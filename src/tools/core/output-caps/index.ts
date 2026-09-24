// Tool output ceilings: the single registry of how much of a tool's result may reach the model.
//
// `applyToolOutputCap` runs once in the executor on every tool result, so no tool can put an unbounded blob into
// the loop. Tools keep their own *fetch* limits (bytes downloaded, process output captured) and item shaping
// (e.g. web_search snippets); the output cut itself happens only here. The one exception is `read`, which cuts by
// whole lines itself (the marker must name line numbers) and stays within its registry cap, so the central pass is
// a no-op for it.
//
// Every cut appends one marker saying how much was cut and how to get more. Markers are deterministic (numbers
// only, no timestamps or locale formatting) so a repeated tool result stays byte-identical for prompt caching.

export interface ToolOutputCapContext {
  input: Record<string, unknown>;
  maxChars: number;
  /** Chars of the result that were kept (before the marker). */
  keptChars: number;
}

export interface ToolOutputLimit {
  /** Max chars of tool output kept; the marker (at most TOOL_OUTPUT_MARKER_MAX_CHARS) is appended after them. */
  maxChars: number;
  /** Per-call override from a numeric input field, clamped to [min, max] (browser_agent maxOutputChars). */
  inputOverride?: { field: string; min: number; max: number };
  /** Input field holding the char offset the result starts at (memory_get offset); used for the shown range. */
  offsetField?: string;
  /** How to get more of the output. */
  hint: string | ((context: ToolOutputCapContext) => string);
}

/** Applies to any tool not listed below (ls, write, edit, future tools). Typical outputs are far smaller. */
export const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 16_000;
/** Upper bound for the appended marker, so the hard ceiling of a result is maxChars + this. */
export const TOOL_OUTPUT_MARKER_MAX_CHARS = 400;

/** `read` without endLine returns at most this many lines, starting at startLine (default 1). */
export const READ_DEFAULT_WINDOW_LINES = 400;

/**
 * Max chars of one matched line in a `grep` hit. A longer line (minified code, one-line JSON) is shown as a window
 * of this many chars around the first match, with an inline `[line cut: ...]` note. The whole result is still capped
 * by TOOL_OUTPUT_LIMITS.grep.
 */
export const GREP_LINE_MAX_CHARS = 300;

// JSON results parsed by the domain adapters (services/gmail, services/coinbase). Their size is already bounded by
// the tools' own row limits (maxResults <= 30, limit <= 30), so this ceiling only stops a pathological payload;
// cutting one makes the adapter's JSON.parse fail, which it reports as a tool error.
const STRUCTURED_JSON_MAX_CHARS = 64_000;
const STRUCTURED_JSON_HINT = "Request fewer items (lower maxResults or limit) to get a complete result.";

const DEFAULT_HINT = "Ask the tool for a narrower result to see the rest.";

export const TOOL_OUTPUT_LIMITS: Readonly<Record<string, ToolOutputLimit>> = {
  // New in Stage 2 (was unlimited). The tool itself returns whole lines inside this cap; see file-tools.
  read: {
    maxChars: 20_000,
    hint: "Call read with startLine and endLine to see other lines.",
  },
  // Was 200 hits with no char cap (200 hits measured at 17-21k chars on this repo).
  grep: {
    maxChars: 24_000,
    hint: "Narrow the pattern or the path to see the remaining matches.",
  },
  // Was 16,000 chars of page body plus the title/source header; now the whole result.
  web_fetch: {
    maxChars: 18_000,
    hint: "The page is longer than one web_fetch returns; fetch a narrower URL (a specific section or subpage) for other parts.",
  },
  web_search: {
    maxChars: 6_000,
    hint: "Refine the query for more specific results.",
  },
  exec: {
    maxChars: 8_000,
    hint: "Narrow the command's output (filter it, or print a smaller part) to see the rest.",
  },
  browser_agent: {
    maxChars: 12_000,
    inputOverride: { field: "maxOutputChars", min: 1_000, max: 32_000 },
    hint: ({ maxChars }) => (maxChars < 32_000
      ? "Narrow the command (for example a scoped snapshot) or raise maxOutputChars (max 32000)."
      : "Narrow the command (for example a scoped snapshot) to see the rest."),
  },
  memory_search: {
    maxChars: 8_000,
    hint: "Lower top_k or refine the query; memory_get returns one source in full.",
  },
  // Was 32,000.
  memory_get: {
    maxChars: 12_000,
    offsetField: "offset",
    hint: ({ input, keptChars }) =>
      `Call memory_get with the same chunk_id and offset=${readOffset(input, "offset") + keptChars} to read the next part.`,
  },
};

const STRUCTURED_JSON_TOOL_PREFIXES = ["gmail_", "coinbase_", "phantom_"];

function readOffset(input: Record<string, unknown>, field: string): number {
  const value = Number(input?.[field]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function resolveLimit(toolName: string): ToolOutputLimit {
  const name = String(toolName || "").trim().toLowerCase();
  const listed = TOOL_OUTPUT_LIMITS[name];
  if (listed) return listed;
  if (STRUCTURED_JSON_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return { maxChars: STRUCTURED_JSON_MAX_CHARS, hint: STRUCTURED_JSON_HINT };
  }
  return { maxChars: DEFAULT_TOOL_OUTPUT_MAX_CHARS, hint: DEFAULT_HINT };
}

/** Max chars of output kept for one call of `toolName` (resolves per-call overrides). */
export function resolveToolOutputMaxChars(toolName: string, input: Record<string, unknown> = {}): number {
  const limit = resolveLimit(toolName);
  const override = limit.inputOverride;
  if (!override) return limit.maxChars;
  const requested = Number(input?.[override.field]);
  if (!Number.isFinite(requested) || requested <= 0) return limit.maxChars;
  return Math.min(override.max, Math.max(override.min, Math.floor(requested)));
}

/** Builds the marker; also used by `read`, which cuts by lines itself. Never longer than the marker bound. */
export function formatTruncationMarker(summary: string, hint: string): string {
  const text = `\n... [truncated: ${summary}${hint ? ` ${hint}` : ""}]`;
  return text.length <= TOOL_OUTPUT_MARKER_MAX_CHARS ? text : `${text.slice(0, TOOL_OUTPUT_MARKER_MAX_CHARS - 2)}]`;
}

/** Caps one tool result. Output within the cap is returned unchanged (same string). */
export function applyToolOutputCap(toolName: string, output: string, input: Record<string, unknown> = {}): string {
  if (typeof output !== "string") return output;
  const limit = resolveLimit(toolName);
  const maxChars = resolveToolOutputMaxChars(toolName, input);
  if (output.length <= maxChars) return output;
  const kept = output.slice(0, maxChars);
  const base = limit.offsetField ? readOffset(input, limit.offsetField) : 0;
  const total = base + output.length;
  const hint = typeof limit.hint === "function"
    ? limit.hint({ input, maxChars, keptChars: kept.length })
    : limit.hint;
  const summary = `showed chars ${base + 1}-${base + kept.length} of ${total}; ${total - base - kept.length} more not shown.`;
  return `${kept}${formatTruncationMarker(summary, hint)}`;
}

/** Short in-line cut for item shaping inside a tool (a search snippet, an error body). */
export function truncateInline(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [+${text.length - maxChars} chars]`;
}
