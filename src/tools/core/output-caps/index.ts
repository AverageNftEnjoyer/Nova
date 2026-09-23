// Tool output caps (token-efficiency Stage 2): the single registry of how much of a tool's output reaches the model.
//
// Every tool result goes through executeToolUse (src/tools/core/executor), which applies capToolOutput() below, so
// no tool can put an unbounded blob into the tool loop (where each result is resent on every later step).
//
// Two kinds of tool:
//   - Paging tools (read, memory_get, web_fetch) return one page themselves, sized by the numbers here, and end it
//     with a marker built by formatTruncationMarker() that names the exact call for the next page. Their executor
//     cap is the page size plus room for that marker, so it only acts as a backstop.
//   - Every other tool is cut by the executor at `maxChars`, with a marker built from its `howToGetMore` hint.
// Every marker says how much was shown, how much was cut, and how to get more. Markers start with
// TRUNCATION_MARKER_PREFIX so callers (and tests) can recognise them.

export const TRUNCATION_MARKER_PREFIX = "[Output truncated by Nova:";

/** `read` with no line range returns at most this many lines (PLAN.md Stage 2). */
export const READ_DEFAULT_LINE_WINDOW = 400;
/** `read` page size in characters, for files with very long lines (minified code, logs, CSV). */
export const READ_MAX_CHARS = 32_000;
/** `memory_get` page size (was a flat 32,000-character cut). */
export const MEMORY_GET_PAGE_CHARS = 12_000;
/** `web_fetch` page size of the page's markdown (unchanged from the old flat cut). */
export const WEB_FETCH_PAGE_CHARS = 16_000;
/** `browser_agent` accepts `maxOutputChars` from the model within these bounds (unchanged). */
export const BROWSER_AGENT_DEFAULT_OUTPUT_CHARS = 12_000;
export const BROWSER_AGENT_MAX_OUTPUT_CHARS = 32_000;
/** `grep` stops collecting after this many matching lines (unchanged). */
export const GREP_MAX_MATCHES = 200;
/** Safety net for tools with no entry below (Gmail, Coinbase, Phantom, write/edit, errors that echo their input). */
export const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 64_000;

/** Room kept for a paging tool's own marker on top of its page size. */
const PAGING_MARKER_HEADROOM_CHARS = 1_000;

type ToolInput = Record<string, unknown>;

export interface ToolOutputCap {
  /** Characters of output the model may see; may depend on the call's input (browser_agent). */
  maxChars: number | ((input: ToolInput) => number);
  /** One sentence telling the model how to get the part that was cut. */
  howToGetMore: (input: ToolInput) => string;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function resolveBrowserAgentMaxOutputChars(value: unknown): number {
  return clampInt(value, BROWSER_AGENT_DEFAULT_OUTPUT_CHARS, 1_000, BROWSER_AGENT_MAX_OUTPUT_CHARS);
}

export const TOOL_OUTPUT_CAPS: Readonly<Record<string, ToolOutputCap>> = Object.freeze({
  read: {
    maxChars: READ_MAX_CHARS + PAGING_MARKER_HEADROOM_CHARS,
    howToGetMore: () => "call read again with a smaller startLine/endLine range.",
  },
  memory_get: {
    maxChars: MEMORY_GET_PAGE_CHARS + PAGING_MARKER_HEADROOM_CHARS,
    howToGetMore: () => "call memory_get again with a larger offset.",
  },
  web_fetch: {
    maxChars: WEB_FETCH_PAGE_CHARS + PAGING_MARKER_HEADROOM_CHARS,
    howToGetMore: () => "call web_fetch again with a larger offset.",
  },
  web_search: {
    maxChars: 6_000,
    howToGetMore: () => "search again with a more specific query, or web_fetch one of the result URLs.",
  },
  memory_search: {
    maxChars: 8_000,
    howToGetMore: () => "search again with a smaller top_k or a more specific query, or read one result in full with memory_get and its chunk id.",
  },
  exec: {
    maxChars: 8_000,
    howToGetMore: () =>
      "re-run the command with narrower output (grep, head/tail, Select-Object), or redirect it to a file in the workspace and page through it with read startLine/endLine.",
  },
  browser_agent: {
    maxChars: (input) => resolveBrowserAgentMaxOutputChars(input?.maxOutputChars),
    howToGetMore: () =>
      `re-run with a larger maxOutputChars (up to ${BROWSER_AGENT_MAX_OUTPUT_CHARS}) or a narrower command (for example a snapshot of one selector).`,
  },
  grep: {
    maxChars: 12_000,
    howToGetMore: () => "grep again with a more specific pattern or a narrower path.",
  },
  ls: {
    maxChars: 8_000,
    howToGetMore: () => "ls a subdirectory instead.",
  },
});

export function resolveToolOutputCap(toolName: string): ToolOutputCap {
  return TOOL_OUTPUT_CAPS[String(toolName || "")] ?? {
    maxChars: DEFAULT_TOOL_OUTPUT_MAX_CHARS,
    howToGetMore: () => "call the tool again with narrower inputs.",
  };
}

export function resolveToolOutputMaxChars(toolName: string, input: ToolInput = {}): number {
  const cap = resolveToolOutputCap(toolName);
  return typeof cap.maxChars === "function" ? cap.maxChars(input || {}) : cap.maxChars;
}

function formatCount(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}

/**
 * The marker appended to cut output: what was shown (1-based, inclusive), how much was left out, and how to get
 * more. `unit` is "characters" or "lines".
 */
export function formatTruncationMarker(params: {
  unit: "characters" | "lines";
  shownFrom: number;
  shownTo: number;
  total: number;
  howToGetMore: string;
}): string {
  const { unit, shownFrom, shownTo, total, howToGetMore } = params;
  const remaining = Math.max(0, total - shownTo);
  return `\n\n${TRUNCATION_MARKER_PREFIX} showed ${unit} ${formatCount(shownFrom)}-${formatCount(shownTo)} of ${formatCount(total)}; ${formatCount(remaining)} more ${unit} not shown. To get more, ${howToGetMore}]`;
}

/**
 * Where to cut `text` so the kept part has at most `maxChars` characters: at the last line break in the final 10 %
 * of the budget when there is one (so lines stay whole), otherwise exactly at `maxChars`. Never splits a UTF-16
 * surrogate pair.
 */
export function findCutIndex(text: string, maxChars: number): number {
  if (text.length <= maxChars) return text.length;
  let cut = Math.max(0, Math.floor(maxChars));
  const newline = text.lastIndexOf("\n", cut - 1);
  if (newline >= 0 && newline >= Math.floor(cut * 0.9)) cut = newline + 1;
  const code = text.charCodeAt(cut - 1);
  if (cut > 0 && code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return cut;
}

/**
 * Applies the registry cap for `toolName` to one tool result. Output within the cap is returned unchanged.
 */
export function capToolOutput(toolName: string, input: ToolInput, output: string): { content: string; truncated: boolean } {
  const text = typeof output === "string" ? output : String(output ?? "");
  const maxChars = resolveToolOutputMaxChars(toolName, input);
  if (text.length <= maxChars) return { content: text, truncated: false };
  const cut = findCutIndex(text, maxChars);
  const marker = formatTruncationMarker({
    unit: "characters",
    shownFrom: 1,
    shownTo: cut,
    total: text.length,
    howToGetMore: resolveToolOutputCap(toolName).howToGetMore(input || {}),
  });
  return { content: `${text.slice(0, cut).trimEnd()}${marker}`, truncated: true };
}

/**
 * One page of `text` starting at character `offset` (0-based), for tools that page by offset (memory_get,
 * web_fetch). `nextCall` builds the sentence naming the call that returns the following page.
 */
export function pageTextByOffset(params: {
  text: string;
  offset: unknown;
  pageChars: number;
  nextCall: (nextOffset: number) => string;
}): { page: string; offset: number; nextOffset: number | null; total: number } {
  const text = String(params.text ?? "");
  const total = text.length;
  const requested = Number(params.offset);
  const offset = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), total) : 0;
  const rest = text.slice(offset);
  if (rest.length <= params.pageChars) return { page: rest, offset, nextOffset: null, total };
  const cut = findCutIndex(rest, params.pageChars);
  const nextOffset = offset + cut;
  const marker = formatTruncationMarker({
    unit: "characters",
    shownFrom: offset + 1,
    shownTo: nextOffset,
    total,
    howToGetMore: params.nextCall(nextOffset),
  });
  return { page: `${rest.slice(0, cut)}${marker}`, offset, nextOffset, total };
}
