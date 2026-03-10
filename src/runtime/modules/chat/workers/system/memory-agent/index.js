import fs from "fs";
import path from "path";
import { resolvePersonaWorkspaceDir, appendRawStream } from "../../../../context/persona-context/index.js";
import { captureUserPreferencesFromMessage } from "../../../../context/user-preferences/index.js";
import { recordIdentityMemoryUpdate } from "../../../../context/identity/engine/index.js";
import {
  extractMemoryUpdateFact,
  buildMemoryFactMetadata,
  upsertMemoryFactInMarkdown,
  ensureMemoryTemplate,
} from "../../../../../../memory/runtime/index.js";
import { describeUnknownError } from "../../../../llm/providers/index.js";
import { sendDirectAssistantReply } from "../../shared/direct-assistant-reply/index.js";
import { normalizeWorkerSummary } from "../../shared/worker-contract/index.js";

export async function handleMemoryWorker(text, ctx) {
  const { source, userContextId, conversationId } = ctx;
  const fact = extractMemoryUpdateFact(text);
  const summary = {
    route: "memory_update",
    ok: true,
    reply: "",
    error: "",
    provider: "",
    model: "",
    toolCalls: [],
    toolExecutions: [],
    retries: [],
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: null,
    memoryRecallUsed: false,
    webSearchPreloadUsed: false,
    linkUnderstandingUsed: false,
    requestHints: {},
    canRunToolLoop: false,
    canRunWebSearch: false,
    canRunWebFetch: false,
    latencyMs: 0,
  };
  const startedAt = Date.now();

  if (!fact) {
    summary.reply = await sendDirectAssistantReply(
      text,
      "Tell me exactly what to remember after 'update your memory'.",
      ctx,
      "Updating memory",
    );
    summary.latencyMs = Date.now() - startedAt;
    return summary;
  }

  try {
    const personaWorkspaceDir = resolvePersonaWorkspaceDir(userContextId);
    const memoryFilePath = path.join(personaWorkspaceDir, "MEMORY.md");
    const existingContent = fs.existsSync(memoryFilePath)
      ? fs.readFileSync(memoryFilePath, "utf8")
      : ensureMemoryTemplate();
    const memoryMeta = buildMemoryFactMetadata(fact);
    const updatedContent = upsertMemoryFactInMarkdown(existingContent, memoryMeta.fact, memoryMeta.key);
    fs.writeFileSync(memoryFilePath, updatedContent, "utf8");

    const preferenceCapture = captureUserPreferencesFromMessage({
      userContextId,
      workspaceDir: personaWorkspaceDir,
      userInputText: memoryMeta.fact,
      nlpConfidence: 1,
      source: "memory_update",
      sessionKey: ctx.sessionKey || "",
    });
    if (Array.isArray(preferenceCapture?.updatedKeys) && preferenceCapture.updatedKeys.length > 0) {
      console.log(
        `[Preference] Updated ${preferenceCapture.updatedKeys.length} field(s) for ${userContextId || "anonymous"} during memory update.`,
      );
    }

    recordIdentityMemoryUpdate({
      userContextId,
      workspaceDir: personaWorkspaceDir,
      memoryFact: memoryMeta.fact,
      conversationId,
      sessionKey: ctx.sessionKey || "",
      source: source || "hud",
    });

    const confirmation = memoryMeta.hasStructuredField
      ? `Memory updated. I will remember this as current: ${memoryMeta.fact}`
      : `Memory updated. I saved: ${memoryMeta.fact}`;
    summary.reply = await sendDirectAssistantReply(text, confirmation, ctx, "Updating memory");

    appendRawStream({
      event: "memory_manual_upsert",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: userContextId || undefined,
      key: memoryMeta.key || null,
    });
    console.log(`[Memory] Manual memory update applied for ${userContextId || "anonymous"} key=${memoryMeta.key || "general"}.`);
  } catch (err) {
    summary.ok = false;
    summary.error = String(err instanceof Error ? err.message : describeUnknownError(err));
    summary.reply = await sendDirectAssistantReply(
      text,
      `I couldn't update MEMORY.md: ${describeUnknownError(err)}`,
      ctx,
      "Updating memory",
    );
  } finally {
    summary.latencyMs = Date.now() - startedAt;
  }

  return normalizeWorkerSummary(summary, {
    fallbackRoute: "memory_update",
    fallbackResponseRoute: "memory_update",
    fallbackProvider: "",
    fallbackLatencyMs: summary.latencyMs,
    userContextId: String(userContextId || ""),
    conversationId: String(conversationId || ""),
    sessionKey: String(ctx?.sessionKey || ""),
  });
}
