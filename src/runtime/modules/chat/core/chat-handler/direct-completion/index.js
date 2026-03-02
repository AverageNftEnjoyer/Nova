import {
  OPENAI_FALLBACK_MODEL,
  OPENAI_REQUEST_TIMEOUT_MS,
  CLAUDE_CHAT_MAX_TOKENS,
} from "../../../../core/constants/index.js";
import {
  claudeMessagesCreate,
  claudeMessagesStream,
  streamOpenAiChatCompletion,
  extractOpenAIChatText,
  describeUnknownError,
  toErrorDetails,
  withTimeout,
} from "../../../llm/providers.js";
import {
  attemptOpenAiEmptyReplyRecovery,
  buildConstraintSafeFallback,
  buildEmptyReplyFailureReason,
  shouldAttemptOpenAiEmptyReplyRecovery,
} from "./prompt-fallbacks.js";

export async function runClaudeDirectCompletion({
  activeChatRuntime,
  selectedChatModel,
  systemPrompt,
  historyMessages,
  text,
  hasStrictOutputRequirements,
  assistantStreamId,
  source,
  conversationId,
  userContextId,
  broadcastAssistantStreamDelta,
}) {
  let emittedAssistantDelta = false;
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

  return {
    reply: claudeCompletion.text,
    promptTokens: claudeCompletion.usage.promptTokens,
    completionTokens: claudeCompletion.usage.completionTokens,
    llmFinishReason: "",
    modelUsed: selectedChatModel,
    emittedAssistantDelta,
  };
}

export async function runOpenAiDirectCompletion({
  activeChatRuntime,
  activeOpenAiCompatibleClient,
  modelUsed,
  messages,
  openAiMaxCompletionTokens,
  openAiRequestTuningForModel,
  hasStrictOutputRequirements,
  outputConstraints,
  text,
  assistantStreamId,
  source,
  conversationId,
  userContextId,
  broadcastAssistantStreamDelta,
  broadcastThinkingStatus,
  retries,
  markFallback,
}) {
  let reply = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let llmFinishReason = "";
  let emittedAssistantDelta = false;

  if (hasStrictOutputRequirements) {
    let completion = null;
    try {
      completion = await withTimeout(
        activeOpenAiCompatibleClient.chat.completions.create({
          model: modelUsed,
          messages,
          max_completion_tokens: openAiMaxCompletionTokens,
          ...openAiRequestTuningForModel(modelUsed),
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
        `[LLM] Primary model failed provider=${activeChatRuntime.provider} model=${modelUsed}`
        + ` status=${primaryDetails.status ?? "n/a"} message=${primaryDetails.message}. Retrying with fallback ${fallbackModel}.`,
      );
      completion = await withTimeout(
        activeOpenAiCompatibleClient.chat.completions.create({
          model: fallbackModel,
          messages,
          max_completion_tokens: openAiMaxCompletionTokens,
          ...openAiRequestTuningForModel(fallbackModel),
        }),
        OPENAI_REQUEST_TIMEOUT_MS,
        `OpenAI fallback model ${fallbackModel}`,
      );
      modelUsed = fallbackModel;
    }
    const usage = completion?.usage || {};
    promptTokens = Number(usage.prompt_tokens || 0);
    completionTokens = Number(usage.completion_tokens || 0);
    llmFinishReason = String(completion?.choices?.[0]?.finish_reason || "").trim().toLowerCase();
    reply = extractOpenAIChatText(completion).trim();
  } else {
    let streamed = null;
    let sawPrimaryDelta = false;
    try {
      streamed = await streamOpenAiChatCompletion({
        client: activeOpenAiCompatibleClient,
        model: modelUsed,
        messages,
        maxCompletionTokens: openAiMaxCompletionTokens,
        timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
        requestOverrides: openAiRequestTuningForModel(modelUsed),
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
        `[LLM] Primary model failed provider=${activeChatRuntime.provider} model=${modelUsed}`
        + ` status=${primaryDetails.status ?? "n/a"} message=${primaryDetails.message}. Retrying with fallback ${fallbackModel}.`,
      );
      streamed = await streamOpenAiChatCompletion({
        client: activeOpenAiCompatibleClient,
        model: fallbackModel,
        messages,
        maxCompletionTokens: openAiMaxCompletionTokens,
        timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
        requestOverrides: openAiRequestTuningForModel(fallbackModel),
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
    llmFinishReason = String(streamed?.finishReason || "").trim().toLowerCase();
  }

  if (!reply || !reply.trim()) {
    if (shouldAttemptOpenAiEmptyReplyRecovery({
      provider: activeChatRuntime.provider,
      reply,
      finishReason: llmFinishReason,
      completionTokens,
      maxCompletionTokens: openAiMaxCompletionTokens,
    })) {
      broadcastThinkingStatus("Recovering final answer", userContextId);
      retries.push({
        stage: "empty_reply_recovery",
        fromModel: modelUsed,
        toModel: modelUsed,
        reason: buildEmptyReplyFailureReason("empty_reply_after_llm_call", {
          finishReason: llmFinishReason,
          completionTokens,
          maxCompletionTokens: openAiMaxCompletionTokens,
        }),
      });
      try {
        const recovered = await attemptOpenAiEmptyReplyRecovery({
          client: activeOpenAiCompatibleClient,
          model: modelUsed,
          messages,
          timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
          maxCompletionTokens: openAiMaxCompletionTokens,
          requestTuning: openAiRequestTuningForModel(modelUsed),
          label: "OpenAI empty-reply recovery",
        });
        llmFinishReason = String(recovered.finishReason || llmFinishReason || "").trim().toLowerCase();
        promptTokens += Number(recovered.promptTokens || 0);
        completionTokens += Number(recovered.completionTokens || 0);
        if (recovered.reply) {
          reply = recovered.reply;
        }
      } catch (emptyRecoveryErr) {
        console.warn(`[LLM] empty reply recovery failed: ${describeUnknownError(emptyRecoveryErr)}`);
      }
    }
  }

  let responseRouteSuffix = "";
  if (!reply || !reply.trim()) {
    const fallbackReply = buildConstraintSafeFallback(outputConstraints, text, {
      strict: hasStrictOutputRequirements,
    });
    const fallbackReason = buildEmptyReplyFailureReason("empty_reply_after_llm_call", {
      finishReason: llmFinishReason,
      completionTokens,
      maxCompletionTokens: openAiMaxCompletionTokens,
    });
    markFallback("direct_empty_reply_fallback", fallbackReason, reply);
    retries.push({
      stage: "direct_empty_reply_fallback",
      fromModel: modelUsed,
      toModel: modelUsed,
      reason: fallbackReason,
    });
    reply = fallbackReply;
  }

  return {
    reply,
    promptTokens,
    completionTokens,
    llmFinishReason,
    modelUsed,
    emittedAssistantDelta,
    responseRouteSuffix,
  };
}
