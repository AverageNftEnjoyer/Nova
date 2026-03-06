function normalizeText(value = "", fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeRoute(value = "", fallback = "reminder") {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || fallback;
}

function normalizeBoolean(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value, fallback = {}) {
  return value && typeof value === "object" ? value : fallback;
}

export function createRemindersProviderAdapter(deps = {}) {
  return {
    id: "chat-runtime-reminders-adapter",
    providerId: "chat_runtime",
    async runReminderTurn(input = {}) {
      const executeChatRequest = typeof input.executeChatRequest === "function"
        ? input.executeChatRequest
        : deps.executeChatRequest;
      if (typeof executeChatRequest !== "function") {
        return {
          ok: false,
          code: "reminders.execute_missing",
          message: "Reminder execution requires executeChatRequest.",
          route: "reminder",
          responseRoute: "reminder",
          providerId: "chat_runtime",
          adapterId: "chat-runtime-reminders-adapter",
          toolCalls: [],
          toolExecutions: [],
          retries: [],
          telemetry: {},
          requestHints: normalizeObject(input.requestHints, {}),
        };
      }

      const text = normalizeText(input.text);
      const ctx = input.ctx && typeof input.ctx === "object" ? input.ctx : {};
      const llmCtx = input.llmCtx && typeof input.llmCtx === "object" ? input.llmCtx : {};
      const requestHints = normalizeObject(input.requestHints, {});
      const summary = await executeChatRequest(text, ctx, llmCtx, requestHints);
      const source = summary && typeof summary === "object" ? summary : { reply: summary };
      const route = normalizeRoute(source.route, "reminder");
      const responseRoute = normalizeRoute(source.responseRoute, route);
      const ok = normalizeBoolean(source.ok, true);

      return {
        ...source,
        route,
        responseRoute,
        ok,
        reply: normalizeText(source.reply),
        error: ok ? "" : normalizeText(source.error, "reminder_execution_failed"),
        code: normalizeText(source.code, ok ? "reminders.execute_ok" : "reminders.execute_failed"),
        message: normalizeText(source.message, ok ? "Reminder execution completed." : "Reminder execution failed."),
        providerId: normalizeText(source.providerId, normalizeText(llmCtx?.activeChatRuntime?.provider, "chat_runtime")),
        adapterId: "chat-runtime-reminders-adapter",
        toolCalls: normalizeArray(source.toolCalls),
        toolExecutions: normalizeArray(source.toolExecutions),
        retries: normalizeArray(source.retries),
        telemetry: normalizeObject(source.telemetry, {}),
        requestHints: normalizeObject(source.requestHints, requestHints),
      };
    },
  };
}
