import { createDelegatedProviderAdapter } from "../delegated-provider-adapter/index.js";

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeRoute(value, fallback = "chat") {
  return normalizeText(value, fallback).toLowerCase();
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value, fallback = {}) {
  return value && typeof value === "object" ? value : fallback;
}

function normalizeBoolean(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function buildFailureCode(domainId, code) {
  const normalizedDomain = normalizeRoute(domainId, "delegated");
  const normalizedCode = normalizeRoute(code, "execution_failed").replace(/^delegated\./, "");
  return `${normalizedDomain}.${normalizedCode}`;
}

export async function runDelegatedDomainService(input = {}, deps = {}) {
  const startedAt = Date.now();
  const domainId = normalizeRoute(input.domainId, "chat");
  const route = normalizeRoute(input.route, domainId);
  const responseRoute = normalizeRoute(input.responseRoute, route);
  const degradedReply = normalizeText(input.degradedReply, `I couldn't complete the ${domainId} request right now. Please retry.`);

  const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
  const userContextId = normalizeText(input.userContextId || ctx.userContextId);
  const conversationId = normalizeText(input.conversationId || ctx.conversationId);
  const sessionKey = normalizeText(input.sessionKey || ctx.sessionKey);
  if (!userContextId || !conversationId || !sessionKey) {
    return {
      ok: false,
      route,
      responseRoute,
      code: buildFailureCode(domainId, "context_missing"),
      message: `${domainId} worker requires userContextId, conversationId, and sessionKey.`,
      reply: degradedReply,
      toolCalls: [],
      toolExecutions: [],
      retries: [],
      requestHints: normalizeObject(input.requestHints, {}),
      provider: "",
      model: "",
      telemetry: {
        domain: domainId,
        provider: "",
        adapterId: "",
        attemptCount: 0,
        latencyMs: Date.now() - startedAt,
        userContextId,
        conversationId,
        sessionKey,
      },
    };
  }

  const adapter = deps.providerAdapter && typeof deps.providerAdapter === "object"
    ? deps.providerAdapter
    : createDelegatedProviderAdapter({
      timeoutMs: input.timeoutMs,
      retryCount: input.retryCount,
      retryBackoffMs: input.retryBackoffMs,
    });

  const adapterResult = await adapter.execute({
    text: input.text,
    ctx,
    llmCtx: input.llmCtx,
    requestHints: input.requestHints,
    executeChatRequest: input.executeChatRequest,
  });
  const latencyMs = Date.now() - startedAt;
  if (adapterResult?.ok !== true) {
    return {
      ok: false,
      route,
      responseRoute,
      code: buildFailureCode(domainId, adapterResult?.code || "execution_failed"),
      message: normalizeText(adapterResult?.message, `${domainId} execution failed.`),
      reply: degradedReply,
      toolCalls: [],
      toolExecutions: [],
      retries: [{
        stage: "delegated_adapter",
        reason: normalizeText(adapterResult?.code, "execution_failed"),
      }],
      requestHints: normalizeObject(input.requestHints, {}),
      provider: "",
      model: "",
      telemetry: {
        domain: domainId,
        provider: "",
        adapterId: normalizeText(adapter?.id),
        attemptCount: Number(adapterResult?.attemptCount || 0),
        timeoutMs: Number(adapterResult?.timeoutMs || adapter?.timeoutMs || 0),
        latencyMs,
        userContextId,
        conversationId,
        sessionKey,
      },
    };
  }

  const summary = normalizeObject(adapterResult.summary, {});
  const telemetry = normalizeObject(summary.telemetry, {});
  const ok = normalizeBoolean(summary.ok, true);
  return {
    ...summary,
    route: normalizeRoute(summary.route, route),
    responseRoute: normalizeRoute(summary.responseRoute, responseRoute),
    ok,
    reply: normalizeText(summary.reply),
    error: ok ? "" : normalizeText(summary.error, buildFailureCode(domainId, "execution_failed")),
    toolCalls: normalizeArray(summary.toolCalls),
    toolExecutions: normalizeArray(summary.toolExecutions),
    retries: normalizeArray(summary.retries),
    requestHints: normalizeObject(summary.requestHints, normalizeObject(input.requestHints, {})),
    telemetry: {
      ...telemetry,
      domain: domainId,
      provider: normalizeText(telemetry.provider, normalizeText(summary.provider)),
      adapterId: normalizeText(telemetry.adapterId, normalizeText(adapter?.id)),
      attemptCount: Number(telemetry.attemptCount || adapterResult.attemptCount || 0),
      timeoutMs: Number(telemetry.timeoutMs || adapterResult.timeoutMs || adapter?.timeoutMs || 0),
      latencyMs: Number(telemetry.latencyMs || summary.latencyMs || latencyMs),
      userContextId: normalizeText(telemetry.userContextId, userContextId),
      conversationId: normalizeText(telemetry.conversationId, conversationId),
      sessionKey: normalizeText(telemetry.sessionKey, sessionKey),
    },
  };
}
