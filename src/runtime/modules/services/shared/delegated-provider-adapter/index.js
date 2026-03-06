import { describeUnknownError } from "../../../llm/providers/index.js";

function toInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyAdapterError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const name = String(error?.name || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  if (code === "aborted" || name === "aborterror") return "timeout";
  if (code.includes("timeout") || message.includes("timed out")) return "timeout";
  if (code.includes("rate") || message.includes("rate limit")) return "rate_limited";
  if (message.includes("network") || message.includes("fetch")) return "network_error";
  return "execution_failed";
}

async function runWithTimeout(run, timeoutMs) {
  let timerId = null;
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise((_, reject) => {
        timerId = setTimeout(() => {
          const timeoutError = new Error("delegated provider adapter timed out");
          timeoutError.code = "aborted";
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timerId) clearTimeout(timerId);
  }
}

export function createDelegatedProviderAdapter(input = {}) {
  const timeoutMs = toInt(input.timeoutMs, 25_000, 1_000, 120_000);
  const retryCount = toInt(input.retryCount, 1, 0, 2);
  const retryBackoffMs = toInt(input.retryBackoffMs, 150, 25, 2_000);

  return Object.freeze({
    id: "chat-runtime-delegated-adapter",
    timeoutMs,
    retryCount,
    retryBackoffMs,
    async execute(input = {}) {
      const execute = typeof input.executeChatRequest === "function" ? input.executeChatRequest : null;
      if (!execute) {
        return {
          ok: false,
          code: "delegated.adapter_missing_execute",
          message: "Delegated provider adapter requires executeChatRequest.",
          attemptCount: 0,
          timeoutMs,
        };
      }

      const text = String(input.text || "");
      const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
      const llmCtx = input.llmCtx && typeof input.llmCtx === "object" ? input.llmCtx : {};
      const requestHints = input.requestHints && typeof input.requestHints === "object"
        ? input.requestHints
        : {};

      let attempt = 0;
      while (attempt <= retryCount) {
        attempt += 1;
        try {
          const summary = await runWithTimeout(
            () => execute(text, ctx, llmCtx, requestHints),
            timeoutMs,
          );
          return {
            ok: true,
            summary: summary && typeof summary === "object" ? summary : { reply: String(summary || "") },
            attemptCount: attempt,
            timeoutMs,
          };
        } catch (error) {
          const errorClass = classifyAdapterError(error);
          if (attempt <= retryCount && (errorClass === "timeout" || errorClass === "rate_limited" || errorClass === "network_error")) {
            await sleep(retryBackoffMs * attempt);
            continue;
          }
          return {
            ok: false,
            code: `delegated.${errorClass}`,
            message: describeUnknownError(error),
            attemptCount: attempt,
            timeoutMs,
          };
        }
      }

      return {
        ok: false,
        code: "delegated.execution_failed",
        message: "Delegated provider adapter failed after retries.",
        attemptCount: retryCount + 1,
        timeoutMs,
      };
    },
  });
}
