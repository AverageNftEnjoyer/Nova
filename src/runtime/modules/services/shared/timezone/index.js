const UTC_TIMEZONE = "UTC";

function normalizeTimezoneCandidate(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidTimezone(value) {
  const candidate = normalizeTimezoneCandidate(value);
  if (!candidate) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getRuntimeTimezone() {
  const envTimezone = normalizeTimezoneCandidate(process.env.NOVA_DEFAULT_TIMEZONE);
  if (isValidTimezone(envTimezone)) return envTimezone;

  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimezone(detected)) return detected;
  } catch {
  }

  return UTC_TIMEZONE;
}

export function resolveTimezone(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeTimezoneCandidate(candidate);
    if (isValidTimezone(normalized)) return normalized;
  }
  return getRuntimeTimezone();
}
