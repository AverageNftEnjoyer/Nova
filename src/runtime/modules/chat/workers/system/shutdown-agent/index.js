import { stopSpeaking } from "../../../../audio/voice/index.js";
import { sendDirectAssistantReply } from "../../shared/direct-assistant-reply/index.js";

export async function handleShutdownWorker(text, ctx, options = {}) {
  const summary = {
    route: "shutdown",
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
    webSearchPreloadUsed: false,
    linkUnderstandingUsed: false,
    requestHints: {},
    canRunToolLoop: false,
    canRunWebSearch: false,
    canRunWebFetch: false,
    latencyMs: 0,
  };
  const startedAt = Date.now();
  const exitProcess = options.exitProcess !== false;
  const processExit = typeof options.processExit === "function" ? options.processExit : process.exit;

  stopSpeaking();
  summary.reply = await sendDirectAssistantReply(
    text,
    "Shutting down now. If you need me again, just restart the system.",
    ctx,
    "Shutting down",
  );
  summary.latencyMs = Date.now() - startedAt;

  if (exitProcess) {
    processExit(0);
  }

  return summary;
}
