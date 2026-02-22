import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SAMPLE_PERCENT = 0;
const DEFAULT_MAX_INFLIGHT = 2;
const DEFAULT_ALLOWED_INTENTS = new Set(["chat"]);
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
  if (!normalized) return new Set(DEFAULT_ALLOWED_INTENTS);
  const out = new Set(
    normalized
      .split(",")
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean),
  );
  return out.size > 0 ? out : new Set(DEFAULT_ALLOWED_INTENTS);
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

export function resolveChatKitServePolicy() {
  return {
    enabled: toBool(process.env.NOVA_CHATKIT_SERVE_MODE, false),
    samplePercent: toInt(process.env.NOVA_CHATKIT_SERVE_SAMPLE_PERCENT, DEFAULT_SAMPLE_PERCENT, 0, 100),
    allowedIntents: parseIntentSet(process.env.NOVA_CHATKIT_SERVE_INTENTS),
    maxInflight: toInt(process.env.NOVA_CHATKIT_SERVE_MAX_INFLIGHT, DEFAULT_MAX_INFLIGHT, 1, 32),
  };
}

export function shouldServeChatKit(params = {}) {
  const policy = resolveChatKitServePolicy();
  if (!policy.enabled) return { serve: false, reason: "serve_disabled", policy };
  if (policy.samplePercent <= 0) return { serve: false, reason: "sample_percent_zero", policy };
  if (inflightCount >= policy.maxInflight) return { serve: false, reason: "inflight_limited", policy };
  const userContextId = String(params.userContextId || "").trim();
  if (!userContextId) return { serve: false, reason: "missing_user_context", policy };
  const intentClass = String(params.intentClass || "").trim().toLowerCase();
  if (!intentClass || !policy.allowedIntents.has(intentClass)) {
    return { serve: false, reason: "intent_filtered", policy, intentClass };
  }
  const bucketSeed = `${userContextId}|${String(params.conversationId || "").trim()}|${String(params.turnId || "").trim()}`;
  const bucket = stableHash32(bucketSeed) % 100;
  if (bucket >= policy.samplePercent) return { serve: false, reason: "sample_miss", policy, intentClass, bucket };
  return { serve: true, reason: "scheduled", policy, intentClass, bucket };
}

export async function runChatKitServeAttempt(params = {}) {
  const decision = shouldServeChatKit(params);
  if (!decision.serve) return { used: false, reason: decision.reason };
  inflightCount += 1;
  try {
    const module = await loadChatKitIntegrationModule();
    if (!module || typeof module.runChatKitWorkflow !== "function") {
      return { used: false, reason: "chatkit_module_unavailable" };
    }
    const prompt = String(params.prompt || "");
    const userContextId = String(params.userContextId || "");
    const conversationId = String(params.conversationId || "");
    const missionRunId = String(params.missionRunId || "");
    const result = await module.runChatKitWorkflow({
      prompt,
      context: { userContextId, conversationId, missionRunId },
    });
    if (result.ok !== true || !String(result.outputText || "").trim()) {
      if (typeof module.appendChatKitEvent === "function") {
        module.appendChatKitEvent({
          status: "error",
          event: "chatkit.serve.fallback",
          userContextId,
          conversationId,
          missionRunId,
          model: String(result.model || ""),
          latencyMs: Number(result.latencyMs || 0),
          errorCode: String(result.errorCode || "SERVE_EMPTY_OR_ERROR"),
          errorMessage: String(result.errorMessage || ""),
          promptChars: prompt.length,
          outputChars: String(result.outputText || "").length,
          details: {
            reason: "serve_not_usable",
            intentClass: decision.intentClass || "",
            sampleBucket: Number.isFinite(Number(decision.bucket)) ? Number(decision.bucket) : null,
            samplePercent: decision.policy.samplePercent,
          },
        });
      }
      return { used: false, reason: "serve_not_usable", result };
    }
    if (typeof module.appendChatKitEvent === "function") {
      module.appendChatKitEvent({
        status: "ok",
        event: "chatkit.serve.success",
        userContextId,
        conversationId,
        missionRunId,
        model: String(result.model || ""),
        latencyMs: Number(result.latencyMs || 0),
        promptChars: prompt.length,
        outputChars: String(result.outputText || "").length,
        details: {
          intentClass: decision.intentClass || "",
          sampleBucket: Number.isFinite(Number(decision.bucket)) ? Number(decision.bucket) : null,
          samplePercent: decision.policy.samplePercent,
        },
      });
    }
    return {
      used: true,
      reply: String(result.outputText || "").trim(),
      model: String(result.model || ""),
      provider: "openai-chatkit",
      latencyMs: Number(result.latencyMs || 0),
      usage: result.usage && typeof result.usage === "object" ? result.usage : null,
    };
  } catch (err) {
    return { used: false, reason: String(err?.message || err || "serve_failed") };
  } finally {
    inflightCount = Math.max(0, inflightCount - 1);
  }
}

