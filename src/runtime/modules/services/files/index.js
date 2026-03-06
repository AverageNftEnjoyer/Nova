import { createFilesProviderAdapter } from "./provider-adapter/index.js";

function normalizeText(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function buildTelemetry({
  provider = "tool_runtime",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  latencyMs = 0,
  action = "",
  toolName = "",
}) {
  return {
    domain: "files",
    provider: normalizeText(provider, "tool_runtime"),
    adapterId: normalizeText(provider, "tool_runtime"),
    latencyMs: Number(latencyMs || 0),
    action: normalizeText(action),
    toolName: normalizeText(toolName),
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
  provider = "tool_runtime",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  action = "",
  toolName = "",
  toolCalls = [],
  startedAt = Date.now(),
  data = {},
}) {
  const latencyMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  return {
    ok,
    route: "files",
    responseRoute: "files",
    code: normalizeText(code),
    message: normalizeText(message),
    reply: normalizeText(reply),
    error: ok ? "" : normalizeText(code || "files.execution_failed"),
    toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
    toolExecutions: [],
    retries: [],
    requestHints: requestHints && typeof requestHints === "object" ? requestHints : {},
    provider: normalizeText(provider, "tool_runtime"),
    model: "",
    latencyMs,
    telemetry: buildTelemetry({
      provider,
      userContextId,
      conversationId,
      sessionKey,
      latencyMs,
      action,
      toolName,
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

function parseFilesCommand(text = "") {
  const normalized = normalizeText(text);
  const lowered = normalized.toLowerCase();
  if (!lowered) return { action: "unsupported" };

  const listMatch = lowered.match(/\b(list|show)\b.*\b(files|folders|directories|workspace)\b/);
  if (listMatch) {
    const pathMatch = normalized.match(/\b(?:in|under)\s+([^\n]+)$/i);
    return { action: "list", path: normalizeText(pathMatch?.[1] || ".") };
  }

  const readMatch = normalized.match(/\b(?:read|open|show)\s+(?:file\s+)?([^\n]+)$/i);
  if (readMatch && /\.(md|txt|js|ts|tsx|json|yaml|yml|mjs|cjs|py|go|rs|java|css|html)$/i.test(readMatch[1])) {
    return { action: "read", path: normalizeText(readMatch[1]) };
  }

  const searchMatch = normalized.match(/\b(?:search|grep|find)\s+(?:for\s+)?["“]?([^"”]+)["”]?(?:\s+in\s+([^\n]+))?$/i);
  if (searchMatch) {
    return {
      action: "search",
      pattern: normalizeText(searchMatch[1]),
      path: normalizeText(searchMatch[2] || "."),
    };
  }

  const writeMatch = normalized.match(/\b(?:write|create)\s+(?:file\s+)?([^\s:]+)\s*:\s*([\s\S]+)$/i);
  if (writeMatch) {
    return {
      action: "write",
      path: normalizeText(writeMatch[1]),
      content: String(writeMatch[2] || ""),
    };
  }

  return { action: "unsupported" };
}

function summarizeToolContent(raw = "", maxLines = 8) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const lines = text.split(/\r?\n/).slice(0, Math.max(1, maxLines));
  return lines.join("\n");
}

export async function runFilesDomainService(input = {}, deps = {}) {
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
      code: "files.context_missing",
      message: "Files worker requires userContextId, conversationId, and sessionKey.",
      reply: "I need a scoped conversation context before I can run file operations.",
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
      action: "context_check",
    });
  }

  const command = parseFilesCommand(text);
  const adapter = deps.providerAdapter && typeof deps.providerAdapter === "object"
    ? deps.providerAdapter
    : createFilesProviderAdapter();

  if (command.action === "unsupported") {
    return buildResponse({
      ok: true,
      code: "files.unsupported_command",
      message: "Unsupported files command.",
      reply: "Files lane supports: `list files`, `read <path>`, `search <pattern> in <path>`, and `write <path>: <content>`.",
      requestHints,
      provider: "tool_runtime",
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
      action: "unsupported",
    });
  }

  let toolName = "";
  let toolInput = {};
  if (command.action === "list") {
    toolName = "ls";
    toolInput = { path: command.path || "." };
  } else if (command.action === "read") {
    toolName = "read";
    toolInput = { path: command.path };
  } else if (command.action === "search") {
    toolName = "grep";
    toolInput = { pattern: command.pattern, path: command.path || "." };
  } else if (command.action === "write") {
    toolName = "write";
    toolInput = { path: command.path, content: String(command.content || "") };
  }

  const toolResult = await adapter.runFileTool({
    toolName,
    toolInput,
    runtimeTools,
    availableTools,
    userContextId,
    conversationId,
    sessionKey,
  });

  if (toolResult?.ok !== true) {
    return buildResponse({
      ok: false,
      code: String(toolResult?.code || "files.tool_failed"),
      message: String(toolResult?.message || "Files tool call failed."),
      reply: "I couldn't complete that file operation right now. Check tool availability and try again.",
      requestHints,
      provider: normalizeText(toolResult?.providerId, "tool_runtime"),
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
      action: command.action,
      toolName,
      toolCalls: [toolName].filter(Boolean),
    });
  }

  const preview = summarizeToolContent(toolResult?.content || "", command.action === "read" ? 20 : 10);
  const successReply = command.action === "write"
    ? `File write completed:\n${preview}`
    : `${command.action} result:\n${preview || "(no output)"}`;

  return buildResponse({
    ok: true,
    code: `files.${command.action}_ok`,
    message: "Files operation completed.",
    reply: successReply,
    requestHints,
    provider: normalizeText(toolResult?.providerId, "tool_runtime"),
    userContextId,
    conversationId,
    sessionKey,
    startedAt,
    action: command.action,
    toolName,
    toolCalls: [toolName].filter(Boolean),
    data: {
      operation: {
        action: command.action,
        path: normalizeText(command.path || command.pathHint || ""),
      },
    },
  });
}
