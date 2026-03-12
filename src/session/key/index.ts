import type { SessionConfig } from "../../config/types/index.js";
import type { InboundMessage } from "../types/index.js";

function normalizeToken(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "unknown";
  return trimmed.replace(/[^a-z0-9:_-]/g, "-");
}

export function normalizeUserContextId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

export function parseSessionKeyUserContext(sessionKey: string): string {
  const normalizedKey = sessionKey.trim().toLowerCase();
  if (!normalizedKey) return "";

  const hudMarker = ":hud:user:";
  const hudIndex = normalizedKey.indexOf(hudMarker);
  if (hudIndex >= 0) {
    const tail = normalizedKey.slice(hudIndex + hudMarker.length);
    const candidate = normalizeUserContextId(tail.split(":")[0] || "");
    if (candidate) return candidate;
  }

  const voiceMarker = ":voice:dm:";
  const voiceIndex = normalizedKey.indexOf(voiceMarker);
  if (voiceIndex >= 0) {
    const tail = normalizedKey.slice(voiceIndex + voiceMarker.length);
    const candidate = normalizeUserContextId(tail.split(":")[0] || "");
    if (candidate) return candidate;
  }

  const dmMarker = ":dm:";
  const dmIndex = normalizedKey.lastIndexOf(dmMarker);
  if (dmIndex >= 0) {
    const tail = normalizedKey.slice(dmIndex + dmMarker.length);
    const candidate = normalizeUserContextId(tail.split(":")[0] || "");
    if (candidate && candidate !== "anonymous" && candidate !== "unknown") return candidate;
  }

  return "";
}

export function resolveUserContextId(msg: InboundMessage): string {
  const explicit = normalizeUserContextId(String(msg.userContextId || ""));
  if (explicit) return explicit;

  const senderRaw = String(msg.sender || "").trim();
  const senderCompat = senderRaw || (!msg.source ? String(msg.senderId || "").trim() : "");
  if (senderRaw.startsWith("hud-user:")) {
    const fromSender = normalizeUserContextId(senderRaw.slice("hud-user:".length));
    if (fromSender) return fromSender;
  }

  const source = normalizeToken(String(msg.source || msg.channel || "hud"));
  if (source === "voice") {
    const voiceSender = normalizeUserContextId(senderCompat);
    if (voiceSender) return voiceSender;
    const hinted = parseSessionKeyUserContext(String(msg.sessionKeyHint || ""));
    if (hinted) return hinted;
    return "";
  }
  if (source !== "hud") {
    const senderFallback = normalizeUserContextId(senderCompat);
    if (senderFallback) return senderFallback;
    const hinted = parseSessionKeyUserContext(String(msg.sessionKeyHint || ""));
    if (hinted) return hinted;
    return "";
  }

  const senderFallback = normalizeUserContextId(senderCompat);
  if (senderFallback && senderFallback !== "hud-user") return senderFallback;
  return "";
}

export function buildSessionKey(config: SessionConfig, agentName: string, msg: InboundMessage): string {
  const explicit = String(msg.sessionKeyHint || "").trim();
  if (explicit) return normalizeToken(explicit);

  const base = `agent:${normalizeToken(agentName)}`;

  if (!msg.source && msg.chatType === "group") {
    const channel = normalizeToken(String(msg.channel || "unknown"));
    const chatId = normalizeToken(String(msg.chatId || "unknown"));
    const threadSuffix = msg.threadId ? `:thread:${normalizeToken(String(msg.threadId || ""))}` : "";
    return `${base}:${channel}:group:${chatId}${threadSuffix}`;
  }

  const source = normalizeToken(String(msg.source || msg.channel || "hud"));
  const senderRaw = msg.source ? String(msg.sender || "") : String(msg.sender || msg.senderId || "");
  const sender = normalizeToken(senderRaw);

  if (source === "hud") {
    const hudUserContextId = resolveUserContextId(msg);
    if (!hudUserContextId) throw new Error("HUD session key requires userContextId.");
    return `${base}:hud:user:${hudUserContextId}:${normalizeToken(config.mainKey || "main")}`;
  }
  if (source === "voice") {
    const voiceUserContextId = resolveUserContextId(msg);
    const dmContext = voiceUserContextId || sender;
    if (!dmContext) throw new Error("Voice session key requires userContextId or sender.");
    return `${base}:voice:dm:${normalizeToken(dmContext)}`;
  }

  if (!sender) throw new Error(`Session key requires sender for source "${source}".`);
  return `${base}:${source}:dm:${sender}`;
}
