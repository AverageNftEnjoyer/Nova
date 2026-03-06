import { createHash } from "node:crypto";
import { normalizeMissionBuildInput } from "../build-service/index.js";

const DEFAULT_BRIDGE_TIMEOUT_MS = 7_500;
const DEFAULT_BRIDGE_RETRY_COUNT = 1;
const TRANSIENT_RETRY_DELAY_MS = 180;

function toBoundedInt(value, fallback, minValue, maxValue) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function resolveHudApiBaseUrl(input) {
  return String(input || process.env.NOVA_HUD_API_BASE_URL || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
}

function resolveRuntimeSharedToken() {
  const explicit = String(process.env.NOVA_RUNTIME_SHARED_TOKEN || "").trim();
  if (explicit) return explicit;
  const encryptionKey = String(process.env.NOVA_ENCRYPTION_KEY || "").trim();
  if (!encryptionKey) return "";
  return createHash("sha256")
    .update(`nova-runtime-shared-token:${encryptionKey}`)
    .digest("hex");
}

function resolveRuntimeSharedTokenHeader() {
  return (
    String(process.env.NOVA_RUNTIME_SHARED_TOKEN_HEADER || "x-nova-runtime-token")
      .trim()
      .toLowerCase()
    || "x-nova-runtime-token"
  );
}

function buildMissionHeaders(token, idempotencyKey) {
  const headers = {
    "Content-Type": "application/json",
  };
  const sharedToken = resolveRuntimeSharedToken();
  const sharedHeader = resolveRuntimeSharedTokenHeader();
  if (sharedToken) headers[sharedHeader] = sharedToken;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  return headers;
}

function isTransientStatus(status) {
  return Number(status) === 429 || Number(status) >= 500;
}

function isAbortError(error) {
  return String(error?.name || "").trim().toLowerCase() === "aborterror";
}

function describeUnknownError(error) {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown error");
}

function getBridgeTimeoutMs() {
  return toBoundedInt(
    process.env.NOVA_INTEGRATION_BRIDGE_TIMEOUT_MS,
    DEFAULT_BRIDGE_TIMEOUT_MS,
    1000,
    30_000,
  );
}

function getBridgeRetryCount() {
  return toBoundedInt(
    process.env.NOVA_INTEGRATION_BRIDGE_RETRY_COUNT,
    DEFAULT_BRIDGE_RETRY_COUNT,
    0,
    2,
  );
}

async function fetchWithTimeoutAndRetry(url, init) {
  const timeoutMs = getBridgeTimeoutMs();
  const retryCount = getBridgeRetryCount();
  let attempt = 0;
  let lastError = null;

  while (attempt <= retryCount) {
    attempt += 1;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (attempt <= retryCount && isTransientStatus(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS * attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt > retryCount) throw error;
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS * attempt));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error("Mission build request failed.");
}

export async function runMissionBuildViaProviderAdapter(input = {}) {
  const normalizedInput = normalizeMissionBuildInput(input);
  const token = String(input?.supabaseAccessToken || "").trim();
  const idempotencyKey = String(input?.idempotencyKey || "").trim();
  const headers = buildMissionHeaders(token, idempotencyKey);

  try {
    const response = await fetchWithTimeoutAndRetry(
      `${resolveHudApiBaseUrl()}/api/missions/build`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: normalizedInput.prompt,
          deploy: normalizedInput.deploy,
          engine: normalizedInput.engine,
          ...(normalizedInput.timezone ? { timezone: normalizedInput.timezone } : {}),
          enabled: normalizedInput.enabled,
        }),
      },
    );
    const data = await response.json().catch(() => ({}));
    return {
      attempted: true,
      ok: response.ok && data?.ok === true,
      status: Number(response.status || 0),
      data,
      error: "",
      code: "",
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      status: 0,
      data: null,
      error: describeUnknownError(error),
      code: isAbortError(error) ? "missions.timeout" : "missions.network",
    };
  }
}
