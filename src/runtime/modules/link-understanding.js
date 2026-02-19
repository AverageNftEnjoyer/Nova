const MARKDOWN_LINK_RE = /\[[^\]]*]\((https?:\/\/[^\s)]+)\)/gi;
const BARE_LINK_RE = /https?:\/\/\S+/gi;
const QUERY_STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "what", "when", "where", "which", "about", "into",
  "your", "have", "has", "was", "were", "you", "are", "can", "will", "could", "would", "should", "please",
  "link", "links", "http", "https", "www", "com", "net", "org",
]);

const LINK_FETCH_CACHE_TTL_MS = Math.max(
  30_000,
  Number.parseInt(process.env.NOVA_LINK_FETCH_CACHE_TTL_MS || "600000", 10) || 600_000,
);
const LINK_FETCH_CACHE_MAX = Math.max(
  16,
  Number.parseInt(process.env.NOVA_LINK_FETCH_CACHE_MAX || "256", 10) || 256,
);
const linkFetchCache = new Map();

function normalizeUrl(raw, opts = {}) {
  const keepHash = opts.keepHash === true;
  let trimmed = String(raw || "").trim().replace(/[),.;!?]+$/g, "");
  while (trimmed.endsWith(")") && (trimmed.match(/\(/g) || []).length < (trimmed.match(/\)/g) || []).length) {
    trimmed = trimmed.slice(0, -1);
  }
  if (!trimmed) return "";
  let parsed = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  parsed.hash = keepHash ? parsed.hash : "";
  return parsed.toString();
}

export function extractLinksFromMessage(message, opts = {}) {
  const maxLinks = Math.max(1, Number(opts.maxLinks || 3));
  const source = String(message || "");
  const seen = new Set();
  const urls = [];
  const pushUrl = (raw) => {
    const normalized = normalizeUrl(raw);
    if (!normalized) return false;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    urls.push(normalized);
    return urls.length >= maxLinks;
  };

  for (const match of source.matchAll(MARKDOWN_LINK_RE)) {
    if (pushUrl(match[1])) break;
  }

  if (urls.length < maxLinks) {
    for (const match of source.matchAll(BARE_LINK_RE)) {
      if (pushUrl(match[0])) break;
    }
  }

  return urls;
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated]`;
}

function tokenizeQuery(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !QUERY_STOP_WORDS.has(token));
}

function parseWebFetchContent(content) {
  const text = String(content || "").trim();
  if (!text) return { title: "", source: "", body: "" };

  const lines = text.split(/\r?\n/);
  let title = "";
  let source = "";
  const bodyLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!title && trimmed.startsWith("# ")) {
      title = trimmed.slice(2).trim();
      continue;
    }
    if (!source && /^source:\s+/i.test(trimmed)) {
      source = trimmed.replace(/^source:\s+/i, "").trim();
      continue;
    }
    bodyLines.push(line);
  }

  return {
    title,
    source,
    body: bodyLines.join("\n").trim(),
  };
}

function pickRelevantContextLines(body, query, maxLines = 4) {
  const queryTokens = tokenizeQuery(query);
  const lines = String(body || "")
    .split(/\r?\n+/g)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 24);
  if (lines.length === 0) return [];

  const scored = lines.map((line, idx) => {
    const lower = line.toLowerCase();
    let overlap = 0;
    for (const token of queryTokens) {
      if (lower.includes(token)) overlap += 1;
    }
    const score = overlap * 4 + Math.min(2, Math.floor(line.length / 120));
    return { line, idx, score };
  });

  const ranked = scored
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx))
    .slice(0, Math.max(2, maxLines * 2));

  const selected = ranked
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => entry.line)
    .filter((line, idx, arr) => arr.indexOf(line) === idx)
    .slice(0, maxLines);

  if (selected.length > 0 && ranked.some((entry) => entry.score > 0)) {
    return selected;
  }
  return lines.slice(0, Math.max(2, maxLines));
}

function compactLinkContext(result, query, url, maxChars) {
  const parsed = parseWebFetchContent(result);
  const source = normalizeUrl(parsed.source || url, { keepHash: false }) || url;
  const title = parsed.title || source;
  const highlights = pickRelevantContextLines(parsed.body, query, 4);
  const block = [
    `Source: ${source}`,
    `Title: ${title}`,
    ...highlights.map((line) => `- ${line}`),
  ].join("\n");
  return truncate(block.trim(), Math.max(300, Number(maxChars || 1600)));
}

function cacheGet(url) {
  const now = Date.now();
  const entry = linkFetchCache.get(url);
  if (!entry) return "";
  if (now - Number(entry.ts || 0) > LINK_FETCH_CACHE_TTL_MS) {
    linkFetchCache.delete(url);
    return "";
  }
  return String(entry.value || "");
}

function cacheSet(url, value) {
  linkFetchCache.set(url, { ts: Date.now(), value: String(value || "") });
  if (linkFetchCache.size <= LINK_FETCH_CACHE_MAX) return;
  const entries = [...linkFetchCache.entries()].sort((a, b) => Number(a[1]?.ts || 0) - Number(b[1]?.ts || 0));
  const removeCount = Math.max(1, entries.length - LINK_FETCH_CACHE_MAX);
  for (let i = 0; i < removeCount; i += 1) {
    const key = entries[i]?.[0];
    if (key) linkFetchCache.delete(key);
  }
}

export async function runLinkUnderstanding(params) {
  const links = extractLinksFromMessage(params?.text || "", { maxLinks: params?.maxLinks });
  if (links.length === 0) return { urls: [], outputs: [] };

  const outputs = [];
  const query = String(params?.query || params?.text || "").trim();
  for (const url of links) {
    const cached = cacheGet(url);
    if (cached) {
      outputs.push(truncate(cached, Math.max(300, Number(params.maxCharsPerLink || 1600))));
      continue;
    }
    try {
      const result = await params.runtimeTools.executeToolUse(
        {
          id: `tool_link_fetch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: "web_fetch",
          input: { url },
          type: "tool_use",
        },
        params.availableTools,
      );
      const content = String(result?.content || "").trim();
      if (!content || /^web_fetch error/i.test(content)) continue;
      const compacted = compactLinkContext(content, query, url, Number(params.maxCharsPerLink || 1600));
      if (!compacted) continue;
      outputs.push(compacted);
      cacheSet(url, compacted);
    } catch {
      // Best-effort enrichment only.
    }
  }

  return { urls: links, outputs };
}

export function formatLinkUnderstandingForPrompt(outputs, maxChars = 4200) {
  const list = Array.isArray(outputs)
    ? outputs
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .filter((item, idx, arr) => arr.indexOf(item) === idx)
    : [];
  if (list.length === 0) return "";
  const prefixed = list.map((item, idx) => `[Link ${idx + 1}]\n${item}`);
  const combined = prefixed.join("\n\n");
  return truncate(combined, Math.max(800, Number(maxChars || 4200)));
}
