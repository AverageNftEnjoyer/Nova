import { describeUnknownError } from "../../llm/providers/index.js";
import { createTelegramProviderRegistry } from "./provider-adapter/index.js";
import { createTelegramIntegrationStateAdapter } from "./integration-state/index.js";
import { redactTelegramSecrets } from "./redaction.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_BASE_MS = 150;

function toStringList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const normalized = String(entry || "").trim();
    if (!normalized) continue;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(normalized);
  }
  return out;
}

function clampInt(value, fallback, minValue, maxValue) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function normalizeTelegramAction(text = "", requestHints = {}) {
  const command = requestHints?.telegramCommand && typeof requestHints.telegramCommand === "object"
    ? requestHints.telegramCommand
    : requestHints?.telegram && typeof requestHints.telegram === "object"
      ? requestHints.telegram
      : {};

  const commandAction = String(command.action || "").trim().toLowerCase();
  if (commandAction === "status" || commandAction === "send") {
    return commandAction;
  }
  const normalizedText = String(text || "").trim().toLowerCase();
  if (/\b(status|connected|connection|health|verify)\b/.test(normalizedText)) return "status";
  return "send";
}

function normalizeSendMessage(text = "", requestHints = {}) {
  const command = requestHints?.telegramCommand && typeof requestHints.telegramCommand === "object"
    ? requestHints.telegramCommand
    : requestHints?.telegram && typeof requestHints.telegram === "object"
      ? requestHints.telegram
      : {};
  const explicitMessage = String(command.message || "").trim();
  if (explicitMessage) return explicitMessage.slice(0, 3500);

  const rawText = String(text || "").trim();
  const afterVerb = rawText.match(/\b(?:send|post|deliver)\b(?:.*?\btelegram\b)?\s*[:\-]?\s*(.+)$/i);
  if (afterVerb && String(afterVerb[1] || "").trim()) {
    return String(afterVerb[1] || "").trim().slice(0, 3500);
  }

  const quotedMessage = rawText.match(/["']([^"']{1,3500})["']/);
  if (quotedMessage && String(quotedMessage[1] || "").trim()) {
    return String(quotedMessage[1] || "").trim();
  }

  return "";
}

function normalizeParseMode(requestHints = {}) {
  const command = requestHints?.telegramCommand && typeof requestHints.telegramCommand === "object"
    ? requestHints.telegramCommand
    : requestHints?.telegram && typeof requestHints.telegram === "object"
      ? requestHints.telegram
      : {};
  const parseMode = String(command.parseMode || "").trim();
  if (parseMode === "Markdown" || parseMode === "MarkdownV2" || parseMode === "HTML") return parseMode;
  return "";
}

function normalizeExecutionPolicy(requestHints = {}) {
  const policy = requestHints?.telegramPolicy && typeof requestHints.telegramPolicy === "object"
    ? requestHints.telegramPolicy
    : {};
  return {
    timeoutMs: clampInt(policy.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 30_000),
    retryCount: clampInt(policy.retryCount, DEFAULT_RETRY_COUNT, 0, 3),
    retryBaseMs: clampInt(policy.retryBaseMs, DEFAULT_RETRY_BASE_MS, 25, 1500),
  };
}

function normalizeTelegramRuntime(runtimeState = {}, requestHints = {}) {
  const hintCommand = requestHints?.telegramCommand && typeof requestHints.telegramCommand === "object"
    ? requestHints.telegramCommand
    : requestHints?.telegram && typeof requestHints.telegram === "object"
      ? requestHints.telegram
      : {};
  const hintProvider = String(hintCommand.providerId || "").trim();
  const hintApiBaseUrl = String(hintCommand.apiBaseUrl || "").trim().replace(/\/+$/, "");
  const hintChatIds = toStringList(hintCommand.chatIds);

  return {
    connected: runtimeState.connected === true,
    providerId: hintProvider || String(runtimeState.providerId || "").trim(),
    apiBaseUrl: hintApiBaseUrl || String(runtimeState.apiBaseUrl || "").trim().replace(/\/+$/, ""),
    botToken: String(runtimeState.botToken || "").trim(),
    chatIds: hintChatIds.length > 0 ? hintChatIds : toStringList(runtimeState.chatIds),
    sourcePath: String(runtimeState.sourcePath || "").trim(),
  };
}

function createFailureResult(input = {}) {
  return {
    ok: false,
    route: "telegram",
    responseRoute: "telegram",
    action: String(input.action || "send"),
    code: String(input.code || "telegram.execution_failed"),
    message: redactTelegramSecrets(String(input.message || "Telegram execution failed.")),
    reply: redactTelegramSecrets(String(input.reply || input.message || "Telegram execution failed.")),
    context: {
      userContextId: String(input.userContextId || ""),
      conversationId: String(input.conversationId || ""),
      sessionKey: String(input.sessionKey || ""),
    },
    provider: {
      providerId: String(input.providerId || ""),
      adapterId: String(input.adapterId || ""),
    },
    policy: {
      timeoutMs: Number(input.timeoutMs || 0),
      retryCount: Number(input.retryCount || 0),
      retryBaseMs: Number(input.retryBaseMs || 0),
    },
    operations: [],
    telemetry: {
      latencyMs: Number(input.latencyMs || 0),
      attemptCount: Number(input.attemptCount || 0),
      chatIdCount: Number(input.chatIdCount || 0),
    },
  };
}

export async function runTelegramDomainService(input = {}, deps = {}) {
  const startedAt = Date.now();
  const text = String(input.text || "").trim();
  const requestHints = input.requestHints && typeof input.requestHints === "object"
    ? input.requestHints
    : {};
  const userContextId = String(input.userContextId || "").trim();
  const conversationId = String(input.conversationId || "").trim();
  const sessionKey = String(input.sessionKey || "").trim();
  const action = normalizeTelegramAction(text, requestHints);
  const policy = normalizeExecutionPolicy(requestHints);

  if (!userContextId || !conversationId || !sessionKey) {
    return createFailureResult({
      action,
      code: "telegram.context_missing",
      message: "Telegram worker requires userContextId, conversationId, and sessionKey.",
      userContextId,
      conversationId,
      sessionKey,
      timeoutMs: policy.timeoutMs,
      retryCount: policy.retryCount,
      retryBaseMs: policy.retryBaseMs,
      latencyMs: Date.now() - startedAt,
    });
  }

  const integrationStateAdapter = deps.integrationStateAdapter && typeof deps.integrationStateAdapter === "object"
    ? deps.integrationStateAdapter
    : createTelegramIntegrationStateAdapter();
  const loadIntegrationsState = typeof deps.loadIntegrationsState === "function"
    ? deps.loadIntegrationsState
    : (contextId) => integrationStateAdapter.getState(contextId);
  const adapterRegistry = deps.adapterRegistry && typeof deps.adapterRegistry === "object"
    ? deps.adapterRegistry
    : createTelegramProviderRegistry();

  let integrationsState = {};
  try {
    integrationsState = await loadIntegrationsState(userContextId);
  } catch (error) {
    return createFailureResult({
      action,
      code: "telegram.config_unavailable",
      message: `Telegram integration state is unavailable: ${redactTelegramSecrets(describeUnknownError(error))}`,
      userContextId,
      conversationId,
      sessionKey,
      timeoutMs: policy.timeoutMs,
      retryCount: policy.retryCount,
      retryBaseMs: policy.retryBaseMs,
      latencyMs: Date.now() - startedAt,
    });
  }

  const runtime = normalizeTelegramRuntime(integrationsState, requestHints);
  if (!runtime.connected) {
    return createFailureResult({
      action,
      code: "telegram.integration_disabled",
      message: "Telegram integration is disabled for this user context.",
      reply: "Telegram is disabled in Integrations. Enable it and retry.",
      userContextId,
      conversationId,
      sessionKey,
      providerId: runtime.providerId,
      timeoutMs: policy.timeoutMs,
      retryCount: policy.retryCount,
      retryBaseMs: policy.retryBaseMs,
      latencyMs: Date.now() - startedAt,
    });
  }
  if (!runtime.providerId) {
    return createFailureResult({
      action,
      code: "telegram.provider_not_configured",
      message: "Telegram providerId is missing from integration config.",
      reply: "Telegram provider is not configured. Update Integrations and retry.",
      userContextId,
      conversationId,
      sessionKey,
      timeoutMs: policy.timeoutMs,
      retryCount: policy.retryCount,
      retryBaseMs: policy.retryBaseMs,
      latencyMs: Date.now() - startedAt,
    });
  }
  if (!runtime.apiBaseUrl) {
    return createFailureResult({
      action,
      code: "telegram.api_base_url_missing",
      message: "Telegram apiBaseUrl is missing from integration config.",
      reply: "Telegram endpoint is not configured. Update Integrations and retry.",
      userContextId,
      conversationId,
      sessionKey,
      providerId: runtime.providerId,
      timeoutMs: policy.timeoutMs,
      retryCount: policy.retryCount,
      retryBaseMs: policy.retryBaseMs,
      latencyMs: Date.now() - startedAt,
    });
  }
  if (!runtime.botToken) {
    return createFailureResult({
      action,
      code: "telegram.bot_token_missing",
      message: "Telegram bot token is missing from integration config.",
      reply: "Telegram bot token is missing. Re-save Telegram settings and retry.",
      userContextId,
      conversationId,
      sessionKey,
      providerId: runtime.providerId,
      timeoutMs: policy.timeoutMs,
      retryCount: policy.retryCount,
      retryBaseMs: policy.retryBaseMs,
      latencyMs: Date.now() - startedAt,
    });
  }

  const adapter = adapterRegistry[runtime.providerId];
  if (!adapter || typeof adapter !== "object") {
    return createFailureResult({
      action,
      code: "telegram.provider_adapter_missing",
      message: `No Telegram provider adapter registered for providerId "${runtime.providerId}".`,
      reply: "Telegram provider adapter is missing. Contact support.",
      userContextId,
      conversationId,
      sessionKey,
      providerId: runtime.providerId,
      timeoutMs: policy.timeoutMs,
      retryCount: policy.retryCount,
      retryBaseMs: policy.retryBaseMs,
      latencyMs: Date.now() - startedAt,
    });
  }

  try {
    if (action === "status") {
      const statusResult = await adapter.getStatus({
        apiBaseUrl: runtime.apiBaseUrl,
        botToken: runtime.botToken,
        timeoutMs: policy.timeoutMs,
        retryCount: policy.retryCount,
        retryBaseMs: policy.retryBaseMs,
      });
      const ok = statusResult?.ok === true;
      const providerUsername = String(statusResult?.responseBody?.result?.username || "").trim();
      const providerDisplayName = String(statusResult?.responseBody?.result?.first_name || "").trim();
      const reply = ok
        ? `Telegram is connected${providerUsername ? ` as @${providerUsername}` : ""}.`
        : "Telegram status check failed. Verify integration settings and retry.";
      return {
        ok,
        route: "telegram",
        responseRoute: "telegram",
        action,
        code: ok ? "telegram.status_ok" : String(statusResult?.errorCode || "telegram.status_failed"),
        message: ok
          ? "Telegram status is healthy."
          : String(statusResult?.errorMessage || "Telegram status check failed."),
        reply,
        context: { userContextId, conversationId, sessionKey },
        provider: {
          providerId: runtime.providerId,
          adapterId: String(adapter.id || runtime.providerId),
          username: providerUsername,
          displayName: providerDisplayName,
        },
        policy,
        operations: [{
          operation: "status",
          ok,
          attempts: Number(statusResult?.attempts || 0),
          status: Number(statusResult?.status || 0),
          errorCode: String(statusResult?.errorCode || ""),
          errorMessage: String(statusResult?.errorMessage || ""),
        }],
        telemetry: {
          latencyMs: Date.now() - startedAt,
          attemptCount: Number(statusResult?.attempts || 0),
          chatIdCount: runtime.chatIds.length,
        },
      };
    }

    const messageText = normalizeSendMessage(text, requestHints);
    if (!messageText) {
      return createFailureResult({
        action,
        code: "telegram.message_missing",
        message: "Telegram send command requires a message payload.",
        reply: "Tell me the message to send on Telegram.",
        userContextId,
        conversationId,
        sessionKey,
        providerId: runtime.providerId,
        adapterId: String(adapter.id || runtime.providerId),
        timeoutMs: policy.timeoutMs,
        retryCount: policy.retryCount,
        retryBaseMs: policy.retryBaseMs,
        latencyMs: Date.now() - startedAt,
        chatIdCount: runtime.chatIds.length,
      });
    }

    if (runtime.chatIds.length === 0) {
      return createFailureResult({
        action,
        code: "telegram.chat_ids_missing",
        message: "No Telegram chat IDs are configured for this user context.",
        reply: "I need at least one Telegram chat ID before I can send.",
        userContextId,
        conversationId,
        sessionKey,
        providerId: runtime.providerId,
        adapterId: String(adapter.id || runtime.providerId),
        timeoutMs: policy.timeoutMs,
        retryCount: policy.retryCount,
        retryBaseMs: policy.retryBaseMs,
        latencyMs: Date.now() - startedAt,
      });
    }

    const parseMode = normalizeParseMode(requestHints);
    const disableNotification = requestHints?.telegramCommand?.disableNotification === true
      || requestHints?.telegram?.disableNotification === true;
    const operations = await Promise.all(runtime.chatIds.map(async (chatId) => {
      const sendResult = await adapter.sendMessage({
        apiBaseUrl: runtime.apiBaseUrl,
        botToken: runtime.botToken,
        chatId,
        text: messageText,
        parseMode,
        disableNotification,
        timeoutMs: policy.timeoutMs,
        retryCount: policy.retryCount,
        retryBaseMs: policy.retryBaseMs,
      });
      return {
        operation: "send_message",
        chatId,
        ok: sendResult?.ok === true,
        attempts: Number(sendResult?.attempts || 0),
        status: Number(sendResult?.status || 0),
        messageId: Number(sendResult?.responseBody?.result?.message_id || 0),
        errorCode: String(sendResult?.errorCode || ""),
        errorMessage: redactTelegramSecrets(String(sendResult?.errorMessage || "")),
      };
    }));

    const successCount = operations.filter((entry) => entry.ok === true).length;
    const failureCount = operations.length - successCount;
    const ok = failureCount === 0;
    const partialFailure = successCount > 0 && failureCount > 0;
    const code = ok
      ? "telegram.send_ok"
      : partialFailure
        ? "telegram.send_partial_failure"
        : "telegram.send_failed";
    const reply = ok
      ? `Sent to ${successCount} Telegram ${successCount === 1 ? "chat" : "chats"}.`
      : partialFailure
        ? `Sent to ${successCount} Telegram chats, ${failureCount} failed.`
        : "Telegram send failed. Verify integration and retry.";

    return {
      ok,
      route: "telegram",
      responseRoute: "telegram",
      action,
      code,
      message: ok
        ? "Telegram send completed."
        : partialFailure
          ? "Telegram send partially completed."
          : "Telegram send failed.",
      reply,
      context: { userContextId, conversationId, sessionKey },
      provider: {
        providerId: runtime.providerId,
        adapterId: String(adapter.id || runtime.providerId),
      },
      policy,
      operations,
      telemetry: {
        latencyMs: Date.now() - startedAt,
        attemptCount: operations.reduce((sum, entry) => sum + Number(entry.attempts || 0), 0),
        chatIdCount: operations.length,
      },
    };
  } catch (error) {
    return createFailureResult({
      action,
      code: "telegram.execution_failed",
      message: redactTelegramSecrets(describeUnknownError(error)),
      userContextId,
      conversationId,
      sessionKey,
      providerId: runtime.providerId,
      adapterId: String(adapter.id || runtime.providerId),
      timeoutMs: policy.timeoutMs,
      retryCount: policy.retryCount,
      retryBaseMs: policy.retryBaseMs,
      latencyMs: Date.now() - startedAt,
      chatIdCount: runtime.chatIds.length,
    });
  }
}
