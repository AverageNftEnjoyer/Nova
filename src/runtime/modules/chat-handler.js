// ===== Chat Handler =====
// handleInput dispatcher split into focused sub-handlers.
// Bug Fix 2: Tool loop errors are now caught, logged, and surfaced to HUD.

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { exec } from "child_process";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GROK_MODEL,
  DEFAULT_GEMINI_MODEL,
  ENABLE_PROVIDER_FALLBACK,
  OPENAI_FALLBACK_MODEL,
  OPENAI_REQUEST_TIMEOUT_MS,
  TOOL_LOOP_ENABLED,
  TOOL_LOOP_MAX_STEPS,
  CLAUDE_CHAT_MAX_TOKENS,
  SPOTIFY_INTENT_MAX_TOKENS,
  OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
  MEMORY_LOOP_ENABLED,
  SESSION_MAX_TURNS,
  SESSION_MAX_HISTORY_TOKENS,
  MAX_PROMPT_TOKENS,
  PROMPT_RESPONSE_RESERVE_TOKENS,
  PROMPT_HISTORY_TARGET_TOKENS,
  PROMPT_MIN_HISTORY_TOKENS,
  PROMPT_CONTEXT_SECTION_MAX_TOKENS,
  PROMPT_BUDGET_DEBUG,
  COMMAND_ACKS,
  AGENT_PROMPT_MODE,
  ROOT_WORKSPACE_DIR,
  ROUTING_PREFERENCE,
  ROUTING_ALLOW_ACTIVE_OVERRIDE,
  ROUTING_PREFERRED_PROVIDERS,
} from "../constants.js";
import { sessionRuntime, toolRuntime, wakeWordRuntime } from "./config.js";
import { resolvePersonaWorkspaceDir, appendRawStream, trimHistoryMessagesByTokenBudget, cachedLoadIntegrationsRuntime } from "./persona-context.js";
import { isMemoryUpdateRequest, extractMemoryUpdateFact, buildMemoryFactMetadata, upsertMemoryFactInMarkdown, ensureMemoryTemplate, extractAutoMemoryFacts } from "./memory.js";
import { buildRuntimeSkillsPrompt } from "./skills.js";
import { shouldBuildWorkflowFromPrompt, shouldDraftOnlyWorkflow, shouldPreloadWebSearch, replyClaimsNoLiveAccess, buildWebSearchReadableReply } from "./intent-router.js";
import { speak, playThinking, stopSpeaking, getBusy, setBusy, getCurrentVoice, normalizeRuntimeTone, runtimeToneDirective } from "./voice.js";
import {
  broadcast,
  broadcastState,
  broadcastMessage,
  createAssistantStreamId,
  broadcastAssistantStreamStart,
  broadcastAssistantStreamDelta,
  broadcastAssistantStreamDone,
} from "./hud-gateway.js";
import {
  claudeMessagesCreate,
  claudeMessagesStream,
  describeUnknownError,
  estimateTokenCostUsd,
  extractOpenAIChatText,
  getOpenAIClient,
  resolveConfiguredChatRuntime,
  streamOpenAiChatCompletion,
  toErrorDetails,
  withTimeout,
} from "./providers.js";
import { buildSystemPromptWithPersona, enforcePromptTokenBound } from "../context-prompt.js";
import { buildAgentSystemPrompt, PromptMode } from "./system-prompt.js";
import { buildPersonaPrompt } from "./bootstrap.js";
import { shouldSkipDuplicateInbound } from "./inbound-dedupe.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "./reply-normalizer.js";
import { runLinkUnderstanding, formatLinkUnderstandingForPrompt } from "./link-understanding.js";
import { appendBudgetedPromptSection, computeHistoryTokenBudget } from "./prompt-budget.js";
import { detectSuspiciousPatterns, wrapWebContent } from "./external-content.js";

function applyMemoryFactsToWorkspace(personaWorkspaceDir, facts) {
  if (!Array.isArray(facts) || facts.length === 0) return 0;
  const memoryFilePath = path.join(personaWorkspaceDir, "MEMORY.md");
  const existingContent = fs.existsSync(memoryFilePath)
    ? fs.readFileSync(memoryFilePath, "utf8")
    : ensureMemoryTemplate();

  let nextContent = existingContent;
  let applied = 0;
  for (const fact of facts) {
    const memoryFact = String(fact?.fact || "").trim();
    const memoryKey = String(fact?.key || "").trim();
    if (!memoryFact) continue;
    const updated = upsertMemoryFactInMarkdown(nextContent, memoryFact, memoryKey || undefined);
    if (updated !== nextContent) {
      nextContent = updated;
      applied += 1;
    }
  }

  if (nextContent !== existingContent) {
    fs.writeFileSync(memoryFilePath, nextContent, "utf8");
  }
  return applied;
}

function hashShadowPayload(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

// ===== Memory update sub-handler =====
async function handleMemoryUpdate(text, ctx) {
  const { source, sender, sessionId, useVoice, ttsVoice, userContextId } = ctx;
  const fact = extractMemoryUpdateFact(text);
  const assistantStreamId = createAssistantStreamId();

  function sendAssistantReply(reply) {
    const normalized = normalizeAssistantReply(reply);
    if (normalized.skip) return "";
    broadcastAssistantStreamStart(assistantStreamId, source);
    broadcastAssistantStreamDelta(assistantStreamId, normalized.text, source);
    broadcastAssistantStreamDone(assistantStreamId, source);
    return normalized.text;
  }

  broadcastState("thinking");
  broadcastMessage("user", text, source);
  if (sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "user", text, { source, sender: sender || null });

  if (!fact) {
    const reply = "Tell me exactly what to remember after 'update your memory'.";
    const finalReply = sendAssistantReply(reply);
    if (finalReply && sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", finalReply, { source, sender: "nova" });
    if (finalReply && useVoice) {
      await speak(normalizeAssistantSpeechText(finalReply) || finalReply, ttsVoice);
    } else broadcastState("idle");
    return;
  }

  try {
    const personaWorkspaceDir = resolvePersonaWorkspaceDir(userContextId);
    const memoryFilePath = path.join(personaWorkspaceDir, "MEMORY.md");
    const existingContent = fs.existsSync(memoryFilePath) ? fs.readFileSync(memoryFilePath, "utf8") : ensureMemoryTemplate();
    const memoryMeta = buildMemoryFactMetadata(fact);
    const updatedContent = upsertMemoryFactInMarkdown(existingContent, memoryMeta.fact, memoryMeta.key);
    fs.writeFileSync(memoryFilePath, updatedContent, "utf8");
    const confirmation = memoryMeta.hasStructuredField
      ? `Memory updated. I will remember this as current: ${memoryMeta.fact}`
      : `Memory updated. I saved: ${memoryMeta.fact}`;
    const finalConfirmation = sendAssistantReply(confirmation);
    if (finalConfirmation && sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", finalConfirmation, { source, sender: "nova" });
    appendRawStream({
      event: "memory_manual_upsert",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: userContextId || undefined,
      key: memoryMeta.key || null,
    });
    console.log(`[Memory] Manual memory update applied for ${userContextId || "anonymous"} key=${memoryMeta.key || "general"}.`);
    if (finalConfirmation && useVoice) {
      await speak(normalizeAssistantSpeechText(finalConfirmation) || finalConfirmation, ttsVoice);
    } else broadcastState("idle");
  } catch (err) {
    const failure = `I couldn't update MEMORY.md: ${describeUnknownError(err)}`;
    const finalFailure = sendAssistantReply(failure);
    if (finalFailure && sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", finalFailure, { source, sender: "nova" });
    if (finalFailure && useVoice) {
      await speak(normalizeAssistantSpeechText(finalFailure) || finalFailure, ttsVoice);
    } else broadcastState("idle");
  }
}

// ===== Shutdown sub-handler =====
async function handleShutdown(ctx) {
  const { ttsVoice } = ctx;
  stopSpeaking();
  await speak("Shutting down now. If you need me again, just restart the system.", ttsVoice);
  process.exit(0);
}

// ===== Spotify sub-handler =====
async function handleSpotify(text, ctx, llmCtx) {
  const { source, useVoice, ttsVoice } = ctx;
  const { activeChatRuntime, activeOpenAiCompatibleClient, selectedChatModel } = llmCtx;
  stopSpeaking();

  const spotifySystemPrompt = `You parse Spotify commands. Given user input, respond with ONLY a JSON object:
{
  "action": "open" | "play" | "pause" | "next" | "previous",
  "query": "search query if playing something, otherwise empty string",
  "type": "track" | "artist" | "playlist" | "album" | "genre",
  "response": "short friendly acknowledgment to say to the user"
}
Examples:
- "open spotify" → { "action": "open", "query": "", "type": "track", "response": "Opening Spotify." }
- "play some jazz" → { "action": "play", "query": "jazz", "type": "genre", "response": "Putting on some jazz for you." }
- "next song" → { "action": "next", "query": "", "type": "track", "response": "Skipping to the next track." }
- "pause the music" → { "action": "pause", "query": "", "type": "track", "response": "Pausing the music." }
Output ONLY valid JSON, nothing else.`;

  let spotifyRaw = "";
  if (activeChatRuntime.provider === "claude") {
    const r = await claudeMessagesCreate({
      apiKey: activeChatRuntime.apiKey,
      baseURL: activeChatRuntime.baseURL,
      model: selectedChatModel,
      system: spotifySystemPrompt,
      userText: text,
      maxTokens: SPOTIFY_INTENT_MAX_TOKENS,
    });
    spotifyRaw = r.text;
  } else {
    const parse = await withTimeout(
      activeOpenAiCompatibleClient.chat.completions.create({
        model: selectedChatModel,
        messages: [{ role: "system", content: spotifySystemPrompt }, { role: "user", content: text }],
      }),
      OPENAI_REQUEST_TIMEOUT_MS,
      "OpenAI Spotify parse",
    );
    spotifyRaw = extractOpenAIChatText(parse);
  }

  try {
    const intent = JSON.parse(spotifyRaw);
    const normalized = normalizeAssistantReply(intent.response);
    if (!normalized.skip) {
      if (useVoice) await speak(normalizeAssistantSpeechText(normalized.text) || normalized.text, ttsVoice);
      else broadcastMessage("assistant", normalized.text, source);
    }

    if (intent.action === "open") {
      exec("start spotify:");
    } else if (intent.action === "pause") {
      exec('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"');
    } else if (intent.action === "next") {
      exec('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB0)"');
    } else if (intent.action === "previous") {
      exec('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB1)"');
    } else if (intent.action === "play" && intent.query) {
      const encoded = encodeURIComponent(intent.query);
      exec(`start "spotify" "spotify:search:${encoded}" && timeout /t 2 >nul && powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"`);
    } else {
      exec("start spotify:");
    }
  } catch (e) {
    console.error("[Spotify] Parse error:", e.message);
    const ack = COMMAND_ACKS[Math.floor(Math.random() * COMMAND_ACKS.length)];
    const normalizedAck = normalizeAssistantReply(ack);
    if (!normalizedAck.skip) {
      if (useVoice) await speak(normalizeAssistantSpeechText(normalizedAck.text) || normalizedAck.text, ttsVoice);
      else broadcastMessage("assistant", normalizedAck.text, source);
    }
    exec("start spotify:");
  }

  broadcastState("idle");
}

// ===== Workflow builder sub-handler =====
async function handleWorkflowBuild(text, ctx, options = {}) {
  const { source, useVoice, ttsVoice } = ctx;
  const engine = String(options.engine || "src").trim().toLowerCase() || "src";
  stopSpeaking();
  broadcastState("thinking");
  broadcastMessage("user", text, source);
  try {
    const deploy = !shouldDraftOnlyWorkflow(text);
    appendRawStream({
      event: "workflow_build_start",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: ctx.userContextId || undefined,
      engine,
      deploy,
    });
    const res = await fetch("http://localhost:3000/api/missions/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text, deploy, engine }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.error || `Workflow build failed (${res.status}).`);

    const label = data?.workflow?.label || "Generated Workflow";
    const provider = data?.provider || "LLM";
    const model = data?.model || "default model";
    const stepCount = Array.isArray(data?.workflow?.summary?.workflowSteps) ? data.workflow.summary.workflowSteps.length : 0;
    const scheduleTime = data?.workflow?.summary?.schedule?.time || "09:00";
    const scheduleTimezone = data?.workflow?.summary?.schedule?.timezone || "America/New_York";

    const reply = data?.deployed
      ? `Built and deployed "${label}" with ${stepCount} workflow steps. It is scheduled for ${scheduleTime} ${scheduleTimezone}. Generated using ${provider} ${model}.`
      : `Built a workflow draft "${label}" with ${stepCount} steps. It's ready for review and not deployed yet. Generated using ${provider} ${model}.`;
    const normalizedReply = normalizeAssistantReply(reply);

    appendRawStream({
      event: "workflow_build_done",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: ctx.userContextId || undefined,
      engine,
      deployed: Boolean(data?.deployed),
      provider,
      model,
      stepCount,
    });
    if (!normalizedReply.skip) {
      broadcastMessage("assistant", normalizedReply.text, source);
      if (useVoice) await speak(normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text, ttsVoice);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Workflow build failed.";
    appendRawStream({
      event: "workflow_build_error",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: ctx.userContextId || undefined,
      engine,
      message: msg,
    });
    const reply = `I couldn't build that workflow yet: ${msg}`;
    const normalizedReply = normalizeAssistantReply(reply);
    if (!normalizedReply.skip) {
      broadcastMessage("assistant", normalizedReply.text, source);
      if (useVoice) await speak(normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text, ttsVoice);
    }
  } finally {
    broadcastState("idle");
  }
}

// ===== Core chat request =====
async function executeChatRequest(text, ctx, llmCtx) {
  const { source, sender, sessionContext, sessionKey, useVoice, ttsVoice, userContextId,
    runtimeTone, runtimeCommunicationStyle, runtimeAssistantName, runtimeCustomInstructions } = ctx;
  const { activeChatRuntime, activeOpenAiCompatibleClient, selectedChatModel, runtimeTools, availableTools, canRunToolLoop, canRunWebSearch, canRunWebFetch } = llmCtx;
  const startedAt = Date.now();
  const observedToolCalls = [];
  let usedMemoryRecall = false;
  let usedWebSearchPreload = false;
  let usedLinkUnderstanding = false;
  let preparedPromptHash = "";
  let emittedAssistantDelta = false;
  const runSummary = {
    ok: false,
    source,
    sessionKey,
    userContextId: userContextId || "",
    provider: activeChatRuntime.provider,
    model: selectedChatModel,
    reply: "",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    latencyMs: 0,
    toolCalls: [],
    memoryRecallUsed: false,
    webSearchPreloadUsed: false,
    linkUnderstandingUsed: false,
    promptHash: "",
    error: "",
  };
  broadcastState("thinking");
  broadcastMessage("user", text, source);
  if (useVoice) playThinking();

  const personaWorkspaceDir = resolvePersonaWorkspaceDir(userContextId);
  const runtimeSkillsPrompt = buildRuntimeSkillsPrompt(personaWorkspaceDir, text);
  const { systemPrompt: baseSystemPrompt, tokenBreakdown } = buildSystemPromptWithPersona({
    buildAgentSystemPrompt,
    buildPersonaPrompt,
    workspaceDir: personaWorkspaceDir,
    promptArgs: {
      workspaceDir: ROOT_WORKSPACE_DIR,
      promptMode:
        AGENT_PROMPT_MODE === PromptMode.MINIMAL || AGENT_PROMPT_MODE === PromptMode.NONE
          ? AGENT_PROMPT_MODE : PromptMode.FULL,
      memoryCitationsMode: String(process.env.NOVA_MEMORY_CITATIONS_MODE || "off").trim().toLowerCase() === "on" ? "on" : "off",
      userTimezone: process.env.NOVA_USER_TIMEZONE || "America/New_York",
      skillsPrompt: runtimeSkillsPrompt || process.env.NOVA_SKILLS_PROMPT || "",
      heartbeatPrompt: process.env.NOVA_HEARTBEAT_PROMPT || "",
      docsPath: process.env.NOVA_DOCS_PATH || "",
      ttsHint: "Keep voice responses concise, clear, and natural.",
      reasoningLevel: "off",
      runtimeInfo: {
        agentId: "nova-agent",
        host: process.env.COMPUTERNAME || "",
        os: process.platform,
        arch: process.arch,
        node: process.version,
        model: selectedChatModel,
        defaultModel: selectedChatModel,
        shell: process.env.ComSpec || process.env.SHELL || "",
        channel: source,
        capabilities: ["voice", "websocket"],
        repoRoot: process.env.ROOT_WORKSPACE_DIR || "",
      },
      workspaceNotes: [
        "This is a first-pass prompt framework integration for Nova.",
        "Future skill/memory metadata plumbing can extend this prompt builder.",
      ],
    },
  });

  let systemPrompt = baseSystemPrompt;
  const personaOverlay = [
    "## Runtime Persona (HUD)",
    runtimeAssistantName ? `- Assistant name: ${runtimeAssistantName}` : "",
    runtimeCommunicationStyle ? `- Communication style: ${runtimeCommunicationStyle}` : "",
    `- Tone: ${runtimeTone}`,
    `- Tone behavior: ${runtimeToneDirective(runtimeTone)}`,
    runtimeCustomInstructions ? `- Custom instructions: ${runtimeCustomInstructions}` : "",
  ].filter(Boolean).join("\n");
  if (personaOverlay) systemPrompt += `\n\n${personaOverlay}`;

  const promptBudgetOptions = {
    userMessage: text,
    maxPromptTokens: MAX_PROMPT_TOKENS,
    responseReserveTokens: PROMPT_RESPONSE_RESERVE_TOKENS,
    historyTargetTokens: PROMPT_HISTORY_TARGET_TOKENS,
    sectionMaxTokens: PROMPT_CONTEXT_SECTION_MAX_TOKENS,
    debug: PROMPT_BUDGET_DEBUG,
  };

  if (canRunWebSearch && shouldPreloadWebSearch(text)) {
    try {
      const preloadResult = await runtimeTools.executeToolUse(
        { id: `tool_preload_${Date.now()}`, name: "web_search", input: { query: text }, type: "tool_use" },
        availableTools,
      );
      const preloadContent = String(preloadResult?.content || "").trim();
      if (preloadContent && !/^web_search error/i.test(preloadContent)) {
        const suspiciousPatterns = detectSuspiciousPatterns(preloadContent);
        if (suspiciousPatterns.length > 0) {
          console.warn(
            `[Security] suspicious web_search preload patterns=${suspiciousPatterns.length} session=${sessionKey}`,
          );
        }
        const safePreloadContent = wrapWebContent(preloadContent, "web_search");
        const prepend = "Use these current results when answering:\n";
        const appended = appendBudgetedPromptSection({
          ...promptBudgetOptions,
          prompt: systemPrompt,
          sectionTitle: "Live Web Search Context",
          sectionBody: `${prepend}${safePreloadContent}`,
        });
        if (appended.included) {
          systemPrompt = appended.prompt;
          usedWebSearchPreload = true;
        }
      }
    } catch (err) {
      console.warn(`[ToolLoop] web_search preload failed: ${describeUnknownError(err)}`);
    }
  }

  if (canRunWebFetch) {
    try {
      const linkResult = await runLinkUnderstanding({
        text,
        runtimeTools,
        availableTools,
        maxLinks: 2,
        maxCharsPerLink: 1800,
      });
      const formatted = formatLinkUnderstandingForPrompt(linkResult.outputs, 3600);
      if (formatted) {
        const suspiciousPatterns = detectSuspiciousPatterns(formatted);
        if (suspiciousPatterns.length > 0) {
          console.warn(
            `[Security] suspicious link context patterns=${suspiciousPatterns.length} session=${sessionKey}`,
          );
        }
        const safeLinkContext = wrapWebContent(formatted, "web_fetch");
        const prepend = "Use this fetched URL context when relevant:\n";
        const appended = appendBudgetedPromptSection({
          ...promptBudgetOptions,
          prompt: systemPrompt,
          sectionTitle: "Link Context",
          sectionBody: `${prepend}${safeLinkContext}`,
        });
        if (appended.included) {
          systemPrompt = appended.prompt;
          usedLinkUnderstanding = true;
          observedToolCalls.push("web_fetch");
        }
      }
    } catch (err) {
      console.warn(`[ToolLoop] link understanding preload failed: ${describeUnknownError(err)}`);
    }
  }

  if (runtimeTools?.memoryManager && MEMORY_LOOP_ENABLED) {
    try {
      runtimeTools.memoryManager.warmSession();
      const recalled = await runtimeTools.memoryManager.search(text, 3);
      if (Array.isArray(recalled) && recalled.length > 0) {
        const memoryContext = recalled
          .map((item, idx) => `[${idx + 1}] ${String(item.source || "unknown")}\n${String(item.content || "").slice(0, 600)}`)
          .join("\n\n");
        const prepend = "Use this indexed context when relevant:\n";
        const appended = appendBudgetedPromptSection({
          ...promptBudgetOptions,
          prompt: systemPrompt,
          sectionTitle: "Live Memory Recall",
          sectionBody: `${prepend}${memoryContext}`,
        });
        if (appended.included) {
          systemPrompt = appended.prompt;
          usedMemoryRecall = true;
        }
      }
    } catch (err) {
      console.warn(`[MemoryLoop] Search failed: ${describeUnknownError(err)}`);
    }
  }

  const tokenInfo = enforcePromptTokenBound(systemPrompt, text, MAX_PROMPT_TOKENS);
  console.log(`[Prompt] Tokens - persona: ${tokenBreakdown.persona}, user: ${tokenInfo.userTokens}`);

  const priorTurns = sessionRuntime.limitTranscriptTurns(sessionContext.transcript, SESSION_MAX_TURNS);
  const rawHistoryMessages = sessionRuntime.transcriptToChatMessages(priorTurns);
  const computedHistoryTokenBudget = computeHistoryTokenBudget({
    maxPromptTokens: MAX_PROMPT_TOKENS,
    responseReserveTokens: PROMPT_RESPONSE_RESERVE_TOKENS,
    userMessage: text,
    systemPrompt,
    maxHistoryTokens: SESSION_MAX_HISTORY_TOKENS,
    minHistoryTokens: PROMPT_MIN_HISTORY_TOKENS,
    targetHistoryTokens: PROMPT_HISTORY_TARGET_TOKENS,
  });
  const historyBudget = trimHistoryMessagesByTokenBudget(rawHistoryMessages, computedHistoryTokenBudget);
  const historyMessages = historyBudget.messages;
  console.log(
    `[Session] key=${sessionKey} sender=${sender || "unknown"} prior_turns=${priorTurns.length} injected_messages=${historyMessages.length} trimmed_messages=${historyBudget.trimmed} history_tokens=${historyBudget.tokens} history_budget=${computedHistoryTokenBudget}`,
  );

  const messages = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: text },
  ];
  preparedPromptHash = hashShadowPayload(JSON.stringify(messages));
  const assistantStreamId = createAssistantStreamId();
  broadcastAssistantStreamStart(assistantStreamId, source);

  let reply = "";
  try {
    let promptTokens = 0;
    let completionTokens = 0;
    let modelUsed = selectedChatModel;

    if (activeChatRuntime.provider === "claude") {
      const claudeMessages = [...historyMessages, { role: "user", content: text }];
      const claudeCompletion = await claudeMessagesStream({
        apiKey: activeChatRuntime.apiKey,
        baseURL: activeChatRuntime.baseURL,
        model: selectedChatModel,
        system: systemPrompt,
        messages: claudeMessages,
        userText: text,
        maxTokens: CLAUDE_CHAT_MAX_TOKENS,
        timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
        onDelta: (delta) => {
          emittedAssistantDelta = true;
          broadcastAssistantStreamDelta(assistantStreamId, delta, source);
        },
      });
      reply = claudeCompletion.text;
      promptTokens = claudeCompletion.usage.promptTokens;
      completionTokens = claudeCompletion.usage.completionTokens;
    } else if (canRunToolLoop) {
      const openAiToolDefs = toolRuntime.toOpenAiToolDefinitions(availableTools);
      const loopMessages = [...messages];
      let usedFallback = false;

      for (let step = 0; step < Math.max(1, TOOL_LOOP_MAX_STEPS); step += 1) {
        let completion = null;
        try {
          completion = await withTimeout(
            activeOpenAiCompatibleClient.chat.completions.create({
              model: modelUsed,
              messages: loopMessages,
              max_completion_tokens: OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
              tools: openAiToolDefs,
              tool_choice: "auto",
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            `Tool loop model ${modelUsed}`,
          );
        } catch (err) {
          if (!usedFallback && OPENAI_FALLBACK_MODEL) {
            usedFallback = true;
            modelUsed = OPENAI_FALLBACK_MODEL;
            console.warn(`[ToolLoop] Primary model failed; retrying with fallback model ${modelUsed}.`);
            completion = await withTimeout(
              activeOpenAiCompatibleClient.chat.completions.create({
                model: modelUsed,
                messages: loopMessages,
                max_completion_tokens: OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
                tools: openAiToolDefs,
                tool_choice: "auto",
              }),
              OPENAI_REQUEST_TIMEOUT_MS,
              `Tool loop fallback model ${modelUsed}`,
            );
          } else {
            throw err;
          }
        }

        const usage = completion?.usage || {};
        promptTokens += Number(usage.prompt_tokens || 0);
        completionTokens += Number(usage.completion_tokens || 0);

        const choice = completion?.choices?.[0]?.message || {};
        const assistantText = typeof choice.content === "string"
          ? choice.content
          : Array.isArray(choice.content)
            ? choice.content.map((p) => (p?.type === "text" ? String(p.text || "") : "")).join("")
            : "";
        const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];

        if (toolCalls.length === 0) {
          reply = assistantText.trim();
          break;
        }

        loopMessages.push({ role: "assistant", content: assistantText || "", tool_calls: toolCalls });

        // Bug Fix 2: tool errors are caught, logged, and surfaced instead of swallowed
        for (const toolCall of toolCalls) {
          const toolName = String(toolCall?.function?.name || toolCall?.id || "").trim();
          if (toolName) observedToolCalls.push(toolName);
          const toolUse = toolRuntime.toOpenAiToolUseBlock(toolCall);
          let toolResult;
          try {
            toolResult = await runtimeTools.executeToolUse(toolUse, availableTools);
          } catch (toolErr) {
            const errMsg = describeUnknownError(toolErr);
            console.error(`[ToolLoop] Tool "${toolCall.function?.name ?? toolCall.id}" failed: ${errMsg}`);
            broadcastAssistantStreamDelta(
              assistantStreamId,
              `[Tool error: ${toolCall.function?.name ?? "unknown"} - ${errMsg}]`,
              source,
            );
            toolResult = { content: `Tool execution failed: ${errMsg}` };
          }
          loopMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: (() => {
              const content = String(toolResult?.content || "");
              const normalizedName = String(toolName || "").toLowerCase();
              if (normalizedName !== "web_search" && normalizedName !== "web_fetch") {
                return content;
              }
              const suspiciousPatterns = detectSuspiciousPatterns(content);
              if (suspiciousPatterns.length > 0) {
                console.warn(
                  `[Security] suspicious ${normalizedName} tool output patterns=${suspiciousPatterns.length} session=${sessionKey}`,
                );
              }
              return wrapWebContent(content, normalizedName === "web_fetch" ? "web_fetch" : "web_search");
            })(),
          });
        }
      }

      if (!reply || !reply.trim()) throw new Error(`Model ${modelUsed} returned no text response after tool loop.`);
    } else {
      let streamed = null;
      let sawPrimaryDelta = false;
      try {
        streamed = await streamOpenAiChatCompletion({
          client: activeOpenAiCompatibleClient,
          model: modelUsed,
          messages,
          timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
          onDelta: (delta) => {
            sawPrimaryDelta = true;
            emittedAssistantDelta = true;
            broadcastAssistantStreamDelta(assistantStreamId, delta, source);
          },
        });
      } catch (primaryError) {
        if (!OPENAI_FALLBACK_MODEL || sawPrimaryDelta) throw primaryError;
        const fallbackModel = OPENAI_FALLBACK_MODEL;
        const primaryDetails = toErrorDetails(primaryError);
        console.warn(
          `[LLM] Primary model failed provider=${activeChatRuntime.provider} model=${modelUsed}` +
          ` status=${primaryDetails.status ?? "n/a"} message=${primaryDetails.message}. Retrying with fallback ${fallbackModel}.`,
        );
        streamed = await streamOpenAiChatCompletion({
          client: activeOpenAiCompatibleClient,
          model: fallbackModel,
          messages,
          timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
          onDelta: (delta) => {
            emittedAssistantDelta = true;
            broadcastAssistantStreamDelta(assistantStreamId, delta, source);
          },
        });
        modelUsed = fallbackModel;
      }
      reply = streamed.reply;
      if (!reply || !reply.trim()) throw new Error(`Model ${modelUsed} returned no text response.`);
      promptTokens = streamed.promptTokens || 0;
      completionTokens = streamed.completionTokens || 0;
    }

    // Refusal recovery: if model claimed no web access, do a search and append results
    if (replyClaimsNoLiveAccess(reply) && canRunWebSearch) {
      try {
        const fallbackResult = await runtimeTools.executeToolUse(
          { id: `tool_refusal_recover_${Date.now()}`, name: "web_search", input: { query: text }, type: "tool_use" },
          availableTools,
        );
        const fallbackContent = String(fallbackResult?.content || "").trim();
        if (fallbackContent && !/^web_search error/i.test(fallbackContent)) {
          const readable = buildWebSearchReadableReply(text, fallbackContent);
          const correction = readable
            ? `I do have live web access in this runtime.\n\n${readable}`
            : `I do have live web access in this runtime. Current web results:\n\n${fallbackContent.slice(0, 2200)}`;
          reply = reply ? `${reply}\n\n${correction}` : correction;
          emittedAssistantDelta = true;
          broadcastAssistantStreamDelta(assistantStreamId, correction, source);
          observedToolCalls.push("web_search");
        }
      } catch (err) {
        console.warn(`[ToolLoop] refusal recovery search failed: ${describeUnknownError(err)}`);
      }
    }

    const normalizedReply = normalizeAssistantReply(reply);
    if (normalizedReply.skip) {
      reply = "";
    } else {
      reply = normalizedReply.text;
    }

    if (reply && !emittedAssistantDelta) {
      emittedAssistantDelta = true;
      broadcastAssistantStreamDelta(assistantStreamId, reply, source);
    }

    const modelForUsage = activeChatRuntime.provider === "claude" ? selectedChatModel : (modelUsed || selectedChatModel);
    const totalTokens = promptTokens + completionTokens;
    const estimatedCostUsd = estimateTokenCostUsd(modelForUsage, promptTokens, completionTokens);

    appendRawStream({ event: "request_done", source, sessionKey, provider: activeChatRuntime.provider, model: modelForUsage, promptTokens, completionTokens, totalTokens, estimatedCostUsd });
    console.log(`[LLM] provider=${activeChatRuntime.provider} model=${modelForUsage} prompt_tokens=${promptTokens} completion_tokens=${completionTokens} total_tokens=${totalTokens}${estimatedCostUsd !== null ? ` estimated_usd=$${estimatedCostUsd}` : ""}`);
    broadcast({ type: "usage", provider: activeChatRuntime.provider, model: modelForUsage, promptTokens, completionTokens, totalTokens, estimatedCostUsd, ts: Date.now() });

    sessionRuntime.appendTranscriptTurn(sessionContext.sessionEntry.sessionId, "user", text, { source, sender: ctx.sender, provider: activeChatRuntime.provider, model: modelForUsage, sessionKey });
    if (reply) {
      sessionRuntime.appendTranscriptTurn(sessionContext.sessionEntry.sessionId, "assistant", reply, { source, sender: "nova", provider: activeChatRuntime.provider, model: modelForUsage, sessionKey, promptTokens, completionTokens, totalTokens });
    }
    sessionContext.persistUsage({ model: modelForUsage, promptTokens, completionTokens });

    try {
      const autoFacts = extractAutoMemoryFacts(text);
      const autoCaptured = applyMemoryFactsToWorkspace(personaWorkspaceDir, autoFacts);
      if (autoCaptured > 0) {
        appendRawStream({
          event: "memory_auto_upsert",
          source,
          sessionKey,
          userContextId: userContextId || undefined,
          captured: autoCaptured,
        });
        console.log(
          `[Memory] Auto-upserted ${autoCaptured} fact(s) for ${userContextId || "anonymous"} in MEMORY.md.`,
        );
      }
    } catch (memoryErr) {
      console.warn(`[Memory] Auto-upsert failed: ${describeUnknownError(memoryErr)}`);
    }

    runSummary.ok = true;
    runSummary.provider = activeChatRuntime.provider;
    runSummary.model = modelForUsage;
    runSummary.reply = reply;
    runSummary.promptTokens = promptTokens;
    runSummary.completionTokens = completionTokens;
    runSummary.totalTokens = totalTokens;
    runSummary.toolCalls = Array.from(new Set(observedToolCalls.filter(Boolean)));
    runSummary.memoryRecallUsed = usedMemoryRecall;
    runSummary.webSearchPreloadUsed = usedWebSearchPreload;
    runSummary.linkUnderstandingUsed = usedLinkUnderstanding;
    runSummary.promptHash = preparedPromptHash;

    if (useVoice && reply) await speak(normalizeAssistantSpeechText(reply) || reply, ttsVoice);
  } catch (err) {
    const details = toErrorDetails(err);
    const msg = details.message || "Unknown model error.";
    appendRawStream({ event: "request_error", source, sessionKey, provider: activeChatRuntime.provider, model: selectedChatModel, status: details.status, code: details.code, type: details.type, requestId: details.requestId, message: msg });
    console.error(`[LLM] Chat request failed provider=${activeChatRuntime.provider} model=${selectedChatModel} status=${details.status ?? "n/a"} code=${details.code ?? "n/a"} message=${msg}`);
    broadcastAssistantStreamDelta(
      assistantStreamId,
      `Model request failed${details.status ? ` (${details.status})` : ""}${details.code ? ` [${details.code}]` : ""}: ${msg}`,
      source,
    );
    runSummary.error = msg;
    runSummary.toolCalls = Array.from(new Set(observedToolCalls.filter(Boolean)));
    runSummary.memoryRecallUsed = usedMemoryRecall;
    runSummary.webSearchPreloadUsed = usedWebSearchPreload;
    runSummary.linkUnderstandingUsed = usedLinkUnderstanding;
    runSummary.promptHash = preparedPromptHash;
  } finally {
    runSummary.latencyMs = Date.now() - startedAt;
    broadcastAssistantStreamDone(assistantStreamId, source);
    broadcastState("idle");
  }

  return runSummary;
}

// ===== Main dispatcher =====
export async function handleInput(text, opts = {}) {
  const sessionContext = sessionRuntime.resolveSessionContext(opts);
  const sessionKey = sessionContext.sessionKey;
  const userContextId = sessionRuntime.resolveUserContextId(opts);
  const useVoice = opts.voice !== false;
  const ttsVoice = opts.ttsVoice || "default";
  const source = opts.source || "hud";
  if (source === "hud" && !userContextId) throw new Error("Missing user context id for HUD request.");

  const sender = String(opts.sender || "").trim();
  const runtimeTone = normalizeRuntimeTone(opts.tone);
  const runtimeCommunicationStyle = String(opts.communicationStyle || "").trim();
  const runtimeAssistantName = String(opts.assistantName || "").trim();
  const runtimeCustomInstructions = String(opts.customInstructions || "").trim();
  const inboundMessageId = String(opts.inboundMessageId || "").trim();
  const n = text.toLowerCase().trim();

  if (shouldSkipDuplicateInbound({
    text,
    source,
    sender,
    userContextId,
    sessionKey,
    inboundMessageId,
  })) {
    appendRawStream({
      event: "request_duplicate_skipped",
      source,
      sessionKey,
      userContextId: userContextId || undefined,
      chars: String(text || "").length,
    });
    return;
  }

  appendRawStream({ event: "request_start", source, sessionKey, userContextId: userContextId || undefined, chars: String(text || "").length });

  if (runtimeAssistantName && typeof wakeWordRuntime?.setAssistantName === "function") {
    wakeWordRuntime.setAssistantName(runtimeAssistantName);
  }

  const ctx = {
    source, sender, sessionContext, sessionKey, userContextId,
    useVoice, ttsVoice, runtimeTone, runtimeCommunicationStyle,
    runtimeAssistantName, runtimeCustomInstructions,
    sessionId: sessionContext.sessionEntry?.sessionId,
  };

  // Memory update — short-circuit before any LLM call
  if (isMemoryUpdateRequest(text)) {
    await handleMemoryUpdate(text, ctx);
    return;
  }

  const runtimeTools = await toolRuntime.initToolRuntimeIfNeeded({ userContextId });
  const availableTools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
  const canRunToolLoop = TOOL_LOOP_ENABLED && availableTools.length > 0 && typeof runtimeTools?.executeToolUse === "function";
  const canRunWebSearch = canRunToolLoop && availableTools.some((t) => String(t?.name || "") === "web_search");
  const canRunWebFetch = canRunToolLoop && availableTools.some((t) => String(t?.name || "") === "web_fetch");

  // Resolve provider (Bug Fix 4: uses cached loader) + routing arbitration
  const integrationsRuntime = cachedLoadIntegrationsRuntime({ userContextId });
  const activeChatRuntime = resolveConfiguredChatRuntime(integrationsRuntime, {
    strictActiveProvider: !ENABLE_PROVIDER_FALLBACK,
    preference: ROUTING_PREFERENCE,
    requiresToolCalling: canRunToolLoop,
    allowActiveProviderOverride: ENABLE_PROVIDER_FALLBACK && ROUTING_ALLOW_ACTIVE_OVERRIDE,
    preferredProviders: ROUTING_PREFERRED_PROVIDERS,
  });

  if (!activeChatRuntime.apiKey) {
    const providerName = activeChatRuntime.provider === "claude" ? "Claude" : activeChatRuntime.provider === "grok" ? "Grok" : activeChatRuntime.provider === "gemini" ? "Gemini" : "OpenAI";
    throw new Error(`Missing ${providerName} API key for active provider "${activeChatRuntime.provider}". Configure Integrations first.`);
  }
  if (!activeChatRuntime.connected) {
    throw new Error(`Active provider "${activeChatRuntime.provider}" is not enabled. Enable it or switch activeLlmProvider.`);
  }

  const activeOpenAiCompatibleClient = activeChatRuntime.provider === "claude"
    ? null
    : getOpenAIClient({ apiKey: activeChatRuntime.apiKey, baseURL: activeChatRuntime.baseURL });
  const selectedChatModel = activeChatRuntime.model
    || (activeChatRuntime.provider === "claude" ? DEFAULT_CLAUDE_MODEL
      : activeChatRuntime.provider === "grok" ? DEFAULT_GROK_MODEL
      : activeChatRuntime.provider === "gemini" ? DEFAULT_GEMINI_MODEL
      : DEFAULT_CHAT_MODEL);

  console.log(
    `[RuntimeSelection] session=${sessionKey} provider=${activeChatRuntime.provider}` +
    ` model=${selectedChatModel} source=${source}` +
    ` route=${String(activeChatRuntime.routeReason || "n/a")}` +
    ` candidates=${Array.isArray(activeChatRuntime.rankedCandidates) ? activeChatRuntime.rankedCandidates.join(">") : activeChatRuntime.provider}`,
  );

  const llmCtx = { activeChatRuntime, activeOpenAiCompatibleClient, selectedChatModel, runtimeTools, availableTools, canRunToolLoop, canRunWebSearch, canRunWebFetch };

  // Route to sub-handler
  if (n === "nova shutdown" || n === "nova shut down" || n === "shutdown nova") {
    await handleShutdown(ctx);
    return;
  }

  if (n.includes("spotify") || n.includes("play music") || n.includes("play some") || n.includes("put on ")) {
    await handleSpotify(text, ctx, llmCtx);
    return;
  }

  if (shouldBuildWorkflowFromPrompt(text)) {
    await handleWorkflowBuild(text, ctx, { engine: "src" });
    return;
  }

  await executeChatRequest(text, ctx, llmCtx);
}
