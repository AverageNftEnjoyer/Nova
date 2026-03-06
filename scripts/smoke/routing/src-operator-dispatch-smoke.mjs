import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const results = [];

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

async function run(name, fn) {
  try {
    await fn();
    record("PASS", name);
  } catch (error) {
    record("FAIL", name, error instanceof Error ? error.message : String(error));
  }
}

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

const dispatchModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "operator-dispatch-routing", "index.js")).href,
);
const { routeOperatorDispatch } = dispatchModule;

await run("P24-C1 chat route delegates to chat worker path", async () => {
  const calls = [];
  const out = await routeOperatorDispatch({
    text: "hello",
    ctx: {},
    llmCtx: {},
    requestHints: { fastLaneSimpleChat: true },
    shouldRouteToSpotify: false,
    userContextId: "user-1",
    conversationId: "thread-1",
    sessionKey: "agent:nova:hud:user:user-1:dm:thread-1",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => ({ route: "chat", ok: true, reply: "ok" }),
    upsertShortTermContextState: () => {},
  });
  assert.equal(out?.route, "chat");
  assert.equal(out?.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "chat");
});

await run("P24-C2 spotify route updates short-term context on success", async () => {
  const contextUpdates = [];
  const calls = [];
  const out = await routeOperatorDispatch({
    text: "play my focus playlist",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: true,
    spotifyShortTermFollowUp: true,
    spotifyPolicy: {
      resolveTopicAffinityId: () => "spotify_focus",
    },
    spotifyShortTermContext: null,
    spotifyShortTermContextSnapshot: null,
    userContextId: "user-2",
    conversationId: "thread-2",
    sessionKey: "agent:nova:hud:user:user-2:dm:thread-2",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true, reply: "Playing now" }),
    executeChatRequest: async () => ({ route: "chat", ok: true }),
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "spotify");
  assert.equal(out?.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "spotify");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "spotify");
  assert.equal(contextUpdates[0]?.topicAffinityId, "spotify_focus");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C3 spotify route does not update context on failure", async () => {
  let updates = 0;
  const out = await routeOperatorDispatch({
    text: "spotify fail path",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: true,
    spotifyShortTermFollowUp: false,
    spotifyPolicy: null,
    spotifyShortTermContext: null,
    spotifyShortTermContextSnapshot: null,
    userContextId: "user-3",
    conversationId: "thread-3",
    sessionKey: "agent:nova:hud:user:user-3:dm:thread-3",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => {
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: false, error: "provider_unavailable" }),
    executeChatRequest: async () => ({ route: "chat", ok: true }),
    upsertShortTermContextState: () => { updates += 1; },
  });
  assert.equal(out?.route, "spotify");
  assert.equal(out?.ok, false);
  assert.equal(updates, 0);
});

await run("P24-C4 polymarket route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  let polymarketWorkerCalled = false;
  let genericCalled = false;
  const out = await routeOperatorDispatch({
    text: "show polymarket odds for election",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: true,
    polymarketShortTermFollowUp: true,
    polymarketPolicy: {
      resolveTopicAffinityId: () => "polymarket_politics",
    },
    polymarketShortTermContext: null,
    polymarketShortTermContextSnapshot: null,
    userContextId: "user-4",
    conversationId: "thread-4",
    sessionKey: "agent:nova:hud:user:user-4:dm:thread-4",
    activeChatRuntime: { provider: "grok" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    polymarketWorker: async () => {
      polymarketWorkerCalled = true;
      return { route: "polymarket", ok: true, reply: "Odds loaded." };
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => {
      genericCalled = true;
      return { route: "chat", ok: true, reply: "unexpected" };
    },
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "polymarket");
  assert.equal(out?.ok, true);
  assert.equal(polymarketWorkerCalled, true);
  assert.equal(genericCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "polymarket");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "polymarket");
  assert.equal(contextUpdates[0]?.topicAffinityId, "polymarket_politics");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C5 coinbase route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  let coinbaseWorkerCalled = false;
  const out = await routeOperatorDispatch({
    text: "refresh my coinbase balances",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: true,
    coinbaseShortTermFollowUp: true,
    coinbasePolicy: {
      resolveTopicAffinityId: () => "coinbase_portfolio",
    },
    coinbaseShortTermContext: null,
    coinbaseShortTermContextSnapshot: null,
    userContextId: "user-5",
    conversationId: "thread-5",
    sessionKey: "agent:nova:hud:user:user-5:dm:thread-5",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    coinbaseWorker: async () => {
      coinbaseWorkerCalled = true;
      return { route: "coinbase", ok: true, reply: "Balances synced." };
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => ({ route: "chat", ok: false }),
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "coinbase");
  assert.equal(out?.ok, true);
  assert.equal(coinbaseWorkerCalled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "coinbase");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "coinbase");
  assert.equal(contextUpdates[0]?.topicAffinityId, "coinbase_portfolio");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C6 gmail route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  let genericCalled = false;
  const out = await routeOperatorDispatch({
    text: "check my gmail inbox",
    ctx: {},
    llmCtx: {
      runtimeTools: {
        async executeToolUse() {
          return {
            content: JSON.stringify({
              ok: true,
              count: 1,
              messages: [{ id: "msg-1", from: "ceo@example.com", subject: "Inbox loaded" }],
            }),
          };
        },
      },
      availableTools: [{ name: "gmail_list_messages" }],
      activeChatRuntime: { provider: "claude" },
    },
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: true,
    gmailShortTermFollowUp: true,
    gmailPolicy: {
      resolveTopicAffinityId: () => "gmail_unread",
    },
    gmailShortTermContext: null,
    gmailShortTermContextSnapshot: null,
    userContextId: "user-6",
    conversationId: "thread-6",
    sessionKey: "agent:nova:hud:user:user-6:dm:thread-6",
    activeChatRuntime: { provider: "claude" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => {
      genericCalled = true;
      return { route: "gmail", ok: true, reply: "Inbox loaded." };
    },
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "gmail");
  assert.equal(out?.ok, true);
  assert.equal(genericCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "gmail");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "gmail");
  assert.equal(contextUpdates[0]?.topicAffinityId, "gmail_unread");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C7 telegram route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  let executeChatRequestCalled = false;
  let telegramWorkerCalled = false;
  const out = await routeOperatorDispatch({
    text: "send this to telegram",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: true,
    telegramShortTermFollowUp: true,
    telegramPolicy: {
      resolveTopicAffinityId: () => "telegram_send",
    },
    telegramShortTermContext: null,
    telegramShortTermContextSnapshot: null,
    userContextId: "user-7",
    conversationId: "thread-7",
    sessionKey: "agent:nova:hud:user:user-7:dm:thread-7",
    activeChatRuntime: { provider: "grok" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    telegramWorker: async () => {
      telegramWorkerCalled = true;
      return { route: "telegram", ok: true, reply: "Telegram message queued." };
    },
    executeChatRequest: async () => {
      executeChatRequestCalled = true;
      return { route: "chat", ok: true, reply: "unexpected" };
    },
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "telegram");
  assert.equal(out?.ok, true);
  assert.equal(telegramWorkerCalled, true);
  assert.equal(executeChatRequestCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "telegram");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "telegram");
  assert.equal(contextUpdates[0]?.topicAffinityId, "telegram_send");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C7b telegram route does not update short-term context on normalized worker failure", async () => {
  const contextUpdates = [];
  const out = await routeOperatorDispatch({
    text: "send this to telegram",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: true,
    telegramShortTermFollowUp: true,
    telegramPolicy: {
      resolveTopicAffinityId: () => "telegram_send",
    },
    telegramShortTermContext: null,
    telegramShortTermContextSnapshot: null,
    userContextId: "user-7b",
    conversationId: "thread-7b",
    sessionKey: "agent:nova:hud:user:user-7b:dm:thread-7b",
    activeChatRuntime: { provider: "grok" },
    delegateToOrgChartWorker: async (payload) => await payload.run(),
    telegramWorker: async () => ({
      route: "telegram",
      ok: false,
      error: "telegram.message_missing",
      errorMessage: "Telegram send command requires a message payload.",
    }),
    executeChatRequest: async () => ({ route: "chat", ok: true }),
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.ok, false);
  assert.equal(out?.error, "telegram.message_missing");
  assert.equal(contextUpdates.length, 0);
});

await run("P24-C8 discord route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  let genericCalled = false;
  let discordCalled = false;
  const out = await routeOperatorDispatch({
    text: "post this to discord",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: true,
    discordShortTermFollowUp: true,
    discordPolicy: {
      resolveTopicAffinityId: () => "discord_send",
    },
    discordShortTermContext: null,
    discordShortTermContextSnapshot: null,
    userContextId: "user-8",
    conversationId: "thread-8",
    sessionKey: "agent:nova:hud:user:user-8:dm:thread-8",
    activeChatRuntime: { provider: "claude" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    discordWorker: async () => {
      discordCalled = true;
      return { route: "discord", ok: true, reply: "Discord post queued." };
    },
    executeChatRequest: async () => {
      genericCalled = true;
      return { route: "chat", ok: true, reply: "generic" };
    },
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "discord");
  assert.equal(out?.ok, true);
  assert.equal(discordCalled, true);
  assert.equal(genericCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "discord");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "discord");
  assert.equal(contextUpdates[0]?.topicAffinityId, "discord_send");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C8b discord route does not persist context when domain execution fails", async () => {
  const contextUpdates = [];
  const out = await routeOperatorDispatch({
    text: "post this to discord",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: true,
    discordShortTermFollowUp: true,
    discordPolicy: {
      resolveTopicAffinityId: () => "discord_send",
    },
    discordShortTermContext: null,
    discordShortTermContextSnapshot: null,
    userContextId: "user-8b",
    conversationId: "thread-8b",
    sessionKey: "agent:nova:hud:user:user-8b:dm:thread-8b",
    activeChatRuntime: { provider: "claude" },
    delegateToOrgChartWorker: async (payload) => await payload.run(),
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    discordWorker: async () => ({ route: "discord", ok: false, error: "discord_delivery_all_failed" }),
    executeChatRequest: async () => ({ route: "chat", ok: true }),
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "discord");
  assert.equal(out?.ok, false);
  assert.equal(contextUpdates.length, 0);
});

await run("P24-C9 calendar route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  const out = await routeOperatorDispatch({
    text: "show my calendar for tomorrow",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: false,
    shouldRouteToCalendar: true,
    calendarShortTermFollowUp: true,
    calendarPolicy: {
      resolveTopicAffinityId: () => "calendar_agenda",
    },
    calendarShortTermContext: null,
    calendarShortTermContextSnapshot: null,
    userContextId: "user-9",
    conversationId: "thread-9",
    sessionKey: "agent:nova:hud:user:user-9:dm:thread-9",
    activeChatRuntime: { provider: "gemini" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => ({ route: "calendar", ok: true, reply: "Calendar loaded." }),
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "calendar");
  assert.equal(out?.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "calendar");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "calendar");
  assert.equal(contextUpdates[0]?.topicAffinityId, "calendar_agenda");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C10 reminders route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  const out = await routeOperatorDispatch({
    text: "set a reminder for 5pm",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: false,
    shouldRouteToCalendar: false,
    shouldRouteToReminders: true,
    remindersShortTermFollowUp: true,
    remindersPolicy: {
      resolveTopicAffinityId: () => "reminder_create",
    },
    remindersShortTermContext: null,
    remindersShortTermContextSnapshot: null,
    userContextId: "user-10",
    conversationId: "thread-10",
    sessionKey: "agent:nova:hud:user:user-10:dm:thread-10",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => ({ route: "reminder", ok: true, reply: "Reminder created." }),
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "reminder");
  assert.equal(out?.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "reminder");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "reminders");
  assert.equal(contextUpdates[0]?.topicAffinityId, "reminder_create");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C11 web research route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  let genericCalled = false;
  const out = await routeOperatorDispatch({
    text: "research latest AI safety papers with citations",
    ctx: {},
    llmCtx: {
      runtimeTools: {
        async executeToolUse() {
          return {
            content: "[1] AI Safety Source\nhttps://example.com/safety\nSummary line.",
          };
        },
      },
      availableTools: [{ name: "web_search" }],
    },
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: false,
    shouldRouteToCalendar: false,
    shouldRouteToReminders: false,
    shouldRouteToWebResearch: true,
    webResearchShortTermFollowUp: true,
    webResearchPolicy: {
      resolveTopicAffinityId: () => "web_research_citations",
    },
    webResearchShortTermContext: null,
    webResearchShortTermContextSnapshot: null,
    userContextId: "user-11",
    conversationId: "thread-11",
    sessionKey: "agent:nova:hud:user:user-11:dm:thread-11",
    activeChatRuntime: { provider: "claude" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => {
      genericCalled = true;
      return { route: "chat", ok: true, reply: "unexpected" };
    },
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "web_research");
  assert.equal(out?.ok, true);
  assert.equal(out?.provider, "web_search");
  assert.equal(genericCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "web_research");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "web_research");
  assert.equal(contextUpdates[0]?.topicAffinityId, "web_research_citations");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
  assert.equal(out?.requestHints?.operatorLane?.executorKind, "web_research");
  assert.equal(out?.requestHints?.forceWebSearchPreload, true);
  assert.equal(out?.requestHints?.forceWebFetchPreload, true);
});

await run("P24-C12 crypto route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  let cryptoWorkerCalled = false;
  const out = await routeOperatorDispatch({
    text: "show crypto prices",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: false,
    shouldRouteToCalendar: false,
    shouldRouteToReminders: false,
    shouldRouteToWebResearch: false,
    shouldRouteToCrypto: true,
    cryptoShortTermFollowUp: true,
    cryptoPolicy: {
      resolveTopicAffinityId: () => "crypto_price",
    },
    cryptoShortTermContext: null,
    cryptoShortTermContextSnapshot: null,
    userContextId: "user-12",
    conversationId: "thread-12",
    sessionKey: "agent:nova:hud:user:user-12:dm:thread-12",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    cryptoWorker: async () => {
      cryptoWorkerCalled = true;
      return { route: "crypto", ok: true, reply: "Crypto snapshot ready." };
    },
    executeChatRequest: async () => ({ route: "chat", ok: false, reply: "" }),
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "crypto");
  assert.equal(out?.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(cryptoWorkerCalled, true);
  assert.equal(calls[0]?.routeHint, "crypto");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "crypto");
  assert.equal(contextUpdates[0]?.topicAffinityId, "crypto_price");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C13 market route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  let weatherCalled = false;
  const out = await routeOperatorDispatch({
    text: "weather in nyc",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: false,
    shouldRouteToCalendar: false,
    shouldRouteToReminders: false,
    shouldRouteToWebResearch: false,
    shouldRouteToCrypto: false,
    shouldRouteToMarket: true,
    marketShortTermFollowUp: true,
    marketPolicy: {
      resolveTopicAffinityId: () => "market_weather",
    },
    marketShortTermContext: null,
    marketShortTermContextSnapshot: null,
    userContextId: "user-13",
    conversationId: "thread-13",
    sessionKey: "agent:nova:hud:user:user-13:dm:thread-13",
    activeChatRuntime: { provider: "gemini" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    weatherWorker: async () => {
      weatherCalled = true;
      return { route: "weather", ok: true, reply: "Weather loaded." };
    },
    executeChatRequest: async () => ({ route: "chat", ok: false }),
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "weather");
  assert.equal(out?.ok, true);
  assert.equal(weatherCalled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "weather");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "market");
  assert.equal(contextUpdates[0]?.topicAffinityId, "market_weather");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C13a market route keeps weather dispatch when short-term market context is weather", async () => {
  const calls = [];
  let weatherCalled = false;
  let marketCalled = false;
  const out = await routeOperatorDispatch({
    text: "refresh",
    ctx: {},
    llmCtx: { turnPolicy: { weatherIntent: false } },
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: false,
    shouldRouteToCalendar: false,
    shouldRouteToReminders: false,
    shouldRouteToWebResearch: false,
    shouldRouteToCrypto: false,
    shouldRouteToMarket: true,
    marketShortTermFollowUp: true,
    marketPolicy: {
      resolveTopicAffinityId: () => "market_weather",
    },
    marketShortTermContext: { topicAffinityId: "market_weather" },
    marketShortTermContextSnapshot: null,
    userContextId: "user-13a",
    conversationId: "thread-13a",
    sessionKey: "agent:nova:hud:user:user-13a:dm:thread-13a",
    activeChatRuntime: { provider: "gemini" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    weatherWorker: async () => {
      weatherCalled = true;
      return { route: "weather", ok: true, reply: "Weather refreshed." };
    },
    marketWorker: async () => {
      marketCalled = true;
      return { route: "market", ok: true, reply: "unexpected" };
    },
    executeChatRequest: async () => ({ route: "chat", ok: false }),
    upsertShortTermContextState: () => {},
  });
  assert.equal(out?.route, "weather");
  assert.equal(out?.ok, true);
  assert.equal(weatherCalled, true);
  assert.equal(marketCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "weather");
});

await run("P24-C13b non-weather market route delegates through dedicated market worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  let marketCalled = false;
  let weatherCalled = false;
  let genericCalled = false;
  const out = await routeOperatorDispatch({
    text: "show stock market trend today",
    ctx: {},
    llmCtx: { turnPolicy: { weatherIntent: false } },
    requestHints: { marketTopicAffinityId: "market_equities" },
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: false,
    shouldRouteToCalendar: false,
    shouldRouteToReminders: false,
    shouldRouteToWebResearch: false,
    shouldRouteToCrypto: false,
    shouldRouteToMarket: true,
    marketShortTermFollowUp: true,
    marketPolicy: {
      resolveTopicAffinityId: () => "market_equities",
    },
    marketShortTermContext: null,
    marketShortTermContextSnapshot: null,
    userContextId: "user-13b",
    conversationId: "thread-13b",
    sessionKey: "agent:nova:hud:user:user-13b:dm:thread-13b",
    activeChatRuntime: { provider: "gemini" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    marketWorker: async () => {
      marketCalled = true;
      return { route: "market", ok: true, reply: "Market loaded." };
    },
    weatherWorker: async () => {
      weatherCalled = true;
      return { route: "weather", ok: true, reply: "unexpected" };
    },
    executeChatRequest: async () => {
      genericCalled = true;
      return { route: "chat", ok: true, reply: "unexpected" };
    },
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "market");
  assert.equal(out?.ok, true);
  assert.equal(marketCalled, true);
  assert.equal(weatherCalled, false);
  assert.equal(genericCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "market");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "market");
  assert.equal(contextUpdates[0]?.topicAffinityId, "market_equities");
  assert.equal(contextUpdates[0]?.slots?.lastRoute, "market");
});

await run("P24-C14 files route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  let genericCalled = false;
  const out = await routeOperatorDispatch({
    text: "list files in workspace",
    ctx: {},
    llmCtx: {
      runtimeTools: {
        async executeToolUse() {
          return { content: "f README.md\nf package.json\nd src" };
        },
      },
      availableTools: [{ name: "ls" }],
    },
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: false,
    shouldRouteToCalendar: false,
    shouldRouteToReminders: false,
    shouldRouteToWebResearch: false,
    shouldRouteToCrypto: false,
    shouldRouteToMarket: false,
    shouldRouteToFiles: true,
    filesShortTermFollowUp: true,
    filesPolicy: {
      resolveTopicAffinityId: () => "files_search",
    },
    filesShortTermContext: null,
    filesShortTermContextSnapshot: null,
    userContextId: "user-14",
    conversationId: "thread-14",
    sessionKey: "agent:nova:hud:user:user-14:dm:thread-14",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => {
      genericCalled = true;
      return { route: "chat", ok: true, reply: "unexpected" };
    },
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "files");
  assert.equal(out?.ok, true);
  assert.equal(out?.provider, "tool_runtime");
  assert.equal(genericCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "files");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "files");
  assert.equal(contextUpdates[0]?.topicAffinityId, "files_search");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C15 diagnostics route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  const out = await routeOperatorDispatch({
    text: "run diagnostics",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: false,
    shouldRouteToCalendar: false,
    shouldRouteToReminders: false,
    shouldRouteToWebResearch: false,
    shouldRouteToCrypto: false,
    shouldRouteToMarket: false,
    shouldRouteToFiles: false,
    shouldRouteToDiagnostics: true,
    diagnosticsShortTermFollowUp: true,
    diagnosticsPolicy: {
      resolveTopicAffinityId: () => "diagnostics_latency",
    },
    diagnosticsShortTermContext: null,
    diagnosticsShortTermContextSnapshot: null,
    userContextId: "user-15",
    conversationId: "thread-15",
    sessionKey: "agent:nova:hud:user:user-15:dm:thread-15",
    activeChatRuntime: { provider: "claude" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => ({ route: "diagnostic", ok: true, reply: "Diagnostics complete." }),
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "diagnostic");
  assert.equal(out?.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "diagnostic");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "diagnostics");
  assert.equal(contextUpdates[0]?.topicAffinityId, "diagnostics_latency");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C16 voice route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  let genericCalled = false;
  let voiceWorkerCalled = false;
  const out = await routeOperatorDispatch({
    text: "mute voice",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: false,
    shouldRouteToCalendar: false,
    shouldRouteToReminders: false,
    shouldRouteToWebResearch: false,
    shouldRouteToCrypto: false,
    shouldRouteToMarket: false,
    shouldRouteToFiles: false,
    shouldRouteToDiagnostics: false,
    shouldRouteToVoice: true,
    voiceShortTermFollowUp: true,
    voicePolicy: {
      resolveTopicAffinityId: () => "voice_mute_toggle",
    },
    voiceShortTermContext: null,
    voiceShortTermContextSnapshot: null,
    userContextId: "user-16",
    conversationId: "thread-16",
    sessionKey: "agent:nova:hud:user:user-16:dm:thread-16",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    voiceWorker: async () => {
      voiceWorkerCalled = true;
      return { route: "voice", ok: true, reply: "Voice settings updated." };
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => {
      genericCalled = true;
      return { route: "chat", ok: true, reply: "unexpected" };
    },
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "voice");
  assert.equal(out?.ok, true);
  assert.equal(voiceWorkerCalled, true);
  assert.equal(genericCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "voice");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "voice");
  assert.equal(contextUpdates[0]?.topicAffinityId, "voice_mute_toggle");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C17 tts route delegates through org-chart worker and updates context", async () => {
  const calls = [];
  const contextUpdates = [];
  let genericCalled = false;
  let ttsWorkerCalled = false;
  const out = await routeOperatorDispatch({
    text: "read this aloud",
    ctx: {},
    llmCtx: {},
    requestHints: {},
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: false,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: false,
    shouldRouteToCalendar: false,
    shouldRouteToReminders: false,
    shouldRouteToWebResearch: false,
    shouldRouteToCrypto: false,
    shouldRouteToMarket: false,
    shouldRouteToFiles: false,
    shouldRouteToDiagnostics: false,
    shouldRouteToVoice: false,
    shouldRouteToTts: true,
    ttsShortTermFollowUp: true,
    ttsPolicy: {
      resolveTopicAffinityId: () => "tts_read_aloud",
    },
    ttsShortTermContext: null,
    ttsShortTermContextSnapshot: null,
    userContextId: "user-17",
    conversationId: "thread-17",
    sessionKey: "agent:nova:hud:user:user-17:dm:thread-17",
    activeChatRuntime: { provider: "claude" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    ttsWorker: async () => {
      ttsWorkerCalled = true;
      return { route: "tts", ok: true, reply: "Reading aloud now." };
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => {
      genericCalled = true;
      return { route: "chat", ok: true, reply: "unexpected" };
    },
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "tts");
  assert.equal(out?.ok, true);
  assert.equal(ttsWorkerCalled, true);
  assert.equal(genericCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "tts");
  assert.equal(contextUpdates.length, 1);
  assert.equal(contextUpdates[0]?.domainId, "tts");
  assert.equal(contextUpdates[0]?.topicAffinityId, "tts_read_aloud");
  assert.equal(contextUpdates[0]?.slots?.followUpResolved, true);
});

await run("P24-C18 default worker lanes receive operator lane request hints without mutating input hints", async () => {
  const calls = [];
  const contextUpdates = [];
  const baseRequestHints = { fastLaneSimpleChat: false };
  const out = await routeOperatorDispatch({
    text: "show gmail inbox",
    ctx: {},
    llmCtx: {
      runtimeTools: {
        async executeToolUse() {
          return {
            content: JSON.stringify({
              ok: true,
              count: 1,
              messages: [{ id: "msg-1", from: "ceo@example.com", subject: "Gmail routed" }],
            }),
          };
        },
      },
      availableTools: [{ name: "gmail_list_messages" }],
      activeChatRuntime: { provider: "openai" },
    },
    requestHints: baseRequestHints,
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: true,
    shouldRouteToTelegram: false,
    shouldRouteToDiscord: false,
    shouldRouteToCalendar: false,
    shouldRouteToReminders: false,
    shouldRouteToWebResearch: false,
    shouldRouteToCrypto: false,
    shouldRouteToMarket: false,
    shouldRouteToFiles: false,
    shouldRouteToDiagnostics: false,
    shouldRouteToVoice: false,
    shouldRouteToTts: false,
    gmailShortTermFollowUp: false,
    gmailPolicy: null,
    gmailShortTermContext: null,
    gmailShortTermContextSnapshot: null,
    userContextId: "user-18",
    conversationId: "thread-18",
    sessionKey: "agent:nova:hud:user:user-18:dm:thread-18",
    activeChatRuntime: { provider: "openai" },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    spotifyWorker: async () => ({ route: "spotify", ok: true }),
    executeChatRequest: async () => ({ route: "gmail", ok: true, reply: "unexpected" }),
    upsertShortTermContextState: (payload) => contextUpdates.push(payload),
  });
  assert.equal(out?.route, "gmail");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.routeHint, "gmail");
  assert.equal(out?.requestHints?.operatorLane?.id, "gmail");
  assert.equal(out?.requestHints?.operatorLane?.domainId, "gmail");
  assert.equal("operatorLane" in baseRequestHints, false);
  assert.equal(contextUpdates.length, 1);
});

await run("P24-C19 policy gate signal is forwarded with persisted approval grant consumption", async () => {
  const calls = [];
  let consumeCalls = 0;
  const out = await routeOperatorDispatch({
    text: "gmail status",
    ctx: {},
    llmCtx: {
      runtimeTools: {
        async executeToolUse() {
          return { content: JSON.stringify({ ok: true, data: { connected: true, email: "user@example.com", scopes: [], missingScopes: [] } }) };
        },
      },
      availableTools: [{ name: "gmail_capabilities" }],
      activeChatRuntime: { provider: "claude" },
    },
    requestHints: {
      enforcePolicyGate: true,
    },
    shouldRouteToSpotify: false,
    shouldRouteToYouTube: false,
    shouldRouteToPolymarket: false,
    shouldRouteToCoinbase: false,
    shouldRouteToGmail: true,
    gmailShortTermFollowUp: false,
    gmailPolicy: null,
    gmailShortTermContext: null,
    gmailShortTermContextSnapshot: null,
    userContextId: "user-19",
    conversationId: "thread-19",
    sessionKey: "agent:nova:hud:user:user-19:dm:thread-19",
    activeChatRuntime: { provider: "claude" },
    consumePolicyApprovalGrant: () => {
      consumeCalls += 1;
      return true;
    },
    delegateToOrgChartWorker: async (payload) => {
      calls.push(payload);
      return await payload.run();
    },
    executeChatRequest: async () => ({ route: "gmail", ok: true, reply: "unexpected" }),
    upsertShortTermContextState: () => {},
  });

  assert.equal(out?.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(consumeCalls, 1);
  assert.equal(calls[0]?.policyGate?.enabled, true);
  assert.equal(calls[0]?.policyGate?.approvalGranted, true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);
if (failCount > 0) process.exit(1);
