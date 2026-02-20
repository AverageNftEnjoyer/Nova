// ===== Chat Handler =====
// handleInput dispatcher split into focused sub-handlers.
// Bug Fix 2: Tool loop errors are now caught, logged, and surfaced to HUD.

import fs from "fs";
import path from "path";
import { createRequire } from "module";

// NLP preprocessing (compiled TS → dist/nlp/preprocess.js)
// Loaded lazily so a missing build does not crash the runtime.
let _preprocess = null;
function getPreprocess() {
  if (_preprocess) return _preprocess;
  try {
    const require = createRequire(import.meta.url);
    // Resolve relative to the project root dist output
    const mod = require("../../../../dist/nlp/preprocess.js");
    _preprocess = mod.preprocess ?? mod.default?.preprocess ?? null;
  } catch {
    // Build not available yet — fall back to identity
    _preprocess = (text) => ({ raw_text: text, clean_text: text, corrections: [], confidence: 1.0 });
  }
  return _preprocess;
}
import { createHash } from "crypto";
import { exec } from "child_process";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GROK_MODEL,
  DEFAULT_GEMINI_MODEL,
  ENABLE_PROVIDER_FALLBACK,
  OPENAI_FALLBACK_MODEL,
  OPENAI_REQUEST_TIMEOUT_MS,
  TOOL_LOOP_ENABLED,
  TOOL_LOOP_MAX_STEPS,
  CLAUDE_CHAT_MAX_TOKENS,
  SPOTIFY_INTENT_MAX_TOKENS,
  OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
  MEMORY_LOOP_ENABLED,
  SESSION_MAX_TURNS,
  SESSION_MAX_HISTORY_TOKENS,
  MAX_PROMPT_TOKENS,
  PROMPT_RESPONSE_RESERVE_TOKENS,
  PROMPT_HISTORY_TARGET_TOKENS,
  PROMPT_MIN_HISTORY_TOKENS,
  PROMPT_CONTEXT_SECTION_MAX_TOKENS,
  PROMPT_BUDGET_DEBUG,
  COMMAND_ACKS,
  AGENT_PROMPT_MODE,
  ROOT_WORKSPACE_DIR,
  ROUTING_PREFERENCE,
  ROUTING_ALLOW_ACTIVE_OVERRIDE,
  ROUTING_PREFERRED_PROVIDERS,
} from "../../core/constants.js";
import { sessionRuntime, toolRuntime, wakeWordRuntime } from "../infrastructure/config.js";
import { resolvePersonaWorkspaceDir, appendRawStream, trimHistoryMessagesByTokenBudget, cachedLoadIntegrationsRuntime } from "../context/persona-context.js";
import { isMemoryUpdateRequest, extractMemoryUpdateFact, buildMemoryFactMetadata, upsertMemoryFactInMarkdown, ensureMemoryTemplate, extractAutoMemoryFacts } from "../context/memory.js";
import { buildRuntimeSkillsPrompt } from "../context/skills.js";
import { shouldBuildWorkflowFromPrompt, shouldConfirmWorkflowFromPrompt, shouldDraftOnlyWorkflow, shouldPreloadWebSearch, replyClaimsNoLiveAccess, buildWebSearchReadableReply, buildWeatherWebSummary } from "./intent-router.js";
import { speak, playThinking, stopSpeaking, getBusy, setBusy, getCurrentVoice, normalizeRuntimeTone, runtimeToneDirective } from "../audio/voice.js";
import {
  broadcast,
  broadcastState,
  broadcastThinkingStatus,
  broadcastMessage,
  createAssistantStreamId,
  broadcastAssistantStreamStart,
  broadcastAssistantStreamDelta,
  broadcastAssistantStreamDone,
} from "../infrastructure/hud-gateway.js";
import {
  claudeMessagesCreate,
  claudeMessagesStream,
  describeUnknownError,
  estimateTokenCostUsd,
  extractOpenAIChatText,
  getOpenAIClient,
  resolveConfiguredChatRuntime,
  streamOpenAiChatCompletion,
  toErrorDetails,
  withTimeout,
} from "../llm/providers.js";
import { buildSystemPromptWithPersona, enforcePromptTokenBound } from "../../core/context-prompt.js";
import { buildAgentSystemPrompt, PromptMode } from "../context/system-prompt.js";
import { buildPersonaPrompt } from "../context/bootstrap.js";
import { shouldSkipDuplicateInbound } from "./inbound-dedupe.js";
import { normalizeAssistantReply, normalizeAssistantSpeechText } from "./reply-normalizer.js";
import { runLinkUnderstanding, formatLinkUnderstandingForPrompt } from "./link-understanding.js";
import { appendBudgetedPromptSection, computeHistoryTokenBudget } from "./prompt-budget.js";
import { detectSuspiciousPatterns, wrapWebContent } from "../context/external-content.js";
import {
  isWeatherRequestText,
  tryWeatherFastPathReply,
  getPendingWeatherConfirm,
  setPendingWeatherConfirm,
  clearPendingWeatherConfirm,
  isWeatherConfirmYes,
  isWeatherConfirmNo,
} from "./weather-fast-path.js";
import {
  isCryptoRequestText,
  tryCryptoFastPathReply,
} from "./crypto-fast-path.js";

function applyMemoryFactsToWorkspace(personaWorkspaceDir, facts) {
  if (!Array.isArray(facts) || facts.length === 0) return 0;
  const memoryFilePath = path.join(personaWorkspaceDir, "MEMORY.md");
  const existingContent = fs.existsSync(memoryFilePath)
    ? fs.readFileSync(memoryFilePath, "utf8")
    : ensureMemoryTemplate();

  let nextContent = existingContent;
  let applied = 0;
  for (const fact of facts) {
    const memoryFact = String(fact?.fact || "").trim();
    const memoryKey = String(fact?.key || "").trim();
    if (!memoryFact) continue;
    const updated = upsertMemoryFactInMarkdown(nextContent, memoryFact, memoryKey || undefined);
    if (updated !== nextContent) {
      nextContent = updated;
      applied += 1;
    }
  }

  if (nextContent !== existingContent) {
    fs.writeFileSync(memoryFilePath, nextContent, "utf8");
  }
  return applied;
}

function hashShadowPayload(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

const HUD_API_BASE_URL = String(process.env.NOVA_HUD_API_BASE_URL || "http://localhost:3000")
  .trim()
  .replace(/\/+$/, "");
const WORKFLOW_BUILD_TIMEOUT_MS = Number.parseInt(process.env.NOVA_WORKFLOW_BUILD_TIMEOUT_MS || "45000", 10);
const MISSION_CONFIRM_TTL_MS = Number.parseInt(process.env.NOVA_MISSION_CONFIRM_TTL_MS || "600000", 10);
const MEMORY_RECALL_TIMEOUT_MS = Number.parseInt(process.env.NOVA_MEMORY_RECALL_TIMEOUT_MS || "450", 10);
const WEB_PRELOAD_TIMEOUT_MS = Number.parseInt(process.env.NOVA_WEB_PRELOAD_TIMEOUT_MS || "900", 10);
const LINK_PRELOAD_TIMEOUT_MS = Number.parseInt(process.env.NOVA_LINK_PRELOAD_TIMEOUT_MS || "900", 10);
const missionConfirmBySession = new Map();

function cleanupMissionConfirmStore() {
  const now = Date.now();
  for (const [key, value] of missionConfirmBySession.entries()) {
    if (!value || now - Number(value.ts || 0) > MISSION_CONFIRM_TTL_MS) {
      missionConfirmBySession.delete(key);
    }
  }
}

function getPendingMissionConfirm(sessionKey) {
  const key = String(sessionKey || "").trim();
  if (!key) return null;
  cleanupMissionConfirmStore();
  const value = missionConfirmBySession.get(key);
  if (!value || !String(value.prompt || "").trim()) return null;
  return value;
}

function setPendingMissionConfirm(sessionKey, prompt) {
  const key = String(sessionKey || "").trim();
  const normalizedPrompt = String(prompt || "").trim();
  if (!key || !normalizedPrompt) return;
  missionConfirmBySession.set(key, { prompt: normalizedPrompt, ts: Date.now() });
}

function clearPendingMissionConfirm(sessionKey) {
  const key = String(sessionKey || "").trim();
  if (!key) return;
  missionConfirmBySession.delete(key);
}

function parseConversationIdFromSessionKey(sessionKey) {
  const key = String(sessionKey || "").trim();
  if (!key) return "";
  const marker = ":dm:";
  const markerIndex = key.lastIndexOf(marker);
  if (markerIndex < 0) return "";
  const candidate = key.slice(markerIndex + marker.length).trim();
  if (!candidate || candidate.includes(":")) return "";
  return candidate;
}

function resolveConversationId(opts, sessionKey, source) {
  const explicit = String(opts?.conversationId || opts?.threadId || "").trim();
  if (explicit) return explicit;
  if (String(source || "").trim().toLowerCase() !== "hud") return "";
  return parseConversationIdFromSessionKey(sessionKey);
}

function stripAssistantInvocation(text) {
  return String(text || "")
    .replace(/^\s*(hey|hi|yo)\s+nova[\s,:-]*/i, "")
    .replace(/^\s*nova[\s,:-]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForFastLane(text) {
  return stripAssistantInvocation(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSimpleFastLaneTurn(text) {
  const normalized = normalizeForFastLane(text);
  if (!normalized) return false;
  if (normalized.length > 42) return false;
  if (/\b(weather|forecast|temperature|rain|snow|mission|workflow|automation|schedule|spotify|shutdown|search|news|crypto|coinbase|bitcoin|ethereum|price|portfolio|transaction|trades)\b/.test(normalized)) {
    return false;
  }
  if (/\b(remind|create|build|deploy|send|email|discord|telegram)\b/.test(normalized)) {
    return false;
  }
  return /^(hey|hi|hello|yo|sup|ping|test|ok|okay|thanks|thank you|good morning|good afternoon|good evening|how are you|you there)$/.test(normalized);
}

function shouldUseToolLoopForTurn(text, opts = {}) {
  const normalized = normalizeForFastLane(text);
  if (!normalized) return false;
  if (opts.fastLaneSimpleChat === true) return false;
  if (isWeatherRequestText(text)) return false;
  if (isCryptoRequestText(text)) return false;

  const canRunWebSearch = opts.canRunWebSearch === true;
  const canRunWebFetch = opts.canRunWebFetch === true;
  if (canRunWebFetch && /https?:\/\/\S+/i.test(String(text || ""))) return true;
  if (canRunWebSearch && shouldPreloadWebSearch(text)) return true;

  if (/\b(search|lookup|look up|browse|web|latest|news|price|scores?)\b/.test(normalized)) return true;
  if (/\b(run|execute|terminal|shell|command|script|npm|node|python|git|build|test|lint|debug)\b/.test(normalized)) return true;
  if (/\b(file|folder|directory|read|write|edit|patch|code|refactor|repository|repo)\b/.test(normalized)) return true;
  if (/\b(tool|tool call|web fetch|web search|memory search|memory get)\b/.test(normalized)) return true;
  return false;
}

function shouldAttemptMemoryRecallTurn(text) {
  const normalized = normalizeForFastLane(text);
  if (!normalized) return false;
  if (normalized.length < 18) return false;
  if (isSimpleFastLaneTurn(text)) return false;
  if (isWeatherRequestText(text)) return false;
  if (isCryptoRequestText(text)) return false;
  const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
  if (tokenCount >= 6) return true;
  return /\b(remember|earlier|before|preference|profile|context|resume|continue|project|my)\b/.test(normalized);
}

function missionChannelHint(text) {
  const n = String(text || "").toLowerCase();
  if (/\btelegram\b/.test(n)) return "Telegram";
  if (/\bdiscord\b/.test(n)) return "Discord";
  if (/\bnovachat\b|\bchat\b/.test(n)) return "NovaChat";
  if (/\bemail\b/.test(n)) return "Email";
  if (/\bwebhook\b/.test(n)) return "Webhook";
  return "";
}

function missionTimeHint(text) {
  const m = String(text || "").match(/\b(?:at|around|by)\s+([01]?\d(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?)\b/i);
  return m?.[1] ? String(m[1]).replace(/\s+/g, " ").trim() : "";
}

function buildMissionConfirmReply(text) {
  const channel = missionChannelHint(text);
  const atTime = missionTimeHint(text);
  const details = [
    atTime ? ` at ${atTime}` : "",
    channel ? ` to ${channel}` : "",
  ].join("");
  return [
    `I can turn that into a mission${details}.`,
    `Do you want me to create it now? Reply "yes" or "no".`,
  ].join(" ");
}

function isMissionConfirmYes(text) {
  const n = String(text || "").trim().toLowerCase();
  if (!n) return false;
  if (/^(no|nah|nope|cancel|stop|nevermind|never mind)\b/.test(n)) return false;
  return /^(yes|yeah|yep|sure|ok|okay|do it|go ahead|create it|create mission|please do|affirmative)\b/.test(n);
}

function isMissionConfirmNo(text) {
  const n = String(text || "").trim().toLowerCase();
  return /^(no|nah|nope|cancel|stop|nevermind|never mind)\b/.test(n);
}

function stripMissionConfirmPrefix(text) {
  return String(text || "")
    .replace(/^\s*(yes|yeah|yep|sure|ok|okay|do it|go ahead|create it|create mission|please do|affirmative)[\s,:-]*/i, "")
    .trim();
}

async function sendDirectAssistantReply(userText, replyText, ctx, thinkingStatus = "Confirming mission") {
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

  if (useVoice) {
    await speak(normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text, ttsVoice);
    broadcastThinkingStatus("", userContextId);
  } else {
    broadcastThinkingStatus("", userContextId);
    broadcastState("idle", userContextId);
  }
  return normalizedReply.text;
}

// ===== Memory update sub-handler =====
async function handleMemoryUpdate(text, ctx) {
  const { source, sender, sessionId, useVoice, ttsVoice, userContextId, conversationId } = ctx;
  const fact = extractMemoryUpdateFact(text);
  const assistantStreamId = createAssistantStreamId();

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
    if (finalReply && sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", finalReply, { source, sender: "nova" });
    if (finalReply && useVoice) {
      await speak(normalizeAssistantSpeechText(finalReply) || finalReply, ttsVoice);
    } else broadcastState("idle", userContextId);
    return;
  }

  try {
    const personaWorkspaceDir = resolvePersonaWorkspaceDir(userContextId);
    const memoryFilePath = path.join(personaWorkspaceDir, "MEMORY.md");
    const existingContent = fs.existsSync(memoryFilePath) ? fs.readFileSync(memoryFilePath, "utf8") : ensureMemoryTemplate();
    const memoryMeta = buildMemoryFactMetadata(fact);
    const updatedContent = upsertMemoryFactInMarkdown(existingContent, memoryMeta.fact, memoryMeta.key);
    fs.writeFileSync(memoryFilePath, updatedContent, "utf8");
    const confirmation = memoryMeta.hasStructuredField
      ? `Memory updated. I will remember this as current: ${memoryMeta.fact}`
      : `Memory updated. I saved: ${memoryMeta.fact}`;
    const finalConfirmation = sendAssistantReply(confirmation);
    if (finalConfirmation && sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", finalConfirmation, { source, sender: "nova" });
    appendRawStream({
      event: "memory_manual_upsert",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: userContextId || undefined,
      key: memoryMeta.key || null,
    });
    console.log(`[Memory] Manual memory update applied for ${userContextId || "anonymous"} key=${memoryMeta.key || "general"}.`);
    if (finalConfirmation && useVoice) {
      await speak(normalizeAssistantSpeechText(finalConfirmation) || finalConfirmation, ttsVoice);
    } else broadcastState("idle", userContextId);
  } catch (err) {
    const failure = `I couldn't update MEMORY.md: ${describeUnknownError(err)}`;
    const finalFailure = sendAssistantReply(failure);
    if (finalFailure && sessionId) sessionRuntime.appendTranscriptTurn(sessionId, "assistant", finalFailure, { source, sender: "nova" });
    if (finalFailure && useVoice) {
      await speak(normalizeAssistantSpeechText(finalFailure) || finalFailure, ttsVoice);
    } else broadcastState("idle", userContextId);
  }
}

// ===== Shutdown sub-handler =====
async function handleShutdown(ctx) {
  const { ttsVoice } = ctx;
  stopSpeaking();
  await speak("Shutting down now. If you need me again, just restart the system.", ttsVoice);
  process.exit(0);
}

// ===== Spotify sub-handler =====
async function handleSpotify(text, ctx, llmCtx) {
  const { source, useVoice, ttsVoice, conversationId, userContextId } = ctx;
  const { activeChatRuntime, activeOpenAiCompatibleClient, selectedChatModel } = llmCtx;
  stopSpeaking();

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
    const ack = COMMAND_ACKS[Math.floor(Math.random() * COMMAND_ACKS.length)];
    const normalizedAck = normalizeAssistantReply(ack);
    if (!normalizedAck.skip) {
      if (useVoice) await speak(normalizeAssistantSpeechText(normalizedAck.text) || normalizedAck.text, ttsVoice);
      else broadcastMessage("assistant", normalizedAck.text, source, conversationId, userContextId);
    }
    exec("start spotify:");
  }

  broadcastState("idle", userContextId);
}

// ===== Workflow builder sub-handler =====
async function handleWorkflowBuild(text, ctx, options = {}) {
  const { source, useVoice, ttsVoice, supabaseAccessToken, conversationId, userContextId } = ctx;
  const engine = String(options.engine || "src").trim().toLowerCase() || "src";
  stopSpeaking();
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
    appendRawStream({
      event: "workflow_build_error",
      source,
      sessionKey: ctx.sessionKey || "",
      userContextId: ctx.userContextId || undefined,
      engine,
      message: msg,
    });
    const reply = `I couldn't build that workflow yet: ${msg}`;
    const normalizedReply = normalizeAssistantReply(reply);
    if (!normalizedReply.skip) {
      broadcastMessage("assistant", normalizedReply.text, source, conversationId, userContextId);
      if (useVoice) await speak(normalizeAssistantSpeechText(normalizedReply.text) || normalizedReply.text, ttsVoice);
    }
  } finally {
    broadcastState("idle", userContextId);
  }
}

// ===== Core chat request =====
async function executeChatRequest(text, ctx, llmCtx, requestHints = {}) {
  const { source, sender, sessionContext, sessionKey, useVoice, ttsVoice, userContextId, conversationId,
    runtimeTone, runtimeCommunicationStyle, runtimeAssistantName, runtimeCustomInstructions,
    raw_text: displayText } = ctx;
  // displayText: original user text for UI/transcript; text: clean_text for LLM/tools
  const uiText = displayText || text;
  const { activeChatRuntime, activeOpenAiCompatibleClient, selectedChatModel, runtimeTools, availableTools, canRunToolLoop, canRunWebSearch, canRunWebFetch } = llmCtx;
  const fastLaneSimpleChat = requestHints.fastLaneSimpleChat === true;
  const startedAt = Date.now();
  const observedToolCalls = [];
  let usedMemoryRecall = false;
  let usedWebSearchPreload = false;
  let usedLinkUnderstanding = false;
  let preparedPromptHash = "";
  let emittedAssistantDelta = false;
  const runSummary = {
    ok: false,
    source,
    sessionKey,
    userContextId: userContextId || "",
    provider: activeChatRuntime.provider,
    model: selectedChatModel,
    reply: "",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    latencyMs: 0,
    toolCalls: [],
    memoryRecallUsed: false,
    webSearchPreloadUsed: false,
    linkUnderstandingUsed: false,
    promptHash: "",
    error: "",
  };
  broadcastState("thinking", userContextId);
  broadcastThinkingStatus("Analyzing request", userContextId);
  const nlpCorrectionCount = Array.isArray(ctx.nlpCorrections) ? ctx.nlpCorrections.length : 0;
  broadcastMessage("user", uiText, source, conversationId, userContextId, {
    nlpCleanText: text !== uiText ? text : undefined,
    nlpConfidence: Number.isFinite(Number(ctx.nlpConfidence)) ? Number(ctx.nlpConfidence) : undefined,
    nlpCorrectionCount,
    nlpBypass: ctx.nlpBypass === true,
  });
  if (useVoice) playThinking();

  const personaWorkspaceDir = resolvePersonaWorkspaceDir(userContextId);
  const runtimeSkillsPrompt = fastLaneSimpleChat ? "" : buildRuntimeSkillsPrompt(personaWorkspaceDir, text);
  const { systemPrompt: baseSystemPrompt, tokenBreakdown } = buildSystemPromptWithPersona({
    buildAgentSystemPrompt,
    buildPersonaPrompt,
    workspaceDir: personaWorkspaceDir,
    promptArgs: {
      workspaceDir: ROOT_WORKSPACE_DIR,
      promptMode:
        AGENT_PROMPT_MODE === PromptMode.MINIMAL || AGENT_PROMPT_MODE === PromptMode.NONE
          ? AGENT_PROMPT_MODE : PromptMode.FULL,
      memoryCitationsMode: String(process.env.NOVA_MEMORY_CITATIONS_MODE || "off").trim().toLowerCase() === "on" ? "on" : "off",
      userTimezone: process.env.NOVA_USER_TIMEZONE || "America/New_York",
      skillsPrompt: runtimeSkillsPrompt || process.env.NOVA_SKILLS_PROMPT || "",
      heartbeatPrompt: process.env.NOVA_HEARTBEAT_PROMPT || "",
      docsPath: process.env.NOVA_DOCS_PATH || "",
      ttsHint: "Keep voice responses concise, clear, and natural.",
      reasoningLevel: "off",
      runtimeInfo: {
        agentId: "nova-agent",
        host: process.env.COMPUTERNAME || "",
        os: process.platform,
        arch: process.arch,
        node: process.version,
        model: selectedChatModel,
        defaultModel: selectedChatModel,
        shell: process.env.ComSpec || process.env.SHELL || "",
        channel: source,
        capabilities: ["voice", "websocket"],
        repoRoot: process.env.ROOT_WORKSPACE_DIR || "",
      },
      workspaceNotes: [
        "This is a first-pass prompt framework integration for Nova.",
        "Future skill/memory metadata plumbing can extend this prompt builder.",
      ],
    },
  });

  let systemPrompt = baseSystemPrompt;
  const personaOverlay = [
    "## Runtime Persona (HUD)",
    runtimeAssistantName ? `- Assistant name: ${runtimeAssistantName}` : "",
    runtimeCommunicationStyle ? `- Communication style: ${runtimeCommunicationStyle}` : "",
    `- Tone: ${runtimeTone}`,
    `- Tone behavior: ${runtimeToneDirective(runtimeTone)}`,
    runtimeCustomInstructions ? `- Custom instructions: ${runtimeCustomInstructions}` : "",
  ].filter(Boolean).join("\n");
  if (personaOverlay) systemPrompt += `\n\n${personaOverlay}`;

  const promptBudgetOptions = {
    userMessage: text,
    maxPromptTokens: MAX_PROMPT_TOKENS,
    responseReserveTokens: PROMPT_RESPONSE_RESERVE_TOKENS,
    historyTargetTokens: PROMPT_HISTORY_TARGET_TOKENS,
    sectionMaxTokens: PROMPT_CONTEXT_SECTION_MAX_TOKENS,
    debug: PROMPT_BUDGET_DEBUG,
  };

  const enrichmentTasks = [];
  if (!fastLaneSimpleChat && canRunWebSearch && shouldPreloadWebSearch(text)) {
    enrichmentTasks.push(
      withTimeout(
        (async () => {
          const preloadResult = await runtimeTools.executeToolUse(
            { id: `tool_preload_${Date.now()}`, name: "web_search", input: { query: text }, type: "tool_use" },
            availableTools,
          );
          const preloadContent = String(preloadResult?.content || "").trim();
          if (!preloadContent || /^web_search error/i.test(preloadContent)) return null;
          const suspiciousPatterns = detectSuspiciousPatterns(preloadContent);
          if (suspiciousPatterns.length > 0) {
            console.warn(
              `[Security] suspicious web_search preload patterns=${suspiciousPatterns.length} session=${sessionKey}`,
            );
          }
          return {
            kind: "web_search",
            body: `Use these current results when answering:\n${wrapWebContent(preloadContent, "web_search")}`,
          };
        })(),
        Math.max(250, WEB_PRELOAD_TIMEOUT_MS),
        "Web search preload",
      ),
    );
  }

  if (!fastLaneSimpleChat && canRunWebFetch) {
    enrichmentTasks.push(
      withTimeout(
        (async () => {
          const linkResult = await runLinkUnderstanding({
            text,
            runtimeTools,
            availableTools,
            maxLinks: 2,
            maxCharsPerLink: 1800,
          });
          const formatted = formatLinkUnderstandingForPrompt(linkResult.outputs, 3600);
          if (!formatted) return null;
          const suspiciousPatterns = detectSuspiciousPatterns(formatted);
          if (suspiciousPatterns.length > 0) {
            console.warn(
              `[Security] suspicious link context patterns=${suspiciousPatterns.length} session=${sessionKey}`,
            );
          }
          return {
            kind: "web_fetch",
            body: `Use this fetched URL context when relevant:\n${wrapWebContent(formatted, "web_fetch")}`,
          };
        })(),
        Math.max(250, LINK_PRELOAD_TIMEOUT_MS),
        "Link preload",
      ),
    );
  }

  if (!fastLaneSimpleChat && runtimeTools?.memoryManager && MEMORY_LOOP_ENABLED && shouldAttemptMemoryRecallTurn(text)) {
    enrichmentTasks.push(
      (async () => {
        runtimeTools.memoryManager.warmSession();
        const recalled = await withTimeout(
          runtimeTools.memoryManager.search(text, 3),
          Math.max(150, MEMORY_RECALL_TIMEOUT_MS),
          "Memory recall search",
        );
        if (!Array.isArray(recalled) || recalled.length === 0) return null;
        const memoryContext = recalled
          .map((item, idx) => `[${idx + 1}] ${String(item.source || "unknown")}\n${String(item.content || "").slice(0, 600)}`)
          .join("\n\n");
        return {
          kind: "memory",
          body: `Use this indexed context when relevant:\n${memoryContext}`,
        };
      })(),
    );
  }

  if (enrichmentTasks.length > 0) {
    broadcastThinkingStatus("Gathering context", userContextId);
    const enrichmentResults = await Promise.allSettled(enrichmentTasks);
    for (const taskResult of enrichmentResults) {
      if (taskResult.status === "rejected") {
        const msg = describeUnknownError(taskResult.reason);
        if (/memory/i.test(msg)) console.warn(`[MemoryLoop] Search failed: ${msg}`);
        else if (/link/i.test(msg)) console.warn(`[ToolLoop] link understanding preload failed: ${msg}`);
        else console.warn(`[ToolLoop] web_search preload failed: ${msg}`);
        continue;
      }

      const taskValue = taskResult.value;
      if (!taskValue || !taskValue.kind || !taskValue.body) continue;
      if (taskValue.kind === "web_search") {
        const appended = appendBudgetedPromptSection({
          ...promptBudgetOptions,
          prompt: systemPrompt,
          sectionTitle: "Live Web Search Context",
          sectionBody: taskValue.body,
        });
        if (appended.included) {
          systemPrompt = appended.prompt;
          usedWebSearchPreload = true;
        }
        continue;
      }
      if (taskValue.kind === "web_fetch") {
        const appended = appendBudgetedPromptSection({
          ...promptBudgetOptions,
          prompt: systemPrompt,
          sectionTitle: "Link Context",
          sectionBody: taskValue.body,
        });
        if (appended.included) {
          systemPrompt = appended.prompt;
          usedLinkUnderstanding = true;
          observedToolCalls.push("web_fetch");
        }
        continue;
      }
      if (taskValue.kind === "memory") {
        const appended = appendBudgetedPromptSection({
          ...promptBudgetOptions,
          prompt: systemPrompt,
          sectionTitle: "Live Memory Recall",
          sectionBody: taskValue.body,
        });
        if (appended.included) {
          systemPrompt = appended.prompt;
          usedMemoryRecall = true;
        }
      }
    }
  }

  const tokenInfo = enforcePromptTokenBound(systemPrompt, text, MAX_PROMPT_TOKENS);
  broadcastThinkingStatus("Planning response", userContextId);
  console.log(`[Prompt] Tokens - persona: ${tokenBreakdown.persona}, user: ${tokenInfo.userTokens}`);

  const priorTurns = sessionRuntime.limitTranscriptTurns(sessionContext.transcript, SESSION_MAX_TURNS);
  const rawHistoryMessages = sessionRuntime.transcriptToChatMessages(priorTurns);
  const computedHistoryTokenBudget = computeHistoryTokenBudget({
    maxPromptTokens: MAX_PROMPT_TOKENS,
    responseReserveTokens: PROMPT_RESPONSE_RESERVE_TOKENS,
    userMessage: text,
    systemPrompt,
    maxHistoryTokens: SESSION_MAX_HISTORY_TOKENS,
    minHistoryTokens: PROMPT_MIN_HISTORY_TOKENS,
    targetHistoryTokens: PROMPT_HISTORY_TARGET_TOKENS,
  });
  const historyBudget = trimHistoryMessagesByTokenBudget(rawHistoryMessages, computedHistoryTokenBudget);
  const historyMessages = historyBudget.messages;
  console.log(
    `[Session] key=${sessionKey} sender=${sender || "unknown"} prior_turns=${priorTurns.length} injected_messages=${historyMessages.length} trimmed_messages=${historyBudget.trimmed} history_tokens=${historyBudget.tokens} history_budget=${computedHistoryTokenBudget}`,
  );

  const messages = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: text },
  ];
  preparedPromptHash = hashShadowPayload(JSON.stringify(messages));
  const assistantStreamId = createAssistantStreamId();
  broadcastAssistantStreamStart(assistantStreamId, source, undefined, conversationId, userContextId);

  let reply = "";
  try {
    let promptTokens = 0;
    let completionTokens = 0;
    let modelUsed = selectedChatModel;

    const weatherFastResult = await tryWeatherFastPathReply({
      text,
      runtimeTools,
      availableTools,
      canRunWebSearch,
    });
    const cryptoFastResult = String(weatherFastResult?.reply || "").trim()
      ? { reply: "", source: "" }
      : await tryCryptoFastPathReply({
          text,
          runtimeTools,
          availableTools,
          userContextId,
          conversationId,
        });

    if (String(weatherFastResult?.reply || "").trim()) {
      const suggestedLocation = String(weatherFastResult?.suggestedLocation || "").trim();
      if (weatherFastResult?.needsConfirmation && suggestedLocation) {
        setPendingWeatherConfirm(sessionKey, text, suggestedLocation);
        broadcastThinkingStatus("Confirming location", userContextId);
      } else {
        clearPendingWeatherConfirm(sessionKey);
        broadcastThinkingStatus("Summarizing weather", userContextId);
      }
      reply = String(weatherFastResult.reply || "").trim();
      if (weatherFastResult?.toolCall) observedToolCalls.push(String(weatherFastResult.toolCall));
    } else if (String(cryptoFastResult?.reply || "").trim()) {
      clearPendingWeatherConfirm(sessionKey);
      broadcastThinkingStatus("Checking Coinbase", userContextId);
      reply = String(cryptoFastResult.reply || "").trim();
      if (cryptoFastResult?.toolCall) observedToolCalls.push(String(cryptoFastResult.toolCall));
    } else if (activeChatRuntime.provider === "claude") {
      broadcastThinkingStatus("Drafting response", userContextId);
      const claudeMessages = [...historyMessages, { role: "user", content: text }];
      const claudeCompletion = await claudeMessagesStream({
        apiKey: activeChatRuntime.apiKey,
        baseURL: activeChatRuntime.baseURL,
        model: selectedChatModel,
        system: systemPrompt,
        messages: claudeMessages,
        userText: text,
        maxTokens: CLAUDE_CHAT_MAX_TOKENS,
        timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
        onDelta: (delta) => {
          emittedAssistantDelta = true;
          broadcastAssistantStreamDelta(assistantStreamId, delta, source, undefined, conversationId, userContextId);
        },
      });
      reply = claudeCompletion.text;
      promptTokens = claudeCompletion.usage.promptTokens;
      completionTokens = claudeCompletion.usage.completionTokens;
    } else if (canRunToolLoop) {
      const openAiToolDefs = toolRuntime.toOpenAiToolDefinitions(availableTools);
      const loopMessages = [...messages];
      const toolOutputsForRecovery = [];
      let forcedToolFallbackReply = "";
      let usedFallback = false;

      for (let step = 0; step < Math.max(1, TOOL_LOOP_MAX_STEPS); step += 1) {
        broadcastThinkingStatus("Reasoning", userContextId);
        let completion = null;
        try {
          completion = await withTimeout(
            activeOpenAiCompatibleClient.chat.completions.create({
              model: modelUsed,
              messages: loopMessages,
              max_completion_tokens: OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
              tools: openAiToolDefs,
              tool_choice: "auto",
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            `Tool loop model ${modelUsed}`,
          );
        } catch (err) {
          if (!usedFallback && OPENAI_FALLBACK_MODEL) {
            usedFallback = true;
            modelUsed = OPENAI_FALLBACK_MODEL;
            console.warn(`[ToolLoop] Primary model failed; retrying with fallback model ${modelUsed}.`);
            completion = await withTimeout(
              activeOpenAiCompatibleClient.chat.completions.create({
                model: modelUsed,
                messages: loopMessages,
                max_completion_tokens: OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
                tools: openAiToolDefs,
                tool_choice: "auto",
              }),
              OPENAI_REQUEST_TIMEOUT_MS,
              `Tool loop fallback model ${modelUsed}`,
            );
          } else {
            throw err;
          }
        }

        const usage = completion?.usage || {};
        promptTokens += Number(usage.prompt_tokens || 0);
        completionTokens += Number(usage.completion_tokens || 0);

        const choice = completion?.choices?.[0]?.message || {};
        const assistantText = extractOpenAIChatText(completion);
        const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];

        if (toolCalls.length === 0) {
          reply = assistantText.trim();
          break;
        }

        loopMessages.push({ role: "assistant", content: assistantText || "", tool_calls: toolCalls });

        // Bug Fix 2: tool errors are caught, logged, and surfaced instead of swallowed
        for (const toolCall of toolCalls) {
          const toolName = String(toolCall?.function?.name || toolCall?.id || "").trim();
          const normalizedToolName = toolName.toLowerCase();
          if (normalizedToolName === "web_search") broadcastThinkingStatus("Searching web", userContextId);
          else if (normalizedToolName === "web_fetch") broadcastThinkingStatus("Reviewing sources", userContextId);
          else if (normalizedToolName.startsWith("coinbase_")) broadcastThinkingStatus("Querying Coinbase", userContextId);
          else broadcastThinkingStatus("Running tools", userContextId);
          if (toolName) observedToolCalls.push(toolName);
          const toolUse = toolRuntime.toOpenAiToolUseBlock(toolCall);
          if (String(toolUse?.name || "").toLowerCase().startsWith("coinbase_")) {
            toolUse.input = {
              ...(toolUse.input && typeof toolUse.input === "object" ? toolUse.input : {}),
              userContextId,
              conversationId,
            };
          }
          let toolResult;
          try {
            toolResult = await runtimeTools.executeToolUse(toolUse, availableTools);
          } catch (toolErr) {
            const errMsg = describeUnknownError(toolErr);
            console.error(`[ToolLoop] Tool "${toolCall.function?.name ?? toolCall.id}" failed: ${errMsg}`);
            broadcastAssistantStreamDelta(
              assistantStreamId,
              `[Tool error: ${toolCall.function?.name ?? "unknown"} - ${errMsg}]`,
              source,
              undefined,
              conversationId,
              userContextId,
            );
            toolResult = { content: `Tool execution failed: ${errMsg}` };
          }
          loopMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: (() => {
              const content = String(toolResult?.content || "");
              const normalizedName = String(toolName || "").toLowerCase();
              if (content.trim()) {
                toolOutputsForRecovery.push({ name: normalizedName, content });
                if (normalizedName === "web_search" && /^web_search error:/i.test(content)) {
                  if (/missing brave api key/i.test(content)) {
                    forcedToolFallbackReply =
                      "Live web search is unavailable because the Brave API key is missing. Add Brave in Integrations and retry.";
                  } else if (/rate limited/i.test(content)) {
                    forcedToolFallbackReply =
                      "Live web search is currently rate-limited. Please retry in a moment.";
                  } else {
                    forcedToolFallbackReply =
                      `Live web search failed: ${content.replace(/^web_search error:\s*/i, "").trim()}`;
                  }
                }
              }
              if (normalizedName !== "web_search" && normalizedName !== "web_fetch") {
                return content;
              }
              const suspiciousPatterns = detectSuspiciousPatterns(content);
              if (suspiciousPatterns.length > 0) {
                console.warn(
                  `[Security] suspicious ${normalizedName} tool output patterns=${suspiciousPatterns.length} session=${sessionKey}`,
                );
              }
              return wrapWebContent(content, normalizedName === "web_fetch" ? "web_fetch" : "web_search");
            })(),
          });
        }

        if (forcedToolFallbackReply) {
          reply = forcedToolFallbackReply;
          break;
        }
      }

      if (!reply || !reply.trim()) {
        broadcastThinkingStatus("Recovering final answer", userContextId);
        // Some OpenAI-compatible providers can end tool loops without a terminal text message.
        // Try one no-tools recovery completion first, then fall back to the latest tool output.
        try {
          const recovery = await withTimeout(
            activeOpenAiCompatibleClient.chat.completions.create({
              model: modelUsed,
              messages: [
                ...loopMessages,
                {
                  role: "user",
                  content: "Provide the final answer to the user using the tool results above. Keep it concise and actionable.",
                },
              ],
              max_completion_tokens: OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS,
            }),
            OPENAI_REQUEST_TIMEOUT_MS,
            `Tool loop recovery model ${modelUsed}`,
          );
          reply = extractOpenAIChatText(recovery).trim();
        } catch (recoveryErr) {
          console.warn(`[ToolLoop] recovery completion failed: ${describeUnknownError(recoveryErr)}`);
        }
      }

      if (!reply || !reply.trim()) {
        const latestUsefulTool = [...toolOutputsForRecovery]
          .reverse()
          .find((entry) => {
            const content = String(entry?.content || "").trim();
            if (!content) return false;
            if (entry.name === "web_search" && /^web_search error/i.test(content)) return false;
            if (entry.name === "web_fetch" && /^web_fetch error/i.test(content)) return false;
            return true;
          });

        if (latestUsefulTool) {
          if (latestUsefulTool.name === "web_search") {
            if (isWeatherRequestText(text)) {
              const weatherReadable = buildWeatherWebSummary(text, latestUsefulTool.content);
              reply = weatherReadable
                || "I checked live weather sources, but couldn't extract a reliable forecast summary yet. Please retry with city and state (for example: Pittsburgh, PA).";
            } else {
              const readable = buildWebSearchReadableReply(text, latestUsefulTool.content);
              reply = readable || `Live web results:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
            }
          } else if (latestUsefulTool.name === "web_fetch") {
            reply = `I fetched the page content but the model did not finalize the answer. Here is the extracted content:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
          } else {
            reply = `I ran tools but the model returned no final text. Tool output:\n\n${latestUsefulTool.content.slice(0, 2200)}`;
          }
        } else {
          const latestToolError = [...toolOutputsForRecovery]
            .reverse()
            .find((entry) => {
              const content = String(entry?.content || "").trim().toLowerCase();
              return content.startsWith("web_search error") || content.startsWith("web_fetch error");
            });
          if (latestToolError) {
            if (latestToolError.name === "web_search") {
              const detail = String(latestToolError.content || "")
                .replace(/^web_search error:\s*/i, "")
                .trim();
              reply = detail
                ? `I couldn't complete a live web lookup: ${detail}`
                : "I couldn't complete a live web lookup right now.";
            } else {
              const detail = String(latestToolError.content || "")
                .replace(/^web_fetch error:\s*/i, "")
                .trim();
              reply = detail
                ? `I couldn't fetch the web source: ${detail}`
                : "I couldn't fetch the web source right now.";
            }
          }
        }
      }

      if (!reply || !reply.trim()) throw new Error(`Model ${modelUsed} returned no text response after tool loop.`);
    } else {
      broadcastThinkingStatus("Drafting response", userContextId);
      let streamed = null;
      let sawPrimaryDelta = false;
      try {
        streamed = await streamOpenAiChatCompletion({
          client: activeOpenAiCompatibleClient,
          model: modelUsed,
          messages,
          timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
          onDelta: (delta) => {
            sawPrimaryDelta = true;
            emittedAssistantDelta = true;
            broadcastAssistantStreamDelta(assistantStreamId, delta, source, undefined, conversationId, userContextId);
          },
        });
      } catch (primaryError) {
        if (!OPENAI_FALLBACK_MODEL || sawPrimaryDelta) throw primaryError;
        const fallbackModel = OPENAI_FALLBACK_MODEL;
        const primaryDetails = toErrorDetails(primaryError);
        console.warn(
          `[LLM] Primary model failed provider=${activeChatRuntime.provider} model=${modelUsed}` +
          ` status=${primaryDetails.status ?? "n/a"} message=${primaryDetails.message}. Retrying with fallback ${fallbackModel}.`,
        );
        streamed = await streamOpenAiChatCompletion({
          client: activeOpenAiCompatibleClient,
          model: fallbackModel,
          messages,
          timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
          onDelta: (delta) => {
            emittedAssistantDelta = true;
            broadcastAssistantStreamDelta(assistantStreamId, delta, source, undefined, conversationId, userContextId);
          },
        });
        modelUsed = fallbackModel;
      }
      reply = streamed.reply;
      if (!reply || !reply.trim()) throw new Error(`Model ${modelUsed} returned no text response.`);
      promptTokens = streamed.promptTokens || 0;
      completionTokens = streamed.completionTokens || 0;
    }

    // Refusal recovery: if model claimed no web access, do a search and append results
    if (replyClaimsNoLiveAccess(reply) && canRunWebSearch) {
      broadcastThinkingStatus("Verifying live web access", userContextId);
      try {
        const fallbackResult = await runtimeTools.executeToolUse(
          { id: `tool_refusal_recover_${Date.now()}`, name: "web_search", input: { query: text }, type: "tool_use" },
          availableTools,
        );
        const fallbackContent = String(fallbackResult?.content || "").trim();
        if (fallbackContent && !/^web_search error/i.test(fallbackContent)) {
          const weatherReadable = isWeatherRequestText(text) ? buildWeatherWebSummary(text, fallbackContent) : "";
          const readable = weatherReadable || buildWebSearchReadableReply(text, fallbackContent);
          const correction = readable
            ? `I do have live web access in this runtime.\n\n${readable}`
            : `I do have live web access in this runtime. Current web results:\n\n${fallbackContent.slice(0, 2200)}`;
          reply = reply ? `${reply}\n\n${correction}` : correction;
          emittedAssistantDelta = true;
          broadcastAssistantStreamDelta(assistantStreamId, correction, source, undefined, conversationId, userContextId);
          observedToolCalls.push("web_search");
        }
      } catch (err) {
        console.warn(`[ToolLoop] refusal recovery search failed: ${describeUnknownError(err)}`);
      }
    }

    const normalizedReply = normalizeAssistantReply(reply);
    broadcastThinkingStatus("Finalizing response", userContextId);
    if (normalizedReply.skip) {
      reply = "";
    } else {
      reply = normalizedReply.text;
    }

    if (reply && !emittedAssistantDelta) {
      emittedAssistantDelta = true;
      broadcastAssistantStreamDelta(assistantStreamId, reply, source, undefined, conversationId, userContextId);
    }

    const modelForUsage = activeChatRuntime.provider === "claude" ? selectedChatModel : (modelUsed || selectedChatModel);
    const totalTokens = promptTokens + completionTokens;
    const estimatedCostUsd = estimateTokenCostUsd(modelForUsage, promptTokens, completionTokens);

    appendRawStream({ event: "request_done", source, sessionKey, provider: activeChatRuntime.provider, model: modelForUsage, promptTokens, completionTokens, totalTokens, estimatedCostUsd });
    console.log(`[LLM] provider=${activeChatRuntime.provider} model=${modelForUsage} prompt_tokens=${promptTokens} completion_tokens=${completionTokens} total_tokens=${totalTokens}${estimatedCostUsd !== null ? ` estimated_usd=$${estimatedCostUsd}` : ""}`);
    broadcast(
      {
        type: "usage",
        provider: activeChatRuntime.provider,
        model: modelForUsage,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
        userContextId: userContextId || undefined,
        ts: Date.now(),
      },
      { userContextId },
    );

    const nlpCorrections = Array.isArray(ctx.nlpCorrections)
      ? ctx.nlpCorrections
          .map((c) => ({
            reason: String(c?.reason || ""),
            confidence: Number(c?.confidence || 0),
            offsets: Array.isArray(c?.offsets) ? c.offsets.slice(0, 2) : undefined,
          }))
          .filter((c) => c.reason)
      : [];
    sessionRuntime.appendTranscriptTurn(sessionContext.sessionEntry.sessionId, "user", uiText, {
      source,
      sender: ctx.sender,
      provider: activeChatRuntime.provider,
      model: modelForUsage,
      sessionKey,
      nlpCleanText: text !== uiText ? text : undefined,
      nlpConfidence: Number.isFinite(Number(ctx.nlpConfidence)) ? Number(ctx.nlpConfidence) : undefined,
      nlpCorrectionCount: nlpCorrections.length,
      nlpCorrections: nlpCorrections.length > 0 ? nlpCorrections : undefined,
    });
    if (reply) {
      sessionRuntime.appendTranscriptTurn(sessionContext.sessionEntry.sessionId, "assistant", reply, { source, sender: "nova", provider: activeChatRuntime.provider, model: modelForUsage, sessionKey, promptTokens, completionTokens, totalTokens });
    }
    sessionContext.persistUsage({ model: modelForUsage, promptTokens, completionTokens });

    try {
      const autoFacts = extractAutoMemoryFacts(text);
      const autoCaptured = applyMemoryFactsToWorkspace(personaWorkspaceDir, autoFacts);
      if (autoCaptured > 0) {
        appendRawStream({
          event: "memory_auto_upsert",
          source,
          sessionKey,
          userContextId: userContextId || undefined,
          captured: autoCaptured,
        });
        console.log(
          `[Memory] Auto-upserted ${autoCaptured} fact(s) for ${userContextId || "anonymous"} in MEMORY.md.`,
        );
      }
    } catch (memoryErr) {
      console.warn(`[Memory] Auto-upsert failed: ${describeUnknownError(memoryErr)}`);
    }

    runSummary.ok = true;
    runSummary.provider = activeChatRuntime.provider;
    runSummary.model = modelForUsage;
    runSummary.reply = reply;
    runSummary.promptTokens = promptTokens;
    runSummary.completionTokens = completionTokens;
    runSummary.totalTokens = totalTokens;
    runSummary.toolCalls = Array.from(new Set(observedToolCalls.filter(Boolean)));
    runSummary.memoryRecallUsed = usedMemoryRecall;
    runSummary.webSearchPreloadUsed = usedWebSearchPreload;
    runSummary.linkUnderstandingUsed = usedLinkUnderstanding;
    runSummary.promptHash = preparedPromptHash;

    if (useVoice && reply) await speak(normalizeAssistantSpeechText(reply) || reply, ttsVoice);
  } catch (err) {
    broadcastThinkingStatus("Handling error", userContextId);
    const details = toErrorDetails(err);
    const msg = details.message || "Unknown model error.";
    appendRawStream({ event: "request_error", source, sessionKey, provider: activeChatRuntime.provider, model: selectedChatModel, status: details.status, code: details.code, type: details.type, requestId: details.requestId, message: msg });
    console.error(`[LLM] Chat request failed provider=${activeChatRuntime.provider} model=${selectedChatModel} status=${details.status ?? "n/a"} code=${details.code ?? "n/a"} message=${msg}`);
    broadcastAssistantStreamDelta(
      assistantStreamId,
      `Model request failed${details.status ? ` (${details.status})` : ""}${details.code ? ` [${details.code}]` : ""}: ${msg}`,
      source,
      undefined,
      conversationId,
      userContextId,
    );
    runSummary.error = msg;
    runSummary.toolCalls = Array.from(new Set(observedToolCalls.filter(Boolean)));
    runSummary.memoryRecallUsed = usedMemoryRecall;
    runSummary.webSearchPreloadUsed = usedWebSearchPreload;
    runSummary.linkUnderstandingUsed = usedLinkUnderstanding;
    runSummary.promptHash = preparedPromptHash;
  } finally {
    broadcastThinkingStatus("", userContextId);
    runSummary.latencyMs = Date.now() - startedAt;
    broadcastAssistantStreamDone(assistantStreamId, source, undefined, conversationId, userContextId);
    broadcastState("idle", userContextId);
  }

  return runSummary;
}

// ===== Main dispatcher =====
export async function handleInput(text, opts = {}) {
  const sessionContext = sessionRuntime.resolveSessionContext(opts);
  const sessionKey = sessionContext.sessionKey;
  const userContextId = sessionRuntime.resolveUserContextId(opts);
  const useVoice = opts.voice !== false;
  const ttsVoice = opts.ttsVoice || "default";
  const source = opts.source || "hud";
  const conversationId = resolveConversationId(opts, sessionKey, source);
  if (source === "hud" && !userContextId) throw new Error("Missing user context id for HUD request.");

  const sender = String(opts.sender || "").trim();
  const runtimeTone = normalizeRuntimeTone(opts.tone);
  const runtimeCommunicationStyle = String(opts.communicationStyle || "").trim();
  const runtimeAssistantName = String(opts.assistantName || "").trim();
  const runtimeCustomInstructions = String(opts.customInstructions || "").trim();
  const inboundMessageId = String(opts.inboundMessageId || "").trim();
  const n = text.toLowerCase().trim();

  if (shouldSkipDuplicateInbound({
    text,
    source,
    sender,
    userContextId,
    sessionKey,
    inboundMessageId,
  })) {
    appendRawStream({
      event: "request_duplicate_skipped",
      source,
      sessionKey,
      userContextId: userContextId || undefined,
      chars: String(text || "").length,
    });
    return;
  }

  appendRawStream({ event: "request_start", source, sessionKey, userContextId: userContextId || undefined, chars: String(text || "").length });

  // ── NLP preprocessing ────────────────────────────────────────────────────
  // raw_text is used for UI display and transcript persistence.
  // clean_text is used for routing, tool selection, memory recall, and LLM.
  const raw_text = text;
  let clean_text = text;
  let nlpCorrections = [];
  let nlpConfidence = 1.0;
  const nlpBypass = opts?.nlpBypass === true;
  if (!nlpBypass) {
    try {
      const preprocessFn = getPreprocess();
      if (preprocessFn) {
        // preprocess() is async (spell checker loads on first call)
        const nlpResult = await preprocessFn(text);
        clean_text = nlpResult.clean_text || text;
        nlpCorrections = nlpResult.corrections || [];
        nlpConfidence = Number.isFinite(Number(nlpResult.confidence)) ? Number(nlpResult.confidence) : 1.0;
        if (nlpCorrections.length > 0) {
          const summary = nlpCorrections.map((c) => `${c.reason}(${c.confidence.toFixed(2)})`).join(", ");
          console.log(`[NLP] ${nlpCorrections.length} correction(s) session=${sessionKey}: ${summary}`);
        }
      }
    } catch {
      // Preprocessing failure is non-fatal; continue with original text
      clean_text = text;
      nlpConfidence = 1.0;
    }
  }
  // Use clean_text for all downstream routing and LLM calls.
  // raw_text is preserved for UI messages and transcript writes.
  text = clean_text;
  // ─────────────────────────────────────────────────────────────────────────

  if (runtimeAssistantName && typeof wakeWordRuntime?.setAssistantName === "function") {
    wakeWordRuntime.setAssistantName(runtimeAssistantName);
  }

  const ctx = {
    source, sender, sessionContext, sessionKey, userContextId,
    useVoice, ttsVoice, runtimeTone, runtimeCommunicationStyle,
    runtimeAssistantName, runtimeCustomInstructions,
    conversationId,
    supabaseAccessToken: String(opts.supabaseAccessToken || "").trim(),
    sessionId: sessionContext.sessionEntry?.sessionId,
    // NLP: raw_text for display/persistence; clean_text already in `text`
    raw_text,
    nlpCorrections,
    nlpConfidence,
    nlpBypass,
  };

  // Memory update — short-circuit before any LLM call
  if (isMemoryUpdateRequest(text)) {
    await handleMemoryUpdate(text, ctx);
    return;
  }

  const pendingWeather = getPendingWeatherConfirm(sessionKey);
  if (pendingWeather) {
    if (isWeatherConfirmNo(text)) {
      clearPendingWeatherConfirm(sessionKey);
      await sendDirectAssistantReply(
        text,
        "Okay. I will not run that location. Share the correct city and I will fetch weather immediately.",
        ctx,
        "Waiting for location",
      );
      return;
    }

    if (isWeatherConfirmYes(text)) {
      const runtimeTools = await toolRuntime.initToolRuntimeIfNeeded({ userContextId });
      const availableTools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
      const canRunToolLoop = TOOL_LOOP_ENABLED
        && availableTools.length > 0
        && typeof runtimeTools?.executeToolUse === "function";
      const canRunWebSearch = canRunToolLoop && availableTools.some((t) => String(t?.name || "") === "web_search");
      clearPendingWeatherConfirm(sessionKey);
      const confirmedWeatherResult = await tryWeatherFastPathReply({
        text: pendingWeather.prompt,
        runtimeTools,
        availableTools,
        canRunWebSearch,
        forcedLocation: pendingWeather.suggestedLocation,
        bypassConfirmation: true,
      });
      const confirmedReply = String(confirmedWeatherResult?.reply || "").trim()
        || `I could not fetch weather for ${pendingWeather.suggestedLocation} yet. Please retry.`;
      await sendDirectAssistantReply(text, confirmedReply, ctx, "Fetching weather");
      return;
    }

    await sendDirectAssistantReply(
      text,
      `Please reply "yes" or "no" to confirm weather for ${pendingWeather.suggestedLocation}.`,
      ctx,
      "Confirming location",
    );
    return;
  }

  // Mission confirmation/build routing before LLM/provider selection.
  const pendingMission = getPendingMissionConfirm(sessionKey);
  if (pendingMission) {
    if (isMissionConfirmNo(text)) {
      clearPendingMissionConfirm(sessionKey);
      await sendDirectAssistantReply(
        text,
        "No problem. I will not create a mission. If you want one later, say: create a mission for ...",
        ctx,
      );
      return;
    }

    if (isMissionConfirmYes(text)) {
      const details = stripMissionConfirmPrefix(text);
      const mergedPrompt = details ? `${pendingMission.prompt}. ${details}` : pendingMission.prompt;
      clearPendingMissionConfirm(sessionKey);
      await handleWorkflowBuild(mergedPrompt, ctx, { engine: "src" });
      return;
    }

    const detailLikeFollowUp = /\b(at|am|pm|est|et|pst|pt|cst|ct|telegram|discord|novachat|daily|every|morning|night|tomorrow)\b/i.test(text);
    if (detailLikeFollowUp) {
      const mergedPrompt = `${pendingMission.prompt}. ${stripAssistantInvocation(text)}`.replace(/\s+/g, " ").trim();
      setPendingMissionConfirm(sessionKey, mergedPrompt);
      await sendDirectAssistantReply(text, buildMissionConfirmReply(mergedPrompt), ctx);
      return;
    }
  }

  if (shouldBuildWorkflowFromPrompt(text)) {
    clearPendingMissionConfirm(sessionKey);
    await handleWorkflowBuild(text, ctx, { engine: "src" });
    return;
  }

  if (shouldConfirmWorkflowFromPrompt(text)) {
    const candidatePrompt = stripAssistantInvocation(text) || text;
    setPendingMissionConfirm(sessionKey, candidatePrompt);
    await sendDirectAssistantReply(text, buildMissionConfirmReply(candidatePrompt), ctx);
    return;
  }

  const requestHints = {
    fastLaneSimpleChat: isSimpleFastLaneTurn(text),
  };

  const likelyNeedsToolRuntime =
    isWeatherRequestText(text) ||
    isCryptoRequestText(text) ||
    shouldUseToolLoopForTurn(text, {
      fastLaneSimpleChat: requestHints.fastLaneSimpleChat,
      canRunWebSearch: true,
      canRunWebFetch: true,
    });

  let runtimeTools = null;
  let availableTools = [];
  if (likelyNeedsToolRuntime) {
    runtimeTools = await toolRuntime.initToolRuntimeIfNeeded({ userContextId });
    availableTools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
  }

  const canExecuteTools = TOOL_LOOP_ENABLED && availableTools.length > 0 && typeof runtimeTools?.executeToolUse === "function";
  const canRunWebSearch = canExecuteTools && availableTools.some((t) => String(t?.name || "") === "web_search");
  const canRunWebFetch = canExecuteTools && availableTools.some((t) => String(t?.name || "") === "web_fetch");
  const canRunToolLoop = canExecuteTools && shouldUseToolLoopForTurn(text, {
    fastLaneSimpleChat: requestHints.fastLaneSimpleChat,
    canRunWebSearch,
    canRunWebFetch,
  });

  // Resolve provider (Bug Fix 4: uses cached loader) + routing arbitration
  const integrationsRuntime = cachedLoadIntegrationsRuntime({ userContextId });
  const activeChatRuntime = resolveConfiguredChatRuntime(integrationsRuntime, {
    strictActiveProvider: !ENABLE_PROVIDER_FALLBACK,
    preference: ROUTING_PREFERENCE,
    requiresToolCalling: canRunToolLoop,
    allowActiveProviderOverride: ENABLE_PROVIDER_FALLBACK && ROUTING_ALLOW_ACTIVE_OVERRIDE,
    preferredProviders: ROUTING_PREFERRED_PROVIDERS,
  });

  if (!activeChatRuntime.apiKey) {
    const providerName = activeChatRuntime.provider === "claude" ? "Claude" : activeChatRuntime.provider === "grok" ? "Grok" : activeChatRuntime.provider === "gemini" ? "Gemini" : "OpenAI";
    throw new Error(`Missing ${providerName} API key for active provider "${activeChatRuntime.provider}". Configure Integrations first.`);
  }
  if (!activeChatRuntime.connected) {
    throw new Error(`Active provider "${activeChatRuntime.provider}" is not enabled. Enable it or switch activeLlmProvider.`);
  }

  const activeOpenAiCompatibleClient = activeChatRuntime.provider === "claude"
    ? null
    : getOpenAIClient({ apiKey: activeChatRuntime.apiKey, baseURL: activeChatRuntime.baseURL });
  const selectedChatModel = activeChatRuntime.model
    || (activeChatRuntime.provider === "claude" ? DEFAULT_CLAUDE_MODEL
      : activeChatRuntime.provider === "grok" ? DEFAULT_GROK_MODEL
      : activeChatRuntime.provider === "gemini" ? DEFAULT_GEMINI_MODEL
      : DEFAULT_CHAT_MODEL);

  console.log(
    `[RuntimeSelection] session=${sessionKey} provider=${activeChatRuntime.provider}` +
    ` model=${selectedChatModel} source=${source}` +
    ` route=${String(activeChatRuntime.routeReason || "n/a")}` +
    ` candidates=${Array.isArray(activeChatRuntime.rankedCandidates) ? activeChatRuntime.rankedCandidates.join(">") : activeChatRuntime.provider}`,
  );

  const llmCtx = { activeChatRuntime, activeOpenAiCompatibleClient, selectedChatModel, runtimeTools, availableTools, canRunToolLoop, canRunWebSearch, canRunWebFetch };

  // Route to sub-handler
  if (n === "nova shutdown" || n === "nova shut down" || n === "shutdown nova") {
    await handleShutdown(ctx);
    return;
  }

  if (n.includes("spotify") || n.includes("play music") || n.includes("play some") || n.includes("put on ")) {
    await handleSpotify(text, ctx, llmCtx);
    return;
  }

  await executeChatRequest(text, ctx, llmCtx, requestHints);
}
