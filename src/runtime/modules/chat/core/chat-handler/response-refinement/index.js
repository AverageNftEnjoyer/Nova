import {
  OPENAI_REQUEST_TIMEOUT_MS,
  CLAUDE_CHAT_MAX_TOKENS,
} from "../../../../../core/constants/index.js";
import {
  claudeMessagesCreate,
  describeUnknownError,
  extractOpenAIChatText,
  withTimeout,
} from "../../../../llm/providers/index.js";
import { replyClaimsNoLiveAccess, buildWebSearchReadableReply } from "../../../routing/intent-router/index.js";
import { validateOutputConstraints } from "../../../quality/output-constraints/index.js";
import { normalizeAssistantReply } from "../../../quality/reply-normalizer/index.js";
import { summarizeToolResultPreview } from "../../chat-utils/index.js";
import { addLlmUsage, emptyLlmUsage, normalizeOpenAiCompatibleUsage } from "../../../../../../providers/usage/index.js";
import { resolveLlmUsageRecorder } from "../llm-usage-recorder/index.js";
import { approxTokens, resolveModelRoute, runWithRouteFallback } from "../../../../model-routing/index.js";

export async function refineAssistantReply({
  reply,
  hasStrictOutputRequirements,
  canRunWebSearch,
  text,
  runtimeTools,
  availableTools,
  toolExecutions,
  observedToolCalls,
  emittedAssistantDelta,
  assistantStreamId,
  source,
  conversationId,
  userContextId,
  broadcastThinkingStatus,
  broadcastAssistantStreamDelta,
  latencyTelemetry,
  outputConstraints,
  retries,
  modelUsed,
  activeChatRuntime,
  selectedChatModel,
  systemPrompt,
  historyMessages,
  messages,
  activeOpenAiCompatibleClient,
  openAiMaxCompletionTokens,
  openAiRequestTuningForModel,
  responseRoute,
  markRecovery,
  usageRecorder,
  // Stage 6 routing context of the turn ({ settings, turnTier, userContextId, staticPromptTokens }), or absent:
  // no routing (the correction pass runs on the turn's model, as before).
  modelRouting,
}) {
  const llmUsageRecorder = resolveLlmUsageRecorder(usageRecorder, {
    userContextId,
    conversationId,
    provider: activeChatRuntime?.provider,
  });
  let usageDelta = emptyLlmUsage();
  let correctionPassesDelta = 0;
  let nextReply = String(reply || "");
  let nextResponseRoute = String(responseRoute || "llm");
  let didEmitDelta = emittedAssistantDelta === true;

  if (replyClaimsNoLiveAccess(nextReply) && canRunWebSearch) {
    const refusalRecoveryStartedAt = Date.now();
    broadcastThinkingStatus("Verifying live web access", userContextId);
    try {
      const refusalRecoverStartedAt = Date.now();
      const recoveryResult = await runtimeTools.executeToolUse(
        { id: `tool_refusal_recover_${Date.now()}`, name: "web_search", input: { query: text }, type: "tool_use" },
        availableTools,
      );
      toolExecutions.push({
        name: "web_search",
        status: "ok",
        durationMs: Date.now() - refusalRecoverStartedAt,
        resultPreview: summarizeToolResultPreview(recoveryResult?.content || ""),
      });
      const recoveryContent = String(recoveryResult?.content || "").trim();
      if (recoveryContent && !/^web_search error/i.test(recoveryContent)) {
        const readable = buildWebSearchReadableReply(text, recoveryContent);
        const correction = readable
          ? `I do have live web access in this runtime.\n\n${readable}`
          : `I do have live web access in this runtime. Current web results:\n\n${recoveryContent.slice(0, 2200)}`;
        nextReply = nextReply ? `${nextReply}\n\n${correction}` : correction;
        if (!hasStrictOutputRequirements) {
          didEmitDelta = true;
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
    const initialConstraintCheck = validateOutputConstraints(nextReply, outputConstraints);
    if (!initialConstraintCheck.ok) {
      const correctionStartedAt = Date.now();
      broadcastThinkingStatus("Applying response format", userContextId);
      const isClaude = activeChatRuntime.provider === "claude";
      const correctionInstruction = [
        "Rewrite your previous answer to the same user request.",
        `Violation: ${initialConstraintCheck.reason}.`,
        "Strict requirements:",
        outputConstraints.instructions,
        "Return only the corrected answer.",
      ].join("\n");
      const correctionMessages = isClaude
        ? [
          ...historyMessages,
          { role: "user", content: text },
          { role: "assistant", content: nextReply },
          { role: "user", content: correctionInstruction },
        ]
        : [
          ...messages,
          { role: "assistant", content: nextReply },
          { role: "user", content: correctionInstruction },
        ];
      // Stage 6: the correction pass is always trivial. Cache impact: the turn's model has just cached this prompt's
      // prefix (Claude: the static system block, which carries cache_control; OpenAI-compatible: the turn's prompt,
      // cached automatically); the economy model reads it cold. So routing is often refused for Claude: intended.
      const turnCallModel = isClaude ? selectedChatModel : modelUsed;
      const correctionRoute = modelRouting
        ? resolveModelRoute({
          userContextId: modelRouting.userContextId || userContextId,
          provider: activeChatRuntime.provider,
          model: turnCallModel,
          callSite: "chat.output-correction",
          turnTier: modelRouting.turnTier,
          settings: modelRouting.settings,
          estimate: isClaude
            ? {
              inputTokens: approxTokens(systemPrompt) + approxTokens(correctionMessages),
              mainWarmPrefixTokens: modelRouting.staticPromptTokens,
              economyWarmPrefixTokens: 0,
              writePrefixTokens: modelRouting.staticPromptTokens,
            }
            : {
              inputTokens: approxTokens(correctionMessages),
              mainWarmPrefixTokens: approxTokens(messages),
              economyWarmPrefixTokens: 0,
            },
        })
        : null;
      const correctionRouteForRun = correctionRoute || { routed: false, model: turnCallModel };
      const correctionTier = correctionRoute ? { tier: correctionRoute.tier } : {};
      retries.push({
        stage: "output_constraint_correction",
        fromModel: modelUsed,
        toModel: correctionRoute ? correctionRoute.model : modelUsed,
        reason: initialConstraintCheck.reason,
      });

      let correctedReply = "";
      try {
        if (isClaude) {
          const { result: claudeCorrection, model: correctionModel } = await runWithRouteFallback(
            correctionRouteForRun,
            (model) => withTimeout(
              claudeMessagesCreate({
                apiKey: activeChatRuntime.apiKey,
                baseURL: activeChatRuntime.baseURL,
                model,
                system: systemPrompt,
                messages: correctionMessages,
                userText: correctionInstruction,
                maxTokens: CLAUDE_CHAT_MAX_TOKENS,
              }),
              OPENAI_REQUEST_TIMEOUT_MS,
              `Claude correction ${model}`,
            ),
          );
          correctedReply = String(claudeCorrection?.text || "").trim();
          usageDelta = addLlmUsage(
            usageDelta,
            llmUsageRecorder.record({ model: correctionModel, usage: claudeCorrection?.usage, ...correctionTier }),
          );
        } else {
          const { result: correctionCompletion, model: correctionModel } = await runWithRouteFallback(
            correctionRouteForRun,
            (model) => withTimeout(
              activeOpenAiCompatibleClient.chat.completions.create({
                model,
                messages: correctionMessages,
                max_completion_tokens: openAiMaxCompletionTokens,
                ...openAiRequestTuningForModel(model),
              }),
              OPENAI_REQUEST_TIMEOUT_MS,
              `OpenAI correction ${model}`,
            ),
          );
          correctedReply = extractOpenAIChatText(correctionCompletion).trim();
          usageDelta = addLlmUsage(
            usageDelta,
            llmUsageRecorder.record({
              model: correctionModel,
              usage: normalizeOpenAiCompatibleUsage(correctionCompletion?.usage),
              ...correctionTier,
            }),
          );
        }
      } catch (correctionErr) {
        console.warn(`[OutputConstraints] correction pass failed: ${describeUnknownError(correctionErr)}`);
      } finally {
        correctionPassesDelta += 1;
        latencyTelemetry.incrementCounter("output_constraint_correction_passes");
        latencyTelemetry.addStage("output_constraint_correction", Date.now() - correctionStartedAt);
      }

      if (correctedReply) {
        nextReply = correctedReply;
        const correctedCheck = validateOutputConstraints(nextReply, outputConstraints);
        if (correctedCheck.ok) {
          nextResponseRoute = `${nextResponseRoute}_constraint_corrected`;
        }
      }
    }
  }

  const promptTokensDelta = usageDelta.inputTokens;
  const completionTokensDelta = usageDelta.outputTokens;
  const cachedInputTokensDelta = usageDelta.cachedInputTokens;
  const cacheWriteInputTokensDelta = usageDelta.cacheWriteInputTokens;
  const preNormalizedReply = String(nextReply || "");
  const normalizedReply = normalizeAssistantReply(preNormalizedReply);
  broadcastThinkingStatus("Finalizing response", userContextId);
  nextReply = normalizedReply.skip ? "" : normalizedReply.text;
  if (!nextReply || !nextReply.trim()) {
    const salvageReply = String(preNormalizedReply || "").trim();
    if (salvageReply) {
      nextReply = salvageReply;
      return {
        reply: nextReply,
        responseRoute: `${nextResponseRoute}_normalize_salvage`,
        emittedAssistantDelta: didEmitDelta,
        promptTokensDelta,
        completionTokensDelta,
        cachedInputTokensDelta,
        cacheWriteInputTokensDelta,
        correctionPassesDelta,
      };
    }
    markRecovery("post_normalize_empty_reply_error", "empty_reply_after_normalization", preNormalizedReply);
    retries.push({
      stage: "post_normalize_empty_reply_error",
      fromModel: modelUsed,
      toModel: modelUsed,
      reason: "empty_reply",
    });
    throw new Error("Reply normalization produced no assistant text.");
  }

  return {
    reply: nextReply,
    responseRoute: nextResponseRoute,
    emittedAssistantDelta: didEmitDelta,
    promptTokensDelta,
    completionTokensDelta,
    cachedInputTokensDelta,
    cacheWriteInputTokensDelta,
    correctionPassesDelta,
  };
}
