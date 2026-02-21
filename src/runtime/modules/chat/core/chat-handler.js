// ===== Chat Handler =====
// handleInput dispatcher split into focused sub-handlers.
// Bug Fix 2: Tool loop errors are now caught, logged, and surfaced to HUD.

import { createRequire } from "module";

// NLP preprocessing (compiled TS → dist/nlp/preprocess.js)
// Loaded lazily so a missing build does not crash the runtime.
let _preprocess = null;
function getPreprocess() {
  if (_preprocess) return _preprocess;
  try {
    const require = createRequire(import.meta.url);
    // Resolve relative to the project root dist output
    const mod = require("../../../../../dist/nlp/preprocess.js");
    _preprocess = mod.preprocess ?? mod.default?.preprocess ?? null;
  } catch {
    // Build not available yet — fall back to identity
    _preprocess = (text) => ({ raw_text: text, clean_text: text, corrections: [], confidence: 1.0 });
  }
  return _preprocess;
}
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
  AGENT_PROMPT_MODE,
  ROOT_WORKSPACE_DIR,
  ROUTING_PREFERENCE,
  ROUTING_ALLOW_ACTIVE_OVERRIDE,
  ROUTING_PREFERRED_PROVIDERS,
} from "../../../core/constants.js";
import { sessionRuntime, toolRuntime, wakeWordRuntime } from "../../infrastructure/config.js";
import { resolvePersonaWorkspaceDir, appendRawStream, trimHistoryMessagesByTokenBudget, cachedLoadIntegrationsRuntime } from "../../context/persona-context.js";
import { captureUserPreferencesFromMessage, buildUserPreferencePromptSection } from "../../context/user-preferences.js";
import { isMemoryUpdateRequest, extractAutoMemoryFacts } from "../../context/memory.js";
import { buildRuntimeSkillsPrompt } from "../../context/skills.js";
import { shouldBuildWorkflowFromPrompt, shouldConfirmWorkflowFromPrompt, shouldPreloadWebSearch, replyClaimsNoLiveAccess, buildWebSearchReadableReply, buildWeatherWebSummary } from "../routing/intent-router.js";
import { speak, playThinking, getBusy, setBusy, getCurrentVoice, normalizeRuntimeTone, runtimeToneDirective } from "../../audio/voice.js";
import {
  broadcast,
  broadcastState,
  broadcastThinkingStatus,
  broadcastMessage,
  createAssistantStreamId,
  broadcastAssistantStreamStart,
  broadcastAssistantStreamDelta,
  broadcastAssistantStreamDone,
} from "../../infrastructure/hud-gateway.js";
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
} from "../../llm/providers.js";
import { buildSystemPromptWithPersona, enforcePromptTokenBound } from "../../../core/context-prompt.js";
import { buildAgentSystemPrompt, PromptMode } from "../../context/system-prompt.js";
import { buildPersonaPrompt } from "../../context/bootstrap.js";
import { shouldSkipDuplicateInbound } from "../routing/inbound-dedupe.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "../quality/reply-normalizer.js";
import { normalizeInboundUserText } from "../quality/response-quality-guard.js";
import { appendDevConversationLog } from "../telemetry/dev-conversation-log.js";
import { parseOutputConstraints, validateOutputConstraints } from "../quality/output-constraints.js";
import { runLinkUnderstanding, formatLinkUnderstandingForPrompt } from "../analysis/link-understanding.js";
import { appendBudgetedPromptSection, computeHistoryTokenBudget, resolveDynamicPromptBudget } from "../prompt/prompt-budget.js";
import {
  buildLatencyTurnPolicy,
  resolveToolExecutionPolicy,
} from "../telemetry/latency-policy.js";
import { createChatLatencyTelemetry } from "../telemetry/latency-telemetry.js";
import { detectSuspiciousPatterns, wrapWebContent } from "../../context/external-content.js";
import {
  applyMemoryFactsToWorkspace,
  buildMissionConfirmReply,
  clearPendingMissionConfirm,
  getPendingMissionConfirm,
  hashShadowPayload,
  isMissionConfirmNo,
  isMissionConfirmYes,
  resolveConversationId,
  setPendingMissionConfirm,
  stripAssistantInvocation,
  stripMissionConfirmPrefix,
  summarizeToolResultPreview,
} from "./chat-utils.js";
import {
  sendDirectAssistantReply,
  handleMemoryUpdate,
  handleShutdown,
  handleSpotify,
  handleWorkflowBuild,
} from "./chat-special-handlers.js";
import {
  isWeatherRequestText,
  tryWeatherFastPathReply,
  getPendingWeatherConfirm,
  setPendingWeatherConfirm,
  clearPendingWeatherConfirm,
  isWeatherConfirmYes,
  isWeatherConfirmNo,
} from "../fast-path/weather-fast-path.js";
import {
  isCryptoRequestText,
  tryCryptoFastPathReply,
} from "../fast-path/crypto-fast-path.js";

const MEMORY_RECALL_TIMEOUT_MS = Number.parseInt(process.env.NOVA_MEMORY_RECALL_TIMEOUT_MS || "450", 10);
const WEB_PRELOAD_TIMEOUT_MS = Number.parseInt(process.env.NOVA_WEB_PRELOAD_TIMEOUT_MS || "900", 10);
const LINK_PRELOAD_TIMEOUT_MS = Number.parseInt(process.env.NOVA_LINK_PRELOAD_TIMEOUT_MS || "900", 10);


// ===== Core chat request =====
async function executeChatRequest(text, ctx, llmCtx, requestHints = {}) {
  const { source, sender, sessionContext, sessionKey, useVoice, ttsVoice, userContextId, conversationId,
    runtimeTone, runtimeCommunicationStyle, runtimeAssistantName, runtimeCustomInstructions,
    raw_text: displayText } = ctx;
  // displayText: original user text for UI/transcript; text: clean_text for LLM/tools
  const uiText = displayText || text;
  const {
    activeChatRuntime,
    activeOpenAiCompatibleClient,
    selectedChatModel,
    runtimeTools,
    availableTools,
    canRunToolLoop,
    canRunWebSearch,
    canRunWebFetch,
    turnPolicy,
    executionPolicy,
    latencyTelemetry: inboundLatencyTelemetry,
  } = llmCtx;
  const fastLaneSimpleChat = requestHints.fastLaneSimpleChat === true;
  const shouldPreloadWebSearchForTurn = executionPolicy?.shouldPreloadWebSearch === true;
  const shouldPreloadWebFetchForTurn = executionPolicy?.shouldPreloadWebFetch === true;
  const shouldAttemptMemoryRecallForTurn = executionPolicy?.shouldAttemptMemoryRecall === true;
  const outputConstraints = parseOutputConstraints(text);
  const hasStrictOutputRequirements = outputConstraints.enabled === true && Boolean(outputConstraints.instructions);
  const startedAt = Date.now();
  const latencyTelemetry = inboundLatencyTelemetry || createChatLatencyTelemetry(startedAt);
  const observedToolCalls = [];
  const toolExecutions = [];
  const retries = [];
  let usedMemoryRecall = false;
  let usedWebSearchPreload = false;
  let usedLinkUnderstanding = false;
  let responseRoute = "llm";
  let memoryAutoCaptured = 0;
  let preparedPromptHash = "";
  let emittedAssistantDelta = false;
  let preferredNamePinned = false;
  let preferenceProfileUpdated = 0;
  let outputConstraintCorrectionPasses = 0;
  const runSummary = {
    route: "chat",
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
    toolExecutions: [],
    retries: [],
    requestHints: {
      fastLaneSimpleChat,
      strictOutputConstraints: hasStrictOutputRequirements,
      preferredNamePinned: false,
      latencyPolicy: turnPolicy?.fastLaneSimpleChat === true ? "fast_lane" : "default",
    },
    canRunToolLoop,
    canRunWebSearch,
    canRunWebFetch,
    responseRoute,
    memoryAutoCaptured: 0,
    preferenceProfileUpdated: 0,
    memoryRecallUsed: false,
    webSearchPreloadUsed: false,
    linkUnderstandingUsed: false,
    correctionPassCount: 0,
    latencyStages: {},
    latencyHotPath: "",
    promptHash: "",
    error: "",
  };
  if (turnPolicy && typeof turnPolicy === "object") {
    runSummary.requestHints.weatherIntent = turnPolicy.weatherIntent === true;
    runSummary.requestHints.cryptoIntent = turnPolicy.cryptoIntent === true;
    runSummary.requestHints.toolLoopCandidate = turnPolicy.toolLoopCandidate === true;
    runSummary.requestHints.memoryRecallCandidate = turnPolicy.memoryRecallCandidate === true;
  }
  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Analyzing request", userContextId);
  const nlpCorrectionCount = Array.isArray(ctx.nlpCorrections) ? ctx.nlpCorrections.length : 0;
  broadcastMessage("user", uiText, source, conversationId, userContextId, {
    nlpCleanText: text !== uiText ? text : undefined,
    nlpConfidence: Number.isFinite(Number(ctx.nlpConfidence)) ? Number(ctx.nlpConfidence) : undefined,
    nlpCorrectionCount,
    nlpBypass: ctx.nlpBypass === true,
  });
  if (useVoice) playThinking();

  const promptAssemblyStartedAt = Date.now();
  const personaWorkspaceDir = resolvePersonaWorkspaceDir(userContextId);
  const preferenceCapture = captureUserPreferencesFromMessage({
    userContextId,
    workspaceDir: personaWorkspaceDir,
    userInputText: uiText,
    nlpConfidence: Number.isFinite(Number(ctx?.nlpConfidence)) ? Number(ctx.nlpConfidence) : 1,
    source,
    sessionKey,
  });
  preferenceProfileUpdated = Array.isArray(preferenceCapture?.updatedKeys) ? preferenceCapture.updatedKeys.length : 0;
  const preferencePrompt = buildUserPreferencePromptSection(preferenceCapture?.preferences || {});
  preferredNamePinned = Boolean(preferenceCapture?.preferences?.preferredName);
  runSummary.requestHints.preferredNamePinned = preferredNamePinned;
  if (preferenceProfileUpdated > 0) {
    console.log(
      `[Preference] Updated ${preferenceProfileUpdated} field(s) for ${userContextId || "anonymous"} at ${String(preferenceCapture?.filePath || "unknown")}.`,
    );
  }

  const runtimeSkillsPrompt = fastLaneSimpleChat ? "" : buildRuntimeSkillsPrompt(personaWorkspaceDir, text);
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
      workspaceNotes: [],
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

  const promptBudgetProfile = resolveDynamicPromptBudget({
    maxPromptTokens: MAX_PROMPT_TOKENS,
    responseReserveTokens: PROMPT_RESPONSE_RESERVE_TOKENS,
    historyTargetTokens: PROMPT_HISTORY_TARGET_TOKENS,
    sectionMaxTokens: PROMPT_CONTEXT_SECTION_MAX_TOKENS,
    fastLaneSimpleChat,
    strictOutputConstraints: hasStrictOutputRequirements,
  });
  runSummary.requestHints.latencyPolicy = promptBudgetProfile.profile;

  const promptBudgetOptions = {
    userMessage: text,
    maxPromptTokens: promptBudgetProfile.maxPromptTokens,
    responseReserveTokens: promptBudgetProfile.responseReserveTokens,
    historyTargetTokens: promptBudgetProfile.historyTargetTokens,
    sectionMaxTokens: promptBudgetProfile.sectionMaxTokens,
    debug: PROMPT_BUDGET_DEBUG,
  };

  if (preferencePrompt) {
    const appended = appendBudgetedPromptSection({
      ...promptBudgetOptions,
      prompt: systemPrompt,
      sectionTitle: "User Preference Memory",
      sectionBody: preferencePrompt,
    });
    if (appended.included) {
      systemPrompt = appended.prompt;
    } else {
      systemPrompt = `${systemPrompt}\n\n## User Preference Memory\n${preferencePrompt}`;
    }
  }

  const enrichmentTasks = [];
  if (shouldPreloadWebSearchForTurn && shouldPreloadWebSearch(text)) {
    enrichmentTasks.push(
      withTimeout(
        (async () => {
          const preloadResult = await runtimeTools.executeToolUse(
            { id: `tool_preload_${Date.now()}`, name: "web_search", input: { query: text }, type: "tool_use" },
            availableTools,
          );
          const preloadContent = String(preloadResult?.content || "").trim();
          if (!preloadContent || /^web_search error/i.test(preloadContent)) return null;
          const suspiciousPatterns = detectSuspiciousPatterns(preloadContent);
          if (suspiciousPatterns.length > 0) {
            console.warn(
              `[Security] suspicious web_search preload patterns=${suspiciousPatterns.length} session=${sessionKey}`,
            );
          }
          return {
            kind: "web_search",
            body: `Use these current results when answering:\n${wrapWebContent(preloadContent, "web_search")}`,
          };
        })(),
        Math.max(250, WEB_PRELOAD_TIMEOUT_MS),
        "Web search preload",
      ),
    );
  }

  if (shouldPreloadWebFetchForTurn) {
    enrichmentTasks.push(
      withTimeout(
        (async () => {
          const linkResult = await runLinkUnderstanding({
            text,
            runtimeTools,
            availableTools,
            maxLinks: 2,
            maxCharsPerLink: 1800,
          });
          const formatted = formatLinkUnderstandingForPrompt(linkResult.outputs, 3600);
          if (!formatted) return null;
          const suspiciousPatterns = detectSuspiciousPatterns(formatted);
          if (suspiciousPatterns.length > 0) {
            console.warn(
              `[Security] suspicious link context patterns=${suspiciousPatterns.length} session=${sessionKey}`,
            );
          }
          return {
            kind: "web_fetch",
            body: `Use this fetched URL context when relevant:\n${wrapWebContent(formatted, "web_fetch")}`,
          };
        })(),
        Math.max(250, LINK_PRELOAD_TIMEOUT_MS),
        "Link preload",
      ),
    );
  }

  if (shouldAttemptMemoryRecallForTurn && runtimeTools?.memoryManager && MEMORY_LOOP_ENABLED) {
    enrichmentTasks.push(
      (async () => {
        runtimeTools.memoryManager.warmSession();
        const recalled = await withTimeout(
          runtimeTools.memoryManager.search(text, 3),
          Math.max(150, MEMORY_RECALL_TIMEOUT_MS),
          "Memory recall search",
        );
        if (!Array.isArray(recalled) || recalled.length === 0) return null;
        const memoryContext = recalled
          .map((item, idx) => `[${idx + 1}] ${String(item.source || "unknown")}\n${String(item.content || "").slice(0, 600)}`)
          .join("\n\n");
        return {
          kind: "memory",
          body: `Use this indexed context when relevant:\n${memoryContext}`,
        };
      })(),
    );
  }

  if (enrichmentTasks.length > 0) {
    const enrichmentStartedAt = Date.now();
    broadcastThinkingStatus("Gathering context", userContextId);
    const enrichmentResults = await Promise.allSettled(enrichmentTasks);
    for (const taskResult of enrichmentResults) {
      if (taskResult.status === "rejected") {
        const msg = describeUnknownError(taskResult.reason);
        if (/memory/i.test(msg)) console.warn(`[MemoryLoop] Search failed: ${msg}`);
        else if (/link/i.test(msg)) console.warn(`[ToolLoop] link understanding preload failed: ${msg}`);
        else console.warn(`[ToolLoop] web_search preload failed: ${msg}`);
        continue;
      }

      const taskValue = taskResult.value;
      if (!taskValue || !taskValue.kind || !taskValue.body) continue;
      if (taskValue.kind === "web_search") {
        const appended = appendBudgetedPromptSection({
          ...promptBudgetOptions,
          prompt: systemPrompt,
          sectionTitle: "Live Web Search Context",
          sectionBody: taskValue.body,
        });
        if (appended.included) {
          systemPrompt = appended.prompt;
          usedWebSearchPreload = true;
          latencyTelemetry.incrementCounter("web_search_preload_hits");
        }
        continue;
      }
      if (taskValue.kind === "web_fetch") {
        const appended = appendBudgetedPromptSection({
          ...promptBudgetOptions,
          prompt: systemPrompt,
          sectionTitle: "Link Context",
          sectionBody: taskValue.body,
        });
        if (appended.included) {
          systemPrompt = appended.prompt;
          usedLinkUnderstanding = true;
          observedToolCalls.push("web_fetch");
          latencyTelemetry.incrementCounter("web_fetch_preload_hits");
        }
        continue;
      }
      if (taskValue.kind === "memory") {
        const appended = appendBudgetedPromptSection({
          ...promptBudgetOptions,
          prompt: systemPrompt,
          sectionTitle: "Live Memory Recall",
          sectionBody: taskValue.body,
        });
        if (appended.included) {
          systemPrompt = appended.prompt;
          usedMemoryRecall = true;
          latencyTelemetry.incrementCounter("memory_recall_hits");
        }
      }
    }
    latencyTelemetry.addStage("context_enrichment", Date.now() - enrichmentStartedAt);
  }

  if (hasStrictOutputRequirements) {
    const appended = appendBudgetedPromptSection({
      ...promptBudgetOptions,
      prompt: systemPrompt,
      sectionTitle: "Strict Output Requirements",
      sectionBody: outputConstraints.instructions,
    });
    if (appended.included) {
      systemPrompt = appended.prompt;
    } else {
      systemPrompt = `${systemPrompt}\n\n## Strict Output Requirements\n${outputConstraints.instructions}`;
    }
  }

  const tokenInfo = enforcePromptTokenBound(systemPrompt, text, MAX_PROMPT_TOKENS);
  broadcastThinkingStatus("Planning response", userContextId);
  console.log(`[Prompt] Tokens - persona: ${tokenBreakdown.persona}, user: ${tokenInfo.userTokens}`);

  const priorTurns = sessionRuntime.limitTranscriptTurns(sessionContext.transcript, SESSION_MAX_TURNS);
  const rawHistoryMessages = sessionRuntime.transcriptToChatMessages(priorTurns);
  const computedHistoryTokenBudget = computeHistoryTokenBudget({
    maxPromptTokens: promptBudgetProfile.maxPromptTokens,
    responseReserveTokens: promptBudgetProfile.responseReserveTokens,
    userMessage: text,
    systemPrompt,
    maxHistoryTokens: SESSION_MAX_HISTORY_TOKENS,
    minHistoryTokens: PROMPT_MIN_HISTORY_TOKENS,
    targetHistoryTokens: promptBudgetProfile.historyTargetTokens,
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
  latencyTelemetry.addStage("prompt_assembly", Date.now() - promptAssemblyStartedAt);
  const assistantStreamId = createAssistantStreamId();
  broadcastAssistantStreamStart(assistantStreamId, source, undefined, conversationId, userContextId);

  let reply = "";
  try {
    let promptTokens = 0;
    let completionTokens = 0;
    let modelUsed = selectedChatModel;
    const fastPathStartedAt = Date.now();

    const weatherFastResult = await tryWeatherFastPathReply({
      text,
      runtimeTools,
      availableTools,
      canRunWebSearch,
    });
    const cryptoFastResult = String(weatherFastResult?.reply || "").trim()
      ? { reply: "", source: "" }
      : await tryCryptoFastPathReply({
          text,
          runtimeTools,
          availableTools,
          userContextId,
          conversationId,
        });
    latencyTelemetry.addStage("fast_path", Date.now() - fastPathStartedAt);
    let llmStartedAt = 0;

    if (String(weatherFastResult?.reply || "").trim()) {
      responseRoute = "weather_fast_path";
      const suggestedLocation = String(weatherFastResult?.suggestedLocation || "").trim();
      if (weatherFastResult?.needsConfirmation && suggestedLocation) {
        setPendingWeatherConfirm(sessionKey, text, suggestedLocation);
        broadcastThinkingStatus("Confirming location", userContextId);
      } else {
        clearPendingWeatherConfirm(sessionKey);
        broadcastThinkingStatus("Summarizing weather", userContextId);
      }
      reply = String(weatherFastResult.reply || "").trim();
      if (weatherFastResult?.toolCall) observedToolCalls.push(String(weatherFastResult.toolCall));
    } else if (String(cryptoFastResult?.reply || "").trim()) {
      responseRoute = "crypto_fast_path";
      clearPendingWeatherConfirm(sessionKey);
      broadcastThinkingStatus("Checking Coinbase", userContextId);
      reply = String(cryptoFastResult.reply || "").trim();
      if (cryptoFastResult?.toolCall) observedToolCalls.push(String(cryptoFastResult.toolCall));
    } else if (activeChatRuntime.provider === "claude") {
      llmStartedAt = Date.now();
      responseRoute = "claude_direct";
      broadcastThinkingStatus("Drafting response", userContextId);
      const claudeMessages = [...historyMessages, { role: "user", content: text }];
      const claudeCompletion = hasStrictOutputRequirements
        ? await withTimeout(
            claudeMessagesCreate({
              apiKey: activeChatRuntime.apiKey,
              baseURL: activeChatRuntime.baseURL,
              model: selectedChatModel,
              system: systemPrompt,
              messages: claudeMessages,
              userText: text,
              maxTokens: CLAUDE_CHAT_MAX_TOKENS,
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            `Claude model ${selectedChatModel}`,
          )
        : await claudeMessagesStream({
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
              broadcastAssistantStreamDelta(assistantStreamId, delta, source, undefined, conversationId, userContextId);
            },
          });
      reply = claudeCompletion.text;
      promptTokens = claudeCompletion.usage.promptTokens;
      completionTokens = claudeCompletion.usage.completionTokens;
    } else if (canRunToolLoop) {
      llmStartedAt = Date.now();
      responseRoute = "tool_loop";
      const openAiToolDefs = toolRuntime.toOpenAiToolDefinitions(availableTools);
      const loopMessages = [...messages];
      const toolOutputsForRecovery = [];
      let forcedToolFallbackReply = "";
      let usedFallback = false;

      for (let step = 0; step < Math.max(1, TOOL_LOOP_MAX_STEPS); step += 1) {
        broadcastThinkingStatus("Reasoning", userContextId);
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
            retries.push({
              stage: "tool_loop_completion",
              fromModel: selectedChatModel,
              toModel: modelUsed,
              reason: "primary_failed",
            });
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
        const assistantText = extractOpenAIChatText(completion);
        const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];

        if (toolCalls.length === 0) {
          reply = assistantText.trim();
          break;
        }

        loopMessages.push({ role: "assistant", content: assistantText || "", tool_calls: toolCalls });

        // Bug Fix 2: tool errors are caught, logged, and surfaced instead of swallowed
        for (const toolCall of toolCalls) {
          const toolName = String(toolCall?.function?.name || toolCall?.id || "").trim();
          const normalizedToolName = toolName.toLowerCase();
          if (normalizedToolName === "web_search") broadcastThinkingStatus("Searching web", userContextId);
          else if (normalizedToolName === "web_fetch") broadcastThinkingStatus("Reviewing sources", userContextId);
          else if (normalizedToolName.startsWith("coinbase_")) broadcastThinkingStatus("Querying Coinbase", userContextId);
          else broadcastThinkingStatus("Running tools", userContextId);
          if (toolName) observedToolCalls.push(toolName);
          const toolUse = toolRuntime.toOpenAiToolUseBlock(toolCall);
          if (String(toolUse?.name || "").toLowerCase().startsWith("coinbase_")) {
            toolUse.input = {
              ...(toolUse.input && typeof toolUse.input === "object" ? toolUse.input : {}),
              userContextId,
              conversationId,
            };
          }
          let toolResult;
          const toolStartedAt = Date.now();
          try {
            toolResult = await runtimeTools.executeToolUse(toolUse, availableTools);
            toolExecutions.push({
              name: normalizedToolName || "unknown",
              status: "ok",
              durationMs: Date.now() - toolStartedAt,
              resultPreview: summarizeToolResultPreview(toolResult?.content || ""),
            });
          } catch (toolErr) {
            const errMsg = describeUnknownError(toolErr);
            console.error(`[ToolLoop] Tool "${toolCall.function?.name ?? toolCall.id}" failed: ${errMsg}`);
            broadcastAssistantStreamDelta(
              assistantStreamId,
              `[Tool error: ${toolCall.function?.name ?? "unknown"} - ${errMsg}]`,
              source,
              undefined,
              conversationId,
              userContextId,
            );
            toolExecutions.push({
              name: normalizedToolName || "unknown",
              status: "error",
              durationMs: Date.now() - toolStartedAt,
              error: errMsg,
              resultPreview: "",
            });
            toolResult = { content: `Tool execution failed: ${errMsg}` };
          }
          loopMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: (() => {
              const content = String(toolResult?.content || "");
              const normalizedName = String(toolName || "").toLowerCase();
              if (content.trim()) {
                toolOutputsForRecovery.push({ name: normalizedName, content });
                if (normalizedName === "web_search" && /^web_search error:/i.test(content)) {
                  if (/missing brave api key/i.test(content)) {
                    forcedToolFallbackReply =
                      "Live web search is unavailable because the Brave API key is missing. Add Brave in Integrations and retry.";
                  } else if (/rate limited/i.test(content)) {
                    forcedToolFallbackReply =
                      "Live web search is currently rate-limited. Please retry in a moment.";
                  } else {
                    forcedToolFallbackReply =
                      `Live web search failed: ${content.replace(/^web_search error:\s*/i, "").trim()}`;
                  }
                }
              }
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

        if (forcedToolFallbackReply) {
          reply = forcedToolFallbackReply;
          break;
        }
      }

      if (!reply || !reply.trim()) {
        broadcastThinkingStatus("Recovering final answer", userContextId);
        // Some OpenAI-compatible providers can end tool loops without a terminal text message.
        // Try one no-tools recovery completion first, then fall back to the latest tool output.
        try {
          const recovery = await withTimeout(
            activeOpenAiCompatibleClient.chat.completions.create({
              model: modelUsed,
              messages: [
                ...loopMessages,
                {
                  role: "user",
                  content: "Provide the final answer to the user using the tool results above. Keep it concise and actionable.",
                },
              ],
              max_completion_tokens: OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            `Tool loop recovery model ${modelUsed}`,
          );
          reply = extractOpenAIChatText(recovery).trim();
        } catch (recoveryErr) {
          console.warn(`[ToolLoop] recovery completion failed: ${describeUnknownError(recoveryErr)}`);
        }
      }

      if (!reply || !reply.trim()) {
        const latestUsefulTool = [...toolOutputsForRecovery]
          .reverse()
          .find((entry) => {
            const content = String(entry?.content || "").trim();
            if (!content) return false;
            if (entry.name === "web_search" && /^web_search error/i.test(content)) return false;
            if (entry.name === "web_fetch" && /^web_fetch error/i.test(content)) return false;
            return true;
          });

        if (latestUsefulTool) {
          if (latestUsefulTool.name === "web_search") {
            if (isWeatherRequestText(text)) {
              const weatherReadable = buildWeatherWebSummary(text, latestUsefulTool.content);
              reply = weatherReadable
                || "I checked live weather sources, but couldn't extract a reliable forecast summary yet. Please retry with city and state (for example: Pittsburgh, PA).";
            } else {
              const readable = buildWebSearchReadableReply(text, latestUsefulTool.content);
              reply = readable || `Live web results:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
            }
          } else if (latestUsefulTool.name === "web_fetch") {
            reply = `I fetched the page content but the model did not finalize the answer. Here is the extracted content:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
          } else {
            reply = `I ran tools but the model returned no final text. Tool output:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
          }
        } else {
          const latestToolError = [...toolOutputsForRecovery]
            .reverse()
            .find((entry) => {
              const content = String(entry?.content || "").trim().toLowerCase();
              return content.startsWith("web_search error") || content.startsWith("web_fetch error");
            });
          if (latestToolError) {
            if (latestToolError.name === "web_search") {
              const detail = String(latestToolError.content || "")
                .replace(/^web_search error:\s*/i, "")
                .trim();
              reply = detail
                ? `I couldn't complete a live web lookup: ${detail}`
                : "I couldn't complete a live web lookup right now.";
            } else {
              const detail = String(latestToolError.content || "")
                .replace(/^web_fetch error:\s*/i, "")
                .trim();
              reply = detail
                ? `I couldn't fetch the web source: ${detail}`
                : "I couldn't fetch the web source right now.";
            }
          }
        }
      }

      if (!reply || !reply.trim()) throw new Error(`Model ${modelUsed} returned no text response after tool loop.`);
    } else {
      llmStartedAt = Date.now();
      broadcastThinkingStatus("Drafting response", userContextId);
      if (hasStrictOutputRequirements) {
        responseRoute = "openai_direct_constraints";
        let completion = null;
        try {
          completion = await withTimeout(
            activeOpenAiCompatibleClient.chat.completions.create({
              model: modelUsed,
              messages,
              max_completion_tokens: OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            `OpenAI model ${modelUsed}`,
          );
        } catch (primaryError) {
          if (!OPENAI_FALLBACK_MODEL) throw primaryError;
          const fallbackModel = OPENAI_FALLBACK_MODEL;
          retries.push({
            stage: "direct_completion",
            fromModel: modelUsed,
            toModel: fallbackModel,
            reason: "primary_failed",
          });
          const primaryDetails = toErrorDetails(primaryError);
          console.warn(
            `[LLM] Primary model failed provider=${activeChatRuntime.provider} model=${modelUsed}` +
            ` status=${primaryDetails.status ?? "n/a"} message=${primaryDetails.message}. Retrying with fallback ${fallbackModel}.`,
          );
          completion = await withTimeout(
            activeOpenAiCompatibleClient.chat.completions.create({
              model: fallbackModel,
              messages,
              max_completion_tokens: OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            `OpenAI fallback model ${fallbackModel}`,
          );
          modelUsed = fallbackModel;
        }
        const usage = completion?.usage || {};
        promptTokens = Number(usage.prompt_tokens || 0);
        completionTokens = Number(usage.completion_tokens || 0);
        reply = extractOpenAIChatText(completion).trim();
      } else {
        responseRoute = "openai_stream";
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
              broadcastAssistantStreamDelta(assistantStreamId, delta, source, undefined, conversationId, userContextId);
            },
          });
        } catch (primaryError) {
          if (!OPENAI_FALLBACK_MODEL || sawPrimaryDelta) throw primaryError;
          const fallbackModel = OPENAI_FALLBACK_MODEL;
          retries.push({
            stage: "stream_completion",
            fromModel: modelUsed,
            toModel: fallbackModel,
            reason: "primary_failed",
          });
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
              broadcastAssistantStreamDelta(assistantStreamId, delta, source, undefined, conversationId, userContextId);
            },
          });
          modelUsed = fallbackModel;
        }
        reply = streamed.reply;
        promptTokens = streamed.promptTokens || 0;
        completionTokens = streamed.completionTokens || 0;
      }
      if (!reply || !reply.trim()) throw new Error(`Model ${modelUsed} returned no text response.`);
    }
    if (llmStartedAt > 0) {
      latencyTelemetry.addStage("llm_generation", Date.now() - llmStartedAt);
    }

    // Refusal recovery: if model claimed no web access, do a search and append results
    if (replyClaimsNoLiveAccess(reply) && canRunWebSearch) {
      const refusalRecoveryStartedAt = Date.now();
      broadcastThinkingStatus("Verifying live web access", userContextId);
      try {
        const refusalRecoverStartedAt = Date.now();
        const fallbackResult = await runtimeTools.executeToolUse(
          { id: `tool_refusal_recover_${Date.now()}`, name: "web_search", input: { query: text }, type: "tool_use" },
          availableTools,
        );
        toolExecutions.push({
          name: "web_search",
          status: "ok",
          durationMs: Date.now() - refusalRecoverStartedAt,
          resultPreview: summarizeToolResultPreview(fallbackResult?.content || ""),
        });
        const fallbackContent = String(fallbackResult?.content || "").trim();
        if (fallbackContent && !/^web_search error/i.test(fallbackContent)) {
          const weatherReadable = isWeatherRequestText(text) ? buildWeatherWebSummary(text, fallbackContent) : "";
          const readable = weatherReadable || buildWebSearchReadableReply(text, fallbackContent);
          const correction = readable
            ? `I do have live web access in this runtime.\n\n${readable}`
            : `I do have live web access in this runtime. Current web results:\n\n${fallbackContent.slice(0, 2200)}`;
          reply = reply ? `${reply}\n\n${correction}` : correction;
          if (!hasStrictOutputRequirements) {
            emittedAssistantDelta = true;
            broadcastAssistantStreamDelta(assistantStreamId, correction, source, undefined, conversationId, userContextId);
          }
          observedToolCalls.push("web_search");
        }
      } catch (err) {
        toolExecutions.push({
          name: "web_search",
          status: "error",
          durationMs: 0,
          error: describeUnknownError(err),
          resultPreview: "",
        });
        console.warn(`[ToolLoop] refusal recovery search failed: ${describeUnknownError(err)}`);
      } finally {
        latencyTelemetry.addStage("refusal_recovery", Date.now() - refusalRecoveryStartedAt);
      }
    }

    if (hasStrictOutputRequirements) {
      const initialConstraintCheck = validateOutputConstraints(reply, outputConstraints);
      if (!initialConstraintCheck.ok) {
        const correctionStartedAt = Date.now();
        broadcastThinkingStatus("Applying response format", userContextId);
        retries.push({
          stage: "output_constraint_correction",
          fromModel: modelUsed,
          toModel: modelUsed,
          reason: initialConstraintCheck.reason,
        });

        const correctionInstruction = [
          "Rewrite your previous answer to the same user request.",
          `Violation: ${initialConstraintCheck.reason}.`,
          "Strict requirements:",
          outputConstraints.instructions,
          "Return only the corrected answer.",
        ].join("\n");

        let correctedReply = "";
        try {
          if (activeChatRuntime.provider === "claude") {
            const correctionMessages = [
              ...historyMessages,
              { role: "user", content: text },
              { role: "assistant", content: reply },
              { role: "user", content: correctionInstruction },
            ];
            const claudeCorrection = await withTimeout(
              claudeMessagesCreate({
                apiKey: activeChatRuntime.apiKey,
                baseURL: activeChatRuntime.baseURL,
                model: selectedChatModel,
                system: systemPrompt,
                messages: correctionMessages,
                userText: correctionInstruction,
                maxTokens: CLAUDE_CHAT_MAX_TOKENS,
              }),
              OPENAI_REQUEST_TIMEOUT_MS,
              `Claude correction ${selectedChatModel}`,
            );
            correctedReply = String(claudeCorrection?.text || "").trim();
            promptTokens += Number(claudeCorrection?.usage?.promptTokens || 0);
            completionTokens += Number(claudeCorrection?.usage?.completionTokens || 0);
          } else {
            const correctionCompletion = await withTimeout(
              activeOpenAiCompatibleClient.chat.completions.create({
                model: modelUsed,
                messages: [
                  ...messages,
                  { role: "assistant", content: reply },
                  { role: "user", content: correctionInstruction },
                ],
                max_completion_tokens: OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
              }),
              OPENAI_REQUEST_TIMEOUT_MS,
              `OpenAI correction ${modelUsed}`,
            );
            correctedReply = extractOpenAIChatText(correctionCompletion).trim();
            const correctionUsage = correctionCompletion?.usage || {};
            promptTokens += Number(correctionUsage.prompt_tokens || 0);
            completionTokens += Number(correctionUsage.completion_tokens || 0);
          }
        } catch (correctionErr) {
          console.warn(`[OutputConstraints] correction pass failed: ${describeUnknownError(correctionErr)}`);
        } finally {
          outputConstraintCorrectionPasses += 1;
          latencyTelemetry.incrementCounter("output_constraint_correction_passes");
          latencyTelemetry.addStage("output_constraint_correction", Date.now() - correctionStartedAt);
        }

        if (correctedReply) {
          reply = correctedReply;
          const correctedCheck = validateOutputConstraints(reply, outputConstraints);
          if (correctedCheck.ok) {
            responseRoute = `${responseRoute}_constraint_corrected`;
          }
        }
      }
    }

    const normalizedReply = normalizeAssistantReply(reply);
    broadcastThinkingStatus("Finalizing response", userContextId);
    if (normalizedReply.skip) {
      reply = "";
    } else {
      reply = normalizedReply.text;
    }

    if (reply && !emittedAssistantDelta) {
      emittedAssistantDelta = true;
      broadcastAssistantStreamDelta(assistantStreamId, reply, source, undefined, conversationId, userContextId);
    }

    const modelForUsage = activeChatRuntime.provider === "claude" ? selectedChatModel : (modelUsed || selectedChatModel);
    const totalTokens = promptTokens + completionTokens;
    const estimatedCostUsd = estimateTokenCostUsd(modelForUsage, promptTokens, completionTokens);

    appendRawStream({ event: "request_done", source, sessionKey, provider: activeChatRuntime.provider, model: modelForUsage, promptTokens, completionTokens, totalTokens, estimatedCostUsd });
    console.log(`[LLM] provider=${activeChatRuntime.provider} model=${modelForUsage} prompt_tokens=${promptTokens} completion_tokens=${completionTokens} total_tokens=${totalTokens}${estimatedCostUsd !== null ? ` estimated_usd=$${estimatedCostUsd}` : ""}`);
    broadcast(
      {
        type: "usage",
        provider: activeChatRuntime.provider,
        model: modelForUsage,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
        userContextId: userContextId || undefined,
        ts: Date.now(),
      },
      { userContextId },
    );

    const nlpCorrections = Array.isArray(ctx.nlpCorrections)
      ? ctx.nlpCorrections
          .map((c) => ({
            reason: String(c?.reason || ""),
            confidence: Number(c?.confidence || 0),
            offsets: Array.isArray(c?.offsets) ? c.offsets.slice(0, 2) : undefined,
          }))
          .filter((c) => c.reason)
      : [];
    const transcriptStartedAt = Date.now();
    sessionRuntime.appendTranscriptTurn(sessionContext.sessionEntry.sessionId, "user", uiText, {
      source,
      sender: ctx.sender,
      provider: activeChatRuntime.provider,
      model: modelForUsage,
      sessionKey,
      conversationId: conversationId || undefined,
      nlpCleanText: text !== uiText ? text : undefined,
      nlpConfidence: Number.isFinite(Number(ctx.nlpConfidence)) ? Number(ctx.nlpConfidence) : undefined,
      nlpCorrectionCount: nlpCorrections.length,
      nlpCorrections: nlpCorrections.length > 0 ? nlpCorrections : undefined,
    });
    if (reply) {
      sessionRuntime.appendTranscriptTurn(sessionContext.sessionEntry.sessionId, "assistant", reply, { source, sender: "nova", provider: activeChatRuntime.provider, model: modelForUsage, sessionKey, conversationId: conversationId || undefined, promptTokens, completionTokens, totalTokens });
    }
    sessionContext.persistUsage({ model: modelForUsage, promptTokens, completionTokens });
    latencyTelemetry.addStage("transcript_persistence", Date.now() - transcriptStartedAt);

    const memoryCaptureStartedAt = Date.now();
    try {
      const autoFacts = extractAutoMemoryFacts(text);
      const autoCaptured = applyMemoryFactsToWorkspace(personaWorkspaceDir, autoFacts);
      memoryAutoCaptured = autoCaptured;
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
    } finally {
      latencyTelemetry.addStage("memory_autocapture", Date.now() - memoryCaptureStartedAt);
    }

    runSummary.ok = true;
    runSummary.provider = activeChatRuntime.provider;
    runSummary.model = modelForUsage;
    runSummary.reply = reply;
    runSummary.promptTokens = promptTokens;
    runSummary.completionTokens = completionTokens;
    runSummary.totalTokens = totalTokens;
    runSummary.toolCalls = Array.from(new Set(observedToolCalls.filter(Boolean)));
    runSummary.toolExecutions = toolExecutions;
    runSummary.retries = retries;
    runSummary.responseRoute = responseRoute;
    runSummary.memoryAutoCaptured = memoryAutoCaptured;
    runSummary.preferenceProfileUpdated = preferenceProfileUpdated;
    runSummary.nlpConfidence = Number.isFinite(Number(ctx.nlpConfidence)) ? Number(ctx.nlpConfidence) : null;
    runSummary.nlpCorrectionCount = Array.isArray(ctx.nlpCorrections) ? ctx.nlpCorrections.length : 0;
    runSummary.memoryRecallUsed = usedMemoryRecall;
    runSummary.webSearchPreloadUsed = usedWebSearchPreload;
    runSummary.linkUnderstandingUsed = usedLinkUnderstanding;
    runSummary.correctionPassCount = outputConstraintCorrectionPasses;
    runSummary.promptHash = preparedPromptHash;

    if (useVoice && reply) {
      const voiceStartedAt = Date.now();
      await speak(normalizeAssistantSpeechText(reply) || reply, ttsVoice);
      latencyTelemetry.addStage("voice_output", Date.now() - voiceStartedAt);
    }
  } catch (err) {
    broadcastThinkingStatus("Handling error", userContextId);
    const details = toErrorDetails(err);
    const msg = details.message || "Unknown model error.";
    appendRawStream({ event: "request_error", source, sessionKey, provider: activeChatRuntime.provider, model: selectedChatModel, status: details.status, code: details.code, type: details.type, requestId: details.requestId, message: msg });
    console.error(`[LLM] Chat request failed provider=${activeChatRuntime.provider} model=${selectedChatModel} status=${details.status ?? "n/a"} code=${details.code ?? "n/a"} message=${msg}`);
    broadcastAssistantStreamDelta(
      assistantStreamId,
      `Model request failed${details.status ? ` (${details.status})` : ""}${details.code ? ` [${details.code}]` : ""}: ${msg}`,
      source,
      undefined,
      conversationId,
      userContextId,
    );
    runSummary.error = msg;
    runSummary.toolCalls = Array.from(new Set(observedToolCalls.filter(Boolean)));
    runSummary.toolExecutions = toolExecutions;
    runSummary.retries = retries;
    runSummary.responseRoute = responseRoute;
    runSummary.memoryAutoCaptured = memoryAutoCaptured;
    runSummary.preferenceProfileUpdated = preferenceProfileUpdated;
    runSummary.nlpConfidence = Number.isFinite(Number(ctx.nlpConfidence)) ? Number(ctx.nlpConfidence) : null;
    runSummary.nlpCorrectionCount = Array.isArray(ctx.nlpCorrections) ? ctx.nlpCorrections.length : 0;
    runSummary.memoryRecallUsed = usedMemoryRecall;
    runSummary.webSearchPreloadUsed = usedWebSearchPreload;
    runSummary.linkUnderstandingUsed = usedLinkUnderstanding;
    runSummary.correctionPassCount = outputConstraintCorrectionPasses;
    runSummary.promptHash = preparedPromptHash;
  } finally {
    broadcastThinkingStatus("", userContextId);
    const latencySnapshot = latencyTelemetry.snapshot();
    runSummary.latencyMs = Number.isFinite(Number(latencySnapshot.totalMs)) && Number(latencySnapshot.totalMs) > 0
      ? Number(latencySnapshot.totalMs)
      : Date.now() - startedAt;
    runSummary.latencyStages = latencySnapshot.stageMs || {};
    runSummary.latencyHotPath = String(latencySnapshot.hotPath || latencySnapshot.hotStage || "");
    runSummary.correctionPassCount = Number.isFinite(Number(latencySnapshot.counters?.output_constraint_correction_passes))
      ? Number(latencySnapshot.counters.output_constraint_correction_passes)
      : runSummary.correctionPassCount;
    broadcastAssistantStreamDone(assistantStreamId, source, undefined, conversationId, userContextId);
    broadcastState("idle", userContextId);
  }

  return runSummary;
}

// ===== Main dispatcher =====
async function handleInputCore(text, opts = {}) {
  const latencyTelemetry = createChatLatencyTelemetry();
  text = normalizeInboundUserText(text);
  if (!text) return;
  const source = opts.source || "hud";
  const userContextId = sessionRuntime.resolveUserContextId(opts);
  if (source === "hud" && !userContextId) throw new Error("Missing user context id for HUD request.");
  const sessionContext = sessionRuntime.resolveSessionContext({
    ...opts,
    userContextId: userContextId || opts.userContextId,
  });
  const sessionKey = sessionContext.sessionKey;
  const useVoice = opts.voice !== false;
  const ttsVoice = opts.ttsVoice || "default";
  const conversationId = resolveConversationId(opts, sessionKey, source);

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
    return {
      route: "duplicate_skipped",
      ok: true,
      reply: "",
      error: "",
      provider: "",
      model: "",
      toolCalls: [],
      toolExecutions: [],
      retries: [],
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: null,
      memoryRecallUsed: false,
      memoryAutoCaptured: 0,
      webSearchPreloadUsed: false,
      linkUnderstandingUsed: false,
      requestHints: {},
      canRunToolLoop: false,
      canRunWebSearch: false,
      canRunWebFetch: false,
      latencyMs: 0,
    };
  }

  appendRawStream({ event: "request_start", source, sessionKey, userContextId: userContextId || undefined, chars: String(text || "").length });

  // ── NLP preprocessing ────────────────────────────────────────────────────
  // raw_text is used for UI display and transcript persistence.
  // clean_text is used for routing, tool selection, memory recall, and LLM.
  const raw_text = text;
  let clean_text = text;
  let nlpCorrections = [];
  let nlpConfidence = 1.0;
  const nlpBypass = opts?.nlpBypass === true;
  const nlpPreprocessStartedAt = Date.now();
  if (!nlpBypass) {
    try {
      const preprocessFn = getPreprocess();
      if (preprocessFn) {
        // preprocess() is async (spell checker loads on first call)
        const nlpResult = await preprocessFn(text);
        clean_text = nlpResult.clean_text || text;
        nlpCorrections = nlpResult.corrections || [];
        nlpConfidence = Number.isFinite(Number(nlpResult.confidence)) ? Number(nlpResult.confidence) : 1.0;
        if (nlpCorrections.length > 0) {
          const summary = nlpCorrections.map((c) => `${c.reason}(${c.confidence.toFixed(2)})`).join(", ");
          console.log(`[NLP] ${nlpCorrections.length} correction(s) session=${sessionKey}: ${summary}`);
        }
      }
    } catch {
      // Preprocessing failure is non-fatal; continue with original text
      clean_text = text;
      nlpConfidence = 1.0;
    }
  }
  latencyTelemetry.addStage("nlp_preprocess", Date.now() - nlpPreprocessStartedAt);
  // Use clean_text for all downstream routing and LLM calls.
  // raw_text is preserved for UI messages and transcript writes.
  text = clean_text;
  // ─────────────────────────────────────────────────────────────────────────

  if (runtimeAssistantName && typeof wakeWordRuntime?.setAssistantName === "function") {
    wakeWordRuntime.setAssistantName(runtimeAssistantName);
  }

  const ctx = {
    source, sender, sessionContext, sessionKey, userContextId,
    useVoice, ttsVoice, runtimeTone, runtimeCommunicationStyle,
    runtimeAssistantName, runtimeCustomInstructions,
    conversationId,
    supabaseAccessToken: String(opts.supabaseAccessToken || "").trim(),
    sessionId: sessionContext.sessionEntry?.sessionId,
    // NLP: raw_text for display/persistence; clean_text already in `text`
    raw_text,
    nlpCorrections,
    nlpConfidence,
    nlpBypass,
  };

  // Memory update — short-circuit before any LLM call
  if (isMemoryUpdateRequest(text)) {
    return await handleMemoryUpdate(text, ctx);
  }

  const pendingWeather = getPendingWeatherConfirm(sessionKey);
  if (pendingWeather) {
    if (isWeatherConfirmNo(text)) {
      clearPendingWeatherConfirm(sessionKey);
      const reply = await sendDirectAssistantReply(
        text,
        "Okay. I will not run that location. Share the correct city and I will fetch weather immediately.",
        ctx,
        "Waiting for location",
      );
      return {
        route: "weather_confirm_declined",
        ok: true,
        reply,
      };
    }

    if (isWeatherConfirmYes(text)) {
      const runtimeTools = await toolRuntime.initToolRuntimeIfNeeded({ userContextId });
      const availableTools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
      const canRunToolLoop = TOOL_LOOP_ENABLED
        && availableTools.length > 0
        && typeof runtimeTools?.executeToolUse === "function";
      const canRunWebSearch = canRunToolLoop && availableTools.some((t) => String(t?.name || "") === "web_search");
      clearPendingWeatherConfirm(sessionKey);
      const confirmedWeatherResult = await tryWeatherFastPathReply({
        text: pendingWeather.prompt,
        runtimeTools,
        availableTools,
        canRunWebSearch,
        forcedLocation: pendingWeather.suggestedLocation,
        bypassConfirmation: true,
      });
      const confirmedReply = String(confirmedWeatherResult?.reply || "").trim()
        || `I could not fetch weather for ${pendingWeather.suggestedLocation} yet. Please retry.`;
      const reply = await sendDirectAssistantReply(text, confirmedReply, ctx, "Fetching weather");
      return {
        route: "weather_confirm_accepted",
        ok: true,
        reply,
        toolCalls: confirmedWeatherResult?.toolCall ? [String(confirmedWeatherResult.toolCall)] : [],
        canRunToolLoop,
        canRunWebSearch,
      };
    }

    // If the user moved on or asked a fresh weather question, do not trap the
    // session in a yes/no loop. Clear stale confirmation and continue routing.
    clearPendingWeatherConfirm(sessionKey);
  }

  // Mission confirmation/build routing before LLM/provider selection.
  const pendingMission = getPendingMissionConfirm(sessionKey);
  if (pendingMission) {
    if (isMissionConfirmNo(text)) {
      clearPendingMissionConfirm(sessionKey);
      const reply = await sendDirectAssistantReply(
        text,
        "No problem. I will not create a mission. If you want one later, say: create a mission for ...",
        ctx,
      );
      return {
        route: "mission_confirm_declined",
        ok: true,
        reply,
      };
    }

    if (isMissionConfirmYes(text)) {
      const details = stripMissionConfirmPrefix(text);
      const mergedPrompt = details ? `${pendingMission.prompt}. ${details}` : pendingMission.prompt;
      clearPendingMissionConfirm(sessionKey);
      return await handleWorkflowBuild(mergedPrompt, ctx, { engine: "src" });
    }

    const detailLikeFollowUp = /\b(at|am|pm|est|et|pst|pt|cst|ct|telegram|discord|novachat|daily|every|morning|night|tomorrow)\b/i.test(text);
    if (detailLikeFollowUp) {
      const mergedPrompt = `${pendingMission.prompt}. ${stripAssistantInvocation(text)}`.replace(/\s+/g, " ").trim();
      setPendingMissionConfirm(sessionKey, mergedPrompt);
      const reply = await sendDirectAssistantReply(text, buildMissionConfirmReply(mergedPrompt), ctx);
      return {
        route: "mission_confirm_refine",
        ok: true,
        reply,
      };
    }
  }

  if (shouldBuildWorkflowFromPrompt(text)) {
    clearPendingMissionConfirm(sessionKey);
    return await handleWorkflowBuild(text, ctx, { engine: "src" });
  }

  if (shouldConfirmWorkflowFromPrompt(text)) {
    const candidatePrompt = stripAssistantInvocation(text) || text;
    setPendingMissionConfirm(sessionKey, candidatePrompt);
    const reply = await sendDirectAssistantReply(text, buildMissionConfirmReply(candidatePrompt), ctx);
    return {
      route: "mission_confirm_prompt",
      ok: true,
      reply,
    };
  }

  const turnPolicy = buildLatencyTurnPolicy(text, {
    weatherIntent: isWeatherRequestText(text),
    cryptoIntent: isCryptoRequestText(text),
    canRunWebSearchHint: true,
    canRunWebFetchHint: true,
  });
  const requestHints = {
    fastLaneSimpleChat: turnPolicy.fastLaneSimpleChat === true,
  };

  let runtimeTools = null;
  let availableTools = [];
  if (turnPolicy.likelyNeedsToolRuntime) {
    const runtimeToolInitStartedAt = Date.now();
    runtimeTools = await toolRuntime.initToolRuntimeIfNeeded({ userContextId });
    availableTools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
    latencyTelemetry.addStage("runtime_tool_init", Date.now() - runtimeToolInitStartedAt);
  }

  const executionPolicy = resolveToolExecutionPolicy(turnPolicy, {
    text,
    availableTools,
    toolLoopEnabled: TOOL_LOOP_ENABLED,
    executeToolUse: runtimeTools?.executeToolUse,
  });
  const canRunWebSearch = executionPolicy.canRunWebSearch;
  const canRunWebFetch = executionPolicy.canRunWebFetch;
  const canRunToolLoop = executionPolicy.canRunToolLoop;

  // Resolve provider (Bug Fix 4: uses cached loader) + routing arbitration
  const providerResolutionStartedAt = Date.now();
  const integrationsRuntime = cachedLoadIntegrationsRuntime({ userContextId });
  const activeChatRuntime = resolveConfiguredChatRuntime(integrationsRuntime, {
    strictActiveProvider: !ENABLE_PROVIDER_FALLBACK,
    preference: ROUTING_PREFERENCE,
    requiresToolCalling: canRunToolLoop,
    allowActiveProviderOverride: ENABLE_PROVIDER_FALLBACK && ROUTING_ALLOW_ACTIVE_OVERRIDE,
    preferredProviders: ROUTING_PREFERRED_PROVIDERS,
  });
  latencyTelemetry.addStage("provider_resolution", Date.now() - providerResolutionStartedAt);

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

  const llmCtx = {
    activeChatRuntime,
    activeOpenAiCompatibleClient,
    selectedChatModel,
    runtimeTools,
    availableTools,
    canRunToolLoop,
    canRunWebSearch,
    canRunWebFetch,
    turnPolicy,
    executionPolicy,
    latencyTelemetry,
  };

  // Route to sub-handler
  if (n === "nova shutdown" || n === "nova shut down" || n === "shutdown nova") {
    await handleShutdown(ctx);
    return {
      route: "shutdown",
      ok: true,
      reply: "Shutting down now. If you need me again, just restart the system.",
    };
  }

  if (n.includes("spotify") || n.includes("play music") || n.includes("play some") || n.includes("put on ")) {
    return await handleSpotify(text, ctx, llmCtx);
  }

  return await executeChatRequest(text, ctx, llmCtx, requestHints);
}

export async function handleInput(text, opts = {}) {
  const startedAt = Date.now();
  const userInputText = String(text || "");
  const source = String(opts?.source || "hud");
  const sender = String(opts?.sender || "");
  let sessionKey = "";
  let userContextId = "";
  let conversationId = "";
  let nlpBypass = opts?.nlpBypass === true;
  let result = null;
  let caughtError = null;

  try {
    userContextId = String(sessionRuntime.resolveUserContextId(opts) || "");
    sessionKey = String(opts?.sessionKeyHint || "");
    conversationId = resolveConversationId(opts, sessionKey, source);
  } catch {
    // Best effort logging; allow main handler to throw normally.
  }

  try {
    result = await handleInputCore(text, opts);
    return result;
  } catch (err) {
    caughtError = err;
    throw err;
  } finally {
    const summary = result && typeof result === "object"
      ? result
      : {
          route: "unclassified",
          ok: caughtError ? false : true,
          reply: typeof result === "string" ? result : "",
          error: caughtError ? describeUnknownError(caughtError) : "",
        };

    appendDevConversationLog({
      source,
      sender,
      userContextId,
      conversationId,
      sessionKey,
      route: String(summary.route || "unclassified"),
      userInputText,
      cleanedInputText: normalizeInboundUserText(userInputText),
      assistantReplyText: String(summary.reply || ""),
      provider: String(summary.provider || ""),
      model: String(summary.model || ""),
      requestHints: summary.requestHints && typeof summary.requestHints === "object" ? summary.requestHints : {},
      canRunToolLoop: summary.canRunToolLoop === true,
      canRunWebSearch: summary.canRunWebSearch === true,
      canRunWebFetch: summary.canRunWebFetch === true,
      toolCalls: Array.isArray(summary.toolCalls) ? summary.toolCalls : [],
      toolExecutions: Array.isArray(summary.toolExecutions) ? summary.toolExecutions : [],
      retries: Array.isArray(summary.retries) ? summary.retries : [],
      memoryRecallUsed: summary.memoryRecallUsed === true,
      memoryAutoCaptured: Number.isFinite(Number(summary.memoryAutoCaptured))
        ? Number(summary.memoryAutoCaptured)
        : 0,
      webSearchPreloadUsed: summary.webSearchPreloadUsed === true,
      linkUnderstandingUsed: summary.linkUnderstandingUsed === true,
      promptTokens: Number.isFinite(Number(summary.promptTokens)) ? Number(summary.promptTokens) : 0,
      completionTokens: Number.isFinite(Number(summary.completionTokens)) ? Number(summary.completionTokens) : 0,
      totalTokens: Number.isFinite(Number(summary.totalTokens)) ? Number(summary.totalTokens) : 0,
      estimatedCostUsd: Number.isFinite(Number(summary.estimatedCostUsd))
        ? Number(summary.estimatedCostUsd)
        : null,
      latencyMs: Number.isFinite(Number(summary.latencyMs)) && Number(summary.latencyMs) > 0
        ? Number(summary.latencyMs)
        : Date.now() - startedAt,
      latencyStages: summary.latencyStages && typeof summary.latencyStages === "object"
        ? summary.latencyStages
        : {},
      latencyHotPath: String(summary.latencyHotPath || ""),
      correctionPassCount: Number.isFinite(Number(summary.correctionPassCount))
        ? Number(summary.correctionPassCount)
        : 0,
      ok: summary.ok !== false && !caughtError,
      error: String(summary.error || (caughtError ? describeUnknownError(caughtError) : "")),
      nlpBypass,
      nlpConfidence: Number.isFinite(Number(summary.nlpConfidence))
        ? Number(summary.nlpConfidence)
        : null,
      nlpCorrectionCount: Number.isFinite(Number(summary.nlpCorrectionCount))
        ? Number(summary.nlpCorrectionCount)
        : 0,
    });
  }
}

