import { createWebResearchProviderAdapter } from "./provider-adapter/index.js";

function normalizeText(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function buildTelemetry({
  provider = "web_search",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  latencyMs = 0,
  query = "",
  resultCount = 0,
  attemptCount = 0,
}) {
  return {
    domain: "web_research",
    provider: normalizeText(provider, "web_search"),
    adapterId: normalizeText(provider, "web_search"),
    latencyMs: Number(latencyMs || 0),
    query: normalizeText(query),
    resultCount: Number(resultCount || 0),
    attemptCount: Number(attemptCount || 0),
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
  provider = "web_search",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  query = "",
  resultCount = 0,
  attemptCount = 0,
  toolCalls = [],
  startedAt = Date.now(),
  data = {},
}) {
  const latencyMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  return {
    ok,
    route: "web_research",
    responseRoute: "web_research",
    code: normalizeText(code),
    message: normalizeText(message),
    reply: normalizeText(reply),
    error: ok ? "" : normalizeText(code || "web_research.execution_failed"),
    toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
    toolExecutions: [],
    retries: [],
    requestHints: requestHints && typeof requestHints === "object" ? requestHints : {},
    provider: normalizeText(provider, "web_search"),
    model: "",
    latencyMs,
    telemetry: buildTelemetry({
      provider,
      userContextId,
      conversationId,
      sessionKey,
      latencyMs,
      query,
      resultCount,
      attemptCount,
    }),
    ...data,
  };
}

function resolveContext(input = {}) {
  const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
  const llmCtx = input.llmCtx && typeof input.llmCtx === "object" ? input.llmCtx : {};
  return {
    text: normalizeText(input.text),
    requestHints: input.requestHints && typeof input.requestHints === "object" ? input.requestHints : {},
    userContextId: normalizeText(input.userContextId || ctx.userContextId),
    conversationId: normalizeText(input.conversationId || ctx.conversationId),
    sessionKey: normalizeText(input.sessionKey || ctx.sessionKey),
    runtimeTools: llmCtx.runtimeTools || null,
    availableTools: Array.isArray(llmCtx.availableTools) ? llmCtx.availableTools : [],
  };
}

function resolveWebResearchAction(text = "", requestHints = {}) {
  const normalized = normalizeText(text).toLowerCase();
  if (requestHints?.webResearchShortTermFollowUp === true) return "search";
  if (!normalized) return "unsupported";
  if (/\b(research|search|find|look up|latest|current|sources?|citations?|news)\b/.test(normalized)) return "search";
  return "unsupported";
}

function buildWebResearchQuery(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  return normalizeText(
    normalized
      .replace(/\b(please|can you|could you)\b/gi, "")
      .replace(/\b(research|search|look up|find|find out|latest on|current on|sources for|citations for)\b/gi, "")
      .replace(/\s+/g, " "),
  ) || normalized;
}

function buildWebResearchReply(query = "", results = []) {
  const items = Array.isArray(results) ? results : [];
  if (items.length === 0) {
    return "I couldn't find strong web sources for that query. Try being more specific or narrowing the timeframe.";
  }
  const header = `Web research summary for "${query}":`;
  const lines = items.slice(0, 5).map((item, index) => {
    const title = normalizeText(item?.title, "Untitled");
    const url = normalizeText(item?.url, "");
    const snippet = normalizeText(item?.snippet, "");
    return `${index + 1}. ${title}${url ? ` (${url})` : ""}${snippet ? ` - ${snippet}` : ""}`;
  });
  return [header, ...lines].join("\n");
}

export async function runWebResearchDomainService(input = {}, deps = {}) {
  const startedAt = Date.now();
  const {
    text,
    requestHints,
    userContextId,
    conversationId,
    sessionKey,
    runtimeTools,
    availableTools,
  } = resolveContext(input);

  if (!userContextId || !conversationId || !sessionKey) {
    return buildResponse({
      ok: false,
      code: "web_research.context_missing",
      message: "Web research worker requires userContextId, conversationId, and sessionKey.",
      reply: "I need a scoped conversation context before I can run web research.",
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
    });
  }

  const action = resolveWebResearchAction(text, requestHints);
  if (action === "unsupported") {
    return buildResponse({
      ok: true,
      code: "web_research.unsupported_command",
      message: "Unsupported web research command.",
      reply: "Web research can search current sources and summarize findings. Try: `research <topic>` or `find latest news on <topic>`.",
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
    });
  }

  const query = buildWebResearchQuery(text);
  const providerAdapter = deps.providerAdapter && typeof deps.providerAdapter === "object"
    ? deps.providerAdapter
    : createWebResearchProviderAdapter();
  const result = await providerAdapter.searchWeb({
    query,
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
    sessionKey,
  });

  return buildResponse({
    ok: result?.ok === true,
    code: String(result?.code || (result?.ok === true ? "web_research.search_ok" : "web_research.search_failed")),
    message: String(result?.message || (result?.ok === true ? "Web research completed." : "Web research failed.")),
    reply: result?.ok === true
      ? buildWebResearchReply(query, result?.results || [])
      : "I couldn't complete web research right now. Please retry in a moment.",
    requestHints,
    provider: normalizeText(result?.providerId, "web_search"),
    userContextId,
    conversationId,
    sessionKey,
    query,
    resultCount: Number(Array.isArray(result?.results) ? result.results.length : 0),
    attemptCount: Number(result?.attempts || 0),
    toolCalls: Number(result?.attempts || 0) > 0 ? ["web_search"] : [],
    startedAt,
    data: {
      researchResults: Array.isArray(result?.results) ? result.results : [],
      adapter: {
        id: normalizeText(result?.adapterId, "web-research-tool-adapter"),
      },
    },
  });
}
