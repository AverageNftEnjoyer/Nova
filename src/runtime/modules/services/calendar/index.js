import {
  broadcastCalendarConflict,
  broadcastCalendarEventUpdated,
  broadcastCalendarRescheduled,
} from "../../../infrastructure/hud-gateway/index.js";
import { createCalendarProviderAdapter } from "./provider-adapter/index.js";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function buildTelemetry({
  provider = "runtime_calendar",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  latencyMs = 0,
  action = "",
  itemCount = 0,
  conflict = false,
}) {
  return {
    domain: "calendar",
    provider,
    adapterId: provider,
    latencyMs: Number(latencyMs || 0),
    action: normalizeText(action),
    itemCount: Number(itemCount || 0),
    conflict: conflict === true,
    userContextId: normalizeText(userContextId),
    conversationId: normalizeText(conversationId),
    sessionKey: normalizeText(sessionKey),
  };
}

function buildResponse({
  ok = true,
  code = "",
  message = "",
  reply = "",
  startedAt = Date.now(),
  requestHints = {},
  action = "",
  provider = "runtime_calendar",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  itemCount = 0,
  conflict = false,
  data = {},
}) {
  const latencyMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  return {
    ok,
    route: "calendar",
    responseRoute: "calendar",
    code: normalizeText(code),
    message: normalizeText(message),
    reply: normalizeText(reply),
    error: ok ? "" : normalizeText(code || "calendar.execution_failed"),
    provider: normalizeText(provider),
    model: "",
    requestHints: requestHints && typeof requestHints === "object" ? requestHints : {},
    latencyMs,
    telemetry: buildTelemetry({
      provider,
      userContextId,
      conversationId,
      sessionKey,
      latencyMs,
      action,
      itemCount,
      conflict,
    }),
    ...data,
  };
}

function resolveContext(input = {}) {
  const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
  return {
    text: normalizeText(input.text),
    requestHints: input.requestHints && typeof input.requestHints === "object" ? input.requestHints : {},
    userContextId: normalizeText(input.userContextId || ctx.userContextId),
    conversationId: normalizeText(input.conversationId || ctx.conversationId),
    sessionKey: normalizeText(input.sessionKey || ctx.sessionKey),
  };
}

function resolveCalendarAction(text = "", requestHints = {}) {
  const normalized = normalizeText(text).toLowerCase();
  const affinity = normalizeText(requestHints?.calendarTopicAffinityId || requestHints?.topicAffinityId).toLowerCase();
  if (affinity === "calendar_reschedule") return "reschedule";
  if (affinity === "calendar_agenda") return "agenda";
  if (/\b(sync|scheduler|queue cap|queue caps|fairness)\b/.test(normalized)) return "sync";
  if (/\b(remove|delete|clear|restore)\b/.test(normalized) && /\b(reschedule|override|calendar)\b/.test(normalized)) return "clear";
  if (/\b(reschedule|move|change|shift)\b/.test(normalized)) return "reschedule";
  if (/\b(what'?s on|what is on|availability|agenda|today|tomorrow|this week|next week)\b/.test(normalized)) return "agenda";
  if (/\b(calendar)\s+(refresh|check|status)\b/.test(normalized) || /\bcalendar\b/.test(normalized)) return "status";
  return "status";
}

function resolveAgendaWindow(text = "", requestHints = {}) {
  const explicit = normalizeText(requestHints?.calendarWindow || "");
  if (explicit) return explicit;
  const normalized = normalizeText(text).toLowerCase();
  if (/\bnext week\b/.test(normalized)) return "next_week";
  if (/\btomorrow\b/.test(normalized)) return "tomorrow";
  if (/\btoday\b/.test(normalized)) return "today";
  return "week";
}

function extractMissionQuery(text = "", action = "") {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  if (action === "reschedule") {
    const match = normalized.match(/\b(?:reschedule|move|change|shift)\s+(.+?)\s+\bto\b/i);
    if (match?.[1]) return normalizeText(match[1]);
  }
  if (action === "clear") {
    const match = normalized.match(/\b(?:clear|remove|delete|restore)\s+(?:the\s+)?(?:calendar\s+)?(?:override\s+|reschedule\s+)?(?:for\s+)?(.+)$/i);
    if (match?.[1]) return normalizeText(match[1]);
  }
  return "";
}

function extractNewStartAt(text = "", requestHints = {}) {
  const explicit = normalizeText(requestHints?.calendarNewStartAt || requestHints?.newStartAt || "");
  if (explicit) return explicit;
  const match = normalizeText(text).match(/\b(20\d{2}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?z)\b/i);
  return normalizeText(match?.[1] || "");
}

function formatAgendaReply(adapter, agenda = {}, windowKey = "week") {
  const events = Array.isArray(agenda?.events) ? agenda.events : [];
  if (events.length === 0) {
    return `I don't see any scheduled mission events ${adapter.describeWindow(windowKey)}.`;
  }
  const lines = [`Calendar ${adapter.describeWindow(windowKey)}:`];
  for (const event of events.slice(0, 5)) {
    const when = adapter.formatWhen(event.startAt, event.timezone || "UTC");
    const conflictLabel = event.conflict ? " [conflict]" : "";
    lines.push(`- ${event.title} at ${when}${conflictLabel}`);
  }
  return lines.join("\n");
}

export async function runCalendarDomainService(input = {}, deps = {}) {
  const startedAt = Date.now();
  const {
    text,
    requestHints,
    userContextId,
    conversationId,
    sessionKey,
  } = resolveContext(input);

  if (!userContextId || !conversationId || !sessionKey) {
    return buildResponse({
      ok: false,
      code: "calendar.context_missing",
      message: "Calendar worker requires userContextId, conversationId, and sessionKey.",
      reply: "I need a scoped conversation context before I can manage calendar state.",
      requestHints,
      startedAt,
      userContextId,
      conversationId,
      sessionKey,
    });
  }

  const adapter = deps.providerAdapter && typeof deps.providerAdapter === "object"
    ? deps.providerAdapter
    : createCalendarProviderAdapter({
      broadcastCalendarEventUpdated,
      broadcastCalendarRescheduled,
      broadcastCalendarConflict,
    });
  const action = resolveCalendarAction(text, requestHints);

  if (action === "agenda" || action === "status") {
    const windowKey = action === "agenda" ? resolveAgendaWindow(text, requestHints) : "week";
    const agenda = await adapter.listAgenda({ userContextId, window: windowKey });
    const itemCount = Array.isArray(agenda?.events) ? agenda.events.length : 0;
    return buildResponse({
      ok: agenda?.ok === true,
      code: agenda?.ok === true ? "calendar.agenda_ok" : "calendar.agenda_failed",
      message: agenda?.ok === true ? "Calendar agenda loaded." : "Calendar agenda lookup failed.",
      reply: formatAgendaReply(adapter, agenda, windowKey),
      requestHints,
      action: action === "agenda" ? "agenda" : "status",
      startedAt,
      provider: String(adapter.providerId || adapter.id || "runtime_calendar"),
      userContextId,
      conversationId,
      sessionKey,
      itemCount,
      data: {
        agenda: Array.isArray(agenda?.events) ? agenda.events : [],
      },
    });
  }

  if (action === "sync") {
    const sync = await adapter.getSyncStatus({ userContextId });
    return buildResponse({
      ok: sync?.ok === true,
      code: sync?.ok === true ? "calendar.sync_ok" : "calendar.sync_failed",
      message: sync?.ok === true ? "Calendar scheduler status loaded." : "Calendar scheduler status failed.",
      reply: sync?.ok === true
        ? `Calendar scheduler is user-scoped with queue caps ${sync.scheduler.maxRunsPerUserPerTick}/${sync.scheduler.maxRunsPerTick} per user/global tick, with ${sync.activeMissionCount} active mission schedules.`
        : "I couldn't load calendar scheduler status right now.",
      requestHints,
      action: "sync",
      startedAt,
      provider: String(adapter.providerId || adapter.id || "runtime_calendar"),
      userContextId,
      conversationId,
      sessionKey,
      itemCount: Number(sync?.activeMissionCount || 0),
      data: {
        scheduler: sync?.scheduler || {},
        activeMissionCount: Number(sync?.activeMissionCount || 0),
      },
    });
  }

  if (action === "reschedule") {
    const missionQuery = extractMissionQuery(text, action);
    const newStartAt = extractNewStartAt(text, requestHints);
    const result = await adapter.rescheduleMission({ userContextId, missionQuery, newStartAt });
    return buildResponse({
      ok: result?.ok === true,
      code: String(result?.code || (result?.ok === true ? "calendar.reschedule_ok" : "calendar.reschedule_failed")),
      message: String(result?.message || (result?.ok === true ? "Calendar override saved." : "Calendar override failed.")),
      reply: result?.ok === true
        ? `Calendar updated for ${result.mission.label}: moved to ${newStartAt}${result.conflict ? " with a conflict flagged." : "."}`
        : String(result?.message || "I couldn't update that calendar schedule."),
      requestHints,
      action: "reschedule",
      startedAt,
      provider: String(adapter.providerId || adapter.id || "runtime_calendar"),
      userContextId,
      conversationId,
      sessionKey,
      itemCount: result?.mission ? 1 : 0,
      conflict: result?.conflict === true,
      data: {
        missionId: normalizeText(result?.mission?.id || ""),
        override: result?.override || null,
      },
    });
  }

  if (action === "clear") {
    const missionQuery = extractMissionQuery(text, action);
    const result = await adapter.clearReschedule({ userContextId, missionQuery });
    return buildResponse({
      ok: result?.ok === true,
      code: String(result?.code || (result?.ok === true ? "calendar.clear_ok" : "calendar.clear_failed")),
      message: String(result?.message || (result?.ok === true ? "Calendar override cleared." : "Calendar override clear failed.")),
      reply: result?.ok === true
        ? result.deleted
          ? `Cleared the calendar override for ${result.mission.label}.`
          : `There was no saved calendar override for ${result.mission.label}.`
        : String(result?.message || "I couldn't clear that calendar override."),
      requestHints,
      action: "clear",
      startedAt,
      provider: String(adapter.providerId || adapter.id || "runtime_calendar"),
      userContextId,
      conversationId,
      sessionKey,
      itemCount: result?.mission ? 1 : 0,
      data: {
        missionId: normalizeText(result?.mission?.id || ""),
      },
    });
  }

  return buildResponse({
    ok: false,
    code: "calendar.intent_unsupported",
    message: "Calendar request was not recognized.",
    reply: "Try a calendar agenda, reschedule, clear override, or scheduler status request.",
    requestHints,
    action: "unsupported",
    startedAt,
    userContextId,
    conversationId,
    sessionKey,
  });
}
