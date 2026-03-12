import { runWebResearchDomainService } from "../../../../services/web-research/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";
import { appendScopedTranscriptExchange } from "../../shared/scoped-transcript/index.js";

export async function handleWebResearchWorker(text, ctx, llmCtx = {}, requestHints = {}, _executeChatRequest) {
  const summary = await runWebResearchDomainService({
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
    defaultRoute: "web_research",
    defaultResponseRoute: "web_research",
    defaultProvider: String(llmCtx?.activeChatRuntime?.provider || ""),
    defaultLatencyMs: Number(summary?.latencyMs || summary?.telemetry?.latencyMs || 0),
    userContextId: String(ctx?.userContextId || ""),
    conversationId: String(ctx?.conversationId || ""),
    sessionKey: String(ctx?.sessionKey || ""),
  });
}
