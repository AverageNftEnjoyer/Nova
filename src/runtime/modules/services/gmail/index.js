import { executeGmailProviderTool } from "./provider-adapter/index.js";

function normalizeText(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildTelemetry({
  provider = "runtime-gmail-service",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  latencyMs = 0,
  toolName = "",
}) {
  return {
    domain: "gmail",
    provider,
    adapterId: provider,
    toolName: normalizeText(toolName),
    latencyMs: Number(latencyMs || 0),
    userContextId: normalizeText(userContextId),
    conversationId: normalizeText(conversationId),
    sessionKey: normalizeText(sessionKey),
  };
}

function buildResponse({
  ok = true,
  reply = "",
  code = "",
  message = "",
  requestHints = {},
  toolCalls = [],
  provider = "runtime-gmail-service",
  userContextId = "",
  conversationId = "",
  sessionKey = "",
  startedAt = Date.now(),
  toolName = "",
}) {
  const latencyMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  return {
    ok,
    route: "gmail",
    responseRoute: "gmail",
    reply: normalizeText(reply),
    code: normalizeText(code),
    message: normalizeText(message),
    error: ok ? "" : normalizeText(code || "gmail.execution_failed"),
    toolCalls: normalizeArray(toolCalls),
    toolExecutions: [],
    retries: [],
    requestHints: requestHints && typeof requestHints === "object" ? requestHints : {},
    provider: normalizeText(provider),
    model: "",
    latencyMs,
    telemetry: buildTelemetry({
      provider,
      userContextId,
      conversationId,
      sessionKey,
      latencyMs,
      toolName,
    }),
  };
}

function resolveContext(input = {}) {
  const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
  const llmCtx = input.llmCtx && typeof input.llmCtx === "object" ? input.llmCtx : {};
  return {
    text: normalizeText(input.text),
    userContextId: normalizeText(input.userContextId || ctx.userContextId),
    conversationId: normalizeText(input.conversationId || ctx.conversationId),
    sessionKey: normalizeText(input.sessionKey || ctx.sessionKey),
    requestHints: input.requestHints && typeof input.requestHints === "object" ? input.requestHints : {},
    runtimeTools: llmCtx.runtimeTools || null,
    availableTools: Array.isArray(llmCtx.availableTools) ? llmCtx.availableTools : [],
  };
}

function resolveGmailAction(text = "") {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return "unsupported";
  if (/\b(status|capabilities|connected|connection)\b/.test(normalized) && /\b(gmail|email|inbox)\b/.test(normalized)) return "status";
  if (/\b(accounts?|account list|which account)\b/.test(normalized) && /\b(gmail|email)\b/.test(normalized)) return "accounts";
  if (/\b(daily summary|inbox summary|summarize my (gmail|email|inbox)|email summary)\b/.test(normalized)) return "summary";
  if (/\b(read|get|open|show)\b.*\bmessage\b/.test(normalized)) return "get_message";
  if (/\b(unread|latest|recent|new)\b.*\b(emails?|messages?|gmail|inbox)\b/.test(normalized)) return "list_messages";
  if (/\b(list|show|check|scan)\b.*\b(emails?|messages?|gmail|inbox)\b/.test(normalized)) return "list_messages";
  if (/\b(reply|respond|draft)\b/.test(normalized) && /\b(email|message|gmail)\b/.test(normalized)) return "reply_draft";
  if (/\bforward\b/.test(normalized) && /\b(email|message|gmail)\b/.test(normalized)) return "forward";
  return "unsupported";
}

function extractMessageId(text = "") {
  const match = String(text || "").match(/\bmessage\s+(?:id\s+)?([A-Za-z0-9_-]{6,})\b/i);
  return normalizeText(match?.[1]);
}

function extractEmailAddress(text = "") {
  const match = String(text || "").match(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i);
  return normalizeText(match?.[1]).toLowerCase();
}

function extractReplyText(text = "") {
  const raw = String(text || "");
  const match = raw.match(/\b(?:reply|respond|draft(?:\s+a)?\s+reply)\b[\s\S]*?(?::|saying|that says)\s+([\s\S]+)$/i);
  return normalizeText(match?.[1]).replace(/[.?!]+$/, "").trim();
}

function extractForwardNote(text = "") {
  const raw = String(text || "");
  const match = raw.match(/\bforward\b[\s\S]*?(?:note|saying|with note)\s*[: ]\s*([\s\S]+)$/i);
  return normalizeText(match?.[1]).replace(/[.?!]+$/, "").trim();
}

function buildSafeFailureReply(payload) {
  const safeMessage = normalizeText(payload?.safeMessage, "I couldn't verify Gmail data right now.");
  const guidance = normalizeText(payload?.guidance);
  return guidance ? `${safeMessage} Next step: ${guidance}` : `${safeMessage} Next step: Retry in a moment.`;
}

function buildCapabilitiesReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply(payload);
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const email = normalizeText(data.email, "unknown");
  const connected = data.connected === true ? "connected" : "not connected";
  const scopes = normalizeArray(data.scopes).map((scope) => normalizeText(scope)).filter(Boolean);
  const missingScopes = normalizeArray(data.missingScopes).map((scope) => normalizeText(scope)).filter(Boolean);
  return [
    `Gmail status: ${connected}.`,
    `Active account: ${email}.`,
    scopes.length > 0 ? `Scopes: ${scopes.join(", ")}.` : "Scopes: none detected.",
    missingScopes.length > 0 ? `Missing scopes: ${missingScopes.join(", ")}.` : "Missing scopes: none.",
  ].join(" ");
}

function buildAccountsReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply(payload);
  const accounts = normalizeArray(payload.accounts);
  if (accounts.length === 0) return "No Gmail accounts are enabled for this user context.";
  const lines = accounts.map((account) => {
    const email = normalizeText(account?.email, "unknown");
    const active = account?.id && String(account.id) === String(payload.activeAccountId || "") ? "active" : "configured";
    return `- ${email} (${active})`;
  });
  return ["Configured Gmail accounts:", ...lines].join("\n");
}

function buildListReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply(payload);
  const messages = normalizeArray(payload.messages).slice(0, 5);
  if (messages.length === 0) return "No Gmail messages matched that request.";
  const lines = messages.map((message) => {
    const id = normalizeText(message?.id);
    const from = normalizeText(message?.from, "unknown sender");
    const subject = normalizeText(message?.subject, "(no subject)");
    return `- ${subject} from ${from}${id ? ` [${id}]` : ""}`;
  });
  return ["Recent Gmail messages:", ...lines].join("\n");
}

function buildGetMessageReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply(payload);
  const message = payload.message && typeof payload.message === "object" ? payload.message : {};
  const subject = normalizeText(message.subject, "(no subject)");
  const from = normalizeText(message.from, "unknown sender");
  const snippet = normalizeText(message.snippet, "No preview available.");
  const id = normalizeText(message.id);
  return [
    `Message${id ? ` ${id}` : ""}: ${subject}`,
    `From: ${from}`,
    `Preview: ${snippet}`,
  ].join("\n");
}

function buildSummaryReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply(payload);
  const summary = normalizeText(payload.summary, "I couldn't build a Gmail summary.");
  const metrics = payload.metrics && typeof payload.metrics === "object" ? payload.metrics : {};
  const topEmails = normalizeArray(payload.topEmails).slice(0, 3);
  const topLines = topEmails.map((message) => {
    const subject = normalizeText(message?.subject, "(no subject)");
    const from = normalizeText(message?.from, "unknown sender");
    return `- ${subject} from ${from}`;
  });
  return [
    summary,
    `Total: ${Number(metrics.total || 0)}, unread: ${Number(metrics.unread || 0)}, high priority: ${Number(metrics.highPriority || 0)}.`,
    ...(topLines.length > 0 ? ["Top emails:", ...topLines] : []),
  ].join("\n");
}

function buildConfirmRequiredReply(action = "reply") {
  if (action === "forward") {
    return "I can help with Gmail forwarding, but this lane requires explicit approval flow before sending. Include the message ID and recipient, then confirm in the UI and retry.";
  }
  return "I can help draft a Gmail reply, but this lane requires explicit approval flow before creating the draft. Include the message ID and reply text, then confirm in the UI and retry.";
}

export async function runGmailDomainService(input = {}) {
  const startedAt = Date.now();
  const {
    text,
    userContextId,
    conversationId,
    sessionKey,
    requestHints,
    runtimeTools,
    availableTools,
  } = resolveContext(input);

  if (!userContextId || !conversationId || !sessionKey) {
    return buildResponse({
      ok: false,
      code: "gmail.context_missing",
      message: "Gmail worker requires userContextId, conversationId, and sessionKey.",
      reply: "I need a scoped conversation context before I can work with Gmail.",
      requestHints,
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
    });
  }

  const action = resolveGmailAction(text);
  const toolInputBase = {
    userContextId,
    conversationId,
  };

  if (action === "status") {
    const payload = await executeGmailProviderTool(runtimeTools, availableTools, "gmail_capabilities", toolInputBase);
    return buildResponse({
      ok: payload?.ok === true,
      code: payload?.ok ? "gmail.capabilities_ok" : `gmail.${normalizeText(payload?.errorCode, "capabilities_failed").toLowerCase()}`,
      message: payload?.ok ? "Gmail capabilities loaded." : "Gmail capabilities request failed.",
      reply: buildCapabilitiesReply(payload),
      requestHints,
      toolCalls: ["gmail_capabilities"],
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
      toolName: "gmail_capabilities",
    });
  }

  if (action === "accounts") {
    const payload = await executeGmailProviderTool(runtimeTools, availableTools, "gmail_list_accounts", toolInputBase);
    return buildResponse({
      ok: payload?.ok === true,
      code: payload?.ok ? "gmail.accounts_ok" : `gmail.${normalizeText(payload?.errorCode, "accounts_failed").toLowerCase()}`,
      message: payload?.ok ? "Gmail accounts loaded." : "Gmail accounts request failed.",
      reply: buildAccountsReply(payload),
      requestHints,
      toolCalls: ["gmail_list_accounts"],
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
      toolName: "gmail_list_accounts",
    });
  }

  if (action === "summary") {
    const payload = await executeGmailProviderTool(runtimeTools, availableTools, "gmail_daily_summary", {
      ...toolInputBase,
      timeframeHours: 24,
      maxResults: 12,
    });
    return buildResponse({
      ok: payload?.ok === true,
      code: payload?.ok ? "gmail.summary_ok" : `gmail.${normalizeText(payload?.errorCode, "summary_failed").toLowerCase()}`,
      message: payload?.ok ? "Gmail summary loaded." : "Gmail summary request failed.",
      reply: buildSummaryReply(payload),
      requestHints,
      toolCalls: ["gmail_daily_summary"],
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
      toolName: "gmail_daily_summary",
    });
  }

  if (action === "list_messages") {
    const unreadPreferred = /\bunread\b/i.test(text);
    const payload = await executeGmailProviderTool(runtimeTools, availableTools, "gmail_list_messages", {
      ...toolInputBase,
      query: unreadPreferred ? "is:unread newer_than:14d" : "newer_than:7d",
      maxResults: 10,
    });
    return buildResponse({
      ok: payload?.ok === true,
      code: payload?.ok ? "gmail.list_ok" : `gmail.${normalizeText(payload?.errorCode, "list_failed").toLowerCase()}`,
      message: payload?.ok ? "Gmail messages loaded." : "Gmail list request failed.",
      reply: buildListReply(payload),
      requestHints,
      toolCalls: ["gmail_list_messages"],
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
      toolName: "gmail_list_messages",
    });
  }

  if (action === "get_message") {
    const messageId = extractMessageId(text);
    if (!messageId) {
      return buildResponse({
        ok: false,
        code: "gmail.message_id_missing",
        message: "Gmail message lookup requires a message ID.",
        reply: "Tell me the Gmail message ID to read, for example: `read message 18cabc123`.",
        requestHints,
        userContextId,
        conversationId,
        sessionKey,
        startedAt,
      });
    }
    const payload = await executeGmailProviderTool(runtimeTools, availableTools, "gmail_get_message", {
      ...toolInputBase,
      messageId,
    });
    return buildResponse({
      ok: payload?.ok === true,
      code: payload?.ok ? "gmail.message_ok" : `gmail.${normalizeText(payload?.errorCode, "message_failed").toLowerCase()}`,
      message: payload?.ok ? "Gmail message loaded." : "Gmail message request failed.",
      reply: buildGetMessageReply(payload),
      requestHints,
      toolCalls: ["gmail_get_message"],
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
      toolName: "gmail_get_message",
    });
  }

  if (action === "reply_draft") {
    const messageId = extractMessageId(text);
    const replyText = extractReplyText(text);
    if (!messageId || !replyText) {
      return buildResponse({
        ok: false,
        code: "gmail.reply_input_missing",
        message: "Reply draft requires a message ID and reply text.",
        reply: "Include the Gmail message ID and the reply text, for example: `draft reply to message 18cabc123: Thanks, I will review this today.`",
        requestHints,
        userContextId,
        conversationId,
        sessionKey,
        startedAt,
      });
    }
    return buildResponse({
      ok: true,
      code: "gmail.confirm_required",
      message: "Gmail draft creation requires explicit approval flow.",
      reply: buildConfirmRequiredReply("reply"),
      requestHints: {
        ...requestHints,
        gmailPendingAction: "reply_draft",
        gmailMessageId: messageId,
      },
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
    });
  }

  if (action === "forward") {
    const messageId = extractMessageId(text);
    const to = extractEmailAddress(text);
    const note = extractForwardNote(text);
    if (!messageId || !to) {
      return buildResponse({
        ok: false,
        code: "gmail.forward_input_missing",
        message: "Forwarding requires a message ID and recipient email.",
        reply: "Include the Gmail message ID and recipient, for example: `forward message 18cabc123 to ops@example.com`.",
        requestHints,
        userContextId,
        conversationId,
        sessionKey,
        startedAt,
      });
    }
    return buildResponse({
      ok: true,
      code: "gmail.confirm_required",
      message: "Gmail forwarding requires explicit approval flow.",
      reply: buildConfirmRequiredReply("forward"),
      requestHints: {
        ...requestHints,
        gmailPendingAction: "forward_message",
        gmailMessageId: messageId,
        gmailRecipient: to,
        ...(note ? { gmailForwardNote: note } : {}),
      },
      userContextId,
      conversationId,
      sessionKey,
      startedAt,
    });
  }

  return buildResponse({
    ok: true,
    code: "gmail.unsupported_prompt",
    message: "Gmail lane could not map the prompt to a supported Gmail action.",
    reply: "I can check Gmail status, list accounts, show recent or unread emails, summarize inbox activity, or read a specific message by ID.",
    requestHints: {
      ...requestHints,
      gmailUnsupportedPrompt: true,
    },
    userContextId,
    conversationId,
    sessionKey,
    startedAt,
  });
}
