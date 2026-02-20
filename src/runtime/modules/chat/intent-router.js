// ===== Intent Detection Helpers =====
// Pure string functions - no imports required.

export function shouldBuildWorkflowFromPrompt(text) {
  const n = String(text || "").toLowerCase();
  const asksBuild = /(build|create|setup|set up|make|generate|deploy)/.test(n);
  const workflowScope = /(workflow|mission|automation|pipeline|schedule|daily report|notification)/.test(n);
  return asksBuild && workflowScope;
}

export function shouldConfirmWorkflowFromPrompt(text) {
  const n = String(text || "").toLowerCase().trim();
  if (!n) return false;
  if (shouldBuildWorkflowFromPrompt(n)) return false;

  const reminderLike = /\b(remind me to|reminder to|set a reminder|remember to|dont let me forget|don't let me forget)\b/.test(n);
  const scheduleLike = /\b(every day|daily|every morning|every night|weekly|at\s+\d{1,2}(:\d{2})?\s*(am|pm)?|tomorrow morning|tomorrow night)\b/.test(n);
  const deliveryLike = /\b(to telegram|on telegram|to discord|on discord|to novachat|to chat|as a notification)\b/.test(n);
  const missionTerms = /\b(mission|workflow|automation|schedule|scheduled)\b/.test(n);
  const taskLike = /\b(quote|speech|reminder|bill|loan|payment|pay)\b/.test(n);
  const likelyQuestionOnly = /^(what|why|how|when|where)\b/.test(n) || /\b(explain|difference between)\b/.test(n);

  if (likelyQuestionOnly) return false;
  return reminderLike || (scheduleLike && (deliveryLike || taskLike)) || (missionTerms && taskLike);
}

export function shouldDraftOnlyWorkflow(text) {
  const n = String(text || "").toLowerCase();
  return /(draft|preview|don't deploy|do not deploy|just show|show me first)/.test(n);
}

export function shouldPreloadWebSearch(text) {
  const n = String(text || "").toLowerCase();
  if (!n.trim()) return false;
  return /\b(latest|most recent|today|tonight|yesterday|last night|current|breaking|update|updates|live|score|scores|recap|price|prices|market|news|weather)\b/.test(n);
}

export function replyClaimsNoLiveAccess(text) {
  const n = String(text || "").toLowerCase();
  if (!n.trim()) return false;
  return (
    n.includes("don't have live access") ||
    n.includes("do not have live access") ||
    n.includes("don't have access to the internet") ||
    n.includes("no live access to the internet") ||
    n.includes("can't access current") ||
    n.includes("cannot access current") ||
    n.includes("cannot browse") ||
    n.includes("can't browse") ||
    n.includes("without web access")
  );
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&deg;/gi, " deg ")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number.parseInt(String(n), 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function cleanSnippetText(value) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\.\.\.\s*\[truncated\]\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function isBoilerplateWeatherSnippet(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return true;
  return (
    /\b(weather forecasts?|weather reports?|weather conditions?)\b/.test(text) ||
    /\bprovides local\b/.test(text) ||
    /\blong-range weather\b/.test(text) ||
    /\beverything you need to know\b/.test(text) ||
    /\bsee the forecast\b/.test(text)
  );
}

function toTitleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .map((part) => {
      const token = String(part || "").trim();
      if (!token) return token;
      if (token.toUpperCase() === token && token.length <= 3) return token;
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ")
    .trim();
}

function parseWebSearchItems(rawResults) {
  const raw = String(rawResults || "").trim();
  if (!raw || /^web_search error/i.test(raw) || raw === "No results found.") return [];

  const blocks = raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const items = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const title = cleanSnippetText(lines[0].replace(/^\[\d+\]\s*/, "").trim()) || "Result";
    const url = /^https?:\/\//i.test(lines[1]) ? lines[1] : "";
    const snippet = cleanSnippetText(lines.slice(url ? 2 : 1).join(" "));
    if (!title && !snippet) continue;
    items.push({ title, url, snippet: snippet || "No snippet available." });
    if (items.length >= 5) break;
  }
  return items;
}

function normalizeLocationCandidate(value) {
  return toTitleCase(
    String(value || "")
      .replace(/\b(weather|forecast|tomorrow|today|tonight|now|right now)\b/gi, " ")
      .replace(/[?!.]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/,\s*$/, "")
      .trim(),
  );
}

function inferWeatherLocationFromQuery(query) {
  const q = String(query || "").trim();
  const patterns = [
    /\bweather\s+(?:in|for|at)?\s*([A-Za-z0-9][A-Za-z0-9\s,.-]{1,80})/i,
    /\bforecast\s+(?:in|for|at)?\s*([A-Za-z0-9][A-Za-z0-9\s,.-]{1,80})/i,
    /^([A-Za-z0-9][A-Za-z0-9\s,.-]{1,80})\s+weather\b/i,
    /\bfor\s+([0-9]{5}(?:-[0-9]{4})?)\b/,
  ];
  for (const pattern of patterns) {
    const m = q.match(pattern);
    if (!m?.[1]) continue;
    const normalized = normalizeLocationCandidate(m[1]);
    if (normalized) return normalized;
  }
  return "";
}

function inferWeatherLocationFromItems(items) {
  for (const item of items || []) {
    const title = String(item?.title || "");
    let m = title.match(/weather(?:\s+forecast)?\s+for\s+([^|,-]+(?:,\s*[A-Za-z]{2})?)/i);
    if (!m?.[1]) m = title.match(/for\s+([^|,-]+(?:,\s*[A-Za-z]{2})?)\s*[-|]\s*the weather channel/i);
    if (!m?.[1]) m = title.match(/weather\s+tomorrow\s+for\s+([^|,-]+(?:,\s*[A-Za-z]{2})?)/i);
    if (!m?.[1]) m = title.match(/^([^|]+?)\s+weather/i);
    if (!m?.[1]) continue;
    const normalized = normalizeLocationCandidate(m[1]);
    if (normalized) return normalized;
  }
  return "";
}

function inferWeatherLocation(query, items) {
  const fromQuery = inferWeatherLocationFromQuery(query);
  if (fromQuery) return fromQuery;
  const fromResults = inferWeatherLocationFromItems(items);
  if (fromResults) return fromResults;
  return "your location";
}

function inferWeatherTimeframe(query, fallbackText = "") {
  const q = String(query || "").toLowerCase();
  if (q.includes("tomorrow")) return "tomorrow";
  if (q.includes("tonight")) return "tonight";
  if (q.includes("today")) return "today";

  const text = String(fallbackText || "").toLowerCase();
  if (/\btomorrow\b/.test(text)) return "tomorrow";
  if (/\btonight\b/.test(text)) return "tonight";
  if (/\btoday\b/.test(text)) return "today";
  if (/\b(current|currently|now|right now)\b/.test(text)) return "right now";
  return "forecast";
}

function extractTemperatureStats(text) {
  const raw = String(text || "");
  const highMatches = [...raw.matchAll(/\bhigh\s+(?:around\s+)?(-?\d{1,3})\s*(?:deg|degrees?)?\s*([fc])?\b/gi)];
  const lowMatches = [...raw.matchAll(/\blow\s+(?:around\s+)?(-?\d{1,3})\s*(?:deg|degrees?)?\s*([fc])?\b/gi)];
  const pointMatches = [...raw.matchAll(/\b(-?\d{1,3})\s*(?:deg|degrees?)?\s*([fc])\b/gi)];

  const avg = (matches) => {
    if (!matches.length) return null;
    const nums = matches.map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
    if (!nums.length) return null;
    return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  };

  const pickUnit = (matches, fallback = "F") => {
    for (const match of matches) {
      const unit = String(match[2] || "").toUpperCase();
      if (unit === "F" || unit === "C") return unit;
    }
    return fallback;
  };

  return {
    high: avg(highMatches),
    low: avg(lowMatches),
    current: pointMatches.length ? Number(pointMatches[0][1]) : null,
    unit: pickUnit([...highMatches, ...lowMatches, ...pointMatches], "F"),
  };
}

function tokenizeLocationForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function scoreWeatherItem(item, requestedLocation, requestedTimeframe) {
  const hay = `${String(item?.title || "")} ${String(item?.snippet || "")}`.toLowerCase();
  let score = 0;

  const requested = String(requestedLocation || "").trim().toLowerCase();
  if (requested && requested !== "your location") {
    if (hay.includes(requested)) score += 8;
    for (const token of tokenizeLocationForMatch(requested)) {
      if (hay.includes(token)) score += 2;
    }
  }

  if (requestedTimeframe === "tomorrow" && /\btomorrow\b/.test(hay)) score += 4;
  if (requestedTimeframe === "tonight" && /\btonight\b/.test(hay)) score += 4;
  if (requestedTimeframe === "today" && /\btoday\b/.test(hay)) score += 3;
  if (requestedTimeframe === "right now" && /\b(current|currently|now)\b/.test(hay)) score += 3;

  if (/\bhigh\b/.test(hay)) score += 1;
  if (/\blow\b/.test(hay)) score += 1;
  return score;
}

function pickPrimaryWeatherItem(items, requestedLocation, requestedTimeframe) {
  if (!Array.isArray(items) || items.length === 0) return null;
  let best = items[0];
  let bestScore = scoreWeatherItem(best, requestedLocation, requestedTimeframe);
  for (let i = 1; i < items.length; i += 1) {
    const next = items[i];
    const score = scoreWeatherItem(next, requestedLocation, requestedTimeframe);
    if (score > bestScore) {
      best = next;
      bestScore = score;
    }
  }
  return best;
}

export function buildWeatherWebSummary(query, rawResults) {
  const items = parseWebSearchItems(rawResults);
  if (items.length === 0) return "";

  const requestedLocation = inferWeatherLocationFromQuery(query) || "your location";
  const requestedTimeframe = inferWeatherTimeframe(query);
  const primaryItem = pickPrimaryWeatherItem(items, requestedLocation, requestedTimeframe) || items[0];

  const primaryText = `${String(primaryItem?.title || "")} ${String(primaryItem?.snippet || "")}`.trim();
  const joinedText = items.map((item) => `${String(item?.title || "")} ${String(item?.snippet || "")}`.trim()).join(" ");

  const snippets = items.map((item) => item.snippet).filter(Boolean);
  const temps = extractTemperatureStats(primaryText);
  const fallbackTemps = temps.high === null && temps.low === null && temps.current === null
    ? extractTemperatureStats(joinedText)
    : temps;

  const conditionPatterns = [
    /periods of rain/i,
    /chance of rain/i,
    /showers?/i,
    /thunderstorms?/i,
    /foggy/i,
    /cloudy/i,
    /partly cloudy/i,
    /sunny/i,
    /windy/i,
    /snow/i,
  ];

  let condition = "";
  for (const pattern of conditionPatterns) {
    const hit = primaryText.match(pattern);
    if (hit?.[0]) {
      condition = hit[0].toLowerCase();
      break;
    }
  }
  if (!condition) {
    for (const pattern of conditionPatterns) {
      const hit = joinedText.match(pattern);
      if (hit?.[0]) {
        condition = hit[0].toLowerCase();
        break;
      }
    }
  }
  if (condition) {
    // no-op; keep inferred condition
  }

  const location = inferWeatherLocation(query, items);
  const timeframe = inferWeatherTimeframe(query, primaryText);
  const tempChunks = [];
  if (fallbackTemps.high !== null) tempChunks.push(`high around ${fallbackTemps.high} degrees ${fallbackTemps.unit}`);
  if (fallbackTemps.low !== null) tempChunks.push(`low around ${fallbackTemps.low} degrees ${fallbackTemps.unit}`);
  if (!tempChunks.length && fallbackTemps.current !== null) tempChunks.push(`around ${fallbackTemps.current} degrees ${fallbackTemps.unit}`);

  const parts = [];
  if (tempChunks.length > 0) {
    parts.push(`${location} ${timeframe}: ${tempChunks.join(", ")}.`);
  } else if (condition) {
    parts.push(`${location} ${timeframe}: ${condition}.`);
  } else {
    return "";
  }

  if (condition) {
    parts.push(`Conditions likely include ${condition}.`);
  } else if (snippets[0]) {
    const cleaned = cleanSnippetText(snippets[0]).slice(0, 180);
    if (isBoilerplateWeatherSnippet(cleaned)) return "";
    parts.push(cleaned);
  }

  return parts.join("\n");
}

export function buildWebSearchReadableReply(query, rawResults) {
  const items = parseWebSearchItems(rawResults).slice(0, 3);
  if (items.length === 0) return "";

  const out = [`Here is a quick live-web recap for: "${String(query || "").trim()}".`, ""];
  for (const item of items) {
    out.push(`- ${item.title}: ${item.snippet}`);
    if (item.url) out.push(`  Source: ${item.url}`);
  }
  return out.join("\n");
}
