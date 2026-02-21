import crypto from "node:crypto";
import type { SessionConfig } from "../config/types.js";
import {
  buildSessionKey,
  fallbackUserContextIdFromSessionKey,
  normalizeUserContextId,
  parseSessionKeyUserContext,
  resolveUserContextId,
} from "./key.js";
import { SessionStore } from "./store.js";
import type { InboundMessage, ResolveSessionResult, SessionEntry } from "./types.js";

function shouldResetByIdle(now: number, updatedAt: number, idleMinutes: number): boolean {
  const idleMs = Math.max(1, idleMinutes) * 60 * 1000;
  return now - updatedAt > idleMs;
}

function createSessionEntry(params: {
  sessionKey: string;
  model: string;
  now: number;
  userContextId?: string;
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
    ...(params.userContextId ? { userContextId: params.userContextId } : {}),
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
  params.store.pruneOldTranscriptsIfNeeded();
  params.store.migrateLegacySessionStoreIfNeeded();

  const sessionKey = buildSessionKey(params.config, params.agentName, params.inboundMessage);
  const resolvedUserContextId =
    resolveUserContextId(params.inboundMessage) ||
    parseSessionKeyUserContext(sessionKey) ||
    fallbackUserContextIdFromSessionKey(
      sessionKey,
      String(params.inboundMessage.source || params.inboundMessage.channel || ""),
    );

  const existing = params.store.getEntry(sessionKey, resolvedUserContextId);
  const origin = {
    label: params.inboundMessage.source || params.inboundMessage.channel,
    provider: params.inboundMessage.source || params.inboundMessage.channel,
    from: params.inboundMessage.sender || params.inboundMessage.senderId,
    to:
      params.inboundMessage.chatId ??
      params.inboundMessage.sender ??
      params.inboundMessage.senderId,
  };

  let isNewSession = false;
  let entry: SessionEntry;
  const effectiveUserContextId =
    normalizeUserContextId(resolvedUserContextId) ||
    normalizeUserContextId(existing?.userContextId || "");

  if (!existing) {
    entry = createSessionEntry({
      sessionKey,
      model: params.model,
      now,
      userContextId: effectiveUserContextId || undefined,
      origin,
    });
    isNewSession = true;
  } else {
    const shouldReset = shouldResetByIdle(now, existing.updatedAt, params.config.idleMinutes);

    if (shouldReset) {
      entry = createSessionEntry({
        sessionKey,
        model: params.model,
        now,
        userContextId: effectiveUserContextId || undefined,
        origin,
      });
      isNewSession = true;
    } else {
      entry = {
        ...existing,
        updatedAt: now,
        model: params.model,
        ...(effectiveUserContextId ? { userContextId: effectiveUserContextId } : {}),
      };
    }
  }

  params.store.setEntry(sessionKey, entry, effectiveUserContextId);
  return { sessionEntry: entry, isNewSession, sessionKey };
}
