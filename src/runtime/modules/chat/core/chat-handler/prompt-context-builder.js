import {
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
} from "../../../../core/constants.js";
import { sessionRuntime } from "../../../infrastructure/config.js";
import { trimHistoryMessagesByTokenBudget } from "../../../context/persona-context.js";
import { captureUserPreferencesFromMessage, buildUserPreferencePromptSection } from "../../../context/user-preferences.js";
import { syncIdentityIntelligenceFromTurn } from "../../../context/identity/engine.js";
import { syncPersonalityFromTurn } from "../../../context/personality/index.js";
import { buildRuntimeSkillsPrompt } from "../../../context/skills.js";
import { shouldPreloadWebSearch } from "../../routing/intent-router.js";
import { runtimeToneDirective } from "../../../audio/voice.js";
import { describeUnknownError, withTimeout } from "../../../llm/providers.js";
import { buildSystemPromptWithPersona, enforcePromptTokenBound } from "../../../../core/context-prompt.js";
import { buildAgentSystemPrompt, PromptMode } from "../../../context/system-prompt.js";
import { buildPersonaPrompt } from "../../../context/bootstrap.js";
import { runLinkUnderstanding, formatLinkUnderstandingForPrompt } from "../../analysis/link-understanding.js";
import { appendBudgetedPromptSection, computeHistoryTokenBudget, resolveDynamicPromptBudget } from "../../prompt/prompt-budget.js";
import { detectSuspiciousPatterns, wrapWebContent } from "../../../context/external-content.js";
import { hashShadowPayload } from "../chat-utils.js";

const MEMORY_RECALL_TIMEOUT_MS = readIntEnv("NOVA_MEMORY_RECALL_TIMEOUT_MS", 450, 50, 10_000);
const WEB_PRELOAD_TIMEOUT_MS = readIntEnv("NOVA_WEB_PRELOAD_TIMEOUT_MS", 900, 50, 30_000);
const LINK_PRELOAD_TIMEOUT_MS = readIntEnv("NOVA_LINK_PRELOAD_TIMEOUT_MS", 900, 50, 30_000);

function readIntEnv(name, fallback, minValue, maxValue) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

export async function buildPromptContextForTurn({
  text,
  uiText,
  ctx,
  source,
  sender,
  sessionKey,
  sessionContext,
  userContextId,
  conversationId,
  personaWorkspaceDir,
  runtimeAssistantName,
  runtimeCommunicationStyle,
  runtimeTone,
  runtimeCustomInstructions,
  runtimeProactivity,
  runtimeHumorLevel,
  runtimeRiskTolerance,
  runtimeStructurePreference,
  runtimeChallengeLevel,
  requestHints,
  fastLaneSimpleChat,
  hasStrictOutputRequirements,
  outputConstraints,
  selectedChatModel,
  runtimeTools,
  availableTools,
  shouldPreloadWebSearchForTurn,
  shouldPreloadWebFetchForTurn,
  shouldAttemptMemoryRecallForTurn,
  observedToolCalls,
  runSummary,
  latencyTelemetry,
  broadcastThinkingStatus,
}) {
  const promptAssemblyStartedAt = Date.now();
  const preferenceCapture = captureUserPreferencesFromMessage({
    userContextId,
    workspaceDir: personaWorkspaceDir,
    userInputText: uiText,
    nlpConfidence: Number.isFinite(Number(ctx?.nlpConfidence)) ? Number(ctx.nlpConfidence) : 1,
    source,
    sessionKey,
  });
  const preferenceProfileUpdated = Array.isArray(preferenceCapture?.updatedKeys) ? preferenceCapture.updatedKeys.length : 0;
  const preferencePrompt = buildUserPreferencePromptSection(preferenceCapture?.preferences || {});
  const preferredNamePinned = Boolean(preferenceCapture?.preferences?.preferredName);
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
    systemPrompt = appended.included
      ? appended.prompt
      : `${systemPrompt}\n\n## User Preference Memory\n${preferencePrompt}`;
  }

  const identitySync = syncIdentityIntelligenceFromTurn({
    userContextId,
    workspaceDir: personaWorkspaceDir,
    conversationId,
    sessionKey,
    source,
    userInputText: uiText,
    nlpConfidence: Number.isFinite(Number(ctx?.nlpConfidence)) ? Number(ctx.nlpConfidence) : 1,
    runtimeAssistantName,
    runtimeCommunicationStyle,
    runtimeTone,
    preferenceCapture,
    maxPromptTokens: Math.max(120, Math.floor(promptBudgetProfile.sectionMaxTokens * 0.9)),
  });
  const identityPrompt = String(identitySync?.promptSection || "").trim();
  const identityAppliedSignals = Array.isArray(identitySync?.appliedSignals) ? identitySync.appliedSignals.length : 0;
  const identityRejectedSignals = Array.isArray(identitySync?.rejectedSignals) ? identitySync.rejectedSignals.length : 0;
  let identityPromptIncluded = false;
  if (identityPrompt) {
    const appended = appendBudgetedPromptSection({
      ...promptBudgetOptions,
      prompt: systemPrompt,
      sectionTitle: "Identity Intelligence",
      sectionBody: identityPrompt,
    });
    systemPrompt = appended.included
      ? appended.prompt
      : `${systemPrompt}\n\n## Identity Intelligence\n${identityPrompt}`;
    identityPromptIncluded = true;
  }
  runSummary.requestHints.identityProfileActive = Boolean(identityPromptIncluded || identityAppliedSignals > 0);
  runSummary.requestHints.identityAppliedSignals = identityAppliedSignals;
  runSummary.requestHints.identityRejectedSignals = identityRejectedSignals;
  runSummary.requestHints.identityPromptIncluded = identityPromptIncluded;

  const personalitySync = syncPersonalityFromTurn({
    userContextId,
    workspaceDir: personaWorkspaceDir,
    userText: uiText,
    sessionIntent: identitySync?.snapshot?.temporalSessionIntent?.currentIntent,
    seedData: {
      proactivity: runtimeProactivity,
      humor_level: runtimeHumorLevel,
      risk_tolerance: runtimeRiskTolerance,
      structure_preference: runtimeStructurePreference,
      challenge_level: runtimeChallengeLevel,
    },
    conversationId,
    maxPromptTokens: Math.max(80, Math.floor(promptBudgetProfile.sectionMaxTokens * 0.6)),
  });
  const personalityPrompt = String(personalitySync?.promptSection || "").trim();
  if (personalityPrompt) {
    const appended = appendBudgetedPromptSection({
      ...promptBudgetOptions,
      prompt: systemPrompt,
      sectionTitle: "Personality Calibration",
      sectionBody: personalityPrompt,
    });
    systemPrompt = appended.included
      ? appended.prompt
      : `${systemPrompt}\n\n## Personality Calibration\n${personalityPrompt}`;
  }
  runSummary.requestHints.personalityAppliedSignals = personalitySync?.appliedSignals || 0;

  const shortTermContextSummary = String(requestHints?.assistantShortTermContextSummary || "").trim();
  if (shortTermContextSummary) {
    const sectionBody = [
      `follow_up: ${requestHints?.assistantShortTermFollowUp === true ? "true" : "false"}`,
      requestHints?.assistantTopicAffinityId ? `topic_affinity_id: ${String(requestHints.assistantTopicAffinityId)}` : "",
      shortTermContextSummary,
    ].filter(Boolean).join("\n");
    const appended = appendBudgetedPromptSection({
      ...promptBudgetOptions,
      prompt: systemPrompt,
      sectionTitle: "Short-Term Context",
      sectionBody,
    });
    systemPrompt = appended.included
      ? appended.prompt
      : `${systemPrompt}\n\n## Short-Term Context\n${sectionBody}`;
  }

  const allowContextEnrichment = !fastLaneSimpleChat;
  let usedMemoryRecall = false;
  let usedWebSearchPreload = false;
  let usedLinkUnderstanding = false;
  if (!allowContextEnrichment) {
    runSummary.requestHints.contextEnrichmentSkipped = "fast_lane";
    latencyTelemetry.incrementCounter("context_enrichment_skipped_fast_lane");
  }

  const enrichmentTasks = [];
  if (allowContextEnrichment && shouldPreloadWebSearchForTurn && shouldPreloadWebSearch(text)) {
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

  if (allowContextEnrichment && shouldPreloadWebFetchForTurn) {
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

  if (allowContextEnrichment && shouldAttemptMemoryRecallForTurn && runtimeTools?.memoryManager && MEMORY_LOOP_ENABLED) {
    enrichmentTasks.push(
      (async () => {
        runtimeTools.memoryManager.warmSession();
        const memorySearchId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const recalled = await withTimeout(
          runtimeTools.memoryManager.searchWithDiagnostics
            ? runtimeTools.memoryManager.searchWithDiagnostics(text, 3, memorySearchId)
            : runtimeTools.memoryManager.search(text, 3),
          Math.max(150, MEMORY_RECALL_TIMEOUT_MS),
          "Memory recall search",
        );
        const recalledResults = Array.isArray(recalled?.results) ? recalled.results : Array.isArray(recalled) ? recalled : [];
        const diagnostics = recalled?.diagnostics
          || (runtimeTools.memoryManager.getSearchDiagnostics
            ? runtimeTools.memoryManager.getSearchDiagnostics(memorySearchId)
            : runtimeTools.memoryManager.getLastSearchDiagnostics?.());
        if (diagnostics) {
          runSummary.memorySearchDiagnostics = diagnostics;
        }
        if (!Array.isArray(recalledResults) || recalledResults.length === 0) return null;
        const memoryContext = recalledResults
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
    systemPrompt = appended.included
      ? appended.prompt
      : `${systemPrompt}\n\n## Strict Output Requirements\n${outputConstraints.instructions}`;
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
  const preparedPromptHash = hashShadowPayload(JSON.stringify(messages));
  latencyTelemetry.addStage("prompt_assembly", Date.now() - promptAssemblyStartedAt);

  return {
    systemPrompt,
    historyMessages,
    messages,
    preparedPromptHash,
    preferenceProfileUpdated,
    identityAppliedSignals,
    identityRejectedSignals,
    identityPromptIncluded,
    usedMemoryRecall,
    usedWebSearchPreload,
    usedLinkUnderstanding,
  };
}
