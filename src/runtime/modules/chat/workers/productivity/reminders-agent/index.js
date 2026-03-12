import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";
import { runRemindersDomainService } from "../../../../services/reminders/index.js";
import { appendScopedTranscriptExchange } from "../../shared/scoped-transcript/index.js";

export async function handleRemindersWorker(text, ctx, llmCtx = {}, requestHints = {}, executeChatRequest) {
  const summary = await runRemindersDomainService({
    text,
    ctx,
    llmCtx,
    requestHints,
    executeChatRequest,
  });
  appendScopedTranscriptExchange(
    ctx,
    String(ctx?.raw_text || text || ""),
    String(summary?.reply || ""),
  );
  return normalizeWorkerSummary(summary, {
    defaultRoute: "reminder",
    defaultResponseRoute: "reminder",
    defaultProvider: String(llmCtx?.activeChatRuntime?.provider || ""),
    defaultLatencyMs: 0,
    userContextId: String(ctx?.userContextId || ""),
    conversationId: String(ctx?.conversationId || ""),
    sessionKey: String(ctx?.sessionKey || ""),
  });
}
