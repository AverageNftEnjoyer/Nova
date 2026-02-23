import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

function parseJsonObject(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeSnippetText(value, limit = 220) {
  return cleanText(String(value || "")).slice(0, limit);
}

function normalizeSourceSnippet(title, snippet) {
  const t = cleanText(title || "");
  const s = cleanText(snippet || "");
  return [t, s].filter(Boolean).join(": ");
}

function extractFactSentences(value, limit = 3) {
  return String(value || "")
    .split(/[.!?]\s+/)
    .map((row) => cleanText(row))
    .filter(Boolean)
    .slice(0, limit);
}

function toNumberSafe(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function collectSourceUrlsFromContextData() {
  return [];
}

function formatSourceButtons(urls) {
  return urls.map((url, index) => `[Source ${index + 1}](${url})`).join(" ");
}

function normalizeMissionSourcePresentation(raw) {
  return String(raw || "");
}

function uniqueSourceUrls(urls, max = 2) {
  const out = [];
  const seen = new Set();
  for (const url of Array.isArray(urls) ? urls : []) {
    const normalized = String(url || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

function loadFormattersModule() {
  const source = fs.readFileSync(path.join(process.cwd(), "hud/lib/missions/output/formatters.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: "formatters.ts",
  }).outputText;

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier === "../text/cleaning") return { cleanText, normalizeSnippetText, normalizeSourceSnippet, parseJsonObject };
      if (specifier === "../text/formatting") return { extractFactSentences };
      if (specifier === "../utils/paths") return { toNumberSafe };
      if (specifier === "./sources") {
        return {
          collectSourceUrlsFromContextData,
          formatSourceButtons,
          normalizeMissionSourcePresentation,
          uniqueSourceUrls,
        };
      }
      throw new Error(`Unexpected require: ${specifier}`);
    },
    console,
    process,
    Buffer,
    Intl,
  };

  vm.runInNewContext(compiled, sandbox, { filename: "formatters.smoke.cjs" });
  return module.exports;
}

const { humanizeMissionOutputText } = loadFormattersModule();

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
  portfolio: {
    balances: [
      { accountId: "abc", assetSymbol: "SUI", total: 124.8 },
      { accountId: "def", assetSymbol: "ETH", total: 0.25 },
      { accountId: "ghi", assetSymbol: "DOGE", total: 0 },
    ],
  },
  transactions: [],
  notes: ["Coinbase private account data unavailable: /fills failed (401) [auth=jwt_bearer]: Unauthorized"],
};

const raw = JSON.stringify(payload);
const formatted = humanizeMissionOutputText(raw);

assert.equal(formatted.startsWith("{"), false, "should not emit raw JSON");
assert.equal(/Coinbase/i.test(formatted), true, "should identify coinbase summary");
assert.equal(/ETH/i.test(formatted) && /SUI/i.test(formatted), true, "should include key assets");
assert.equal(/accountId/i.test(formatted), false, "should not dump raw account fields");
assert.equal(formatted.length < raw.length, true, "should reduce payload verbosity");

console.log("[mission-output-coinbase-format:smoke] coinbase JSON humanization passed.");
