import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { ensureMemoryTemplate, upsertMemoryFactInMarkdown } from "../../context/memory.js";

const MISSION_CONFIRM_TTL_MS = Number.parseInt(process.env.NOVA_MISSION_CONFIRM_TTL_MS || "600000", 10);
const missionConfirmBySession = new Map();

export function applyMemoryFactsToWorkspace(personaWorkspaceDir, facts) {
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

export function hashShadowPayload(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

export function summarizeToolResultPreview(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= 360) return text;
  return `${text.slice(0, 360)}...`;
}

function cleanupMissionConfirmStore() {
  const now = Date.now();
  for (const [key, value] of missionConfirmBySession.entries()) {
    if (!value || now - Number(value.ts || 0) > MISSION_CONFIRM_TTL_MS) {
      missionConfirmBySession.delete(key);
    }
  }
}

export function getPendingMissionConfirm(sessionKey) {
  const key = String(sessionKey || "").trim();
  if (!key) return null;
  cleanupMissionConfirmStore();
  const value = missionConfirmBySession.get(key);
  if (!value || !String(value.prompt || "").trim()) return null;
  return value;
}

export function setPendingMissionConfirm(sessionKey, prompt) {
  const key = String(sessionKey || "").trim();
  const normalizedPrompt = String(prompt || "").trim();
  if (!key || !normalizedPrompt) return;
  missionConfirmBySession.set(key, { prompt: normalizedPrompt, ts: Date.now() });
}

export function clearPendingMissionConfirm(sessionKey) {
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

export function resolveConversationId(opts, sessionKey, source) {
  const explicit = String(opts?.conversationId || opts?.threadId || "").trim();
  if (explicit) return explicit;
  if (String(source || "").trim().toLowerCase() !== "hud") return "";
  return parseConversationIdFromSessionKey(sessionKey);
}

export function stripAssistantInvocation(text) {
  return String(text || "")
    .replace(/^\s*(hey|hi|yo)\s+nova[\s,:-]*/i, "")
    .replace(/^\s*nova[\s,:-]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
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

export function buildMissionConfirmReply(text) {
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

export function isMissionConfirmYes(text) {
  const n = String(text || "").trim().toLowerCase();
  if (!n) return false;
  if (/^(no|nah|nope|cancel|stop|nevermind|never mind)\b/.test(n)) return false;
  return /^(yes|yeah|yep|sure|ok|okay|do it|go ahead|create it|create mission|please do|affirmative)\b/.test(n);
}

export function isMissionConfirmNo(text) {
  const n = String(text || "").trim().toLowerCase();
  return /^(no|nah|nope|cancel|stop|nevermind|never mind)\b/.test(n);
}

export function stripMissionConfirmPrefix(text) {
  return String(text || "")
    .replace(/^\s*(yes|yeah|yep|sure|ok|okay|do it|go ahead|create it|create mission|please do|affirmative)[\s,:-]*/i, "")
    .trim();
}
