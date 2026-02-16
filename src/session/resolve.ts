import crypto from "node:crypto";
import type { SessionConfig } from "../config/types.js";
import { buildSessionKey } from "./key.js";
import { SessionStore } from "./store.js";
import type { InboundMessage, ResolveSessionResult, SessionEntry } from "./types.js";

function shouldResetByDailyBoundary(now: number, updatedAt: number, resetAtHour: number): boolean {
  const hourOffsetMs = Math.max(0, Math.min(23, Math.trunc(resetAtHour))) * 60 * 60 * 1000;
  const nowBucket = new Date(now - hourOffsetMs).toISOString().slice(0, 10);
  const prevBucket = new Date(updatedAt - hourOffsetMs).toISOString().slice(0, 10);
  return nowBucket !== prevBucket;
}

function shouldResetByIdle(now: number, updatedAt: number, idleMinutes: number): boolean {
  const idleMs = Math.max(1, idleMinutes) * 60 * 1000;
  return now - updatedAt > idleMs;
}

function createSessionEntry(params: {
  sessionKey: string;
  model: string;
  now: number;
  origin?: SessionEntry["origin"];
}): SessionEntry {
  return {
    sessionId: crypto.randomUUID(),
    sessionKey: params.sessionKey,
    createdAt: params.now,
    updatedAt: params.now,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    contextTokens: 0,
    model: params.model,
    ...(params.origin ? { origin: params.origin } : {}),
  };
}

export function resolveSession(params: {
  config: SessionConfig;
  store: SessionStore;
  agentName: string;
  inboundMessage: InboundMessage;
  model: string;
  now?: number;
}): ResolveSessionResult {
  const now = params.now ?? Date.now();
  const sessionKey = buildSessionKey(params.config, params.agentName, params.inboundMessage);

  const existing = params.store.getEntry(sessionKey);
  const origin = {
    label: params.inboundMessage.channel,
    provider: params.inboundMessage.channel,
    from: params.inboundMessage.senderId,
    to: params.inboundMessage.chatId ?? params.inboundMessage.senderId,
  };

  let isNewSession = false;
  let entry: SessionEntry;

  if (!existing) {
    entry = createSessionEntry({
      sessionKey,
      model: params.model,
      now,
      origin,
    });
    isNewSession = true;
  } else {
    const resetMode = params.config.resetMode;
    const shouldReset =
      (resetMode === "daily" &&
        shouldResetByDailyBoundary(now, existing.updatedAt, params.config.resetAtHour)) ||
      (resetMode === "idle" && shouldResetByIdle(now, existing.updatedAt, params.config.idleMinutes));

    if (shouldReset) {
      entry = createSessionEntry({
        sessionKey,
        model: params.model,
        now,
        origin,
      });
      isNewSession = true;
    } else {
      entry = {
        ...existing,
        updatedAt: now,
        model: params.model,
      };
    }
  }

  params.store.setEntry(sessionKey, entry);
  return { sessionEntry: entry, isNewSession, sessionKey };
}