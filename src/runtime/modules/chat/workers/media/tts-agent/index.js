import { runTtsDomainService } from "../../../../services/tts/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";
import { appendScopedTranscriptExchange } from "../../shared/scoped-transcript/index.js";

export async function handleTtsWorker(text, ctx, llmCtx = {}, requestHints = {}, executeChatRequest) {
  const summary = await runTtsDomainService({
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
    fallbackRoute: "tts",
    fallbackResponseRoute: "tts",
    fallbackProvider: String(llmCtx?.activeChatRuntime?.provider || ""),
    fallbackLatencyMs: Number(summary?.latencyMs || summary?.telemetry?.latencyMs || 0),
    userContextId: String(ctx?.userContextId || ""),
    conversationId: String(ctx?.conversationId || ""),
    sessionKey: String(ctx?.sessionKey || ""),
  });
}
