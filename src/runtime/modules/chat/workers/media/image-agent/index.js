import { runDelegatedChatWorker } from "../../shared/delegated-chat-worker/index.js";

export async function handleImageWorker(text, ctx, llmCtx = {}, requestHints = {}, executeChatRequest) {
  const imageHints = {
    ...(requestHints && typeof requestHints === "object" ? requestHints : {}),
    imageLane: true,
    preferredProvider: "grok",
  };
  return await runDelegatedChatWorker({
    text,
    ctx,
    llmCtx,
    requestHints: imageHints,
    executeChatRequest,
    route: "image",
  });
}
