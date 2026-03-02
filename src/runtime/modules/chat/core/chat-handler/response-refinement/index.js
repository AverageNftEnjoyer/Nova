import {
  OPENAI_REQUEST_TIMEOUT_MS,
  CLAUDE_CHAT_MAX_TOKENS,
} from "../../../../core/constants/index.js";
import {
  claudeMessagesCreate,
  describeUnknownError,
  extractOpenAIChatText,
  withTimeout,
} from "../../../llm/providers.js";
import { replyClaimsNoLiveAccess, buildWebSearchReadableReply, buildWeatherWebSummary } from "../../routing/intent-router.js";
import { isWeatherRequestText } from "../../fast-path/weather-fast-path.js";
import { validateOutputConstraints } from "../../quality/output-constraints.js";
import { normalizeAssistantReply } from "../../quality/reply-normalizer.js";
import { summarizeToolResultPreview } from "../chat-utils.js";
import { buildConstraintSafeFallback } from "./prompt-fallbacks.js";

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
  markFallback,
}) {
  let promptTokensDelta = 0;
  let completionTokensDelta = 0;
  let correctionPassesDelta = 0;
  let nextReply = String(reply || "");
  let nextResponseRoute = String(responseRoute || "llm");
  let didEmitDelta = emittedAssistantDelta === true;

  if (replyClaimsNoLiveAccess(nextReply) && canRunWebSearch) {
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
            { role: "assistant", content: nextReply },
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
          promptTokensDelta += Number(claudeCorrection?.usage?.promptTokens || 0);
          completionTokensDelta += Number(claudeCorrection?.usage?.completionTokens || 0);
        } else {
          const correctionCompletion = await withTimeout(
            activeOpenAiCompatibleClient.chat.completions.create({
              model: modelUsed,
              messages: [
                ...messages,
                { role: "assistant", content: nextReply },
                { role: "user", content: correctionInstruction },
              ],
              max_completion_tokens: openAiMaxCompletionTokens,
              ...openAiRequestTuningForModel(modelUsed),
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            `OpenAI correction ${modelUsed}`,
          );
          correctedReply = extractOpenAIChatText(correctionCompletion).trim();
          const correctionUsage = correctionCompletion?.usage || {};
          promptTokensDelta += Number(correctionUsage.prompt_tokens || 0);
          completionTokensDelta += Number(correctionUsage.completion_tokens || 0);
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

  const normalizedReply = normalizeAssistantReply(nextReply);
  broadcastThinkingStatus("Finalizing response", userContextId);
  nextReply = normalizedReply.skip ? "" : normalizedReply.text;
  if (!nextReply || !nextReply.trim()) {
    const fallbackReply = buildConstraintSafeFallback(outputConstraints, text, {
      strict: hasStrictOutputRequirements,
    });
    markFallback("post_normalize_empty_reply_fallback", "empty_reply_after_normalization", nextReply);
    retries.push({
      stage: "post_normalize_empty_reply_fallback",
      fromModel: modelUsed,
      toModel: modelUsed,
      reason: "empty_reply",
    });
    nextReply = fallbackReply;
  }

  return {
    reply: nextReply,
    responseRoute: nextResponseRoute,
    emittedAssistantDelta: didEmitDelta,
    promptTokensDelta,
    completionTokensDelta,
    correctionPassesDelta,
  };
}
