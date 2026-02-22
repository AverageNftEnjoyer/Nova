import type { ChatKitReasoningEffort, ChatKitRuntimeConfig, ChatKitValidationResult } from "./types.js";

const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_REASONING: ChatKitReasoningEffort = "low";
const DEFAULT_TIMEOUT_MS = 20_000;

function toBool(value: unknown, fallback: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function parseReasoningEffort(raw: unknown): ChatKitReasoningEffort {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (normalized === "minimal" || normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return DEFAULT_REASONING;
}

export function resolveChatKitRuntimeConfig(): ChatKitRuntimeConfig {
  const enabled = toBool(process.env.NOVA_CHATKIT_ENABLED, false);
  return {
    enabled,
    apiKey: String(process.env.OPENAI_API_KEY || "").trim(),
    model: String(process.env.NOVA_CHATKIT_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    reasoningEffort: parseReasoningEffort(process.env.NOVA_CHATKIT_REASONING_EFFORT),
    store: toBool(process.env.NOVA_CHATKIT_STORE, true),
    timeoutMs: toInt(process.env.NOVA_CHATKIT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 3_000, 120_000),
  };
}

export function validateChatKitRuntimeConfig(config: ChatKitRuntimeConfig): ChatKitValidationResult {
  const issues: Array<{ field: string; message: string }> = [];
  if (config.enabled && !config.apiKey) {
    issues.push({
      field: "OPENAI_API_KEY",
      message: "Missing OPENAI_API_KEY while NOVA_CHATKIT_ENABLED=1.",
    });
  }
  if (config.enabled && !config.model) {
    issues.push({
      field: "NOVA_CHATKIT_MODEL",
      message: "Missing model for ChatKit runtime.",
    });
  }
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 3_000) {
    issues.push({
      field: "NOVA_CHATKIT_TIMEOUT_MS",
      message: "Timeout must be >= 3000ms.",
    });
  }
  return { ok: issues.length === 0, issues };
}

