import { randomUUID } from "node:crypto";

import {
  clearReminderFollowUpState,
  readReminderFollowUpState,
  upsertReminderFollowUpState,
} from "./follow-up-state/index.js";
import { runDelegatedDomainService } from "../shared/delegated-domain-service/index.js";

const REMINDERS_TIMEOUT_MS = Math.max(
  3_000,
  Number.parseInt(process.env.NOVA_REMINDERS_WORKER_TIMEOUT_MS || "30000", 10) || 30_000,
);
const REMINDERS_RETRY_COUNT = Math.max(
  0,
  Number.parseInt(process.env.NOVA_REMINDERS_WORKER_RETRY_COUNT || "1", 10) || 1,
);
const REMINDER_FOLLOW_UP_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.NOVA_REMINDERS_FOLLOW_UP_TTL_MS || "180000", 10) || 180_000,
);

function normalizeText(value = "") {
  return String(value || "").trim();
}

function buildTelemetry({
  provider = "runtime-reminders-service",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  latencyMs = 0,
  attemptCount = 0,
}) {
  return {
    domain: "reminders",
    provider,
    adapterId: provider,
    attemptCount: Number(attemptCount || 0),
    latencyMs: Number(latencyMs || 0),
    userContextId: normalizeText(userContextId),
    conversationId: normalizeText(conversationId),
    sessionKey: normalizeText(sessionKey),
  };
}

function buildResponse({
  ok = true,
  reply = "",
  code = "",
  message = "",
  requestHints = {},
  retries = [],
  toolCalls = [],
  toolExecutions = [],
  provider = "runtime-reminders-service",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  startedAt = Date.now(),
}) {
  const latencyMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  return {
    ok,
    route: "reminder",
    responseRoute: "reminder",
    reply: normalizeText(reply),
    code: normalizeText(code),
    message: normalizeText(message),
    error: ok ? "" : normalizeText(code || "reminders.execution_failed"),
    toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
    toolExecutions: Array.isArray(toolExecutions) ? toolExecutions : [],
    retries: Array.isArray(retries) ? retries : [],
    requestHints: requestHints && typeof requestHints === "object" ? requestHints : {},
    provider: normalizeText(provider),
    model: "",
    latencyMs,
    telemetry: buildTelemetry({
      provider,
      userContextId,
      conversationId,
      sessionKey,
      latencyMs,
    }),
    followUpState: {
      persistent: true,
      scope: "user-context-conversation",
      store: "reminders-follow-up-state",
    },
  };
}

function resolveReminderAction(text = "", requestHints = {}) {
  const normalized = normalizeText(text).toLowerCase();
  const affinity = normalizeText(requestHints?.remindersTopicAffinityId || requestHints?.topicAffinityId).toLowerCase();
  if (/^reminder_(create|update|remove|general)$/.test(affinity)) {
    if (affinity === "reminder_create") return "create";
    if (affinity === "reminder_update") return "update";
    if (affinity === "reminder_remove") return "remove";
  }
  if (/\b(remove|delete|cancel)\b/.test(normalized) && /\b(remind|reminder)\b/.test(normalized)) return "remove";
  if (/\b(update|change|edit|reschedule|move)\b/.test(normalized) && /\b(remind|reminder)\b/.test(normalized)) return "update";
  if (/\b(list|show|what|status|current|active)\b/.test(normalized) && /\b(remind|reminder)\b/.test(normalized)) return "status";
  if (/\b(remind me|set (a )?reminder|create (a )?reminder|add (a )?reminder)\b/.test(normalized)) return "create";
  return "unknown";
}

function extractReminderText(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  const patterns = [
    /\bremind me to\s+(.+)$/i,
    /\bset\s+(?:a\s+)?reminder(?:\s+to)?\s+(.+)$/i,
    /\bcreate\s+(?:a\s+)?reminder(?:\s+to)?\s+(.+)$/i,
    /\badd\s+(?:a\s+)?reminder(?:\s+to)?\s+(.+)$/i,
    /\breminder\s+to\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      return normalizeText(match[1]).replace(/[.?!]+$/, "").trim();
    }
  }
  return "";
}

function resolveContext(input = {}) {
  const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
  return {
    userContextId: normalizeText(input.userContextId || ctx.userContextId),
    conversationId: normalizeText(input.conversationId || ctx.conversationId),
    sessionKey: normalizeText(input.sessionKey || ctx.sessionKey),
    text: normalizeText(input.text),
    requestHints: input.requestHints && typeof input.requestHints === "object" ? input.requestHints : {},
  };
}

function withDelegatedFallback(input = {}, startedAt = Date.now()) {
  return runDelegatedDomainService(
    {
      ...input,
      domainId: "reminders",
      route: "reminder",
      responseRoute: "reminder",
      timeoutMs: REMINDERS_TIMEOUT_MS,
      retryCount: REMINDERS_RETRY_COUNT,
      degradedReply: "I couldn't complete that reminder request right now. Please retry in a moment.",
    },
    {},
  ).then((result) => ({
    ...result,
    followUpState: {
      persistent: true,
      scope: "user-context-conversation",
      store: "reminders-follow-up-state",
    },
    latencyMs: Number(result?.latencyMs || Math.max(0, Date.now() - startedAt)),
    telemetry: {
      ...(result?.telemetry && typeof result.telemetry === "object" ? result.telemetry : {}),
      domain: "reminders",
    },
  }));
}

export async function runRemindersDomainService(input = {}) {
  const startedAt = Date.now();
  const {
    userContextId,
    conversationId,
    sessionKey,
    text,
    requestHints,
  } = resolveContext(input);

  if (!userContextId || !conversationId || !sessionKey) {
    return buildResponse({
      ok: false,
      code: "reminders.context_missing",
      message: "Reminders worker requires userContextId, conversationId, and sessionKey.",
      reply: "I need a scoped conversation context before I can manage reminders.",
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
    });
  }

  const action = resolveReminderAction(text, requestHints);
  if (action === "unknown") {
    return await withDelegatedFallback({
      ...input,
      userContextId,
      conversationId,
      sessionKey,
      requestHints,
    }, startedAt);
  }

  const existing = readReminderFollowUpState({
    userContextId,
    conversationId,
    domainId: "reminders",
  });

  if (action === "status") {
    if (!existing) {
      return buildResponse({
        ok: true,
        code: "reminders.status_empty",
        message: "No active reminder context found.",
        reply: "I don't see an active reminder in this thread yet. Say \"set a reminder to ...\" to create one.",
        requestHints,
        userContextId,
        conversationId,
        sessionKey,
        startedAt,
      });
    }
    const reminderText = normalizeText(existing?.slots?.reminderText || "");
    const reminderId = normalizeText(existing?.slots?.reminderId || "");
    return buildResponse({
      ok: true,
      code: "reminders.status_ok",
      message: "Reminder context loaded.",
      reply: reminderText
        ? `Active reminder${reminderId ? ` (${reminderId})` : ""}: ${reminderText}`
        : "I found reminder context for this thread, but it does not include reminder text.",
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
    });
  }

  if (action === "create") {
    const reminderText = extractReminderText(text);
    if (!reminderText) {
      return buildResponse({
        ok: false,
        code: "reminders.text_missing",
        message: "Reminder text is required.",
        reply: "Tell me what to remind you about, for example: \"set a reminder to review the report at 5pm.\"",
        requestHints,
        userContextId,
        conversationId,
        sessionKey,
        startedAt,
      });
    }
    const reminderId = `rem-${randomUUID().slice(0, 8)}`;
    upsertReminderFollowUpState({
      userContextId,
      conversationId,
      domainId: "reminders",
      topicAffinityId: "reminder_create",
      slots: {
        reminderId,
        reminderText,
        lastAction: "create",
      },
      ttlMs: REMINDER_FOLLOW_UP_TTL_MS,
    });
    return buildResponse({
      ok: true,
      code: "reminders.create_ok",
      message: "Reminder context created.",
      reply: `Reminder saved${reminderId ? ` (${reminderId})` : ""}: ${reminderText}`,
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
    });
  }

  if (action === "update") {
    if (!existing) {
      return buildResponse({
        ok: false,
        code: "reminders.follow_up_missing",
        message: "No reminder context found to update.",
        reply: "I can't update a reminder yet because this thread has no active reminder context. Create one first.",
        requestHints,
        userContextId,
        conversationId,
        sessionKey,
        startedAt,
      });
    }
    const updateText = extractReminderText(text) || normalizeText(existing?.slots?.reminderText || "");
    upsertReminderFollowUpState({
      userContextId,
      conversationId,
      domainId: "reminders",
      topicAffinityId: "reminder_update",
      slots: {
        ...(existing?.slots || {}),
        reminderText: updateText,
        lastAction: "update",
      },
      ttlMs: REMINDER_FOLLOW_UP_TTL_MS,
    });
    return buildResponse({
      ok: true,
      code: "reminders.update_ok",
      message: "Reminder context updated.",
      reply: updateText
        ? `Reminder updated: ${updateText}`
        : "Reminder context updated.",
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
    });
  }

  if (action === "remove") {
    if (!existing) {
      return buildResponse({
        ok: true,
        code: "reminders.remove_noop",
        message: "No reminder context existed to remove.",
        reply: "There was no active reminder in this thread to remove.",
        requestHints,
        userContextId,
        conversationId,
        sessionKey,
        startedAt,
      });
    }
    clearReminderFollowUpState({
      userContextId,
      conversationId,
      domainId: "reminders",
    });
    return buildResponse({
      ok: true,
      code: "reminders.remove_ok",
      message: "Reminder context removed.",
      reply: "Done. I removed the active reminder context for this thread.",
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
    });
  }

  return await withDelegatedFallback({
    ...input,
    userContextId,
    conversationId,
    sessionKey,
    requestHints,
  }, startedAt);
}