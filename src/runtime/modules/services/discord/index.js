import {
  isValidDiscordWebhookUrl,
  isValidDiscordChannelId,
  resolveDiscordWebhookPolicy,
  sendDiscordWebhookTarget,
} from "./adapters/webhook/index.js";
import { createDiscordIntegrationStateAdapter } from "./integration-state/index.js";
import { redactWebhookTarget, redactDiscordSecrets } from "./redaction.js";

const ADAPTER_TYPE_WEBHOOK = "webhook";

function parseBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function resolveDispatchLimits() {
  return Object.freeze({
    maxTargets: parseBoundedInt(process.env.NOVA_DISCORD_MAX_TARGETS, 50, 1, 200),
    concurrency: parseBoundedInt(process.env.NOVA_DISCORD_SEND_CONCURRENCY, 5, 1, 20),
  });
}

function normalizeContextId(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function buildError(code, message, status = 400, meta = {}) {
  return {
    ok: false,
    code: String(code || "discord_unknown_error"),
    message: redactDiscordSecrets(String(message || "Discord execution failed.")),
    status: Number(status) || 400,
    meta: meta && typeof meta === "object" ? { ...meta } : {},
  };
}

function createTelemetry(startedAt, extra = {}) {
  return {
    latencyMs: Math.max(0, Date.now() - startedAt),
    provider: "discord-webhook-adapter",
    toolCalls: 0,
    tokens: 0,
    ...extra,
  };
}

function normalizeTextContent(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeTargets(inputTargets = [], fallbackWebhookUrls = []) {
  const seen = new Set();
  const normalized = [];

  const pushWebhook = (webhookUrl, channelId = "") => {
    const url = String(webhookUrl || "").trim();
    const channel = String(channelId || "").trim();
    if (!url) return;
    if (!isValidDiscordWebhookUrl(url)) {
      throw buildError(
        "discord_target_invalid_webhook",
        `Invalid Discord webhook target: ${redactWebhookTarget(url)}`,
        400,
      );
    }
    if (channel && !isValidDiscordChannelId(channel)) {
      throw buildError("discord_target_invalid_channel", "Invalid Discord channel target.", 400);
    }
    if (seen.has(url)) return;
    seen.add(url);
    normalized.push({
      type: ADAPTER_TYPE_WEBHOOK,
      webhookUrl: url,
      channelId: channel,
      target: redactWebhookTarget(url),
    });
  };

  if (Array.isArray(inputTargets) && inputTargets.length > 0) {
    for (const item of inputTargets) {
      if (typeof item === "string") {
        pushWebhook(item);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const targetType = String(item.type || ADAPTER_TYPE_WEBHOOK).trim().toLowerCase();
      if (targetType !== ADAPTER_TYPE_WEBHOOK) {
        throw buildError("discord_target_type_unsupported", "Unsupported Discord target type.", 400);
      }
      pushWebhook(item.webhookUrl, item.channelId);
    }
    return normalized;
  }

  for (const webhookUrl of fallbackWebhookUrls) pushWebhook(webhookUrl);
  return normalized;
}

async function runWithConcurrency(items, concurrency, worker) {
  const queue = Array.isArray(items) ? items.slice() : [];
  const out = [];
  const workerCount = Math.max(1, Math.min(concurrency, queue.length || 1));
  await Promise.all(
    Array.from({ length: workerCount }).map(async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        out.push(await worker(next));
      }
    }),
  );
  return out;
}

function summarizeDelivery(results = []) {
  const okCount = results.filter((row) => row?.ok === true).length;
  const failCount = Math.max(0, results.length - okCount);
  if (results.length === 0) return { status: "none", okCount: 0, failCount: 0 };
  if (okCount === 0) return { status: "all_failed", okCount, failCount };
  if (failCount === 0) return { status: "all_succeeded", okCount, failCount };
  return { status: "partial", okCount, failCount };
}

export async function runDiscordDomainService(input = {}) {
  const startedAt = Date.now();
  const integrationStateAdapter = input.integrationStateAdapter && typeof input.integrationStateAdapter === "object"
    ? input.integrationStateAdapter
    : createDiscordIntegrationStateAdapter();
  const loadIntegrationsState = typeof input.loadIntegrationsState === "function"
    ? input.loadIntegrationsState
    : (contextId) => integrationStateAdapter.getState(contextId);
  const userContextId = normalizeContextId(
    typeof integrationStateAdapter.normalizeContextId === "function"
      ? integrationStateAdapter.normalizeContextId(input.userContextId)
      : input.userContextId,
  );
  const conversationId = String(input.conversationId || "").trim();
  const sessionKey = String(input.sessionKey || "").trim();
  const text = normalizeTextContent(input.text);
  const requestHints = input.requestHints && typeof input.requestHints === "object" ? input.requestHints : {};
  const discordHints = requestHints.discord && typeof requestHints.discord === "object" ? requestHints.discord : {};
  const content = normalizeTextContent(discordHints.content || discordHints.message || text);

  if (!userContextId) {
    return {
      ...buildError("discord_context_missing_user", "Discord execution requires user context.", 400),
      telemetry: createTelemetry(startedAt),
    };
  }
  if (!conversationId) {
    return {
      ...buildError("discord_context_missing_conversation", "Discord execution requires conversation context.", 400),
      telemetry: createTelemetry(startedAt),
    };
  }
  if (!sessionKey) {
    return {
      ...buildError("discord_context_missing_session", "Discord execution requires session context.", 400),
      telemetry: createTelemetry(startedAt),
    };
  }
  if (!content) {
    return {
      ...buildError("discord_input_empty", "Discord message content is required.", 400),
      telemetry: createTelemetry(startedAt),
    };
  }

  let scopedConfig = { connected: false, webhookUrls: [] };
  try {
    const loaded = await loadIntegrationsState(userContextId);
    scopedConfig = loaded && typeof loaded === "object"
      ? loaded
      : { connected: false, webhookUrls: [] };
  } catch {
    return {
      ...buildError("discord_config_unavailable", "Discord integration state is unavailable.", 503),
      telemetry: createTelemetry(startedAt),
    };
  }
  if (!scopedConfig.connected) {
    return {
      ...buildError("discord_integration_disabled", "Discord integration is disabled for this user.", 403),
      telemetry: createTelemetry(startedAt),
    };
  }

  let targets = [];
  try {
    targets = normalizeTargets(discordHints.targets, scopedConfig.webhookUrls);
  } catch (error) {
    const normalized = error && typeof error === "object" && "ok" in error
      ? error
      : buildError("discord_target_validation_failed", "Discord target validation failed.", 400);
    return {
      ...normalized,
      telemetry: createTelemetry(startedAt),
    };
  }

  if (targets.length === 0) {
    return {
      ...buildError("discord_targets_missing", "No Discord targets configured.", 400),
      telemetry: createTelemetry(startedAt),
    };
  }

  const limits = resolveDispatchLimits();
  if (targets.length > limits.maxTargets) {
    return {
      ...buildError("discord_targets_exceeded", `Discord target count exceeds cap (${limits.maxTargets}).`, 400),
      telemetry: createTelemetry(startedAt),
    };
  }

  const payload = {
    content,
    ...(discordHints.username ? { username: String(discordHints.username).trim() } : {}),
    ...(discordHints.avatarUrl ? { avatar_url: String(discordHints.avatarUrl).trim() } : {}),
  };

  const policy = resolveDiscordWebhookPolicy();
  const fetchImpl = typeof input.fetchImpl === "function" ? input.fetchImpl : globalThis.fetch;
  const deliveries = await runWithConcurrency(
    targets,
    limits.concurrency,
    async (target) => sendDiscordWebhookTarget({
      webhookUrl: target.webhookUrl,
      payload,
      fetchImpl,
      policy,
    }),
  );

  const summary = summarizeDelivery(deliveries);
  const retries = deliveries.reduce((acc, row) => acc + Math.max(0, Number(row?.attempts || 1) - 1), 0);
  const errors = deliveries
    .filter((row) => row?.ok !== true)
    .map((row) => ({
      code: String(row?.code || "discord_delivery_failed"),
      target: String(row?.target || "discord:webhook:unknown"),
      status: Number(row?.status || 0),
      retryable: row?.retryable === true,
    }));

  if (summary.okCount === 0) {
    return {
      ...buildError("discord_delivery_all_failed", "Discord delivery failed for all targets.", 502, { errors }),
      deliveries,
      summary,
      telemetry: createTelemetry(startedAt, { retries }),
    };
  }

  return {
    ok: true,
    code: summary.failCount > 0 ? "discord_delivery_partial" : "discord_delivery_ok",
    message: summary.failCount > 0
      ? `Discord delivered to ${summary.okCount}/${targets.length} targets.`
      : `Discord delivered to ${summary.okCount} target${summary.okCount === 1 ? "" : "s"}.`,
    summary,
    deliveries,
    telemetry: createTelemetry(startedAt, { retries }),
    requestContext: {
      userContextId,
      conversationId,
      sessionKey,
    },
  };
}
