import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";
import { appendScopedTranscriptExchange } from "../../shared/scoped-transcript/index.js";
import { runGmailDomainService } from "../../../../services/gmail/index.js";

export async function handleGmailWorker(text, ctx, llmCtx = {}, requestHints = {}, _executeChatRequest) {
  const summary = await runGmailDomainService({
    text,
    ctx,
    llmCtx,
    requestHints,
  });
  appendScopedTranscriptExchange(
    ctx,
    String(ctx?.raw_text || text || ""),
    String(summary?.reply || ""),
  );
  return normalizeWorkerSummary(summary, {
    defaultRoute: "gmail",
    defaultResponseRoute: "gmail",
    defaultProvider: String(llmCtx?.activeChatRuntime?.provider || ""),
    defaultLatencyMs: 0,
    userContextId: String(ctx?.userContextId || ""),
    conversationId: String(ctx?.conversationId || ""),
    sessionKey: String(ctx?.sessionKey || ""),
  });
}
