import { normalizeWorkerSummary } from "../worker-contract/index.js";

function normalizeRoute(value, fallback = "chat") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

export async function runDelegatedChatWorker(input = {}) {
  const {
    text,
    ctx,
    llmCtx,
    requestHints,
    executeChatRequest,
    route = "chat",
  } = input;

  if (typeof executeChatRequest !== "function") {
    throw new Error(`runDelegatedChatWorker requires executeChatRequest for route "${normalizeRoute(route)}"`);
  }

  const summary = await executeChatRequest(text, ctx, llmCtx, requestHints);
  return normalizeWorkerSummary(summary, {
    fallbackRoute: normalizeRoute(route),
    fallbackResponseRoute: normalizeRoute(route),
    fallbackProvider: String(llmCtx?.activeChatRuntime?.provider || ""),
    fallbackLatencyMs: 0,
  });
}
