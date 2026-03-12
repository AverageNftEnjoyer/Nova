import { runVoiceDomainService } from "../../../../services/voice/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";
import { appendScopedTranscriptExchange } from "../../shared/scoped-transcript/index.js";

export async function handleVoiceWorker(text, ctx, llmCtx = {}, requestHints = {}, executeChatRequest) {
  const summary = await runVoiceDomainService({
    text,
    ctx,
    llmCtx,
    requestHints,
    executeChatRequest,
    userContextId: String(ctx?.userContextId || ""),
    conversationId: String(ctx?.conversationId || ""),
    sessionKey: String(ctx?.sessionKey || ""),
  });
  appendScopedTranscriptExchange(
    ctx,
    String(ctx?.raw_text || text || ""),
    String(summary?.reply || ""),
  );
  return normalizeWorkerSummary(summary, {
    defaultRoute: "voice",
    defaultResponseRoute: "voice",
    defaultProvider: String(llmCtx?.activeChatRuntime?.provider || ""),
    defaultLatencyMs: Number(summary?.latencyMs || summary?.telemetry?.latencyMs || 0),
    userContextId: String(ctx?.userContextId || ""),
    conversationId: String(ctx?.conversationId || ""),
    sessionKey: String(ctx?.sessionKey || ""),
  });
}
