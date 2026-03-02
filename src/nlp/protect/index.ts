/**
 * protect.ts
 *
 * Identifies protected spans in user text that must never be mutated by
 * normalization or spell correction. Returns a flat list of segments with
 * a `protected` flag so downstream stages can skip or pass through those spans.
 */

export interface Segment {
  text: string;
  protected: boolean;
  reason?: string;
}

// ─── Ordered protection rules ────────────────────────────────────────────────
// Each rule has a regex and a label. Rules are applied left-to-right; the
// first match at each position wins.

interface ProtectRule {
  pattern: RegExp;
  reason: string;
}

const PROTECT_RULES: ProtectRule[] = [
  // Fenced code blocks (``` ... ```)
  { pattern: /```[\s\S]*?```/g, reason: "code_fence" },
  // Inline code (`...`)
  { pattern: /`[^`]+`/g, reason: "inline_code" },
  // URLs (http / https / ftp)
  { pattern: /https?:\/\/[^\s<>"')\]]+|ftp:\/\/[^\s<>"')\]]+/gi, reason: "url" },
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, reason: "email" },
  // Windows absolute paths  (C:\foo\bar or \\server\share)
  { pattern: /(?:[A-Za-z]:\\|\\\\)[^\s"'<>|?*\x00-\x1f]+/g, reason: "win_path" },
  // POSIX absolute paths  (/usr/local/bin/foo or ~/something)
  { pattern: /(?:~\/|\/)[a-zA-Z0-9._\-/]+(?:\.[a-zA-Z0-9]+)?/g, reason: "posix_path" },
  // Environment variable names  (ALL_CAPS_WITH_UNDERSCORES, optionally prefixed $)
  { pattern: /\$?[A-Z][A-Z0-9_]{3,}(?=\s|$|[^a-zA-Z0-9_])/g, reason: "env_var" },
  // UUIDs
  { pattern: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, reason: "uuid" },
  // Hex strings (0x prefix, 6+ chars, or bare 32+ char hex runs)
  { pattern: /\b0x[0-9a-fA-F]{4,}\b|\b[0-9a-fA-F]{32,}\b/g, reason: "hex" },
  // Numbers (integers, decimals, negatives, percentages, currency)
  { pattern: /[+-]?\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?[%$]?/g, reason: "number" },
  // ISO dates / times  (2024-01-15, 14:30:00, 2024-01-15T14:30:00Z)
  { pattern: /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?\b/g, reason: "iso_date" },
  // Time literals  (3:45pm, 14:30)
  { pattern: /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[apAP][mM])?\b/g, reason: "time" },
  // Semantic version strings  (v1.2.3, 1.2.3-beta.1)
  { pattern: /\bv?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?\b/g, reason: "semver" },
  // npm-style scoped packages  (@scope/package)
  { pattern: /@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/g, reason: "npm_package" },
];

// ─── Core splitter ────────────────────────────────────────────────────────────

/**
 * Split `text` into an ordered list of segments.
 * Protected segments must not be modified by any downstream stage.
 */
export function splitProtectedSegments(text: string): Segment[] {
  if (!text) return [{ text: "", protected: false }];

  // Build a flat list of [start, end, reason] spans from all rules.
  // We merge overlapping spans (first-rule priority).
  const spans: Array<{ start: number; end: number; reason: string }> = [];

  for (const rule of PROTECT_RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      // Only add if not already covered by an earlier (higher-priority) span
      const overlaps = spans.some((s) => start < s.end && end > s.start);
      if (!overlaps) {
        spans.push({ start, end, reason: rule.reason });
      }
    }
  }

  // Sort spans by start position
  spans.sort((a, b) => a.start - b.start);

  // Build segment list
  const segments: Segment[] = [];
  let cursor = 0;

  for (const span of spans) {
    if (span.start > cursor) {
      segments.push({ text: text.slice(cursor, span.start), protected: false });
    }
    segments.push({ text: text.slice(span.start, span.end), protected: true, reason: span.reason });
    cursor = span.end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), protected: false });
  }

  return segments.filter((s) => s.text.length > 0);
}

/**
 * Reassemble segments back into a single string.
 */
export function reassembleSegments(segments: Segment[]): string {
  return segments.map((s) => s.text).join("");
}
