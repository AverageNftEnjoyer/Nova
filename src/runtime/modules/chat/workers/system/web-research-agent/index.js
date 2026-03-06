import { runDelegatedChatWorker } from "../../shared/delegated-chat-worker/index.js";

export async function handleWebResearchWorker(text, ctx, llmCtx = {}, requestHints = {}, executeChatRequest) {
  return await runDelegatedChatWorker({
    text,
    ctx,
    llmCtx,
    requestHints,
    executeChatRequest,
    route: "web_research",
  });
}
