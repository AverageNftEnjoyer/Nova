import fs from "node:fs";
import path from "node:path";
import {
  CRYPTO_REPORT_ACTION_REGEX,
  CRYPTO_REPORT_CONTEXT_REGEX,
  FOLLOW_UP_DETAIL_REGEX,
  PERSONALITY_PNL_THRESHOLD_PCT,
  PERSONALITY_PNL_TRIGGER_REGEX,
  REPORT_REPEAT_CUE_REGEX,
} from "../constants/index.js";
import { normalizeCoinbaseCommandText } from "../coinbase-command-parser.js";

const personaMetaCache = new Map();

function parseToolPayload(raw) {
  const text = String(raw || "").trim();
  if (!text) return { ok: false, errorCode: "EMPTY_TOOL_RESPONSE", safeMessage: "I couldn't verify Coinbase data right now.", guidance: "Retry in a moment." };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
  }
  return { ok: false, errorCode: "NON_JSON_TOOL_RESPONSE", safeMessage: "I couldn't verify Coinbase data right now.", guidance: "Retry in a moment." };
}

function formatTimestamp(ms) {
  const parsed = Number(ms);
  if (!Number.isFinite(parsed) || parsed <= 0) return "unknown time";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function formatFreshness(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return "unknown";
  const seconds = Math.round(value / 1000);
  return `${seconds}s`;
}

function formatUsdAmount(value, decimalPlaces = 2) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "n/a";
  const places = Math.max(0, Math.min(8, Math.floor(Number(decimalPlaces) || 2)));
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(amount);
}

function normalizePersonaTone(value) {
  const tone = String(value || "").trim().toLowerCase();
  if (tone === "enthusiastic" || tone === "calm" || tone === "direct" || tone === "relaxed") return tone;
  return "neutral";
}

function resolveWorkspaceRoot(workspaceDir, userContextId) {
  const resolved = path.resolve(String(workspaceDir || "").trim() || process.cwd());
  const userScopedDir = path.dirname(resolved);
  const userContextRootDir = path.dirname(userScopedDir);
  const agentRootDir = path.dirname(userContextRootDir);
  const maybeUserId = path.basename(resolved).toLowerCase();
  const maybeUserContext = path.basename(userScopedDir).toLowerCase();
  const maybeAgent = path.basename(userContextRootDir).toLowerCase();
  const normalizedUserContextId = String(userContextId || "").trim().toLowerCase();

  if (
    maybeAgent === ".agent"
    && maybeUserContext === "user-context"
    && (!normalizedUserContextId || maybeUserId === normalizedUserContextId)
  ) {
    return path.dirname(agentRootDir);
  }
  return resolved;
}

function resolvePersonaMeta({ workspaceDir, userContextId }) {
  const uid = String(userContextId || "").trim().toLowerCase();
  if (!uid) return { assistantName: "Nova", tone: "neutral", communicationStyle: "friendly" };
  const root = resolveWorkspaceRoot(workspaceDir, uid);
  const cacheKey = `${root}::${uid}`;
  const now = Date.now();
  const cached = personaMetaCache.get(cacheKey);
  if (cached && now - Number(cached.ts || 0) < 60_000) return cached.value;

  const agentsPath = path.join(root, ".agent", "user-context", uid, "AGENTS.md");
  let assistantName = "Nova";
  let tone = "neutral";
  let communicationStyle = "friendly";
  try {
    const content = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, "utf8") : "";
    const lines = String(content || "").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = String(rawLine || "").trim();
      let match = line.match(/^-+\s*Assistant name:\s*(.+)$/i);
      if (match?.[1]) assistantName = String(match[1]).trim() || assistantName;
      match = line.match(/^-+\s*Tone:\s*(.+)$/i);
      if (match?.[1]) tone = normalizePersonaTone(match[1]);
      match = line.match(/^-+\s*Communication style:\s*(.+)$/i);
      if (match?.[1]) communicationStyle = String(match[1]).trim().toLowerCase() || communicationStyle;
    }
  } catch {
  }
  const value = {
    assistantName: assistantName || "Nova",
    tone: normalizePersonaTone(tone),
    communicationStyle: communicationStyle || "friendly",
  };
  personaMetaCache.set(cacheKey, { ts: now, value });
  return value;
}

function hashSeed(value) {
  const input = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function selectVariant(variants, seed) {
  if (!Array.isArray(variants) || variants.length === 0) return "";
  const index = seed % variants.length;
  return String(variants[index] || "");
}

function buildPnlPersonalityComment({
  estimatedTotalUsd,
  recentNetNotionalUsd,
  includeRecentNetCashFlow,
  normalizedInput,
  userContextId,
  workspaceDir,
  transactionCount,
  valuedAssetCount,
  freshnessMs,
}) {
  if (!includeRecentNetCashFlow) return "";
  if (!PERSONALITY_PNL_TRIGGER_REGEX.test(String(normalizedInput || ""))) return "";
  const total = Number(estimatedTotalUsd);
  const recentNet = Number(recentNetNotionalUsd);
  const txCount = Number(transactionCount);
  const pricedAssetCount = Number(valuedAssetCount);
  const freshness = Number(freshnessMs);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(recentNet)) return "";
  if (Math.abs(recentNet) < 250) return "";
  if (Number.isFinite(txCount) && txCount < 3) return "";
  if (Number.isFinite(pricedAssetCount) && pricedAssetCount <= 0) return "";
  if (Number.isFinite(freshness) && freshness > 6 * 60 * 60 * 1000) return "";
  const pct = (recentNet / total) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) < PERSONALITY_PNL_THRESHOLD_PCT + 0.05) return "";

  const direction = pct >= 0 ? "up" : "down";
  const cadence = /\bweekly\b/i.test(String(normalizedInput || ""))
    ? "weekly"
    : /\bdaily\b/i.test(String(normalizedInput || ""))
      ? "daily"
      : "report";
  const persona = resolvePersonaMeta({ workspaceDir, userContextId });
  const name = String(persona.assistantName || "Nova").trim() || "Nova";
  const pctText = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const seed = hashSeed(`${String(userContextId || "")}:${direction}:${cadence}:${persona.tone}:${Math.round(pct * 10)}`);

  const toneVariants = {
    enthusiastic: {
      up: [
        `${name} note (${cadence}): ${pctText} is a strong move up. Momentum is doing you a favor today.`,
        `${name} note (${cadence}): ${pctText} up. That is the kind of curve people screenshot.`,
        `${name} note (${cadence}): ${pctText} green. Clean execution and strong follow-through.`,
      ],
      down: [
        `${name} note (${cadence}): ${pctText}. Rough tape, but this is where discipline beats emotion.`,
        `${name} note (${cadence}): ${pctText} drawdown. Not fun, but survivable with controlled sizing.`,
        `${name} note (${cadence}): ${pctText} down. Keep the plan tighter than the panic.`,
      ],
    },
    calm: {
      up: [
        `${name} note (${cadence}): ${pctText} is a meaningful gain. Solid progress.`,
        `${name} note (${cadence}): ${pctText} up. Nice improvement without overreacting.`,
        `${name} note (${cadence}): ${pctText} positive move. Keep consistency over excitement.`,
      ],
      down: [
        `${name} note (${cadence}): ${pctText} indicates notable pressure. Stay systematic.`,
        `${name} note (${cadence}): ${pctText} down. Reset and focus on risk controls.`,
        `${name} note (${cadence}): ${pctText} drawdown. Patience and process matter most here.`,
      ],
    },
    direct: {
      up: [
        `${name} note (${cadence}): ${pctText}. Strong period. Keep what is working.`,
        `${name} note (${cadence}): ${pctText}. Clear positive acceleration.`,
        `${name} note (${cadence}): ${pctText}. Good result. Do not overtrade it.`,
      ],
      down: [
        `${name} note (${cadence}): ${pctText}. Drawdown is material. Cut noise, manage risk.`,
        `${name} note (${cadence}): ${pctText}. Negative swing. Tighten exposures.`,
        `${name} note (${cadence}): ${pctText}. Protect capital first.`,
      ],
    },
    relaxed: {
      up: [
        `${name} note (${cadence}): ${pctText} up. That is a pretty clean climb.`,
        `${name} note (${cadence}): ${pctText} in the green. Nice lift.`,
        `${name} note (${cadence}): ${pctText} gain. Good vibe, keep it measured.`,
      ],
      down: [
        `${name} note (${cadence}): ${pctText}. Not ideal, but recoveries start with calm decisions.`,
        `${name} note (${cadence}): ${pctText} down. Take a breath and trim the chaos.`,
        `${name} note (${cadence}): ${pctText} drawdown. Keep it steady and deliberate.`,
      ],
    },
    neutral: {
      up: [
        `${name} note (${cadence}): ${pctText} indicates strong positive movement.`,
        `${name} note (${cadence}): ${pctText} gain recorded for this period.`,
        `${name} note (${cadence}): ${pctText} up move is significant.`,
      ],
      down: [
        `${name} note (${cadence}): ${pctText} indicates meaningful negative movement.`,
        `${name} note (${cadence}): ${pctText} drawdown recorded for this period.`,
        `${name} note (${cadence}): ${pctText} down move is significant.`,
      ],
    },
  };

  const toneKey = normalizePersonaTone(persona.tone);
  return selectVariant(toneVariants[toneKey]?.[direction] || toneVariants.neutral[direction], seed);
}

export function parseCryptoReportPreferenceDirectives(text, options = {}) {
  const assumeReportContext = options?.assumeReportContext === true;
  const raw = String(text || "").trim();
  const normalized = normalizeCoinbaseCommandText(raw);
  if ((!CRYPTO_REPORT_CONTEXT_REGEX.test(normalized) && !assumeReportContext) || !CRYPTO_REPORT_ACTION_REGEX.test(normalized)) {
    return { ok: false, directives: [], reason: "" };
  }
  const directives = [];
  const cleanAssetPhrase = (value) =>
    String(value || "")
      .split(/\b(?:from|for|in|while|then|also|because|so)\b/i)[0]
      .replace(/[.;]+$/g, "")
      .trim();
  const exceptMatch = raw.match(/exclude\s+all\s+assets\s+except\s+([^\n\r]+)/i);
  if (exceptMatch?.[1]) directives.push(`only_assets: ${cleanAssetPhrase(exceptMatch[1])}`);
  const includeMatch = raw.match(/include\s+assets?\s+([^\n\r]+)/i) || raw.match(/only\s+assets?\s+([^\n\r]+)/i);
  if (includeMatch?.[1]) directives.push(`include_assets: ${cleanAssetPhrase(includeMatch[1])}`);
  const excludeMatch = raw.match(/exclude\s+assets?\s+([^\n\r]+)/i);
  if (excludeMatch?.[1] && !exceptMatch) directives.push(`exclude_assets: ${cleanAssetPhrase(excludeMatch[1])}`);
  const decimalsMatch = raw.match(/(\d+)\s+decimal/i) || raw.match(/decimals?\s*(?:to|=|:)?\s*(\d+)/i);
  if (decimalsMatch?.[1]) directives.push(`decimals: ${Math.max(0, Math.min(8, Number(decimalsMatch[1]) || 2))}`);
  if (/\b(no|hide|omit|remove|dont\s+want|don't\s+want)\b.*\b(net\s*cash[-\s]?flow|p\s*&?\s*l\s*proxy|pnl\s*proxy|recent\s+net)\b/i.test(raw)) {
    directives.push("include_recent_net_cash_flow: false");
  }
  if (/\b(show|include|keep)\b.*\b(net\s*cash[-\s]?flow|p\s*&?\s*l\s*proxy|pnl\s*proxy|recent\s+net)\b/i.test(raw)) {
    directives.push("include_recent_net_cash_flow: true");
  }
  const hideTimestamp = /\b(no|hide|omit|remove|do\s+not|don't)\b.*\b(timestamps?|time)\b/i.test(raw);
  const showTimestamp = /\b(show|include)\b.*\b(timestamps?|time)\b/i.test(raw);
  if (hideTimestamp) directives.push("include_timestamp: false");
  else if (showTimestamp) directives.push("include_timestamp: true");
  const hideFreshness = /\b(no|hide|omit|remove|do\s+not|don't)\b.*\bfreshness\b/i.test(raw);
  const showFreshness = /\b(show|include)\b.*\bfreshness\b/i.test(raw);
  if (hideFreshness) directives.push("include_freshness: false");
  else if (showFreshness) directives.push("include_freshness: true");
  if (/\biso\s*date\b|\byyyy-mm-dd\b/i.test(raw)) directives.push("date_format: ISO_DATE");
  if (/\bmm\/dd\/yyyy\b|\bdate\s+only\b/i.test(raw)) directives.push("date_format: MM/DD/YYYY");
  const hasActionableDirective = directives.length > 0;
  const hasPreferenceStyleInstruction =
    /\b(from\s+now\s+on|going\s+forward|always|never|remember|default|preference|less\s+technical|plain\s+english)\b/i.test(raw);
  if (hasActionableDirective || hasPreferenceStyleInstruction) directives.push(`rule: ${raw.replace(/[\r\n]+/g, " ").trim()}`);
  return {
    ok: hasActionableDirective || hasPreferenceStyleInstruction,
    directives,
    reason: hasActionableDirective || hasPreferenceStyleInstruction ? "" : "No actionable report preference found.",
  };
}

export function upsertCryptoReportPreferences({ userContextId, workspaceDir, directives }) {
  const uid = String(userContextId || "").trim().toLowerCase();
  if (!uid) return { ok: false, error: "Missing user context." };
  const workspaceRoot = resolveWorkspaceRoot(workspaceDir, uid);
  const userSkillPath = path.join(
    workspaceRoot,
    ".agent",
    "user-context",
    uid,
    "skills",
    "coinbase",
    "SKILL.md",
  );
  const legacyUserPath = path.join(workspaceRoot, ".agent", "user-context", uid, "skills.md");
  const baselinePath = path.join(workspaceRoot, "skills", "coinbase", "SKILL.md");
  const legacyBaselinePath = path.join(workspaceRoot, ".agent", "skills.md");
  const sectionHeader = "## Crypto Report Preferences";
  let content = "";
  try {
    if (fs.existsSync(userSkillPath)) {
      content = fs.readFileSync(userSkillPath, "utf8");
    } else if (fs.existsSync(legacyUserPath)) {
      content = fs.readFileSync(legacyUserPath, "utf8");
    } else if (fs.existsSync(baselinePath)) {
      content = fs.readFileSync(baselinePath, "utf8");
    } else if (fs.existsSync(legacyBaselinePath)) {
      content = fs.readFileSync(legacyBaselinePath, "utf8");
    } else {
      content = "# Nova Skills\n\n";
    }
  } catch {
    content = "# Nova Skills\n\n";
  }
  const lines = content.split(/\r?\n/);
  let sectionStart = lines.findIndex((line) => String(line || "").trim().toLowerCase() === sectionHeader.toLowerCase());
  let sectionEnd = -1;
  if (sectionStart >= 0) {
    for (let i = sectionStart + 1; i < lines.length; i += 1) {
      if (/^##\s+/.test(String(lines[i] || "").trim())) {
        sectionEnd = i;
        break;
      }
    }
    if (sectionEnd < 0) sectionEnd = lines.length;
  } else {
    if (lines.length > 0 && String(lines[lines.length - 1] || "").trim() !== "") lines.push("");
    sectionStart = lines.length;
    lines.push(sectionHeader, "");
    sectionEnd = lines.length;
  }

  const known = new Map();
  const rules = [];
  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    const line = String(lines[i] || "").trim();
    if (!line || line.startsWith("#")) continue;
    const kv = line.match(/^([a-z_]+)\s*:\s*(.+)$/i);
    if (kv) {
      const key = kv[1].toLowerCase();
      if (key === "rule") rules.push(`rule: ${kv[2].trim()}`);
      else known.set(key, `${kv[1]}: ${kv[2].trim()}`);
    }
  }

  for (const directiveRaw of directives) {
    const directive = String(directiveRaw || "").trim();
    const kv = directive.match(/^([a-z_]+)\s*:\s*(.+)$/i);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    if (key === "rule") {
      const normalizedRule = `rule: ${kv[2].trim()}`;
      if (!rules.includes(normalizedRule)) rules.push(normalizedRule);
      continue;
    }
    known.set(key, `${kv[1]}: ${kv[2].trim()}`);
  }

  const sectionLines = [
    sectionHeader,
    ...[...known.values()],
    ...rules.slice(-25),
    "",
  ];
  const rebuilt = [
    ...lines.slice(0, sectionStart),
    ...sectionLines,
    ...lines.slice(sectionEnd),
  ].join("\n");
  fs.mkdirSync(path.dirname(userSkillPath), { recursive: true });
  fs.writeFileSync(userSkillPath, rebuilt, "utf8");
  return { ok: true, filePath: userSkillPath, applied: directives };
}

export async function executeCoinbaseTool(runtimeTools, availableTools, toolName, input) {
  if (typeof runtimeTools?.executeToolUse !== "function") {
    return { ok: false, errorCode: "TOOL_RUNTIME_UNAVAILABLE", safeMessage: "I couldn't verify Coinbase data because the tool runtime is unavailable.", guidance: "Retry after Nova runtime initializes tools." };
  }
  const exists = Array.isArray(availableTools) && availableTools.some((tool) => String(tool?.name || "") === toolName);
  if (!exists) {
    return { ok: false, errorCode: "TOOL_NOT_ENABLED", safeMessage: `I couldn't verify Coinbase data because ${toolName} is not enabled.`, guidance: "Enable Coinbase tools in NOVA_ENABLED_TOOLS and restart Nova." };
  }
  try {
    const result = await runtimeTools.executeToolUse(
      {
        id: `tool_${toolName}_${Date.now()}`,
        name: toolName,
        input,
        type: "tool_use",
      },
      availableTools,
    );
    return parseToolPayload(result?.content || "");
  } catch (err) {
    return {
      ok: false,
      errorCode: "TOOL_EXECUTION_FAILED",
      safeMessage: "I couldn't verify Coinbase data because tool execution failed.",
      guidance: err instanceof Error ? err.message : "Retry in a moment.",
    };
  }
}

function buildSafeFailureReply(actionLabel, payload) {
  const safeMessage = String(payload?.safeMessage || "").trim() || `I couldn't verify live Coinbase ${actionLabel} right now.`;
  const guidance = String(payload?.guidance || "").trim();
  if (guidance) {
    return `${safeMessage}\nNext step: ${guidance}`;
  }
  return `${safeMessage}\nNext step: Retry in a moment.`;
}

export function buildReportRepeatPrefix(text) {
  const normalized = normalizeCoinbaseCommandText(text);
  if (!REPORT_REPEAT_CUE_REGEX.test(normalized)) return "";
  if (/\b(last\s+one|one\s+more\s+time|again)\b/i.test(normalized)) return "Refreshed report:\n";
  return "Updated report:\n";
}

export function buildStatusReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("status", payload);
  const caps = payload.capabilities || {};
  return [
    `Coinbase status: ${String(caps.status || "unknown")}.`,
    `Capabilities: market=${String(caps.marketData || "unknown")}, portfolio=${String(caps.portfolio || "unknown")}, transactions=${String(caps.transactions || "unknown")}.`,
    `Checked: ${formatTimestamp(payload.checkedAtMs)}.`,
    "Commands: price <ticker>, portfolio, recent transactions, my crypto report, weekly pnl.",
  ].join("\n");
}

export function buildPriceReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("price", payload);
  const data = payload.data || {};
  const pair = String(data.symbolPair || "").trim() || "unknown pair";
  return [
    `${pair} now: ${formatUsdAmount(data.price)}.`,
    `Freshness: ${formatFreshness(data.freshnessMs)}.`,
    `Source: ${String(payload.source || data.source || "coinbase")}.`,
  ].join("\n");
}

export function buildPortfolioReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("portfolio", payload);
  const data = payload.data || {};
  const summary = payload.summary || {};
  const balances = Array.isArray(data.balances) ? data.balances : [];
  const nonZero = balances.filter((entry) => Number(entry?.total || 0) > 0);
  const estimatedTotalUsd = Number(summary.estimatedTotalUsd);
  const valuedAssetCount = Number(summary.valuedAssetCount || 0);
  const activeAssetCount = Number(summary.assetCount || nonZero.length);
  const top = nonZero.slice(0, 5).map((entry) => {
    const symbol = String(entry.assetSymbol || "asset").toUpperCase();
    const total = Number(entry.total || 0);
    return `- ${symbol}: ${Number.isFinite(total) ? total.toLocaleString("en-US", { maximumFractionDigits: 8 }) : "n/a"}`;
  });
  return [
    `Coinbase portfolio snapshot (${nonZero.length} active assets).`,
    Number.isFinite(estimatedTotalUsd)
      ? `- Estimated total balance (USD): ${formatUsdAmount(estimatedTotalUsd)}${valuedAssetCount > 0 ? ` (${valuedAssetCount}/${activeAssetCount || valuedAssetCount} assets priced)` : ""}`
      : "",
    top.length > 0 ? top.join("\n") : "- No non-zero balances found.",
    `Freshness: ${formatFreshness(data.freshnessMs)}.`,
    `Source: ${String(payload.source || data.source || "coinbase")}.`,
  ].join("\n");
}

export function buildTransactionsReply(payload) {
  if (!payload?.ok) return buildSafeFailureReply("transactions", payload);
  const events = Array.isArray(payload.events) ? payload.events : [];
  const lines = events.slice(0, 5).map((event) => {
    const side = String(event.side || "other").toUpperCase();
    const qty = Number(event.quantity || 0);
    const symbol = String(event.assetSymbol || "").toUpperCase();
    const price = Number(event.price);
    const at = formatTimestamp(event.occurredAtMs);
    const priceChunk = Number.isFinite(price) ? ` @ ${formatUsdAmount(price)}` : "";
    return `- ${side} ${Number.isFinite(qty) ? qty.toLocaleString("en-US", { maximumFractionDigits: 8 }) : "n/a"} ${symbol}${priceChunk} (${at})`;
  });
  return [
    `Recent Coinbase transactions (${events.length}).`,
    lines.length > 0 ? lines.join("\n") : "- No recent transactions returned.",
    `Freshness: ${formatFreshness(payload.freshnessMs)}.`,
    `Source: ${String(payload.source || "coinbase")}.`,
  ].join("\n");
}

export function buildReportReply(payload, context = {}) {
  if (!payload?.ok) return buildSafeFailureReply("report", payload);
  const report = payload.report || {};
  const rendered = String(report.rendered || "")
    .split("\n")
    .filter((line) => !/^\s*timestamp\s*:/i.test(String(line || "")))
    .join("\n")
    .trim();
  const hasRenderedPersonalityComment = /\bnote\s*\((?:daily|weekly|report)\)\s*:/i.test(rendered);
  const summary = report.summary || {};
  const recentFlowUpAssets = Number(summary.recentFlowUpAssets || 0);
  const recentFlowDownAssets = Number(summary.recentFlowDownAssets || 0);
  const estimatedTotalUsd = Number(summary.estimatedTotalUsd);
  const valuedAssetCount = Number(summary.valuedAssetCount || 0);
  const totalActiveAssets = Number(summary.nonZeroAssetCount || 0);
  const recentNetNotionalUsd = Number(summary.recentNetNotionalUsd);
  const transactionsUnavailableReason = String(summary.transactionsUnavailableReason || "").trim();
  const includeRecentNetCashFlow = summary.includeRecentNetCashFlow !== false;
  const decimalPlaces = Math.max(0, Math.min(8, Math.floor(Number(summary.decimalPlaces || 2))));
  const enrichedLines = [
    Number.isFinite(estimatedTotalUsd)
      ? `- Estimated total balance (USD): ${formatUsdAmount(estimatedTotalUsd, decimalPlaces)}${valuedAssetCount > 0 ? ` (${valuedAssetCount}/${totalActiveAssets || valuedAssetCount} assets priced)` : ""}`
      : "",
    `- Up positions (recent buy flow): ${Math.max(0, recentFlowUpAssets)}`,
    `- Down positions (recent sell flow): ${Math.max(0, recentFlowDownAssets)}`,
    includeRecentNetCashFlow && Number.isFinite(recentNetNotionalUsd)
      ? `- Recent net cash-flow PnL proxy: ${formatUsdAmount(recentNetNotionalUsd, decimalPlaces)}`
      : "",
    hasRenderedPersonalityComment
      ? ""
      : buildPnlPersonalityComment({
          estimatedTotalUsd,
          recentNetNotionalUsd,
          includeRecentNetCashFlow,
          normalizedInput: context.normalizedInput || "",
          userContextId: context.userContextId || "",
          workspaceDir: context.workspaceDir || "",
          transactionCount: summary.transactionCount,
          valuedAssetCount,
          freshnessMs: report?.portfolio?.freshnessMs,
        }),
    transactionsUnavailableReason ? `- Note: ${transactionsUnavailableReason}` : "",
  ].filter(Boolean);
  if (rendered) {
    if (enrichedLines.length === 0) return rendered;
    return `${rendered}\n${enrichedLines.join("\n")}`;
  }
  const portfolio = report.portfolio || {};
  return [
    "Coinbase crypto report:",
    `- Active assets: ${Number(summary.nonZeroAssetCount || 0)}`,
    `- Recent transactions included: ${Number(summary.transactionCount || 0)}`,
    `- Freshness: ${formatFreshness(portfolio.freshnessMs)}`,
    `- Source: ${String(payload.source || "coinbase")}`,
  ].join("\n");
}
