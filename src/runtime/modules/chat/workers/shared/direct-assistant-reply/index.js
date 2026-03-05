import { sessionRuntime } from "../../../../infrastructure/config/index.js";
import { speak } from "../../../../audio/voice/index.js";
import {
  broadcastState,
  broadcastThinkingStatus,
  broadcastMessage,
  createAssistantStreamId,
  broadcastAssistantStreamStart,
  broadcastAssistantStreamDelta,
  broadcastAssistantStreamDone,
} from "../../../../infrastructure/hud-gateway/index.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "../../../quality/reply-normalizer/index.js";

export async function sendDirectAssistantReply(userText, replyText, ctx, thinkingStatus = "Confirming mission") {
  const { source, sender, sessionId, useVoice, ttsVoice, conversationId, userContextId } = ctx;
  const normalizedReply = normalizeAssistantReply(replyText);
  if (normalizedReply.skip) {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
    return "";
  }

  broadcastState("thinking", userContextId);
  broadcastThinkingStatus(thinkingStatus, userContextId);
  broadcastMessage("user", userText, source, conversationId, userContextId);
  if (sessionId) {
    sessionRuntime.appendTranscriptTurn(sessionId, "user", userText, {
      source,
      sender: sender || null,
    });
  }

  const streamId = createAssistantStreamId();
  broadcastAssistantStreamStart(streamId, source, undefined, conversationId, userContextId);
  broadcastAssistantStreamDelta(streamId, normalizedReply.text, source, undefined, conversationId, userContextId);
  broadcastAssistantStreamDone(streamId, source, undefined, conversationId, userContextId);
  if (sessionId) {
    sessionRuntime.appendTranscriptTurn(sessionId, "assistant", normalizedReply.text, {
      source,
      sender: "nova",
    });
  }

  try {
    if (useVoice) {
      await speak(normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text, ttsVoice);
    }
  } finally {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
  }
  return normalizedReply.text;
}
