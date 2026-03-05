function normalizeScheduleTime(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(String(value || "").trim());
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function normalizePromptTextForExtraction(prompt) {
  return String(prompt || "")
    .replace(/\bhey\s+nova\b/gi, " ")
    .replace(/\bnova\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTimeFromPrompt(prompt) {
  const text = normalizePromptTextForExtraction(prompt);
  const ampm = text.match(/\b([01]?\d)(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (ampm) {
    const rawHour = Number.parseInt(ampm[1], 10);
    const minute = Number.parseInt(ampm[2] || "0", 10);
    const suffix = String(ampm[3] || "").toLowerCase();
    if (Number.isFinite(rawHour) && rawHour >= 1 && rawHour <= 12 && Number.isFinite(minute)) {
      let hour = rawHour % 12;
      if (suffix.startsWith("p")) hour += 12;
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const hhmm = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (hhmm) {
    const normalized = normalizeScheduleTime(`${hhmm[1]}:${hhmm[2]}`);
    if (normalized) return normalized;
  }

  return "";
}

function extractTimezoneFromPrompt(prompt) {
  const text = normalizePromptTextForExtraction(prompt);
  const tz = text.match(/\b(EST|EDT|ET|CST|CDT|CT|MST|MDT|MT|PST|PDT|PT|UTC|GMT)\b/i);
  const token = String(tz?.[1] || "").toUpperCase();
  if (!token) return "";
  const map = {
    EST: "America/New_York",
    EDT: "America/New_York",
    ET: "America/New_York",
    CST: "America/Chicago",
    CDT: "America/Chicago",
    CT: "America/Chicago",
    MST: "America/Denver",
    MDT: "America/Denver",
    MT: "America/Denver",
    PST: "America/Los_Angeles",
    PDT: "America/Los_Angeles",
    PT: "America/Los_Angeles",
    UTC: "UTC",
    GMT: "Etc/UTC",
  };
  return map[token] || "";
}

export function deriveScheduleFromPrompt(prompt) {
  return {
    time: extractTimeFromPrompt(prompt),
    timezone: extractTimezoneFromPrompt(prompt),
  };
}

export function inferRequestedOutputChannel(prompt, outputSet, fallback) {
  const text = normalizePromptTextForExtraction(prompt).toLowerCase();
  if (/\b(email|e-mail|gmail|inbox)\b/.test(text) && outputSet.has("email")) return "email";
  if (/\btelegram\b/.test(text) && outputSet.has("telegram")) return "telegram";
  if (/\bdiscord\b/.test(text) && outputSet.has("discord")) return "discord";
  if (/\b(webhook|http)\b/.test(text) && outputSet.has("webhook")) return "webhook";
  if (/\b(chat|nova ?chat|hud)\b/.test(text) && outputSet.has("telegram")) return "telegram";
  return fallback;
}

export function normalizeOutputChannelId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "gmail") return "email";
  return normalized;
}
