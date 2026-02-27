import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const nativeRequire = createRequire(import.meta.url);
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

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function transpileSource(relativePath) {
  return ts.transpileModule(read(relativePath), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: path.basename(relativePath),
  }).outputText;
}

function loadModule(relativePath, requireMap = {}, extraGlobals = {}) {
  const compiled = transpileSource(relativePath);
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier in requireMap) return requireMap[specifier];
      if (specifier === "server-only") return {};
      return nativeRequire(specifier);
    },
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    ...extraGlobals,
  };
  vm.runInNewContext(compiled, sandbox, { filename: `${relativePath}.cjs` });
  return module.exports;
}

const cleaningModuleStub = {
  cleanText: (value) => String(value || "").trim(),
  normalizeSnippetText: (value, max = 320) => String(value || "").trim().slice(0, max),
  normalizeSourceSnippet: (_title, snippet) => String(snippet || "").trim(),
  parseJsonObject: (text) => {
    const raw = String(text || "").trim();
    if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
};

const formattingModuleStub = {
  extractFactSentences: () => [],
  formatNotificationText: (value) => String(value || "").trim(),
};

const pathsModuleStub = {
  toNumberSafe: (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
};

const sourcesModuleStub = {
  collectSourceUrlsFromContextData: () => [],
  formatSourceButtons: (urls) => String((urls || []).join(", ")),
  normalizeMissionSourcePresentation: (text) => String(text || "").trim(),
  uniqueSourceUrls: (urls, max = 2) => Array.from(new Set((urls || []).filter(Boolean))).slice(0, max),
};

const formattersModule = loadModule("hud/lib/missions/output/formatters.ts", {
  "../text/cleaning": cleaningModuleStub,
  "../text/formatting": formattingModuleStub,
  "../utils/paths": pathsModuleStub,
  "./sources": sourcesModuleStub,
});

const contractModule = loadModule("hud/lib/missions/output/contract.ts", {
  "../text/formatting": formattingModuleStub,
  "../text/cleaning": cleaningModuleStub,
  "./formatters": formattersModule,
});
const briefingQualityModule = loadModule("hud/lib/missions/output/briefing-quality.ts", {});
const briefingModule = loadModule("hud/lib/missions/output/briefing-presenter.ts", {
  "./briefing-quality": briefingQualityModule,
});
let latestBriefingPreview = "";
const realUserContextId = process.env.NOVA_SMOKE_USER_CONTEXT_ID || "dd5ea07a-b92e-4ce8-a5f9-fe229168c80f";

await run("P27-C1 formatter converts Coinbase JSON payload into readable text (no raw object dump)", async () => {
  const payload = {
    ok: true,
    source: "coinbase",
    primitive: "price_alert_digest",
    checkedAtIso: "2026-02-23T21:19:06.800Z",
    quoteCurrency: "USD",
    assets: ["ETH", "SUI"],
    prices: [
      { baseAsset: "ETH", price: 1866.765, deltaPct: 1.25 },
      { baseAsset: "SUI", price: 0.8767, deltaPct: -0.3 },
    ],
    portfolio: {
      balances: [
        { assetSymbol: "SUI", total: 124.8 },
      ],
    },
  };
  const text = formattersModule.formatStructuredMissionOutput(JSON.stringify(payload));
  assert.equal(typeof text, "string");
  assert.equal(text.startsWith("{"), false);
  assert.equal(text.includes("Coinbase Price Alert Digest"), true);
  assert.equal(text.includes("ETH"), true);
  assert.equal(text.includes("SUI"), true);
});

await run("P27-C2 large portfolio input is bounded and suppresses zero-balance spam", async () => {
  const balances = [];
  for (let index = 0; index < 240; index += 1) {
    balances.push({ assetSymbol: `ASSET${index}`, total: index % 11 === 0 ? index + 0.125 : 0 });
  }
  const payload = {
    ok: true,
    source: "coinbase",
    primitive: "price_alert_digest",
    checkedAtIso: "2026-02-23T21:19:06.800Z",
    quoteCurrency: "USD",
    assets: ["ETH", "SUI"],
    prices: [
      { baseAsset: "ETH", price: 1866.765 },
      { baseAsset: "SUI", price: 0.8767 },
    ],
    includePortfolio: true,
    portfolio: { balances },
  };
  const enforced = contractModule.enforceMissionOutputContract({
    channel: "telegram",
    text: JSON.stringify(payload),
    userContextId: "smoke-user-alpha",
    missionId: "mission-p27",
    missionRunId: "run-p27",
    nodeId: "telegram-output-1",
  });
  assert.equal(typeof enforced.text, "string");
  assert.equal(enforced.text.length <= 3600, true);
  assert.equal(enforced.text.includes("ASSET230 ("), false);
  assert.equal(enforced.text.includes("ASSET231 ("), true);
});

await run("P27-C3 integration: Telegram dispatch receives readable bounded Coinbase message", async () => {
  const captured = [];
  const dispatchModule = loadModule("hud/lib/missions/output/dispatch.ts", {
    "@/lib/notifications/dispatcher": {
      dispatchNotification: async (input) => {
        captured.push(input);
        return [{ ok: true, status: 200 }];
      },
    },
    "@/lib/telegram/pending-messages": {
      addPendingMessage: async () => undefined,
    },
    "@/lib/integrations/server-store": {},
    "../web/safe-fetch": {
      fetchWithSsrfGuard: async () => ({
        response: { ok: true, status: 200 },
      }),
    },
    "../text/formatting": formattingModuleStub,
    "../types": {},
    "./contract": contractModule,
  });

  const payload = {
    ok: true,
    source: "coinbase",
    primitive: "price_alert_digest",
    checkedAtIso: "2026-02-23T21:19:06.800Z",
    quoteCurrency: "USD",
    assets: ["ETH", "SUI"],
    prices: [
      { baseAsset: "ETH", price: 1866.765, deltaPct: 1.25 },
      { baseAsset: "SUI", price: 0.8767, deltaPct: -0.3 },
    ],
    portfolio: {
      balances: Array.from({ length: 300 }, (_, i) => ({ assetSymbol: `COIN${i}`, total: i % 31 === 0 ? i + 0.1 : 0 })),
    },
  };

  const schedule = {
    id: "mission-p27",
    userId: realUserContextId,
    label: "Morning Mission",
    integration: "telegram",
    chatIds: ["chat-alpha"],
    timezone: "America/New_York",
    message: "",
    time: "09:00",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runCount: 0,
    successCount: 0,
    failureCount: 0,
  };

  const result = await dispatchModule.dispatchOutput(
    "telegram",
    JSON.stringify(payload),
    ["chat-alpha"],
    schedule,
    { userId: realUserContextId },
    { missionRunId: "run-p27", nodeId: "telegram-node-1", outputIndex: 0 },
  );

  assert.equal(Array.isArray(result), true);
  assert.equal(result[0]?.ok, true);
  assert.equal(captured.length, 1);
  const sentText = String(captured[0].text || "");
  assert.equal(sentText.startsWith("{"), false);
  assert.equal(sentText.includes("Coinbase Price Alert Digest"), true);
  assert.equal(sentText.length <= 3600, true);
});

await run("P27-C4 auth/internal Coinbase notes are stripped from user-visible message", async () => {
  const payload = {
    ok: true,
    source: "coinbase",
    primitive: "price_alert_digest",
    checkedAtIso: "2026-02-23T21:19:06.800Z",
    quoteCurrency: "USD",
    assets: ["ETH", "SUI"],
    prices: [
      { baseAsset: "ETH", price: 1866.765 },
      { baseAsset: "SUI", price: 0.8767 },
    ],
    notes: [
      "Coinbase private account data unavailable: /api/v3/brokerage/orders/historical/fills failed (401) [auth=jwt_bearer]: Unauthorized",
    ],
  };
  const guarded = contractModule.enforceMissionOutputContract({
    channel: "telegram",
    text: JSON.stringify(payload),
    userContextId: "smoke-user-alpha",
    missionId: "mission-p27",
    missionRunId: "run-p27",
    nodeId: "telegram-output-4",
  });
  assert.equal(guarded.text.includes("Unauthorized"), false);
  assert.equal(guarded.text.includes("jwt_bearer"), false);
  assert.equal(guarded.text.includes("private account data"), false);
});

await run("P27-U1 NBA parser strips noisy non-score text and keeps clean final score rows only", async () => {
  const output = {
    ok: true,
    text: [
      "NBA live blog - play-by-play and highlights",
      "Lakers 112-109 Celtics Final",
      "Read more: example.com/story",
      "Warriors 121, Suns 118 final",
      "SEO text and recap snippets",
    ].join("\n"),
  };
  const rows = briefingQualityModule.extractNbaFinalScores(output, 4);
  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length >= 2, true);
  assert.equal(rows.some((row) => /play-by-play/i.test(row)), false);
  assert.equal(rows.some((row) => /read more/i.test(row)), false);
});

await run("P27-U2 quote validator rejects listicle/headline content", async () => {
  const valid = briefingQualityModule.isValidInspirationalQuote(
    "Success is the sum of small efforts repeated day in and day out.",
    "Robert Collier",
  );
  const invalid = briefingQualityModule.isValidInspirationalQuote(
    "Top 50 inspirational quotes for work in 2026",
    "Read more",
  );
  assert.equal(valid, true);
  assert.equal(invalid, false);
});

await run("P27-C5 integration full morning briefing includes 4 required section headers in order", async () => {
  const mission = {
    id: "mission-morning",
    userId: "smoke-user-brief",
    label: "Morning Briefing",
    description: "NBA recap quote ETH SUI tech story",
    category: "finance",
    tags: ["briefing"],
    status: "active",
    version: 1,
    nodes: [
      { id: "n1", type: "web-search", label: "Fetch NBA Scores", query: "NBA scores", x: 0, y: 0 },
      { id: "n2", type: "web-search", label: "Fetch Today's Quote", query: "quote of the day", x: 0, y: 0 },
      { id: "n3", type: "coinbase", label: "Fetch crypto prices from Coinbase", intent: "price", x: 0, y: 0 },
      { id: "n4", type: "web-search", label: "Fetch Tech News", query: "top tech story", x: 0, y: 0 },
    ],
    connections: [],
    variables: [],
    settings: {
      timezone: "America/New_York",
      retryOnFail: false,
      retryCount: 2,
      retryIntervalMs: 5000,
      saveExecutionProgress: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    integration: "telegram",
    chatIds: ["chat-alpha"],
  };

  const nodeOutputs = new Map([
    ["n1", { ok: true, text: "Lakers 112-109 Celtics final", data: { results: [{ title: "Lakers edge Celtics 112-109", snippet: "Late three seals it in final minute." }] } }],
    ["n2", { ok: true, text: "\"Success is the sum of small efforts repeated day in and day out.\" - Robert Collier", data: { results: [{ title: "Quote of the Day", snippet: "\"Success is the sum of small efforts repeated day in and day out.\" - Robert Collier" }] } }],
    ["n3", { ok: true, text: "Coinbase Price Alert Digest", data: { checkedAtIso: "2026-02-23T21:19:06.800Z", prices: [{ baseAsset: "ETH", price: 1866.765 }, { baseAsset: "SUI", price: 0.8767 }] } }],
    ["n4", { ok: true, text: "Tech headline", data: { results: [{ title: "Open-source model cuts inference costs", snippet: "Why it matters: cheaper inference broadens enterprise deployment." }] } }],
  ]);

  const briefing = briefingModule.buildDeterministicMorningBriefing({ mission, nodeOutputs });
  assert.equal(typeof briefing, "string");
  assert.equal(String(briefing).includes("**NBA RECAP**"), true);
  assert.equal(String(briefing).includes("**INSPIRATIONAL QUOTE**"), true);
  assert.equal(String(briefing).includes("**CRYPTO PRICES (USD)**"), true);
  assert.equal(String(briefing).includes("**TOP TECH STORY**"), true);
  const order = [
    String(briefing).indexOf("**NBA RECAP**"),
    String(briefing).indexOf("**INSPIRATIONAL QUOTE**"),
    String(briefing).indexOf("**CRYPTO PRICES (USD)**"),
    String(briefing).indexOf("**TOP TECH STORY**"),
  ];
  assert.equal(order.every((idx) => idx >= 0), true);
  assert.equal(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], true);
  latestBriefingPreview = String(briefing);
});

await run("P27-C6 integration Coinbase 401/private failure still yields valid briefing prices", async () => {
  const mission = {
    id: "mission-morning-401",
    userId: "smoke-user-brief",
    label: "Morning Briefing",
    description: "weekday morning briefing",
    category: "finance",
    tags: ["briefing"],
    status: "active",
    version: 1,
    nodes: [
      { id: "n1", type: "web-search", label: "Fetch NBA Scores", query: "NBA recap", x: 0, y: 0 },
      { id: "n2", type: "web-search", label: "Fetch Quote", query: "inspirational quote", x: 0, y: 0 },
      { id: "n3", type: "coinbase", label: "Fetch crypto prices from Coinbase", intent: "price", x: 0, y: 0 },
      { id: "n4", type: "web-search", label: "Fetch Tech News", query: "top tech headline", x: 0, y: 0 },
    ],
    connections: [],
    variables: [],
    settings: {
      timezone: "America/New_York",
      retryOnFail: false,
      retryCount: 2,
      retryIntervalMs: 5000,
      saveExecutionProgress: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    integration: "telegram",
    chatIds: ["chat-alpha"],
  };

  const nodeOutputs = new Map([
    ["n1", { ok: true, text: "No NBA games were played last night.", data: { results: [{ title: "No NBA games were played last night.", snippet: "" }] } }],
    ["n2", { ok: true, text: "\"The best way out is always through.\" - Robert Frost" }],
    ["n3", { ok: true, text: "Coinbase Price Alert Digest", data: { checkedAtIso: "2026-02-23T21:19:06.800Z", prices: [{ baseAsset: "ETH", price: 1866.765 }, { baseAsset: "SUI", price: 0.8767 }], notes: ["Coinbase private account data unavailable: Unauthorized (401)"] } }],
    ["n4", { ok: true, text: "Tech story", data: { results: [{ title: "Chip startup ships lower-power server silicon", snippet: "Lower power and cost can accelerate data center adoption." }] } }],
  ]);

  const briefing = briefingModule.buildDeterministicMorningBriefing({ mission, nodeOutputs });
  assert.equal(typeof briefing, "string");
  assert.equal(String(briefing).includes("ETH:"), true);
  assert.equal(String(briefing).includes("SUI:"), true);
  assert.equal(String(briefing).includes("Unauthorized"), false);
  assert.equal(String(briefing).includes("private account data"), false);
});

await run("P27-C7 noisy raw fetch blobs still render clean sectioned briefing", async () => {
  const mission = {
    id: "mission-morning-noisy",
    userId: "smoke-user-brief",
    label: "Morning Briefing",
    description: "weekday morning briefing",
    category: "finance",
    tags: ["briefing"],
    status: "active",
    version: 1,
    nodes: [
      { id: "n1", type: "web-search", label: "Fetch NBA Scores", query: "NBA recap", x: 0, y: 0 },
      { id: "n2", type: "web-search", label: "Fetch Motivational Brief", query: "motivational quote", x: 0, y: 0 },
      { id: "n3", type: "coinbase", label: "Fetch crypto prices from Coinbase", intent: "price", x: 0, y: 0 },
      { id: "n4", type: "web-search", label: "Fetch Tech News", query: "top tech headline", x: 0, y: 0 },
    ],
    connections: [],
    variables: [],
    settings: {
      timezone: "America/New_York",
      retryOnFail: false,
      retryCount: 2,
      retryIntervalMs: 5000,
      saveExecutionProgress: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    integration: "telegram",
    chatIds: ["chat-alpha"],
  };

  const nodeOutputs = new Map([
    ["n1", {
      ok: true,
      text: "Celtics 111-89 Lakers Final Score - ESPN According to ESPN Analytics - Luka Doncic misses 17-foot step back jumpshot",
      data: {
        results: [
          {
            title: "Celtics 111-89 Lakers (Feb 22, 2026) Final Score - ESPN",
            snippet: "According to ESPN Analytics play-by-play and live updates",
          },
        ],
      },
    }],
    ["n2", {
      ok: true,
      text: "365 Inspiring, Poignant, and Just Plain Great Quotes for 2026",
      data: {
        results: [
          { title: "365 Inspiring Quotes for 2026", snippet: "Top 365 listicle collection of quotes." },
        ],
      },
    }],
    ["n3", {
      ok: true,
      data: {
        checkedAtIso: "2026-02-23T21:19:06.800Z",
        prices: [{ baseAsset: "ETH", price: 1866.765 }, { baseAsset: "SUI", price: 0.8767 }],
        notes: ["Coinbase private account data unavailable: Unauthorized (401)"],
      },
      text: "Coinbase Price Alert Digest",
    }],
    ["n4", {
      ok: true,
      data: {
        results: [{ title: "Open-source model cuts inference costs", snippet: "Why it matters: lower infra spend." }],
      },
      text: "Tech story",
    }],
  ]);

  const briefing = briefingModule.buildDeterministicMorningBriefing({ mission, nodeOutputs });
  assert.equal(typeof briefing, "string");
  const text = String(briefing);
  assert.equal(text.includes("**NBA RECAP**"), true);
  assert.equal(text.includes("**INSPIRATIONAL QUOTE**"), true);
  assert.equal(text.includes("play-by-play"), false);
  assert.equal(text.includes("365 Inspiring"), false);
  assert.equal(text.includes("Unauthorized"), false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`userContextId=${realUserContextId}`);
if (latestBriefingPreview) {
  console.log("\nPreview Telegram Payload:");
  console.log(latestBriefingPreview);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
