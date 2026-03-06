import { runShutdownDomainService } from "../../../../services/shutdown/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";

export async function handleShutdownWorker(text, ctx, llmCtx = {}, requestHints = {}, options = {}) {
  const summary = await runShutdownDomainService({
    text,
    ctx,
    llmCtx,
    requestHints,
    userContextId: String(ctx?.userContextId || ""),
    conversationId: String(ctx?.conversationId || ""),
    sessionKey: String(ctx?.sessionKey || ""),
    exitProcess: options.exitProcess !== false,
    processExit: typeof options.processExit === "function" ? options.processExit : undefined,
  });

  return normalizeWorkerSummary(summary, {
    fallbackRoute: "shutdown",
    fallbackResponseRoute: "shutdown",
    fallbackProvider: String(llmCtx?.activeChatRuntime?.provider || ""),
    fallbackLatencyMs: Number(summary?.latencyMs || summary?.telemetry?.latencyMs || 0),
    userContextId: String(ctx?.userContextId || ""),
    conversationId: String(ctx?.conversationId || ""),
    sessionKey: String(ctx?.sessionKey || ""),
  });
}
