import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";
import { runRemindersDomainService } from "../../../../services/reminders/index.js";

export async function handleRemindersWorker(text, ctx, llmCtx = {}, requestHints = {}, executeChatRequest) {
  const summary = await runRemindersDomainService({
    text,
    ctx,
    llmCtx,
    requestHints,
    executeChatRequest,
  });
  return normalizeWorkerSummary(summary, {
    fallbackRoute: "reminder",
    fallbackResponseRoute: "reminder",
    fallbackProvider: String(llmCtx?.activeChatRuntime?.provider || ""),
    fallbackLatencyMs: 0,
    userContextId: String(ctx?.userContextId || ""),
    conversationId: String(ctx?.conversationId || ""),
    sessionKey: String(ctx?.sessionKey || ""),
  });
}
