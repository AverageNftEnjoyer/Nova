import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config/types.js";
import { discoverBootstrapFiles } from "./bootstrap.js";
import { compactSession } from "./compact.js";
import { getHistoryLimit, limitHistoryTurns } from "./history.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { resolveSession } from "../session/resolve.js";
import { SessionStore } from "../session/store.js";
import type { InboundMessage, TranscriptTurn } from "../session/types.js";
import { acquireLock } from "../session/lock.js";
import type { MemoryIndexManager } from "../memory/manager.js";
import type { Skill } from "../skills/types.js";
import { executeToolUse, toAnthropicToolResultBlock } from "../tools/executor.js";
import type { AnthropicToolUseBlock, Tool } from "../tools/types.js";

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

function extractTextFromResponse(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
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
        tools: params.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema,
        })),
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
    const transcript = sessionStore.loadTranscript(sessionEntry.sessionId);
    const historyLimit = getHistoryLimit(resolved.sessionKey, config.session);
    const limitedHistory = limitHistoryTurns(transcript, historyLimit);

    if (memoryManager && config.memory.enabled && config.memory.syncOnSessionStart) {
      memoryManager.warmSession();
    }

    const bootstrapFiles = discoverBootstrapFiles(config.agent.workspace, {
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

    const client = new Anthropic({ apiKey: config.agent.apiKey });

    let messages: Anthropic.MessageParam[] = transcriptToAnthropicMessages(limitedHistory);
    messages.push({ role: "user", content: inboundMessage.text });

    const toolCalls: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let response: Anthropic.Messages.Message;
    let compactedThisTurn = false;

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
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      const toolUseBlocks = response.content.filter(
        (block): block is AnthropicToolUseBlock => block.type === "tool_use",
      );

      if (toolUseBlocks.length === 0) {
        break;
      }

      messages.push({ role: "assistant", content: response.content as Anthropic.Messages.ContentBlockParam[] });

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        toolCalls.push(toolUse.name);
        const result = await executeToolUse(toolUse, tools);
        toolResults.push(toAnthropicToolResultBlock(result));
      }

      messages.push({
        role: "user",
        content: toolResults,
      });

      response = await request();
    }

    const finalText = extractTextFromResponse(response) || "I could not produce a text response.";

    sessionStore.appendTurnBySessionId(sessionEntry.sessionId, "user", inboundMessage.text);
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
