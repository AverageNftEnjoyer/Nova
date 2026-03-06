import { runFilesDomainService } from "../../../../services/files/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";
import { appendScopedTranscriptExchange } from "../../shared/scoped-transcript/index.js";

export async function handleFilesWorker(text, ctx, llmCtx = {}, requestHints = {}, _executeChatRequest) {
  const summary = await runFilesDomainService({
    text,
    ctx,
    llmCtx,
    requestHints,
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
    fallbackRoute: "files",
    fallbackResponseRoute: "files",
    fallbackProvider: String(llmCtx?.activeChatRuntime?.provider || ""),
    fallbackLatencyMs: Number(summary?.latencyMs || summary?.telemetry?.latencyMs || 0),
    userContextId: String(ctx?.userContextId || ""),
    conversationId: String(ctx?.conversationId || ""),
    sessionKey: String(ctx?.sessionKey || ""),
  });
}
