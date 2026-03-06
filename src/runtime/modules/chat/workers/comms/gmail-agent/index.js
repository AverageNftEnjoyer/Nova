import { runDelegatedChatWorker } from "../../shared/delegated-chat-worker/index.js";

export async function handleGmailWorker(text, ctx, llmCtx = {}, requestHints = {}, executeChatRequest) {
  return await runDelegatedChatWorker({
    text,
    ctx,
    llmCtx,
    requestHints,
    executeChatRequest,
    route: "gmail",
  });
}
