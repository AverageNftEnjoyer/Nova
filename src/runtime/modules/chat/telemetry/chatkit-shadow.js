import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_INTENTS = new Set(["chat", "weather", "crypto", "mission", "memory", "other"]);
const DEFAULT_SAMPLE_PERCENT = 0;
const DEFAULT_MAX_INFLIGHT = 2;
let inflightCount = 0;

function toBool(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function toInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function parseIntentSet(raw) {
  const normalized = String(raw || "").trim();
  if (!normalized) return new Set(DEFAULT_INTENTS);
  const out = new Set(
    normalized
      .split(",")
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean),
  );
  return out.size > 0 ? out : new Set(DEFAULT_INTENTS);
}

function stableHash32(input) {
  const text = String(input || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveIntentClass(routeRaw) {
  const route = String(routeRaw || "").trim().toLowerCase();
  if (!route) return "other";
  if (route.includes("weather")) return "weather";
  if (route.includes("crypto") || route.includes("coinbase")) return "crypto";
  if (route.includes("mission") || route.includes("workflow")) return "mission";
  if (route.includes("memory")) return "memory";
  if (
    route.includes("chat") ||
    route.includes("tool_loop") ||
    route.includes("llm") ||
    route.includes("web")
  ) return "chat";
  return "other";
}

export function resolveChatKitShadowPolicy() {
  return {
    enabled: toBool(process.env.NOVA_CHATKIT_SHADOW_MODE, false),
    samplePercent: toInt(process.env.NOVA_CHATKIT_SHADOW_SAMPLE_PERCENT, DEFAULT_SAMPLE_PERCENT, 0, 100),
    intents: parseIntentSet(process.env.NOVA_CHATKIT_SHADOW_INTENTS),
    maxInflight: toInt(process.env.NOVA_CHATKIT_SHADOW_MAX_INFLIGHT, DEFAULT_MAX_INFLIGHT, 1, 32),
  };
}

export function shouldRunChatKitShadow(params = {}) {
  const policy = resolveChatKitShadowPolicy();
  if (!policy.enabled) return { run: false, reason: "shadow_disabled", policy };
  if (policy.samplePercent <= 0) return { run: false, reason: "sample_percent_zero", policy };
  if (inflightCount >= policy.maxInflight) return { run: false, reason: "inflight_limited", policy };
  const userContextId = String(params.userContextId || "").trim();
  if (!userContextId) return { run: false, reason: "missing_user_context", policy };
  const intentClass = resolveIntentClass(params.route);
  if (!policy.intents.has(intentClass)) return { run: false, reason: "intent_filtered", policy, intentClass };
  const bucketSeed = `${userContextId}|${String(params.conversationId || "").trim()}|${String(params.turnId || "").trim()}`;
  const bucket = stableHash32(bucketSeed) % 100;
  if (bucket >= policy.samplePercent) return { run: false, reason: "sample_miss", policy, intentClass, bucket };
  return { run: true, reason: "scheduled", policy, intentClass, bucket };
}

function moduleExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

async function loadChatKitIntegrationModule() {
  const builtPath = path.join(process.cwd(), "dist", "integrations", "chatkit", "index.js");
  if (!moduleExists(builtPath)) return null;
  return await import(pathToFileURL(builtPath).href);
}

export async function runChatKitShadowEvaluation(params = {}) {
  const decision = shouldRunChatKitShadow(params);
  if (!decision.run) return { ok: false, skipped: true, reason: decision.reason };
  inflightCount += 1;
  const startedAt = Date.now();
  try {
    const module = await loadChatKitIntegrationModule();
    if (!module || typeof module.runChatKitWorkflow !== "function") {
      return { ok: false, skipped: true, reason: "chatkit_module_unavailable" };
    }
    const runResult = await module.runChatKitWorkflow({
      prompt: String(params.prompt || ""),
      context: {
        userContextId: String(params.userContextId || ""),
        conversationId: String(params.conversationId || ""),
        missionRunId: String(params.missionRunId || ""),
      },
    });
    if (typeof module.appendChatKitEvent === "function") {
      module.appendChatKitEvent({
        status: runResult.ok ? "ok" : "error",
        event: "chatkit.shadow.compare",
        userContextId: String(params.userContextId || ""),
        conversationId: String(params.conversationId || ""),
        missionRunId: String(params.missionRunId || ""),
        model: String(runResult.model || ""),
        latencyMs: Number(runResult.latencyMs || Date.now() - startedAt),
        errorCode: runResult.errorCode || "",
        errorMessage: runResult.errorMessage || "",
        promptChars: String(params.prompt || "").length,
        outputChars: String(runResult.outputText || "").length,
        details: {
          mode: "shadow",
          intentClass: decision.intentClass || "other",
          sampleBucket: Number.isFinite(Number(decision.bucket)) ? Number(decision.bucket) : null,
          samplePercent: decision.policy.samplePercent,
          baselineRoute: String(params.route || ""),
          baselineProvider: String(params.baselineProvider || ""),
          baselineModel: String(params.baselineModel || ""),
          baselineLatencyMs: Number.isFinite(Number(params.baselineLatencyMs)) ? Number(params.baselineLatencyMs) : 0,
          baselineOk: params.baselineOk !== false,
          shadowOk: runResult.ok === true,
          shadowErrorCode: String(runResult.errorCode || ""),
          latencyDeltaMs:
            Number.isFinite(Number(runResult.latencyMs)) && Number.isFinite(Number(params.baselineLatencyMs))
              ? Number(runResult.latencyMs) - Number(params.baselineLatencyMs)
              : null,
        },
      });
    }
    return { ok: runResult.ok === true, skipped: false, result: runResult };
  } catch (err) {
    return { ok: false, skipped: false, reason: String(err?.message || err || "shadow_run_failed") };
  } finally {
    inflightCount = Math.max(0, inflightCount - 1);
  }
}

