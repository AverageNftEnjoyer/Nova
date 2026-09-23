import {
  OPENAI_REQUEST_TIMEOUT_MS,
  CLAUDE_CHAT_MAX_TOKENS,
} from "../../../../../core/constants/index.js";
import {
  claudeMessagesCreate,
  claudeMessagesStream,
  streamOpenAiChatCompletion,
  extractOpenAIChatText,
  describeUnknownError,
  withTimeout,
} from "../../../../llm/providers/index.js";
import {
  attemptOpenAiEmptyReplyRecovery,
  buildEmptyReplyFailureReason,
  shouldAttemptOpenAiEmptyReplyRecovery,
} from "../prompt-recovery/index.js";
import { addLlmUsage, emptyLlmUsage, normalizeOpenAiCompatibleUsage } from "../../../../../../providers/usage/index.js";
import { resolveLlmUsageRecorder } from "../llm-usage-recorder/index.js";

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
  abortSignal,
  usageRecorder,
}) {
  const llmUsageRecorder = resolveLlmUsageRecorder(usageRecorder, {
    userContextId,
    conversationId,
    provider: activeChatRuntime.provider,
  });
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
        signal: abortSignal,
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
      signal: abortSignal,
    });

  const usage = llmUsageRecorder.record({ model: selectedChatModel, usage: claudeCompletion.usage });

  return {
    reply: claudeCompletion.text,
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
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
  text,
  assistantStreamId,
  source,
  conversationId,
  userContextId,
  broadcastAssistantStreamDelta,
  broadcastThinkingStatus,
  retries,
  markRecovery,
  abortSignal,
  usageRecorder,
}) {
  // One ledger row per API call (the main create/stream and the empty-reply recovery). activeChatRuntime.provider
  // names the provider behind the shared OpenAI-compatible client.
  const llmUsageRecorder = resolveLlmUsageRecorder(usageRecorder, {
    userContextId,
    conversationId,
    provider: activeChatRuntime.provider,
  });
  let reply = "";
  let usage = emptyLlmUsage();
  let llmFinishReason = "";
  let emittedAssistantDelta = false;

  if (hasStrictOutputRequirements) {
    let completion = null;
    completion = await withTimeout(
      activeOpenAiCompatibleClient.chat.completions.create(
        {
          model: modelUsed,
          messages,
          max_completion_tokens: openAiMaxCompletionTokens,
          ...openAiRequestTuningForModel(modelUsed),
        },
        { signal: abortSignal },
      ),
      OPENAI_REQUEST_TIMEOUT_MS,
      `OpenAI model ${modelUsed}`,
    );
    usage = llmUsageRecorder.record({ model: modelUsed, usage: normalizeOpenAiCompatibleUsage(completion?.usage) });
    llmFinishReason = String(completion?.choices?.[0]?.finish_reason || "").trim().toLowerCase();
    reply = extractOpenAIChatText(completion).trim();
  } else {
    let streamed = null;
    streamed = await streamOpenAiChatCompletion({
      client: activeOpenAiCompatibleClient,
      model: modelUsed,
      messages,
      maxCompletionTokens: openAiMaxCompletionTokens,
      timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
      requestOverrides: openAiRequestTuningForModel(modelUsed),
      onDelta: (delta) => {
        emittedAssistantDelta = true;
        broadcastAssistantStreamDelta(assistantStreamId, delta, source, undefined, conversationId, userContextId);
      },
      signal: abortSignal,
    });
    reply = streamed.reply;
    usage = llmUsageRecorder.record({ model: modelUsed, usage: streamed.usage });
    llmFinishReason = String(streamed?.finishReason || "").trim().toLowerCase();
  }

  if (!reply || !reply.trim()) {
    if (shouldAttemptOpenAiEmptyReplyRecovery({
      provider: activeChatRuntime.provider,
      reply,
      finishReason: llmFinishReason,
      completionTokens: usage.outputTokens,
      maxCompletionTokens: openAiMaxCompletionTokens,
    })) {
      broadcastThinkingStatus("Recovering final answer", userContextId);
      retries.push({
        stage: "empty_reply_recovery",
        fromModel: modelUsed,
        toModel: modelUsed,
        reason: buildEmptyReplyFailureReason("empty_reply_after_llm_call", {
          finishReason: llmFinishReason,
          completionTokens: usage.outputTokens,
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
          signal: abortSignal,
        });
        llmFinishReason = String(recovered.finishReason || llmFinishReason || "").trim().toLowerCase();
        usage = addLlmUsage(usage, llmUsageRecorder.record({ model: modelUsed, usage: recovered.usage }));
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
    const emptyReplyReason = buildEmptyReplyFailureReason("empty_reply_after_llm_call", {
      finishReason: llmFinishReason,
      completionTokens: usage.outputTokens,
      maxCompletionTokens: openAiMaxCompletionTokens,
    });
    markRecovery("direct_empty_reply_error", emptyReplyReason, reply);
    retries.push({
      stage: "direct_empty_reply_error",
      fromModel: modelUsed,
      toModel: modelUsed,
      reason: emptyReplyReason,
    });
    throw new Error(`OpenAI direct completion returned empty reply (${emptyReplyReason}).`);
  }

  return {
    reply,
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    llmFinishReason,
    modelUsed,
    emittedAssistantDelta,
    responseRouteSuffix,
  };
}
