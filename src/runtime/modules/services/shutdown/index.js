import { createShutdownProviderAdapter } from "./provider-adapter/index.js";

function normalizeText(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function buildTelemetry({
  provider = "runtime_shutdown",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  latencyMs = 0,
  exited = false,
}) {
  return {
    domain: "shutdown",
    provider: normalizeText(provider, "runtime_shutdown"),
    adapterId: normalizeText(provider, "runtime_shutdown"),
    latencyMs: Number(latencyMs || 0),
    exited: exited === true,
    userContextId: normalizeText(userContextId),
    conversationId: normalizeText(conversationId),
    sessionKey: normalizeText(sessionKey),
  };
}

function buildResponse({
  ok = true,
  code = "",
  message = "",
  reply = "",
  requestHints = {},
  provider = "runtime_shutdown",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  startedAt = Date.now(),
  exited = false,
}) {
  const latencyMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  return {
    ok,
    route: "shutdown",
    responseRoute: "shutdown",
    code: normalizeText(code),
    message: normalizeText(message),
    reply: normalizeText(reply),
    error: ok ? "" : normalizeText(code || "shutdown.execution_failed"),
    provider: normalizeText(provider, "runtime_shutdown"),
    model: "",
    toolCalls: [],
    toolExecutions: [],
    retries: [],
    requestHints: requestHints && typeof requestHints === "object" ? requestHints : {},
    latencyMs,
    telemetry: buildTelemetry({
      provider,
      userContextId,
      conversationId,
      sessionKey,
      latencyMs,
      exited,
    }),
  };
}

function resolveContext(input = {}) {
  const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
  return {
    text: normalizeText(input.text),
    ctx,
    requestHints: input.requestHints && typeof input.requestHints === "object" ? input.requestHints : {},
    userContextId: normalizeText(input.userContextId || ctx.userContextId),
    conversationId: normalizeText(input.conversationId || ctx.conversationId),
    sessionKey: normalizeText(input.sessionKey || ctx.sessionKey),
    exitProcess: input.exitProcess !== false,
  };
}

export async function runShutdownDomainService(input = {}, deps = {}) {
  const startedAt = Date.now();
  const {
    text,
    ctx,
    requestHints,
    userContextId,
    conversationId,
    sessionKey,
    exitProcess,
  } = resolveContext(input);

  if (!userContextId || !conversationId || !sessionKey) {
    return buildResponse({
      ok: false,
      code: "shutdown.context_missing",
      message: "Shutdown worker requires userContextId, conversationId, and sessionKey.",
      reply: "I need a scoped conversation context before I can run shutdown.",
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
    });
  }

  const providerAdapter = deps.providerAdapter && typeof deps.providerAdapter === "object"
    ? deps.providerAdapter
    : createShutdownProviderAdapter({
      processExit: typeof input.processExit === "function" ? input.processExit : undefined,
    });

  providerAdapter.stopScopedSpeech({ userContextId });
  const reply = await providerAdapter.sendShutdownReply({
    text,
    ctx,
    replyText: "Shutting down now. If you need me again, just restart the system.",
    thinkingStatus: "Shutting down",
  });
  if (exitProcess) {
    providerAdapter.exitProcess(0);
  }

  return buildResponse({
    ok: true,
    code: "shutdown.completed",
    message: "Shutdown command completed.",
    reply,
    requestHints,
    provider: normalizeText(providerAdapter.providerId, "runtime_shutdown"),
    userContextId,
    conversationId,
    sessionKey,
    startedAt,
    exited: exitProcess,
  });
}
