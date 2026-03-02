
import { loadIntegrationsRuntime } from "../../../providers/runtime/index.js";
import type { Tool } from "../../core/types/index.js";

const GMAIL_SCOPE_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_SCOPE_SEND = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_SCOPE_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";

const GMAIL_TOOL_NAMES = new Set([
  "gmail_capabilities",
  "gmail_list_accounts",
  "gmail_scope_check",
  "gmail_list_messages",
  "gmail_get_message",
  "gmail_daily_summary",
  "gmail_classify_importance",
  "gmail_forward_message",
  "gmail_reply_draft",
]);

type GmailRuntime = {
  connected: boolean;
  activeAccountId: string;
  email: string;
  scopes: string[];
  accessToken?: string;
  accounts: Array<{
    id: string;
    email: string;
    enabled: boolean;
    scopes: string[];
    accessToken?: string;
  }>;
};

type GmailMetaRow = {
  id: string;
  threadId: string;
  labels: string[];
  from: string;
  to: string;
  subject: string;
  date: string;
  messageIdHeader: string;
  replyTo: string;
  snippet: string;
  internalDate: string;
};

type GmailError = {
  ok: false;
  kind: string;
  source: "gmail";
  errorCode: string;
  message: string;
  safeMessage: string;
  guidance: string;
  retryable: boolean;
  requiredScopes: string[];
};

function toJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      ok: false,
      kind: "gmail_error",
      source: "gmail",
      errorCode: "SERIALIZE_FAILED",
      message: "Failed to serialize Gmail output.",
      safeMessage: "I couldn't process Gmail data right now.",
      guidance: "Retry in a moment.",
      retryable: true,
      requiredScopes: [GMAIL_SCOPE_READONLY],
    } satisfies GmailError);
  }
}

function normalizeUserContextId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function toString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const normalized = toString(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function missingScopes(granted: string[], required: string[]): string[] {
  const scopeSet = new Set(granted.map((scope) => scope.toLowerCase()));
  return required.filter((scope) => !scopeSet.has(scope.toLowerCase()));
}

function buildError(
  kind: string,
  errorCode: string,
  message: string,
  safeMessage: string,
  guidance: string,
  retryable: boolean,
  requiredScopes: string[],
): GmailError {
  return {
    ok: false,
    kind,
    source: "gmail",
    errorCode,
    message,
    safeMessage,
    guidance,
    retryable,
    requiredScopes,
  };
}

function parseRuntime(workspaceDir: string, userContextId: string): GmailRuntime {
  const runtime = loadIntegrationsRuntime({
    workspaceRoot: workspaceDir,
    userContextId,
  }) as {
    gmail?: {
      connected?: boolean;
      activeAccountId?: string;
      email?: string;
      scopes?: unknown;
      accessToken?: string;
      accounts?: Array<{
        id?: string;
        email?: string;
        enabled?: boolean;
        scopes?: unknown;
        accessToken?: string;
      }>;
    };
  };
  const gmail = runtime.gmail || {};
  const accounts = Array.isArray(gmail.accounts)
    ? gmail.accounts.map((account) => ({
      id: toString(account?.id),
      email: toString(account?.email),
      enabled: account?.enabled === true,
      scopes: toStringArray(account?.scopes),
      accessToken: toString(account?.accessToken),
    }))
    : [];
  return {
    connected: gmail.connected === true,
    activeAccountId: toString(gmail.activeAccountId),
    email: toString(gmail.email),
    scopes: toStringArray(gmail.scopes),
    accessToken: toString(gmail.accessToken),
    accounts,
  };
}

function activeAccount(runtime: GmailRuntime): GmailRuntime["accounts"][number] | null {
  if (runtime.accounts.length === 0) return null;
  if (runtime.activeAccountId) {
    const match = runtime.accounts.find((account) => account.id === runtime.activeAccountId);
    if (match) return match;
  }
  return runtime.accounts.find((account) => account.enabled) || runtime.accounts[0] || null;
}

function accessToken(runtime: GmailRuntime): string {
  return toString(activeAccount(runtime)?.accessToken) || toString(runtime.accessToken);
}

function grantedScopes(runtime: GmailRuntime): string[] {
  const accountScopes = activeAccount(runtime)?.scopes || [];
  return accountScopes.length > 0 ? accountScopes : runtime.scopes;
}

async function gmailRequest(
  token: string,
  endpoint: string,
  options?: { method?: "GET" | "POST"; body?: Record<string, unknown> },
): Promise<unknown> {
  const method = options?.method || "GET";
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: method === "POST" ? JSON.stringify(options?.body || {}) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const code =
      res.status === 401 ? "AUTH_FAILED"
        : res.status === 403 ? "MISSING_SCOPE"
          : res.status === 404 ? "NOT_FOUND"
            : res.status === 429 ? "RATE_LIMITED"
              : "UPSTREAM_ERROR";
    throw { status: res.status, code, message: text || `Gmail request failed (${res.status}).` };
  }
  return res.json();
}

function normalizeCtx(input: Record<string, unknown>): { userContextId: string; conversationId: string } {
  return {
    userContextId: normalizeUserContextId(input.userContextId),
    conversationId: toString(input.conversationId).slice(0, 128),
  };
}

function ensureReady(
  kind: string,
  runtime: GmailRuntime,
  scopes: string[],
): { ok: true; token: string } | { ok: false; error: GmailError } {
  if (!runtime.connected) {
    return {
      ok: false,
      error: buildError(
        kind,
        "DISCONNECTED",
        "Gmail integration disconnected.",
        "I couldn't access Gmail because the integration is disconnected.",
        "Connect Gmail in Integrations and retry.",
        false,
        scopes,
      ),
    };
  }
  const missing = missingScopes(grantedScopes(runtime), scopes);
  if (missing.length > 0) {
    return {
      ok: false,
      error: buildError(
        kind,
        "MISSING_SCOPE",
        `Missing Gmail scope(s): ${missing.join(", ")}`,
        "I couldn't access Gmail because required permissions are missing.",
        `Reconnect Gmail and grant: ${missing.join(", ")}.`,
        false,
        scopes,
      ),
    };
  }
  const token = accessToken(runtime);
  if (!token) {
    return {
      ok: false,
      error: buildError(
        kind,
        "AUTH_MISSING",
        "No Gmail access token available in runtime config.",
        "I couldn't access Gmail because authentication is missing in runtime.",
        "Refresh Gmail auth and ensure runtime snapshot includes active account token.",
        false,
        scopes,
      ),
    };
  }
  return { ok: true, token };
}

function mapApiError(kind: string, error: unknown, scopes: string[]): GmailError {
  if (error && typeof error === "object") {
    const maybe = error as { code?: string; message?: string };
    const code = toString(maybe.code).toUpperCase() || "UPSTREAM_ERROR";
    if (code === "AUTH_FAILED") {
      return buildError(kind, code, maybe.message || "Auth failed.", "Gmail authentication failed.", "Reconnect Gmail and retry.", false, scopes);
    }
    if (code === "MISSING_SCOPE") {
      return buildError(kind, code, maybe.message || "Missing scope.", "Required Gmail permissions are missing.", "Reconnect Gmail with required scopes.", false, scopes);
    }
    if (code === "NOT_FOUND") {
      return buildError(kind, code, maybe.message || "Message not found.", "I couldn't find that Gmail message.", "Check message ID and retry.", false, scopes);
    }
    if (code === "RATE_LIMITED") {
      return buildError(kind, code, maybe.message || "Rate limited.", "Gmail is rate limiting requests.", "Retry shortly.", true, scopes);
    }
  }
  return buildError(kind, "NETWORK", "Gmail request failed.", "I couldn't reach Gmail right now.", "Retry in a moment.", true, scopes);
}

function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  const key = name.toLowerCase();
  return toString((headers || []).find((item) => toString(item?.name).toLowerCase() === key)?.value);
}

function b64urlEncode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function scoreImportance(subject: string, snippet: string, labels: string[]): { priority: "high" | "normal" | "low"; score: number } {
  const text = `${subject} ${snippet}`.toLowerCase();
  const labelSet = new Set(labels.map((v) => v.toLowerCase()));
  let score = 0;
  if (labelSet.has("unread")) score += 2;
  if (labelSet.has("important") || labelSet.has("starred")) score += 3;
  if (/\b(urgent|asap|deadline|action required|invoice due)\b/.test(text)) score += 3;
  if (/\b(newsletter|digest|promotion)\b/.test(text)) score -= 2;
  if (score >= 5) return { priority: "high", score };
  if (score <= 0) return { priority: "low", score };
  return { priority: "normal", score };
}

async function getMetadataMessages(token: string, query: string, maxResults: number): Promise<GmailMetaRow[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("maxResults", String(maxResults));
  const list = await gmailRequest(token, `/users/me/messages?${params.toString()}`) as {
    messages?: Array<{ id?: string }>;
  };
  const ids = Array.isArray(list.messages) ? list.messages.map((m) => toString(m?.id)).filter(Boolean) : [];
  const out: GmailMetaRow[] = [];
  for (const id of ids) {
    const msg = await gmailRequest(token, `/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=Reply-To`) as {
      id?: string;
      threadId?: string;
      labelIds?: string[];
      snippet?: string;
      internalDate?: string;
      payload?: { headers?: Array<{ name?: string; value?: string }> };
    };
    const headers = msg.payload?.headers || [];
    out.push({
      id: toString(msg.id),
      threadId: toString(msg.threadId),
      labels: Array.isArray(msg.labelIds) ? msg.labelIds : [],
      from: headerValue(headers, "From"),
      to: headerValue(headers, "To"),
      subject: headerValue(headers, "Subject"),
      date: headerValue(headers, "Date"),
      messageIdHeader: headerValue(headers, "Message-ID"),
      replyTo: headerValue(headers, "Reply-To"),
      snippet: toString(msg.snippet),
      internalDate: toString(msg.internalDate),
    });
  }
  return out;
}

async function getMessageByIdMetadata(token: string, messageId: string): Promise<GmailMetaRow> {
  const msg = await gmailRequest(
    token,
    `/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=Reply-To`,
  ) as {
    id?: string;
    threadId?: string;
    labelIds?: string[];
    snippet?: string;
    internalDate?: string;
    payload?: { headers?: Array<{ name?: string; value?: string }> };
  };
  const headers = msg.payload?.headers || [];
  return {
    id: toString(msg.id),
    threadId: toString(msg.threadId),
    labels: Array.isArray(msg.labelIds) ? msg.labelIds : [],
    from: headerValue(headers, "From"),
    to: headerValue(headers, "To"),
    subject: headerValue(headers, "Subject"),
    date: headerValue(headers, "Date"),
    messageIdHeader: headerValue(headers, "Message-ID"),
    replyTo: headerValue(headers, "Reply-To"),
    snippet: toString(msg.snippet),
    internalDate: toString(msg.internalDate),
  };
}

export function isGmailToolName(name: unknown): boolean {
  return GMAIL_TOOL_NAMES.has(String(name || "").trim());
}

export function createGmailTools(params: { workspaceDir: string }): Tool[] {
  const capabilities: Tool = {
    name: "gmail_capabilities",
    description: "Return Gmail integration status, active account, scopes, and token readiness.",
    riskLevel: "safe",
    capabilities: ["integration.gmail.read"],
    input_schema: {
      type: "object",
      properties: { userContextId: { type: "string" }, conversationId: { type: "string" } },
      required: ["userContextId"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const ctx = normalizeCtx(input || {});
      if (!ctx.userContextId) return toJson(buildError("gmail_capabilities", "BAD_INPUT", "Missing userContextId.", "User context is missing.", "Retry from authenticated chat.", false, [GMAIL_SCOPE_READONLY]));
      const runtime = parseRuntime(params.workspaceDir, ctx.userContextId);
      const active = activeAccount(runtime);
      const scopes = grantedScopes(runtime);
      return toJson({
        ok: true,
        kind: "gmail_capabilities",
        source: "gmail",
        data: {
          connected: runtime.connected,
          activeAccountId: runtime.activeAccountId || active?.id || "",
          email: active?.email || runtime.email,
          scopes,
          tokenConfigured: Boolean(accessToken(runtime)),
          missingScopes: missingScopes(scopes, [GMAIL_SCOPE_READONLY]),
          accounts: runtime.accounts.map((a) => ({
            id: a.id,
            email: a.email,
            enabled: a.enabled,
            scopes: a.scopes,
            hasAccessToken: Boolean(a.accessToken),
            isActive: a.id === runtime.activeAccountId,
          })),
        },
        checkedAtMs: Date.now(),
      });
    },
  };

  const listAccounts: Tool = {
    name: "gmail_list_accounts",
    description: "List Gmail accounts configured for this user context.",
    riskLevel: "safe",
    capabilities: ["integration.gmail.read"],
    input_schema: { type: "object", properties: { userContextId: { type: "string" }, conversationId: { type: "string" } }, required: ["userContextId"], additionalProperties: false },
    execute: async (input) => {
      const ctx = normalizeCtx(input || {});
      if (!ctx.userContextId) return toJson(buildError("gmail_list_accounts", "BAD_INPUT", "Missing userContextId.", "User context is missing.", "Retry from authenticated chat.", false, [GMAIL_SCOPE_READONLY]));
      const runtime = parseRuntime(params.workspaceDir, ctx.userContextId);
      if (!runtime.connected) return toJson(buildError("gmail_list_accounts", "DISCONNECTED", "Gmail disconnected.", "Gmail is disconnected.", "Connect Gmail and retry.", false, [GMAIL_SCOPE_READONLY]));
      return toJson({
        ok: true,
        kind: "gmail_list_accounts",
        source: "gmail",
        activeAccountId: runtime.activeAccountId,
        accounts: runtime.accounts.map((a) => ({
          id: a.id,
          email: a.email,
          enabled: a.enabled,
          scopes: a.scopes,
          hasAccessToken: Boolean(a.accessToken),
        })),
        checkedAtMs: Date.now(),
      });
    },
  };

  const scopeCheck: Tool = {
    name: "gmail_scope_check",
    description: "Verify a required Gmail scope is granted.",
    riskLevel: "safe",
    capabilities: ["integration.gmail.read"],
    input_schema: { type: "object", properties: { userContextId: { type: "string" }, conversationId: { type: "string" }, scope: { type: "string" } }, required: ["userContextId"], additionalProperties: false },
    execute: async (input) => {
      const ctx = normalizeCtx(input || {});
      if (!ctx.userContextId) return toJson(buildError("gmail_scope_check", "BAD_INPUT", "Missing userContextId.", "User context is missing.", "Retry from authenticated chat.", false, [GMAIL_SCOPE_READONLY]));
      const runtime = parseRuntime(params.workspaceDir, ctx.userContextId);
      const scope = toString(input.scope) || GMAIL_SCOPE_READONLY;
      const missing = missingScopes(grantedScopes(runtime), [scope]);
      if (missing.length > 0) return toJson(buildError("gmail_scope_check", "MISSING_SCOPE", `Missing scope ${scope}.`, "Required Gmail permission is missing.", `Reconnect Gmail with ${scope}.`, false, [scope]));
      return toJson({ ok: true, kind: "gmail_scope_check", source: "gmail", scope, granted: true, checkedAtMs: Date.now() });
    },
  };

  const listMessages: Tool = {
    name: "gmail_list_messages",
    description: "List recent Gmail messages.",
    riskLevel: "safe",
    capabilities: ["integration.gmail.read"],
    input_schema: { type: "object", properties: { userContextId: { type: "string" }, conversationId: { type: "string" }, query: { type: "string" }, maxResults: { type: "number" } }, required: ["userContextId"], additionalProperties: false },
    execute: async (input) => {
      const kind = "gmail_list_messages";
      const ctx = normalizeCtx(input || {});
      if (!ctx.userContextId) return toJson(buildError(kind, "BAD_INPUT", "Missing userContextId.", "User context is missing.", "Retry from authenticated chat.", false, [GMAIL_SCOPE_READONLY]));
      const runtime = parseRuntime(params.workspaceDir, ctx.userContextId);
      const ready = ensureReady(kind, runtime, [GMAIL_SCOPE_READONLY]);
      if (!ready.ok) return toJson(ready.error);
      try {
        const rows = await getMetadataMessages(ready.token, toString(input.query), toInt(input.maxResults, 10, 1, 25));
        return toJson({ ok: true, kind, source: "gmail", email: activeAccount(runtime)?.email || runtime.email, count: rows.length, messages: rows, checkedAtMs: Date.now() });
      } catch (error) {
        return toJson(mapApiError(kind, error, [GMAIL_SCOPE_READONLY]));
      }
    },
  };

  const getMessage: Tool = {
    name: "gmail_get_message",
    description: "Get one Gmail message by message ID.",
    riskLevel: "safe",
    capabilities: ["integration.gmail.read"],
    input_schema: { type: "object", properties: { userContextId: { type: "string" }, conversationId: { type: "string" }, messageId: { type: "string" } }, required: ["userContextId", "messageId"], additionalProperties: false },
    execute: async (input) => {
      const kind = "gmail_get_message";
      const ctx = normalizeCtx(input || {});
      const messageId = toString(input.messageId);
      if (!ctx.userContextId || !messageId) return toJson(buildError(kind, "BAD_INPUT", "Missing userContextId/messageId.", "Required input is missing.", "Provide a messageId and retry.", false, [GMAIL_SCOPE_READONLY]));
      const runtime = parseRuntime(params.workspaceDir, ctx.userContextId);
      const ready = ensureReady(kind, runtime, [GMAIL_SCOPE_READONLY]);
      if (!ready.ok) return toJson(ready.error);
      try {
        const row = await getMessageByIdMetadata(ready.token, messageId);
        if (!row.id) return toJson(buildError(kind, "NOT_FOUND", "Message not found.", "I couldn't find that Gmail message.", "Verify message ID and retry.", false, [GMAIL_SCOPE_READONLY]));
        return toJson({ ok: true, kind, source: "gmail", message: row, checkedAtMs: Date.now() });
      } catch (error) {
        return toJson(mapApiError(kind, error, [GMAIL_SCOPE_READONLY]));
      }
    },
  };

  const dailySummary: Tool = {
    name: "gmail_daily_summary",
    description: "Summarize daily Gmail activity and important emails.",
    riskLevel: "safe",
    capabilities: ["integration.gmail.read"],
    input_schema: { type: "object", properties: { userContextId: { type: "string" }, conversationId: { type: "string" }, timeframeHours: { type: "number" }, maxResults: { type: "number" } }, required: ["userContextId"], additionalProperties: false },
    execute: async (input) => {
      const kind = "gmail_daily_summary";
      const ctx = normalizeCtx(input || {});
      if (!ctx.userContextId) return toJson(buildError(kind, "BAD_INPUT", "Missing userContextId.", "User context is missing.", "Retry from authenticated chat.", false, [GMAIL_SCOPE_READONLY]));
      const runtime = parseRuntime(params.workspaceDir, ctx.userContextId);
      const ready = ensureReady(kind, runtime, [GMAIL_SCOPE_READONLY]);
      if (!ready.ok) return toJson(ready.error);
      const timeframeHours = toInt(input.timeframeHours, 24, 1, 72);
      const maxResults = toInt(input.maxResults, 20, 1, 30);
      try {
        const rows = await getMetadataMessages(ready.token, `newer_than:${timeframeHours}h`, maxResults);
        const enriched = rows.map((row) => {
          const labels = row.labels;
          const subject = row.subject;
          const snippet = row.snippet;
          return { ...row, importance: scoreImportance(subject, snippet, labels) };
        });
        const unread = enriched.filter((row) => row.labels.map((x) => String(x).toLowerCase()).includes("unread")).length;
        const high = enriched.filter((row) => (row.importance as { priority: string }).priority === "high");
        const top = [...enriched].sort((a, b) => Number((b.importance as { score: number }).score) - Number((a.importance as { score: number }).score)).slice(0, 8);
        return toJson({
          ok: true,
          kind,
          source: "gmail",
          timeframeHours,
          summary: `Processed ${rows.length} emails. ${unread} unread and ${high.length} high-priority.`,
          metrics: { total: rows.length, unread, highPriority: high.length },
          importantEmails: high,
          topEmails: top,
          checkedAtMs: Date.now(),
        });
      } catch (error) {
        return toJson(mapApiError(kind, error, [GMAIL_SCOPE_READONLY]));
      }
    },
  };

  const classifyImportance: Tool = {
    name: "gmail_classify_importance",
    description: "Classify importance for recent Gmail messages.",
    riskLevel: "safe",
    capabilities: ["integration.gmail.read"],
    input_schema: { type: "object", properties: { userContextId: { type: "string" }, conversationId: { type: "string" }, maxResults: { type: "number" }, query: { type: "string" } }, required: ["userContextId"], additionalProperties: false },
    execute: async (input) => {
      const kind = "gmail_classify_importance";
      const ctx = normalizeCtx(input || {});
      if (!ctx.userContextId) return toJson(buildError(kind, "BAD_INPUT", "Missing userContextId.", "User context is missing.", "Retry from authenticated chat.", false, [GMAIL_SCOPE_READONLY]));
      const runtime = parseRuntime(params.workspaceDir, ctx.userContextId);
      const ready = ensureReady(kind, runtime, [GMAIL_SCOPE_READONLY]);
      if (!ready.ok) return toJson(ready.error);
      try {
        const rows = await getMetadataMessages(ready.token, toString(input.query) || "newer_than:48h", toInt(input.maxResults, 12, 1, 25));
        const classified = rows.map((row) => {
          const labels = Array.isArray(row.labels) ? row.labels.map((x) => String(x)) : [];
          const importance = scoreImportance(String(row.subject || ""), String(row.snippet || ""), labels);
          return { ...row, priority: importance.priority, score: importance.score };
        });
        return toJson({ ok: true, kind, source: "gmail", count: classified.length, classified, checkedAtMs: Date.now() });
      } catch (error) {
        return toJson(mapApiError(kind, error, [GMAIL_SCOPE_READONLY]));
      }
    },
  };

  const forwardMessage: Tool = {
    name: "gmail_forward_message",
    description: "Forward a Gmail message to a target email.",
    riskLevel: "elevated",
    capabilities: ["integration.gmail.send"],
    input_schema: { type: "object", properties: { userContextId: { type: "string" }, conversationId: { type: "string" }, messageId: { type: "string" }, to: { type: "string" }, note: { type: "string" }, requireExplicitUserConfirm: { type: "boolean" } }, required: ["userContextId", "messageId", "to", "requireExplicitUserConfirm"], additionalProperties: false },
    execute: async (input) => {
      const kind = "gmail_forward_message";
      const ctx = normalizeCtx(input || {});
      const messageId = toString(input.messageId);
      const to = toString(input.to);
      const requireExplicitUserConfirm = input.requireExplicitUserConfirm === true;
      if (!ctx.userContextId || !messageId || !to) return toJson(buildError(kind, "BAD_INPUT", "Missing userContextId/messageId/to.", "Required input is missing.", "Provide message ID and recipient email.", false, [GMAIL_SCOPE_SEND]));
      if (!requireExplicitUserConfirm) {
        return toJson(buildError(
          kind,
          "CONFIRM_REQUIRED",
          "Forward blocked: explicit user confirmation missing.",
          "I blocked forwarding because explicit confirmation was not provided.",
          "Retry with requireExplicitUserConfirm=true after user approval.",
          false,
          [GMAIL_SCOPE_SEND],
        ));
      }
      const runtime = parseRuntime(params.workspaceDir, ctx.userContextId);
      const ready = ensureReady(kind, runtime, [GMAIL_SCOPE_SEND]);
      if (!ready.ok) return toJson(ready.error);
      try {
        const source = await getMessageByIdMetadata(ready.token, messageId);
        const subject = String(source.subject || "(no subject)");
        const forwardSubject = /^fwd:/i.test(subject) ? subject : `Fwd: ${subject}`;
        const body = [
          toString(input.note) || "Forwarding this message.",
          "",
          "---------- Forwarded message ---------",
          `From: ${String(source.from || "")}`,
          `Date: ${String(source.date || "")}`,
          `Subject: ${subject}`,
          "",
          String(source.snippet || ""),
        ].join("\r\n");
        const raw = [
          `To: ${to}`,
          `Subject: ${forwardSubject}`,
          "Content-Type: text/plain; charset=UTF-8",
          "MIME-Version: 1.0",
          "",
          body,
        ].join("\r\n");
        const sent = await gmailRequest(ready.token, "/users/me/messages/send", { method: "POST", body: { raw: b64urlEncode(raw) } }) as { id?: string; threadId?: string };
        return toJson({ ok: true, kind, source: "gmail", forwarded: { sentMessageId: toString(sent.id), threadId: toString(sent.threadId), to, subject: forwardSubject }, checkedAtMs: Date.now() });
      } catch (error) {
        return toJson(mapApiError(kind, error, [GMAIL_SCOPE_SEND]));
      }
    },
  };

  const replyDraft: Tool = {
    name: "gmail_reply_draft",
    description: "Create a Gmail draft reply for a message.",
    riskLevel: "elevated",
    capabilities: ["integration.gmail.send"],
    input_schema: { type: "object", properties: { userContextId: { type: "string" }, conversationId: { type: "string" }, messageId: { type: "string" }, replyText: { type: "string" }, requireExplicitUserConfirm: { type: "boolean" } }, required: ["userContextId", "messageId", "replyText", "requireExplicitUserConfirm"], additionalProperties: false },
    execute: async (input) => {
      const kind = "gmail_reply_draft";
      const ctx = normalizeCtx(input || {});
      const messageId = toString(input.messageId);
      const replyText = toString(input.replyText);
      const requireExplicitUserConfirm = input.requireExplicitUserConfirm === true;
      if (!ctx.userContextId || !messageId || !replyText) return toJson(buildError(kind, "BAD_INPUT", "Missing userContextId/messageId/replyText.", "Required input is missing.", "Provide message ID and reply text.", false, [GMAIL_SCOPE_COMPOSE]));
      if (!requireExplicitUserConfirm) {
        return toJson(buildError(
          kind,
          "CONFIRM_REQUIRED",
          "Draft blocked: explicit user confirmation missing.",
          "I blocked draft creation because explicit confirmation was not provided.",
          "Retry with requireExplicitUserConfirm=true after user approval.",
          false,
          [GMAIL_SCOPE_COMPOSE],
        ));
      }
      const runtime = parseRuntime(params.workspaceDir, ctx.userContextId);
      const ready = ensureReady(kind, runtime, [GMAIL_SCOPE_COMPOSE]);
      if (!ready.ok) return toJson(ready.error);
      try {
        const source = await getMessageByIdMetadata(ready.token, messageId);
        const to = String(source.replyTo || source.from || "");
        const subjectRaw = String(source.subject || "(no subject)");
        const subject = /^re:/i.test(subjectRaw) ? subjectRaw : `Re: ${subjectRaw}`;
        const messageIdHeader = String(source.messageIdHeader || "");
        const body = [replyText, "", "On previous email:", String(source.snippet || "")].join("\r\n");
        const lines = [
          `To: ${to}`,
          `Subject: ${subject}`,
          "Content-Type: text/plain; charset=UTF-8",
          "MIME-Version: 1.0",
        ];
        if (messageIdHeader) {
          lines.push(`In-Reply-To: ${messageIdHeader}`);
          lines.push(`References: ${messageIdHeader}`);
        }
        lines.push("", body);
        const draft = await gmailRequest(ready.token, "/users/me/drafts", {
          method: "POST",
          body: {
            message: {
              raw: b64urlEncode(lines.join("\r\n")),
              threadId: String(source.threadId || ""),
            },
          },
        }) as { id?: string; message?: { id?: string } };
        return toJson({
          ok: true,
          kind,
          source: "gmail",
          draft: {
            draftId: toString(draft.id),
            messageId: toString(draft.message?.id),
            to,
            subject,
          },
          checkedAtMs: Date.now(),
        });
      } catch (error) {
        return toJson(mapApiError(kind, error, [GMAIL_SCOPE_COMPOSE]));
      }
    },
  };

  return [
    capabilities,
    listAccounts,
    scopeCheck,
    listMessages,
    getMessage,
    dailySummary,
    classifyImportance,
    forwardMessage,
    replyDraft,
  ];
}
