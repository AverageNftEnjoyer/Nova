import { stopSpeaking } from "../../../audio/voice/index.js";
import { sendDirectAssistantReply } from "../../../chat/workers/shared/direct-assistant-reply/index.js";

function normalizeText(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function createShutdownProviderAdapter(deps = {}) {
  const stopSpeakingFn = typeof deps.stopSpeaking === "function" ? deps.stopSpeaking : stopSpeaking;
  const sendDirectAssistantReplyFn = typeof deps.sendDirectAssistantReply === "function"
    ? deps.sendDirectAssistantReply
    : sendDirectAssistantReply;
  const processExitFn = typeof deps.processExit === "function" ? deps.processExit : process.exit;

  return {
    id: "runtime-shutdown-provider-adapter",
    providerId: "runtime_shutdown",
    stopScopedSpeech({ userContextId = "" } = {}) {
      stopSpeakingFn({ userContextId: normalizeText(userContextId) });
    },
    async sendShutdownReply({
      text = "",
      ctx = {},
      replyText = "Shutting down now. If you need me again, just restart the system.",
      thinkingStatus = "Shutting down",
    } = {}) {
      return await sendDirectAssistantReplyFn(
        String(text || ""),
        String(replyText || ""),
        ctx && typeof ctx === "object" ? ctx : {},
        String(thinkingStatus || "Shutting down"),
      );
    },
    exitProcess(code = 0) {
      processExitFn(Number(code) || 0);
    },
  };
}
