import fs from "fs";
import path from "path";
import { exec } from "child_process";
import {
  COMMAND_ACKS,
  OPENAI_REQUEST_TIMEOUT_MS,
  SPOTIFY_INTENT_MAX_TOKENS,
} from "../../../core/constants.js";
import { sessionRuntime } from "../../infrastructure/config.js";
import { resolvePersonaWorkspaceDir, appendRawStream } from "../../context/persona-context.js";
import { captureUserPreferencesFromMessage } from "../../context/user-preferences.js";
import { extractMemoryUpdateFact, buildMemoryFactMetadata, upsertMemoryFactInMarkdown, ensureMemoryTemplate } from "../../context/memory.js";
import { shouldDraftOnlyWorkflow } from "../routing/intent-router.js";
import { speak, stopSpeaking } from "../../audio/voice.js";
import {
  broadcastState,
  broadcastThinkingStatus,
  broadcastMessage,
  createAssistantStreamId,
  broadcastAssistantStreamStart,
  broadcastAssistantStreamDelta,
  broadcastAssistantStreamDone,
} from "../../infrastructure/hud-gateway.js";
import {
  claudeMessagesCreate,
  describeUnknownError,
  extractOpenAIChatText,
  withTimeout,
} from "../../llm/providers.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "../quality/reply-normalizer.js";

const HUD_API_BASE_URL = String(process.env.NOVA_HUD_API_BASE_URL || "http://localhost:3000")
  .trim()
  .replace(/\/+$/, "");
const WORKFLOW_BUILD_TIMEOUT_MS = Number.parseInt(process.env.NOVA_WORKFLOW_BUILD_TIMEOUT_MS || "45000", 10);
export async function sendDirectAssistantReply(userText, replyText, ctx, thinkingStatus = "Confirming mission") {
  const { source, sender, sessionId, useVoice, ttsVoice, conversationId, userContextId } = ctx;
  const normalizedReply = normalizeAssistantReply(replyText);
  if (normalizedReply.skip) {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
    return "";
  }

  broadcastState("thinking", userContextId);
  broadcastThinkingStatus(thinkingStatus, userContextId);
  broadcastMessage("user", userText, source, conversationId, userContextId);
  if (sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "user", userText, { source, sender: sender || null });

  const streamId = createAssistantStreamId();
  broadcastAssistantStreamStart(streamId, source, undefined, conversationId, userContextId);
  broadcastAssistantStreamDelta(streamId, normalizedReply.text, source, undefined, conversationId, userContextId);
  broadcastAssistantStreamDone(streamId, source, undefined, conversationId, userContextId);
  if (sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", normalizedReply.text, { source, sender: "nova" });

  try {
    if (useVoice) {
      await speak(normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text, ttsVoice);
    }
  } finally {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
  }
  return normalizedReply.text;
}

// ===== Memory update sub-handler =====
export async function handleMemoryUpdate(text, ctx) {
  const { source, sender, sessionId, useVoice, ttsVoice, userContextId, conversationId } = ctx;
  const fact = extractMemoryUpdateFact(text);
  const assistantStreamId = createAssistantStreamId();
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

  function sendAssistantReply(reply) {
    const normalized = normalizeAssistantReply(reply);
    if (normalized.skip) return "";
    broadcastAssistantStreamStart(assistantStreamId, source, undefined, conversationId, userContextId);
    broadcastAssistantStreamDelta(assistantStreamId, normalized.text, source, undefined, conversationId, userContextId);
    broadcastAssistantStreamDone(assistantStreamId, source, undefined, conversationId, userContextId);
    return normalized.text;
  }

  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Updating memory", userContextId);
  broadcastMessage("user", text, source, conversationId, userContextId);
  if (sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "user", text, { source, sender: sender || null });

  if (!fact) {
    const reply = "Tell me exactly what to remember after 'update your memory'.";
    const finalReply = sendAssistantReply(reply);
    summary.reply = finalReply;
    if (finalReply && sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", finalReply, { source, sender: "nova" });
    try {
      if (finalReply && useVoice) await speak(normalizeAssistantSpeechText(finalReply) || finalReply, ttsVoice);
    } finally {
      broadcastState("idle", userContextId);
    }
    summary.latencyMs = Date.now() - startedAt;
    return summary;
  }

  try {
    const personaWorkspaceDir = resolvePersonaWorkspaceDir(userContextId);
    const memoryFilePath = path.join(personaWorkspaceDir, "MEMORY.md");
    const existingContent = fs.existsSync(memoryFilePath) ? fs.readFileSync(memoryFilePath, "utf8") : ensureMemoryTemplate();
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
    const confirmation = memoryMeta.hasStructuredField
      ? `Memory updated. I will remember this as current: ${memoryMeta.fact}`
      : `Memory updated. I saved: ${memoryMeta.fact}`;
    const finalConfirmation = sendAssistantReply(confirmation);
    summary.reply = finalConfirmation;
    if (finalConfirmation && sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", finalConfirmation, { source, sender: "nova" });
    appendRawStream({
      event: "memory_manual_upsert",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: userContextId || undefined,
      key: memoryMeta.key || null,
    });
    console.log(`[Memory] Manual memory update applied for ${userContextId || "anonymous"} key=${memoryMeta.key || "general"}.`);
    if (finalConfirmation && useVoice) await speak(normalizeAssistantSpeechText(finalConfirmation) || finalConfirmation, ttsVoice);
  } catch (err) {
    const failure = `I couldn't update MEMORY.md: ${describeUnknownError(err)}`;
    const finalFailure = sendAssistantReply(failure);
    summary.ok = false;
    summary.error = String(err instanceof Error ? err.message : describeUnknownError(err));
    summary.reply = finalFailure;
    if (finalFailure && sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", finalFailure, { source, sender: "nova" });
    try {
      if (finalFailure && useVoice) await speak(normalizeAssistantSpeechText(finalFailure) || finalFailure, ttsVoice);
    } catch {}
  } finally {
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
  }
  return summary;
}

// ===== Shutdown sub-handler =====
export async function handleShutdown(ctx) {
  const { ttsVoice } = ctx;
  stopSpeaking();
  await speak("Shutting down now. If you need me again, just restart the system.", ttsVoice);
  process.exit(0);
}

// ===== Spotify sub-handler =====
export async function handleSpotify(text, ctx, llmCtx) {
  const { source, useVoice, ttsVoice, conversationId, userContextId } = ctx;
  const { activeChatRuntime, activeOpenAiCompatibleClient, selectedChatModel } = llmCtx;
  stopSpeaking();
  const summary = {
    route: "spotify",
    ok: true,
    reply: "",
    error: "",
    provider: activeChatRuntime.provider,
    model: selectedChatModel,
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

  const spotifySystemPrompt = `You parse Spotify commands. Given user input, respond with ONLY a JSON object:
{
  "action": "open" | "play" | "pause" | "next" | "previous",
  "query": "search query if playing something, otherwise empty string",
  "type": "track" | "artist" | "playlist" | "album" | "genre",
  "response": "short friendly acknowledgment to say to the user"
}
Examples:
- "open spotify" → { "action": "open", "query": "", "type": "track", "response": "Opening Spotify." }
- "play some jazz" → { "action": "play", "query": "jazz", "type": "genre", "response": "Putting on some jazz for you." }
- "next song" → { "action": "next", "query": "", "type": "track", "response": "Skipping to the next track." }
- "pause the music" → { "action": "pause", "query": "", "type": "track", "response": "Pausing the music." }
Output ONLY valid JSON, nothing else.`;

  let spotifyRaw = "";
  if (activeChatRuntime.provider === "claude") {
    const r = await claudeMessagesCreate({
      apiKey: activeChatRuntime.apiKey,
      baseURL: activeChatRuntime.baseURL,
      model: selectedChatModel,
      system: spotifySystemPrompt,
      userText: text,
      maxTokens: SPOTIFY_INTENT_MAX_TOKENS,
    });
    spotifyRaw = r.text;
  } else {
    const parse = await withTimeout(
      activeOpenAiCompatibleClient.chat.completions.create({
        model: selectedChatModel,
        messages: [{ role: "system", content: spotifySystemPrompt }, { role: "user", content: text }],
      }),
      OPENAI_REQUEST_TIMEOUT_MS,
      "OpenAI Spotify parse",
    );
    spotifyRaw = extractOpenAIChatText(parse);
  }

  try {
    const intent = JSON.parse(spotifyRaw);
    const normalized = normalizeAssistantReply(intent.response);
    summary.reply = normalized.skip ? "" : normalized.text;
    if (!normalized.skip) {
      if (useVoice) await speak(normalizeAssistantSpeechText(normalized.text) || normalized.text, ttsVoice);
      else broadcastMessage("assistant", normalized.text, source, conversationId, userContextId);
    }

    if (intent.action === "open") {
      exec("start spotify:");
    } else if (intent.action === "pause") {
      exec('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"');
    } else if (intent.action === "next") {
      exec('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB0)"');
    } else if (intent.action === "previous") {
      exec('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB1)"');
    } else if (intent.action === "play" && intent.query) {
      const encoded = encodeURIComponent(intent.query);
      exec(`start "spotify" "spotify:search:${encoded}" && timeout /t 2 >nul && powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"`);
    } else {
      exec("start spotify:");
    }
  } catch (e) {
    console.error("[Spotify] Parse error:", e.message);
    summary.ok = false;
    summary.error = String(e instanceof Error ? e.message : describeUnknownError(e));
    const ack = COMMAND_ACKS[Math.floor(Math.random() * COMMAND_ACKS.length)];
    const normalizedAck = normalizeAssistantReply(ack);
    summary.reply = normalizedAck.skip ? "" : normalizedAck.text;
    if (!normalizedAck.skip) {
      try {
        if (useVoice) await speak(normalizeAssistantSpeechText(normalizedAck.text) || normalizedAck.text, ttsVoice);
        else broadcastMessage("assistant", normalizedAck.text, source, conversationId, userContextId);
      } catch {}
    }
    exec("start spotify:");
  } finally {
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
  }
  return summary;
}

// ===== Workflow builder sub-handler =====
export async function handleWorkflowBuild(text, ctx, options = {}) {
  const { source, useVoice, ttsVoice, supabaseAccessToken, conversationId, userContextId } = ctx;
  const engine = String(options.engine || "src").trim().toLowerCase() || "src";
  stopSpeaking();
  const summary = {
    route: "workflow_build",
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
  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Building workflow", userContextId);
  broadcastMessage("user", text, source, conversationId, userContextId);
  try {
    const deploy = !shouldDraftOnlyWorkflow(text);
    appendRawStream({
      event: "workflow_build_start",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: ctx.userContextId || undefined,
      engine,
      deploy,
    });
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), Math.max(5000, WORKFLOW_BUILD_TIMEOUT_MS));
    const headers = { "Content-Type": "application/json" };
    if (String(supabaseAccessToken || "").trim()) {
      headers.Authorization = `Bearer ${String(supabaseAccessToken).trim()}`;
    }
    const res = await fetch(`${HUD_API_BASE_URL}/api/missions/build`, {
      method: "POST",
      headers,
      signal: abortController.signal,
      body: JSON.stringify({ prompt: text, deploy, engine }),
    }).finally(() => clearTimeout(timeoutId));
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.error || `Workflow build failed (${res.status}).`);

    const label = data?.workflow?.label || "Generated Workflow";
    const provider = data?.provider || "LLM";
    const model = data?.model || "default model";
    const stepCount = Array.isArray(data?.workflow?.summary?.workflowSteps) ? data.workflow.summary.workflowSteps.length : 0;
    const scheduleTime = data?.workflow?.summary?.schedule?.time || "09:00";
    const scheduleTimezone = data?.workflow?.summary?.schedule?.timezone || "America/New_York";

    const reply = data?.deployed
      ? `Built and deployed "${label}" with ${stepCount} workflow steps. It is scheduled for ${scheduleTime} ${scheduleTimezone}. Generated using ${provider} ${model}. Open the Missions page to review or edit it.`
      : `Built a workflow draft "${label}" with ${stepCount} steps. It's ready for review and not deployed yet. Generated using ${provider} ${model}. Open the Missions page to review or edit it.`;
    const normalizedReply = normalizeAssistantReply(reply);
    summary.reply = normalizedReply.skip ? "" : normalizedReply.text;
    summary.provider = String(provider || "");
    summary.model = String(model || "");

    appendRawStream({
      event: "workflow_build_done",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: ctx.userContextId || undefined,
      engine,
      deployed: Boolean(data?.deployed),
      provider,
      model,
      stepCount,
    });
    if (!normalizedReply.skip) {
      broadcastMessage("assistant", normalizedReply.text, source, conversationId, userContextId);
      if (useVoice) await speak(normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text, ttsVoice);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Workflow build failed.";
    summary.ok = false;
    summary.error = msg;
    appendRawStream({
      event: "workflow_build_error",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: ctx.userContextId || undefined,
      engine,
      message: msg,
    });
    const isUnauthorized = /\bunauthorized\b/i.test(msg);
    const reply = isUnauthorized
      ? "I could not build that workflow because your session is not authorized for missions yet. Re-open Nova, sign in again, then retry and I will continue from your latest prompt."
      : `I couldn't build that workflow yet: ${msg}`;
    const normalizedReply = normalizeAssistantReply(reply);
    summary.reply = normalizedReply.skip ? "" : normalizedReply.text;
    if (!normalizedReply.skip) {
      broadcastMessage("assistant", normalizedReply.text, source, conversationId, userContextId);
      if (useVoice) await speak(normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text, ttsVoice);
    }
  } finally {
    broadcastState("idle", userContextId);
    summary.latencyMs = Date.now() - startedAt;
  }
  return summary;
}


