import { sessionRuntime } from "../../../../infrastructure/config/index.js";
import { describeUnknownError } from "../../../../llm/providers/index.js";

function readIntEnv(name, fallback, minValue, maxValue) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

const HUD_API_BASE_URL = String(process.env.NOVA_HUD_API_BASE_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
const INTEGRATIONS_SNAPSHOT_ENSURE_TTL_MS = Math.max(
  5_000,
  readIntEnv("NOVA_INTEGRATIONS_SNAPSHOT_ENSURE_TTL_MS", 20_000, 1_000, 300_000),
);
const integrationsSnapshotEnsuredAtByUser = new Map();

export async function ensureRuntimeIntegrationsSnapshot(input = {}, deps = {}) {
  const {
    userContextId = "",
    supabaseAccessToken = "",
  } = input;
  const {
    sessionRuntimeRef = sessionRuntime,
    fetchRef = fetch,
    describeUnknownErrorRef = describeUnknownError,
  } = deps;

  const userId = sessionRuntimeRef.normalizeUserContextId(String(userContextId || ""));
  const token = String(supabaseAccessToken || "").trim();
  if (!userId || !token) return;

  const now = Date.now();
  const last = Number(integrationsSnapshotEnsuredAtByUser.get(userId) || 0);
  if (now - last < INTEGRATIONS_SNAPSHOT_ENSURE_TTL_MS) return;

  try {
    const res = await fetchRef(`${HUD_API_BASE_URL}/api/integrations/config/runtime-snapshot`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.ok) {
      integrationsSnapshotEnsuredAtByUser.set(userId, now);
      return;
    }
    console.warn(`[IntegrationsSnapshot] ensure failed status=${res.status} user=${userId}`);
  } catch (err) {
    console.warn(`[IntegrationsSnapshot] ensure failed user=${userId} error=${describeUnknownErrorRef(err)}`);
  }
}

