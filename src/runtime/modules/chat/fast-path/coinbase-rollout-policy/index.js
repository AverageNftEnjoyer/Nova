function toInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function toBool(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  return fallback;
}

function parseUserSet(raw) {
  return new Set(
    String(raw || "")
      .split(",")
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizeUserContextId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 96);
}

function normalizeStage(raw) {
  const stage = String(raw || "full").trim().toLowerCase();
  if (stage === "off" || stage === "alpha" || stage === "beta" || stage === "ramp" || stage === "full") return stage;
  return "full";
}

function fnv1a32(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function percentBucket(userContextId, salt) {
  return fnv1a32(`${salt}:${userContextId}`) % 100;
}

export function resolveCoinbaseRolloutAccessForFastPath(userContextIdRaw) {
  const userContextId = normalizeUserContextId(userContextIdRaw);
  const stage = normalizeStage(process.env.NOVA_COINBASE_ROLLOUT_STAGE);
  const supportChannel = String(process.env.NOVA_COINBASE_SUPPORT_CHANNEL || "#nova-coinbase-support").trim() || "#nova-coinbase-support";
  const percent = toInt(process.env.NOVA_COINBASE_ROLLOUT_PERCENT, 0, 0, 100);
  const killSwitch = toBool(process.env.NOVA_COINBASE_ROLLOUT_KILL_SWITCH, false);
  const alphaUsers = parseUserSet(process.env.NOVA_COINBASE_ALPHA_USERS);
  const betaUsers = parseUserSet(process.env.NOVA_COINBASE_BETA_USERS);
  const salt = String(process.env.NOVA_COINBASE_ROLLOUT_SALT || "nova-coinbase-rollout").trim() || "nova-coinbase-rollout";

  if (!userContextId) return { enabled: false, stage, reason: "missing_user_context", supportChannel, percent };
  if (killSwitch) return { enabled: false, stage: "off", reason: "kill_switch", supportChannel, percent };
  if (stage === "off") return { enabled: false, stage, reason: "disabled", supportChannel, percent };
  if (stage === "full") return { enabled: true, stage, reason: "full", supportChannel, percent: 100 };
  if (alphaUsers.has(userContextId)) return { enabled: true, stage, reason: "alpha_allowlist", supportChannel, percent };
  if (stage === "alpha") return { enabled: false, stage, reason: "alpha_only", supportChannel, percent };
  if (betaUsers.has(userContextId)) return { enabled: true, stage, reason: "beta_allowlist", supportChannel, percent };
  if (stage === "beta") return { enabled: false, stage, reason: "beta_only", supportChannel, percent };
  if (percentBucket(userContextId, salt) < percent) return { enabled: true, stage, reason: "ramp_percentage", supportChannel, percent };
  return { enabled: false, stage, reason: "ramp_percentage_blocked", supportChannel, percent };
}
