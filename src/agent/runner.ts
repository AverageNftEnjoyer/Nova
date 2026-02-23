import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config/types.js";
import { discoverBootstrapFiles } from "./bootstrap.js";
import { resolvePersonaWorkspaceDir } from "./persona-workspace.js";
import { compactSession } from "./compact.js";
import { getHistoryLimit, limitHistoryTurns } from "./history.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { resolveSession } from "../session/resolve.js";
import { SessionStore } from "../session/store.js";
import type { InboundMessage, TranscriptTurn } from "../session/types.js";
import { acquireLock } from "../session/lock.js";
import type { MemoryIndexManager } from "../memory/manager.js";
import { applyMemoryWriteThrough } from "../memory/write-through.js";
import { buildMemoryRecallContext, injectMemoryRecallSection } from "../memory/recall.js";
import type { Skill } from "../skills/types.js";
import { executeToolUse, toAnthropicToolResultBlock } from "../tools/core/executor.js";
import { toAnthropicToolDefinitions } from "../tools/core/protocol.js";
import type { AnthropicToolUseBlock, Tool } from "../tools/core/types.js";
import { preprocess, logCorrections } from "../nlp/preprocess.js";

export interface AgentRunResult {
  response: string;
  tokensUsed: number;
  toolCalls: string[];
  sessionKey: string;
}

function isContextOverflowError(error: unknown): boolean {
  const text = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return text.includes("context") && text.includes("length");
}

function isRateLimitError(error: unknown): boolean {
  const maybeStatus = (error as { status?: number })?.status;
  if (maybeStatus === 429) return true;
  const text = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return text.includes("rate") && text.includes("limit");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const safeTimeout = Math.max(1, Number.parseInt(String(timeoutMs || 0), 10) || 1);
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${safeTimeout}ms`)), safeTimeout);
    }),
  ]);
}

function extractTextFromResponse(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function toToolUseBlock(block: Anthropic.Messages.ContentBlock): AnthropicToolUseBlock | null {
  if (block.type !== "tool_use") {
    return null;
  }

  const id = typeof block.id === "string" ? block.id : "";
  const name = typeof block.name === "string" ? block.name : "";
  const input =
    block.input && typeof block.input === "object" && !Array.isArray(block.input)
      ? (block.input as Record<string, unknown>)
      : {};

  if (!id || !name) {
    return null;
  }

  return {
    type: "tool_use",
    id,
    name,
    input,
  };
}

function normalizeTranscriptTurnContent(content: unknown): string | Anthropic.Messages.ContentBlockParam[] {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content as Anthropic.Messages.ContentBlockParam[];
  }

  if (content && typeof content === "object") {
    return JSON.stringify(content);
  }

  return String(content ?? "");
}

function transcriptToAnthropicMessages(turns: TranscriptTurn[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  for (const turn of turns) {
    if (turn.role !== "user" && turn.role !== "assistant") {
      continue;
    }
    messages.push({
      role: turn.role,
      content: normalizeTranscriptTurnContent(turn.content),
    });
  }
  return messages;
}

function collectCompactionSummaries(turns: TranscriptTurn[]): string[] {
  const summaries: string[] = [];
  for (const turn of turns) {
    if (turn.role !== "system") continue;
    if (turn.meta?.kind === "compaction_summary" && typeof turn.content === "string") {
      summaries.push(turn.content.replace(/^\[COMPACTION_SUMMARY\]\s*/i, "").trim());
    }
  }
  return summaries;
}

function envPositiveInt(name: string, fallback: number, minValue: number): number {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.trunc(parsed));
}

async function callAnthropicWithRetry(params: {
  client: Anthropic;
  model: string;
  maxTokens: number;
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Tool[];
  retries?: number;
}): Promise<Anthropic.Messages.Message> {
  const retries = params.retries ?? 3;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await params.client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens,
        system: params.system,
        messages: params.messages,
        tools: toAnthropicToolDefinitions(params.tools),
      });
    } catch (error) {
      if (!isRateLimitError(error) || attempt === retries) {
        throw error;
      }
      const backoff = Math.min(8_000, 500 * 2 ** attempt);
      await delay(backoff);
    }
  }

  throw new Error("Unreachable retry state");
}

export async function runAgentTurn(
  config: Config,
  sessionStore: SessionStore,
  memoryManager: MemoryIndexManager | null,
  tools: Tool[],
  skills: Skill[],
  inboundMessage: InboundMessage,
): Promise<AgentRunResult> {
  const resolved = resolveSession({
    config: config.session,
    store: sessionStore,
    agentName: config.agent.name,
    inboundMessage,
    model: config.agent.model,
  });

  const release = await acquireLock(resolved.sessionKey);
  try {
    const sessionEntry = resolved.sessionEntry;
    const transcript = sessionStore.loadTranscript(sessionEntry.sessionId, sessionEntry.userContextId || "");
    const historyLimit = getHistoryLimit(resolved.sessionKey, config.session);
    const limitedHistory = limitHistoryTurns(transcript, historyLimit);

    if (memoryManager && config.memory.enabled && config.memory.syncOnSessionStart) {
      memoryManager.warmSession();
    }

    // ── NLP preprocessing ──────────────────────────────────────────────────
    // raw_text: persisted to transcript and shown in UI.
    // clean_text: used for memory recall, LLM call, tool routing.
    const nlpResult = await preprocess(inboundMessage.text);
    logCorrections(nlpResult, resolved.sessionKey);
    const rawUserText = nlpResult.raw_text;
    const cleanUserText = nlpResult.clean_text;
    // ──────────────────────────────────────────────────────────────────────

    const personaWorkspaceDir = resolvePersonaWorkspaceDir({
      workspaceRoot: config.agent.workspace,
      userContextRoot: config.session.userContextRoot,
      userContextId: sessionEntry.userContextId || "",
    });

    const memoryUpdate = await applyMemoryWriteThrough({
      input: cleanUserText,
      personaWorkspaceDir,
      memoryManager: memoryManager && config.memory.enabled ? memoryManager : null,
    });
    const nlpCorrectionsMeta = nlpResult.corrections
      .map((c) => ({
        reason: c.reason,
        confidence: c.confidence,
        offsets: c.offsets,
      }))
      .filter((c) => c.reason);
    const nlpTurnMeta = {
      nlpCleanText: cleanUserText !== rawUserText ? cleanUserText : undefined,
      nlpConfidence: nlpResult.confidence,
      nlpCorrectionCount: nlpCorrectionsMeta.length,
      nlpCorrections: nlpCorrectionsMeta.length > 0 ? nlpCorrectionsMeta : undefined,
    };

    if (memoryUpdate.handled) {
      sessionStore.appendTurnBySessionId(sessionEntry.sessionId, "user", rawUserText, undefined, nlpTurnMeta);
      sessionStore.appendTurnBySessionId(sessionEntry.sessionId, "assistant", memoryUpdate.response);
      return {
        response: memoryUpdate.response,
        tokensUsed: 0,
        toolCalls: [],
        sessionKey: resolved.sessionKey,
      };
    }

    const bootstrapFiles = discoverBootstrapFiles(personaWorkspaceDir, {
      bootstrapMaxChars: config.agent.bootstrapMaxChars,
      bootstrapTotalMaxChars: config.agent.bootstrapTotalMaxChars,
    });

    const inheritedSummaries = collectCompactionSummaries(limitedHistory);

    let systemPrompt = buildSystemPrompt({
      mode: "full",
      workspacePath: config.agent.workspace,
      tools,
      skills,
      bootstrapFiles,
      memoryEnabled: config.memory.enabled,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    if (inheritedSummaries.length > 0) {
      systemPrompt += `\n\n## Prior Compaction Summary\n${inheritedSummaries.join("\n\n")}`;
    }

    if (memoryManager && config.memory.enabled) {
      const recallTopK = envPositiveInt("NOVA_MEMORY_RECALL_TOP_K", Math.min(3, Math.max(1, config.memory.topK)), 1);
      const recallMaxChars = envPositiveInt("NOVA_MEMORY_RECALL_MAX_CHARS", 2200, 200);
      const recallMaxTokens = envPositiveInt("NOVA_MEMORY_RECALL_MAX_TOKENS", 480, 80);
      const recallContext = await buildMemoryRecallContext({
        memoryManager,
        query: cleanUserText,   // use clean text for better recall matching
        topK: recallTopK,
        maxChars: recallMaxChars,
        maxTokens: recallMaxTokens,
      });
      systemPrompt = injectMemoryRecallSection(systemPrompt, recallContext);
    }

    const client = new Anthropic({ apiKey: config.agent.apiKey });

    let messages: Anthropic.MessageParam[] = transcriptToAnthropicMessages(limitedHistory);
    // Send clean_text to the LLM; raw_text is stored in the transcript below
    messages.push({ role: "user", content: cleanUserText });

    const toolCalls: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let response: Anthropic.Messages.Message;
    let compactedThisTurn = false;
    const toolLoopMaxSteps = envPositiveInt("NOVA_AGENT_TOOL_LOOP_MAX_STEPS", 8, 1);
    const toolLoopMaxDurationMs = envPositiveInt("NOVA_AGENT_TOOL_LOOP_MAX_DURATION_MS", 32000, 1000);
    const toolExecTimeoutMs = envPositiveInt("NOVA_AGENT_TOOL_EXEC_TIMEOUT_MS", 8000, 1000);
    const toolLoopMaxToolCallsPerStep = envPositiveInt("NOVA_AGENT_TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP", 6, 1);
    const toolLoopStartedAt = Date.now();
    let toolLoopStep = 0;
    let loopTerminationReason = "";

    const request = async () => {
      try {
        return await callAnthropicWithRetry({
          client,
          model: config.agent.model,
          maxTokens: config.agent.maxTokens,
          system: systemPrompt,
          messages,
          tools,
        });
      } catch (error) {
        if (!isContextOverflowError(error) || compactedThisTurn) {
          throw error;
        }

        compactedThisTurn = true;
        const compactResult = await compactSession(client, messages, config.agent.model);
        const compactionEntry = `[COMPACTION_SUMMARY]\n${compactResult.summary}`;
        sessionStore.appendTurnBySessionId(sessionEntry.sessionId, "system", compactionEntry, undefined, {
          kind: "compaction_summary",
        });
        systemPrompt += `\n\n## New Compaction Summary\n${compactResult.summary}`;
        messages = messages.slice(-8);

        return callAnthropicWithRetry({
          client,
          model: config.agent.model,
          maxTokens: config.agent.maxTokens,
          system: systemPrompt,
          messages,
          tools,
        });
      }
    };

    response = await request();

    while (true) {
      toolLoopStep += 1;
      if (toolLoopStep > toolLoopMaxSteps) {
        loopTerminationReason = `tool loop step cap reached (${toolLoopMaxSteps})`;
        break;
      }
      if (Date.now() - toolLoopStartedAt > toolLoopMaxDurationMs) {
        loopTerminationReason = `tool loop duration cap reached (${toolLoopMaxDurationMs}ms)`;
        break;
      }

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      const toolUseBlocks = response.content
        .map((block) => toToolUseBlock(block))
        .filter((block): block is AnthropicToolUseBlock => Boolean(block));

      if (toolUseBlocks.length === 0) {
        break;
      }

      messages.push({ role: "assistant", content: response.content as Anthropic.Messages.ContentBlockParam[] });

      const toolResults = [];
      const cappedToolUseBlocks = toolUseBlocks.slice(0, toolLoopMaxToolCallsPerStep);
      if (toolUseBlocks.length > cappedToolUseBlocks.length) {
        toolResults.push({
          type: "tool_result" as const,
          tool_use_id: "tool-loop-guardrail",
          content: `Tool call count capped at ${toolLoopMaxToolCallsPerStep} for this step.`,
          is_error: true,
        });
      }
      for (const toolUse of cappedToolUseBlocks) {
        toolCalls.push(toolUse.name);
        const result = await withTimeout(
          executeToolUse(toolUse, tools),
          toolExecTimeoutMs,
          `Tool ${toolUse.name}`,
        );
        toolResults.push(toAnthropicToolResultBlock(result));
      }

      messages.push({
        role: "user",
        content: toolResults,
      });

      response = await request();
    }

    let finalText = extractTextFromResponse(response) || "";
    if (!finalText && loopTerminationReason) {
      finalText = `I stopped tool execution early (${loopTerminationReason}). Please retry with a narrower request.`;
    }
    if (!finalText) {
      finalText = "I could not produce a text response.";
    }

    // Persist raw_text so the transcript reflects what the user actually typed
    sessionStore.appendTurnBySessionId(sessionEntry.sessionId, "user", rawUserText, undefined, nlpTurnMeta);
    sessionStore.appendTurnBySessionId(
      sessionEntry.sessionId,
      "assistant",
      finalText,
      {
        input: totalInputTokens,
        output: totalOutputTokens,
        total: totalInputTokens + totalOutputTokens,
      },
    );

    sessionStore.setEntry(resolved.sessionKey, {
      ...sessionEntry,
      updatedAt: Date.now(),
      inputTokens: sessionEntry.inputTokens + totalInputTokens,
      outputTokens: sessionEntry.outputTokens + totalOutputTokens,
      totalTokens: sessionEntry.totalTokens + totalInputTokens + totalOutputTokens,
      contextTokens: sessionEntry.contextTokens + totalInputTokens,
      model: config.agent.model,
    });

    return {
      response: finalText,
      tokensUsed: totalInputTokens + totalOutputTokens,
      toolCalls,
      sessionKey: resolved.sessionKey,
    };
  } finally {
    release();
  }
}
