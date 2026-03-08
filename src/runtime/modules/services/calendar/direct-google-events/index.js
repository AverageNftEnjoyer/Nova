import { getRuntimeTimezone, resolveTimezone } from "../../shared/timezone/index.js";

const DEFAULT_DURATION_MINUTES = 60;
const ACTION_PREFIX_RE = /^(?:nova[,:]?\s+)?(?:please\s+)?/i;
const WEEKDAY_INDEX = Object.freeze({
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
});
const MONTH_INDEX = Object.freeze({
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
});
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/i,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i,
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?\b/i,
  /\b(?:today|tomorrow|tonight)\b/i,
  /\b(?:this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
];
const TIME_PATTERNS = [
  /\b(?:at\s+)?\d{1,2}:\d{2}\s*(?:am|pm)\b/i,
  /\b(?:at\s+)?\d{1,2}\s*(?:am|pm)\b/i,
  /\b(?:at\s+)?\d{1,2}:\d{2}\b/i,
  /\b(?:at\s+)?(?:noon|midnight)\b/i,
];
const DURATION_RE = /\bfor\s+(\d+)\s*(minutes?|mins?|min|hours?|hrs?|hr)\b/i;
const MISSION_TERMS_RE = /\b(mission|workflow|automation|pipeline|override|reschedule override)\b/i;
const CALENDAR_TARGET_RE = /\b(?:to|on|in|from)\s+(?:my\s+)?(?:(?:google|nova)\s+)?calendar\b/gi;

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getLocalParts(date = new Date(), timezone = "UTC") {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    return {
      weekday: String(parts.weekday || "").toLowerCase(),
      year: Number(parts.year || "0"),
      month: Number(parts.month || "0"),
      day: Number(parts.day || "0"),
      hour: Number(parts.hour || "0"),
      minute: Number(parts.minute || "0"),
      second: Number(parts.second || "0"),
      dayStamp: `${parts.year}-${parts.month}-${parts.day}`,
    };
  } catch {
    return {
      weekday: "",
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      dayStamp: date.toISOString().slice(0, 10),
    };
  }
}

function addDaysToDayStamp(dayStamp = "", days = 0) {
  const base = new Date(`${dayStamp}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return "";
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function toIsoInTimezone(dayStamp = "", hours = 9, minutes = 0, timezone = "UTC") {
  try {
    const safeHours = Math.max(0, Math.min(23, Number(hours || 0)));
    const safeMinutes = Math.max(0, Math.min(59, Number(minutes || 0)));
    const dt = new Date(`${dayStamp}T${String(safeHours).padStart(2, "0")}:${String(safeMinutes).padStart(2, "0")}:00`);
    const localFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(localFmt.formatToParts(dt).map((part) => [part.type, part.value]));
    const localStr = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
    const offset = dt.getTime() - new Date(localStr).getTime();
    return new Date(
      new Date(`${dayStamp}T${String(safeHours).padStart(2, "0")}:${String(safeMinutes).padStart(2, "0")}:00`).getTime() + offset,
    ).toISOString();
  } catch {
    return new Date(`${dayStamp}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`).toISOString();
  }
}

function stripActionPrefix(text = "", action = "") {
  const base = normalizeText(text).replace(ACTION_PREFIX_RE, "");
  if (action === "create") return base.replace(/^(?:add|create|schedule|book|put)\b\s*/i, "");
  if (action === "update") return base.replace(/^(?:move|reschedule|change|update|edit|shift)\b\s*/i, "");
  if (action === "delete") return base.replace(/^(?:delete|remove|cancel)\b\s*/i, "");
  return base;
}

function stripCalendarTargets(text = "") {
  return normalizeText(text.replace(CALENDAR_TARGET_RE, " "));
}

function isStandaloneCalendarCrudPrompt(text = "") {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized || MISSION_TERMS_RE.test(normalized)) return false;
  const hasCrudVerb = /\b(add|create|schedule|book|put|move|reschedule|change|update|edit|shift|delete|remove|cancel)\b/.test(normalized);
  const hasCalendarTarget = /\b(calendar|meeting|appointment|event)\b/.test(normalized);
  return hasCrudVerb && hasCalendarTarget;
}

function detectAction(text = "") {
  const normalized = normalizeText(text).toLowerCase();
  if (/\b(delete|remove|cancel)\b/.test(normalized)) return "delete";
  if (/\b(move|reschedule|change|update|edit|shift)\b/.test(normalized)) return "update";
  if (/\b(add|create|schedule|book|put)\b/.test(normalized)) return "create";
  return "";
}

function findFirstMatch(text = "", patterns = []) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[0]) {
      return {
        text: match[0],
        index: match.index,
        end: match.index + match[0].length,
      };
    }
  }
  return null;
}

function parseTimePhrase(phrase = "") {
  const normalized = normalizeText(phrase).toLowerCase().replace(/^at\s+/, "");
  if (!normalized) return null;
  if (normalized === "noon") return { hours: 12, minutes: 0 };
  if (normalized === "midnight") return { hours: 0, minutes: 0 };

  const meridiemMatch = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(normalized);
  if (meridiemMatch) {
    let hours = Number(meridiemMatch[1]);
    const minutes = Number(meridiemMatch[2] || "0");
    if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59) return null;
    if (meridiemMatch[3] === "pm" && hours < 12) hours += 12;
    if (meridiemMatch[3] === "am" && hours === 12) hours = 0;
    if (hours < 0 || hours > 23) return null;
    return { hours, minutes };
  }

  const twentyFourMatch = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (twentyFourMatch) {
    const hours = Number(twentyFourMatch[1]);
    const minutes = Number(twentyFourMatch[2]);
    if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }
    return { hours, minutes };
  }

  return null;
}

function resolveWeekdayDayStamp(weekday, now, timezone, mode = "") {
  const targetDow = WEEKDAY_INDEX[weekday];
  if (targetDow == null) return "";
  const localNow = getLocalParts(now, timezone);
  let dayStamp = localNow.dayStamp;
  for (let offset = 0; offset < 15; offset += 1) {
    const candidate = addDaysToDayStamp(localNow.dayStamp, offset);
    const probe = new Date(toIsoInTimezone(candidate, 12, 0, timezone));
    const weekdayParts = getLocalParts(probe, timezone);
    if (WEEKDAY_INDEX[weekdayParts.weekday] === targetDow) {
      dayStamp = candidate;
      if (mode === "next" && offset < 7) {
        return addDaysToDayStamp(candidate, 7);
      }
      return candidate;
    }
  }
  return dayStamp;
}

function parseDatePhrase(phrase = "", now = new Date(), timezone = "UTC") {
  const normalized = normalizeText(phrase).toLowerCase();
  if (!normalized) return null;
  const localNow = getLocalParts(now, timezone);

  if (normalized === "today") {
    return localNow.dayStamp;
  }
  if (normalized === "tomorrow" || normalized === "tonight") {
    return addDaysToDayStamp(localNow.dayStamp, 1);
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (isoMatch) {
    const date = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    return Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()) ? null : date;
  }

  const slashMatch = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(normalized);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    let year = Number(slashMatch[3] || localNow.year);
    if (year < 100) year += 2000;
    const dayStamp = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return Number.isNaN(new Date(`${dayStamp}T00:00:00Z`).getTime()) ? null : dayStamp;
  }

  const monthDayMatch = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?$/.exec(normalized);
  if (monthDayMatch) {
    const month = MONTH_INDEX[monthDayMatch[1]];
    const day = Number(monthDayMatch[2]);
    let year = Number(monthDayMatch[3] || localNow.year);
    let dayStamp = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (Number.isNaN(new Date(`${dayStamp}T00:00:00Z`).getTime())) return null;
    if (!monthDayMatch[3] && dayStamp < localNow.dayStamp) {
      year += 1;
      dayStamp = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return dayStamp;
  }

  const qualifiedWeekdayMatch = /^(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.exec(normalized);
  if (qualifiedWeekdayMatch) {
    return resolveWeekdayDayStamp(qualifiedWeekdayMatch[2], now, timezone, qualifiedWeekdayMatch[1]);
  }
  const weekdayMatch = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.exec(normalized);
  if (weekdayMatch) {
    return resolveWeekdayDayStamp(weekdayMatch[1], now, timezone, "");
  }

  return null;
}

function parseDurationMs(text = "") {
  const match = DURATION_RE.exec(text);
  if (!match?.[0]) return { durationMs: DEFAULT_DURATION_MINUTES * 60 * 1000, range: null };
  const count = Number(match[1]);
  const unit = String(match[2] || "").toLowerCase();
  if (!Number.isFinite(count) || count <= 0) {
    return { durationMs: DEFAULT_DURATION_MINUTES * 60 * 1000, range: null };
  }
  const multiplier = unit.startsWith("h") ? 60 * 60 * 1000 : 60 * 1000;
  return {
    durationMs: count * multiplier,
    range: { index: match.index, end: match.index + match[0].length },
  };
}

function removeRanges(text = "", ranges = []) {
  const ordered = [...ranges]
    .filter((range) => range && Number.isInteger(range.index) && Number.isInteger(range.end) && range.end > range.index)
    .sort((a, b) => b.index - a.index);
  let next = text;
  for (const range of ordered) {
    next = `${next.slice(0, range.index)} ${next.slice(range.end)}`;
  }
  return normalizeText(next);
}

function cleanupTitle(text = "") {
  return normalizeText(
    String(text || "")
      .replace(/^(?:an?\s+)?(?:google\s+calendar\s+)?(?:calendar\s+)?event\s+(?:called\s+)?/i, "")
      .replace(/^(?:an?\s+)?meeting\s+(?:called\s+)?/i, "")
      .replace(/^(?:an?\s+)?appointment\s+(?:called\s+)?/i, "")
      .replace(/^called\s+/i, "")
      .replace(/\b(?:for|on|at|to)\s*$/i, "")
      .replace(/^["']|["']$/g, ""),
  );
}

function buildDateTime(datePhrase, timePhrase, now = new Date(), timezone = "UTC") {
  const dayStamp = parseDatePhrase(datePhrase, now, timezone);
  if (!dayStamp) return null;
  const time = timePhrase ? parseTimePhrase(timePhrase) : null;
  const hours = time?.hours ?? (String(datePhrase).toLowerCase() === "tonight" ? 20 : 9);
  const minutes = time?.minutes ?? 0;
  const date = new Date(toIsoInTimezone(dayStamp, hours, minutes, timezone));
  if (
    date.getTime() < now.getTime() - 60 * 1000
    && /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(String(datePhrase))
    && !/\bthis\s+/i.test(String(datePhrase))
  ) {
    return new Date(toIsoInTimezone(addDaysToDayStamp(dayStamp, 7), hours, minutes, timezone));
  }
  return date;
}

function extractTemporalParts(text = "", now = new Date(), timezone = "UTC") {
  const dateMatch = findFirstMatch(text, DATE_PATTERNS);
  const timeMatch = findFirstMatch(text, TIME_PATTERNS);
  const { durationMs, range: durationRange } = parseDurationMs(text);
  const startAt = dateMatch ? buildDateTime(dateMatch.text, timeMatch?.text || "", now, timezone) : null;
  const endAt = startAt ? new Date(startAt.getTime() + durationMs) : null;
  const stripped = removeRanges(text, [
    dateMatch ? { index: dateMatch.index, end: dateMatch.end } : null,
    timeMatch ? { index: timeMatch.index, end: timeMatch.end } : null,
    durationRange,
  ]);
  return {
    titleCandidate: stripped,
    startAt,
    endAt,
    matchStartAt: startAt,
  };
}

function parseCreateIntent(text, now, timezone) {
  const actionBody = stripCalendarTargets(stripActionPrefix(text, "create"));
  const temporal = extractTemporalParts(actionBody, now, timezone);
  const title = cleanupTitle(temporal.titleCandidate);
  return {
    action: "create",
    title,
    startAt: temporal.startAt?.toISOString() || "",
    endAt: temporal.endAt?.toISOString() || "",
    timeZone: timezone,
    ok: Boolean(title && temporal.startAt && temporal.endAt),
    message: title && temporal.startAt
      ? ""
      : "Calendar event creation needs a title plus a date and time.",
  };
}

function parseUpdateIntent(text, now, timezone) {
  const actionBody = stripCalendarTargets(stripActionPrefix(text, "update"));
  const splitIndex = actionBody.toLowerCase().lastIndexOf(" to ");
  const titleSegment = splitIndex >= 0 ? actionBody.slice(0, splitIndex) : actionBody;
  const scheduleSegment = splitIndex >= 0 ? actionBody.slice(splitIndex + 4) : "";
  const targetTemporal = extractTemporalParts(titleSegment, now, timezone);
  const nextTemporal = extractTemporalParts(scheduleSegment, now, timezone);
  const title = cleanupTitle(targetTemporal.titleCandidate);
  return {
    action: "update",
    title,
    startAt: nextTemporal.startAt?.toISOString() || "",
    endAt: nextTemporal.endAt?.toISOString() || "",
    matchStartAt: targetTemporal.matchStartAt?.toISOString() || "",
    timeZone: timezone,
    ok: Boolean(title && nextTemporal.startAt && nextTemporal.endAt),
    message: title && nextTemporal.startAt
      ? ""
      : "Calendar event updates need an existing title plus the new date and time after \"to\".",
  };
}

function parseDeleteIntent(text, now, timezone) {
  const actionBody = stripCalendarTargets(stripActionPrefix(text, "delete"));
  const temporal = extractTemporalParts(actionBody, now, timezone);
  const title = cleanupTitle(temporal.titleCandidate);
  return {
    action: "delete",
    title,
    matchStartAt: temporal.matchStartAt?.toISOString() || "",
    timeZone: timezone,
    ok: Boolean(title),
    message: title ? "" : "Calendar event deletion needs an event title.",
  };
}

export function parseStandaloneCalendarEventCommand(text = "", options = {}) {
  if (!isStandaloneCalendarCrudPrompt(text)) return null;
  const now = options.now instanceof Date && !Number.isNaN(options.now.getTime()) ? options.now : new Date();
  const timezone = resolveTimezone(normalizeText(options.timezone), getRuntimeTimezone());
  const action = detectAction(text);
  if (action === "create") return parseCreateIntent(text, now, timezone);
  if (action === "update") return parseUpdateIntent(text, now, timezone);
  if (action === "delete") return parseDeleteIntent(text, now, timezone);
  return null;
}

export { isStandaloneCalendarCrudPrompt };
