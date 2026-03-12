import { resolveTimezone } from "../../shared/timezone/index.js";

const VALID_PROVIDERS = new Set(["claude", "openai", "grok", "gemini"]);
const VALID_AI_DETAIL_LEVELS = new Set(["concise", "standard", "detailed"]);
const VALID_AGENT_WORKER_ROLES = new Set([
  "routing-council",
  "policy-council",
  "memory-council",
  "planning-council",
  "media-manager",
  "finance-manager",
  "productivity-manager",
  "comms-manager",
  "system-manager",
  "worker-agent",
]);
const VALID_AGENT_DOMAINS = new Set(["media", "finance", "productivity", "comms", "system"]);
const VALID_PROVIDER_SELECTOR_STRATEGIES = new Set(["policy", "latency", "cost", "quality"]);

function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeProvider(value) {
  const parsed = String(value || "claude").toLowerCase();
  return VALID_PROVIDERS.has(parsed) ? parsed : "claude";
}

function normalizeDetailLevel(value) {
  const parsed = String(value || "standard");
  return VALID_AI_DETAIL_LEVELS.has(parsed) ? parsed : "standard";
}

function defaultPositionForIndex(index) {
  return { x: 200 + index * 240, y: 200 };
}

function parseStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, mapValue]) => {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = typeof mapValue === "string" ? mapValue.trim() : "";
    return normalizedKey && normalizedValue ? [[normalizedKey, normalizedValue]] : [];
  });
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function parseAgentRetryPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = asRecord(value);
  const maxAttempts = Number(record.maxAttempts);
  const backoffMs = Number(record.backoffMs);
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1 || !Number.isFinite(backoffMs) || backoffMs < 0) {
    return undefined;
  }
  return {
    maxAttempts: Math.max(1, Math.floor(maxAttempts)),
    backoffMs: Math.max(0, Math.floor(backoffMs)),
  };
}

function parseAgentRuntimeConfig(record) {
  const inputMapping = parseStringMap(record.inputMapping);
  const outputSchema = asString(record.outputSchema, "").trim() || undefined;
  const timeoutMsRaw = Number(record.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
    ? Math.max(1, Math.floor(timeoutMsRaw))
    : undefined;
  const retryPolicy = parseAgentRetryPolicy(record.retryPolicy);
  return {
    ...(inputMapping ? { inputMapping } : {}),
    ...(outputSchema ? { outputSchema } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(retryPolicy ? { retryPolicy } : {}),
  };
}

export function parseLlmNode(raw, index, options = {}) {
  const timezoneResolver = typeof options.resolveTimezone === "function" ? options.resolveTimezone : resolveTimezone;
  const positionForIndex = typeof options.positionForIndex === "function" ? options.positionForIndex : defaultPositionForIndex;
  const record = asRecord(raw);
  const id = String(record.id || `n${index + 1}`);
  const label = String(record.label || String(record.type || "Node"));
  const type = String(record.type || "");
  const position = positionForIndex(index);

  switch (type) {
    case "schedule-trigger": {
      const mode = String(record.triggerMode || "daily");
      return {
        id, label, position, type: "schedule-trigger",
        triggerMode: (mode === "once" || mode === "daily" || mode === "weekly" || mode === "interval" ? mode : "daily"),
        triggerTime: asString(record.triggerTime, "09:00") || "09:00",
        triggerTimezone: timezoneResolver(asString(record.triggerTimezone, "")),
        triggerDays: Array.isArray(record.triggerDays) ? record.triggerDays.map(String) : undefined,
        triggerIntervalMinutes: typeof record.triggerIntervalMinutes === "number" ? record.triggerIntervalMinutes : undefined,
      };
    }
    case "manual-trigger":
      return { id, label, position, type: "manual-trigger" };
    case "webhook-trigger": {
      const method = String(record.method || "POST");
      return {
        id, label, position, type: "webhook-trigger",
        method: (method === "GET" || method === "POST" || method === "PUT" ? method : "POST"),
        path: asString(record.path, ""),
        authentication: (() => {
          const authentication = String(record.authentication || "none");
          return authentication === "bearer" || authentication === "basic" ? authentication : "none";
        })(),
      };
    }
    case "event-trigger":
      return { id, label, position, type: "event-trigger", eventName: asString(record.eventName, ""), filter: asString(record.filter) || undefined };
    case "web-search":
      return {
        id, label, position, type: "web-search",
        query: asString(record.query, ""),
        maxResults: asNumber(record.maxResults, 5),
        fetchContent: record.fetchContent !== false,
      };
    case "http-request": {
      const method = String(record.method || "GET").toUpperCase();
      return {
        id, label, position, type: "http-request",
        method: (method === "GET" || method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE" ? method : "GET"),
        url: asString(record.url, ""),
        selector: asString(record.selector) || undefined,
      };
    }
    case "rss-feed":
      return {
        id, label, position, type: "rss-feed",
        url: asString(record.url, ""),
        maxItems: asNumber(record.maxItems, 10),
      };
    case "coinbase": {
      const intent = String(record.intent || "report");
      return {
        id, label, position, type: "coinbase",
        intent: (intent === "status" || intent === "price" || intent === "portfolio" || intent === "transactions" || intent === "report" ? intent : "report"),
        assets: Array.isArray(record.assets) ? record.assets.map(String) : undefined,
        quoteCurrency: asString(record.quoteCurrency) || undefined,
      };
    }
    case "polymarket-price-trigger": {
      const direction = String(record.direction || "above").trim().toLowerCase();
      return {
        id, label, position, type: "polymarket-price-trigger",
        tokenId: asString(record.tokenId, ""),
        marketSlug: asString(record.marketSlug) || undefined,
        direction: (direction === "below" ? "below" : "above"),
        threshold: asNumber(record.threshold, 0.5),
        pollIntervalSeconds: asNumber(record.pollIntervalSeconds, 60),
      };
    }
    case "polymarket-monitor": {
      const range = String(record.range || "1d").trim().toLowerCase();
      return {
        id, label, position, type: "polymarket-monitor",
        query: asString(record.query) || undefined,
        tagSlug: asString(record.tagSlug) || undefined,
        range: (range === "1h" || range === "6h" || range === "1d" || range === "1w" || range === "1m" || range === "all" ? range : "1d"),
        changeThresholdPct: asNumber(record.changeThresholdPct, 5),
        maxMarkets: asNumber(record.maxMarkets, 6),
        pollIntervalSeconds: asNumber(record.pollIntervalSeconds, 60),
      };
    }
    case "polymarket":
    case "polymarket-data-fetch": {
      const queryType = String(record.queryType || "search").trim().toLowerCase();
      const window = String(record.window || "day").trim().toLowerCase();
      return {
        id, label, position, type: "polymarket-data-fetch",
        queryType: (queryType === "market" || queryType === "prices" || queryType === "leaderboard" || queryType === "events" ? queryType : "search"),
        query: asString(record.query) || undefined,
        slug: asString(record.slug) || undefined,
        tokenIds: Array.isArray(record.tokenIds) ? record.tokenIds.map(String) : undefined,
        window: (window === "week" || window === "month" || window === "all" ? window : "day"),
        limit: asNumber(record.limit, 8),
        tagSlug: asString(record.tagSlug) || undefined,
      };
    }
    case "file-read": {
      const format = String(record.format || "text");
      return {
        id, label, position, type: "file-read",
        path: asString(record.path, ""),
        format: (format === "json" || format === "csv" ? format : "text"),
      };
    }
    case "form-input":
      return {
        id, label, position, type: "form-input",
        fields: Array.isArray(record.fields)
          ? record.fields.map((field) => {
              const parsedField = asRecord(field);
              return { name: asString(parsedField.name, "field"), label: asString(parsedField.label, asString(parsedField.name, "Field")), type: "text" };
            })
          : [{ name: "input", label: "Input", type: "text" }],
      };
    case "ai-summarize":
      return {
        id, label, position, type: "ai-summarize",
        prompt: asString(record.prompt, "Summarize the input in clear bullet points."),
        integration: normalizeProvider(record.integration),
        detailLevel: normalizeDetailLevel(record.detailLevel),
      };
    case "ai-generate":
      return {
        id, label, position, type: "ai-generate",
        prompt: asString(record.prompt, "Generate a report from the input."),
        integration: normalizeProvider(record.integration),
        detailLevel: normalizeDetailLevel(record.detailLevel),
      };
    case "ai-classify":
      return {
        id, label, position, type: "ai-classify",
        prompt: asString(record.prompt, "Classify the input."),
        integration: normalizeProvider(record.integration),
        categories: Array.isArray(record.categories) ? record.categories.map(String) : ["positive", "negative", "neutral"],
      };
    case "ai-extract":
      return {
        id, label, position, type: "ai-extract",
        prompt: asString(record.prompt, "Extract key fields from the input."),
        integration: normalizeProvider(record.integration),
      };
    case "ai-chat":
      return {
        id, label, position, type: "ai-chat",
        integration: normalizeProvider(record.integration),
        messages: Array.isArray(record.messages)
          ? record.messages.map((message) => {
              const parsedMessage = asRecord(message);
              const role = String(parsedMessage.role || "user");
              return {
                role: (role === "system" || role === "assistant" ? role : "user"),
                content: asString(parsedMessage.content, ""),
              };
            })
          : [],
      };
    case "condition":
      return {
        id, label, position, type: "condition",
        rules: Array.isArray(record.rules)
          ? record.rules.map((rule) => {
              const parsedRule = asRecord(rule);
              const operator = String(parsedRule.operator || "exists");
              return {
                field: asString(parsedRule.field, ""),
                operator: (
                  operator === "contains"
                  || operator === "equals"
                  || operator === "not_equals"
                  || operator === "greater_than"
                  || operator === "less_than"
                  || operator === "regex"
                  || operator === "exists"
                  || operator === "not_exists"
                    ? operator
                    : "exists"
                ),
                value: asString(parsedRule.value) || undefined,
              };
            })
          : [{ field: "", operator: "exists" }],
        logic: String(record.logic || "all") === "any" ? "any" : "all",
      };
    case "switch":
      return {
        id, label, position, type: "switch",
        expression: asString(record.expression, ""),
        cases: Array.isArray(record.cases)
          ? record.cases.map((entry) => {
              const parsedEntry = asRecord(entry);
              return { value: asString(parsedEntry.value, ""), port: asString(parsedEntry.port, "case_0") };
            })
          : [],
      };
    case "loop":
      return {
        id, label, position, type: "loop",
        inputExpression: asString(record.inputExpression, ""),
        batchSize: asNumber(record.batchSize, 1),
        maxIterations: asNumber(record.maxIterations, 100),
      };
    case "merge": {
      const mode = String(record.mode || "wait-all");
      return {
        id, label, position, type: "merge",
        mode: (mode === "first-wins" || mode === "append" ? mode : "wait-all"),
        inputCount: asNumber(record.inputCount, 2),
      };
    }
    case "split":
      return { id, label, position, type: "split", outputCount: asNumber(record.outputCount, 2) };
    case "wait": {
      const waitMode = String(record.waitMode || "duration");
      return {
        id, label, position, type: "wait",
        waitMode: (waitMode === "until-time" || waitMode === "webhook" ? waitMode : "duration"),
        durationMs: asNumber(record.durationMs, 60000),
        untilTime: asString(record.untilTime) || undefined,
        webhookPath: asString(record.webhookPath) || undefined,
      };
    }
    case "set-variables":
      return {
        id, label, position, type: "set-variables",
        assignments: Array.isArray(record.assignments)
          ? record.assignments.map((assignment) => {
              const parsedAssignment = asRecord(assignment);
              return { name: asString(parsedAssignment.name, ""), value: asString(parsedAssignment.value, "") };
            })
          : [],
      };
    case "code":
      return {
        id, label, position, type: "code",
        language: "javascript",
        code: asString(record.code, "return $input;"),
      };
    case "format": {
      const outputFormat = String(record.outputFormat || "text");
      return {
        id, label, position, type: "format",
        template: asString(record.template, "{{$nodes.previous.output.text}}"),
        outputFormat: (outputFormat === "markdown" || outputFormat === "json" || outputFormat === "html" ? outputFormat : "text"),
      };
    }
    case "filter": {
      const mode = String(record.mode || "keep");
      return {
        id, label, position, type: "filter",
        expression: asString(record.expression, "true"),
        mode: (mode === "remove" ? "remove" : "keep"),
      };
    }
    case "sort": {
      const direction = String(record.direction || "asc");
      return {
        id, label, position, type: "sort",
        field: asString(record.field, ""),
        direction: (direction === "desc" ? "desc" : "asc"),
      };
    }
    case "dedupe":
      return { id, label, position, type: "dedupe", field: asString(record.field, "") };
    case "telegram-output":
      return {
        id, label, position, type: "telegram-output",
        messageTemplate: asString(record.messageTemplate) || undefined,
        chatIds: Array.isArray(record.chatIds) ? record.chatIds.map(String) : undefined,
        parseMode: (() => {
          const parseMode = String(record.parseMode || "markdown");
          return parseMode === "html" || parseMode === "plain" ? parseMode : "markdown";
        })(),
      };
    case "discord-output":
      return {
        id, label, position, type: "discord-output",
        messageTemplate: asString(record.messageTemplate) || undefined,
        webhookUrls: Array.isArray(record.webhookUrls) ? record.webhookUrls.map(String) : undefined,
      };
    case "email-output": {
      const format = String(record.format || "text");
      return {
        id, label, position, type: "email-output",
        messageTemplate: asString(record.messageTemplate) || undefined,
        subject: asString(record.subject) || undefined,
        recipients: Array.isArray(record.recipients) ? record.recipients.map(String) : undefined,
        format: (format === "html" ? "html" : "text"),
      };
    }
    case "slack-output":
      return {
        id, label, position, type: "slack-output",
        messageTemplate: asString(record.messageTemplate) || undefined,
        channel: asString(record.channel) || undefined,
      };
    case "webhook-output":
      return { id, label, position, type: "webhook-output", url: asString(record.url, "") };
    case "sticky-note":
      return { id, label, position, type: "sticky-note", content: asString(record.content, "") };
    case "agent-supervisor": {
      const agentId = asString(record.agentId, "").trim();
      const goal = asString(record.goal, "").trim();
      if (!agentId || !goal) return null;
      return {
        id, label, position, type: "agent-supervisor",
        agentId,
        role: "operator",
        goal,
        reads: Array.isArray(record.reads) ? record.reads.map(String) : [],
        writes: Array.isArray(record.writes) ? record.writes.map(String) : [],
        ...parseAgentRuntimeConfig(record),
      };
    }
    case "agent-worker": {
      const agentId = asString(record.agentId, "").trim();
      const goal = asString(record.goal, "").trim();
      const role = String(record.role || "").trim();
      if (!agentId || !goal || !VALID_AGENT_WORKER_ROLES.has(role)) return null;
      const domain = String(record.domain || "").trim();
      if (domain && !VALID_AGENT_DOMAINS.has(domain)) return null;
      return {
        id, label, position, type: "agent-worker",
        agentId,
        role,
        domain: domain || undefined,
        goal,
        reads: Array.isArray(record.reads) ? record.reads.map(String) : [],
        writes: Array.isArray(record.writes) ? record.writes.map(String) : [],
        ...parseAgentRuntimeConfig(record),
      };
    }
    case "agent-handoff":
      if (!asString(record.fromAgentId, "").trim() || !asString(record.toAgentId, "").trim() || !asString(record.reason, "").trim()) return null;
      return {
        id, label, position, type: "agent-handoff",
        fromAgentId: asString(record.fromAgentId, "").trim(),
        toAgentId: asString(record.toAgentId, "").trim(),
        reason: asString(record.reason, "").trim(),
      };
    case "agent-state-read":
      if (!asString(record.key, "").trim()) return null;
      return {
        id, label, position, type: "agent-state-read",
        key: asString(record.key, "").trim(),
        required: record.required !== false,
      };
    case "agent-state-write":
      if (!asString(record.key, "").trim() || !asString(record.valueExpression, "").trim()) return null;
      return {
        id, label, position, type: "agent-state-write",
        key: asString(record.key, "").trim(),
        valueExpression: asString(record.valueExpression, "").trim(),
        writeMode: (() => {
          const writeMode = String(record.writeMode || "replace");
          return writeMode === "merge" || writeMode === "append" ? writeMode : "replace";
        })(),
      };
    case "provider-selector": {
      const allowedProviders = Array.isArray(record.allowedProviders)
        ? record.allowedProviders
          .map((provider) => String(provider).trim())
          .filter((provider) => VALID_PROVIDERS.has(provider))
        : [];
      const defaultProvider = String(record.defaultProvider || "").trim();
      const strategy = String(record.strategy || "").trim();
      if (allowedProviders.length === 0 || !allowedProviders.includes(defaultProvider) || !VALID_PROVIDER_SELECTOR_STRATEGIES.has(strategy)) return null;
      return {
        id, label, position, type: "provider-selector",
        allowedProviders,
        defaultProvider,
        strategy,
      };
    }
    case "agent-audit": {
      const agentId = asString(record.agentId, "").trim();
      const goal = asString(record.goal, "").trim();
      const requiredChecks = Array.isArray(record.requiredChecks)
        ? record.requiredChecks.map(String).map((item) => item.trim()).filter(Boolean)
        : [];
      if (!agentId || !goal || requiredChecks.length === 0) return null;
      return {
        id, label, position, type: "agent-audit",
        agentId,
        role: "audit-council",
        goal,
        requiredChecks,
        reads: Array.isArray(record.reads) ? record.reads.map(String) : [],
        writes: Array.isArray(record.writes) ? record.writes.map(String) : [],
        ...parseAgentRuntimeConfig(record),
      };
    }
    case "agent-subworkflow":
      if (!asString(record.missionId, "").trim()) return null;
      return {
        id, label, position, type: "agent-subworkflow",
        missionId: asString(record.missionId, "").trim(),
        inputMapping: parseStringMap(record.inputMapping),
        waitForCompletion: record.waitForCompletion !== false,
      };
    default:
      return null;
  }
}

export function parseLlmNodes(rawNodes, options = {}) {
  const nodes = [];
  const rejected = [];
  for (let index = 0; index < rawNodes.length; index += 1) {
    const node = parseLlmNode(rawNodes[index], index, options);
    if (node) {
      nodes.push(node);
      continue;
    }
    const raw = rawNodes[index];
    const record = asRecord(raw);
    rejected.push({ index, type: String(record.type || "unknown") });
  }
  return { nodes, rejected };
}

export function parseLlmConnections(rawConns, nodeIds) {
  const connections = [];
  const seenConnectionIds = new Set();
  for (let index = 0; index < (Array.isArray(rawConns) ? rawConns.length : 0); index += 1) {
    const raw = rawConns[index];
    if (!raw || typeof raw !== "object") continue;
    const record = raw;
    const sourceNodeId = String(record.sourceNodeId || "");
    const targetNodeId = String(record.targetNodeId || "");
    if (!sourceNodeId || !targetNodeId) continue;
    if (!nodeIds.has(sourceNodeId) || !nodeIds.has(targetNodeId)) continue;
    const connectionId = String(record.id || `c${index + 1}`);
    if (seenConnectionIds.has(connectionId)) continue;
    seenConnectionIds.add(connectionId);
    connections.push({
      id: connectionId,
      sourceNodeId,
      sourcePort: String(record.sourcePort || "main"),
      targetNodeId,
      targetPort: typeof record.targetPort === "string" ? record.targetPort : "main",
    });
  }
  return connections;
}




