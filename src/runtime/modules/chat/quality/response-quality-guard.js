const ANSI_CSI_RE = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const BRACKETED_PASTE_RE = /\[(?:200|201)~/g;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const FILLER_TOKENS = new Set([
  "i", "me", "my", "we", "us", "you", "please", "just", "some", "any", "a", "an", "the",
  "want", "need", "can", "could", "would", "do", "to", "for", "on", "with", "about", "now",
  "help", "kind", "of",
]);

const GENERIC_INTENT_TOKENS = new Set([
  "help", "advice", "guidance", "suggestion", "suggestions", "tips", "direction", "recommendation", "recommendations",
  "assist", "assistance", "input",
]);

function normalizeSpaces(value, opts = {}) {
  const preserveNewlines = opts.preserveNewlines === true;
  if (preserveNewlines) {
    return String(value || "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function sanitizeTransportArtifacts(value, opts = {}) {
  const preserveNewlines = opts.preserveNewlines === true;
  let text = String(value || "")
    .replace(ANSI_CSI_RE, "")
    .replace(BRACKETED_PASTE_RE, "")
    .replace(ZERO_WIDTH_RE, "")
    .replace(CONTROL_RE, "")
    .replace(/â€”/g, "-")
    .replace(/â€“/g, "-")
    .replace(/â€˜|â€™/g, "'")
    .replace(/â€œ|â€\x9d/g, "\"");

  // Keep line breaks for assistant rendering, flatten for inbound prompts.
  if (!preserveNewlines) {
    text = text.replace(/[\r\n]+/g, " ");
  } else {
    text = text.replace(/\r\n/g, "\n");
  }
  return normalizeSpaces(text, { preserveNewlines });
}

export function normalizeInboundUserText(value) {
  return sanitizeTransportArtifacts(value, { preserveNewlines: false });
}

function normalizeForIntent(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shouldUseVagueClarifier(text) {
  const normalized = normalizeForIntent(text);
  if (!normalized) return { shouldClarify: false, reason: "empty" };
  if (/\bhttps?:\/\/\S+\b/i.test(String(text || ""))) return { shouldClarify: false, reason: "url_present" };

  const tokens = normalized.split(/\s+/g).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 8) return { shouldClarify: false, reason: "token_window" };

  const meaningful = tokens.filter((token) => !FILLER_TOKENS.has(token));
  if (meaningful.length === 0) return { shouldClarify: false, reason: "no_meaningful_tokens" };

  const genericOnly = meaningful.every((token) => GENERIC_INTENT_TOKENS.has(token));
  if (!genericOnly) return { shouldClarify: false, reason: "specific_request" };

  return {
    shouldClarify: true,
    reason: "brief_generic_request",
    tokenCount: tokens.length,
    meaningfulCount: meaningful.length,
  };
}

export function buildVagueClarifierReply() {
  return "Happy to help. What outcome are you trying to get, and what area is this in?";
}

const DIGIT_LETTER_SKIP_RE = /^(?:°[A-Za-z]|[%x×]|(?:st|nd|rd|th|px|em|rem|ms|fps|GB|MB|KB|TB|GHz|MHz|mph|kph|kmh|mpg|rpm|mm|ml|cm|km|mi|mg|lb|lbs|oz|kg|ft|hr|hrs|min|sec|am|pm|AM|PM|dB|kW|in|k|m|g|L)(?![a-zA-Z]))/;
const PROTECTED_SPAN_RE = /`[^`]+`|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+/g;

const SOURCE_META_LINE_RE = /^[ \t]*(?:Confidence|Source|Freshness)\s*:.*$/gm;
const SOURCE_META_INLINE_RE = /\s*(?:Confidence|Source|Freshness)\s*:[^.\n]*\.?/g;

export function stripSourceMetadata(value) {
  return String(value || "")
    .replace(SOURCE_META_LINE_RE, "")
    .replace(SOURCE_META_INLINE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function repairBrokenReadability(value) {
  const raw = String(value || "");
  if (!raw || /```/.test(raw)) return raw;

  const stash = [];
  let text = raw.replace(PROTECTED_SPAN_RE, (m) => {
    stash.push(m);
    return `\x00#${stash.length - 1}#\x00`;
  });

  text = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z°%×])/g, (match, d, l, offset) => {
      if (DIGIT_LETTER_SKIP_RE.test(text.slice(offset + 1))) return match;
      return `${d} ${l}`;
    });

  text = text.replace(/\x00#(\d+)#\x00/g, (_, idx) => stash[Number(idx)]);

  text = text.replace(/([^\n])(\n?)(- )/g, (m, before, nl, dash) => {
    if (nl) return m;
    return `${before}\n${dash}`;
  });

  const longSingleLine = text.length > 220 && !/\n/.test(text);
  const listShape = /\b\d+\s+[A-Z]/.test(text) || /(?:\s- )/.test(text);
  if (longSingleLine && listShape) {
    text = text
      .replace(/\s- /g, "\n- ")
      .replace(/(^|[.!?]\s+)(\d+)\s+/g, (_, p1, p2) => `${p1}\n${p2} `)
      .replace(/\s{2,}/g, " ");
  }

  return text;
}
