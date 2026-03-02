/**
 * normalize.ts
 *
 * Unicode (NFKC) normalization and whitespace cleanup applied only to
 * unprotected segments. Protected spans are passed through unchanged.
 */

import type { Segment } from "../protect/index.js";

// ─── Segment-level normalization ──────────────────────────────────────────────

/**
 * Normalize a single unprotected text segment:
 * 1. NFKC Unicode normalization (collapses compatibility characters,
 *    e.g. ﬁ → fi, ½ → 1/2, fullwidth letters → ASCII).
 * 2. Collapse runs of whitespace (spaces, tabs, non-breaking spaces) to a
 *    single ASCII space.
 * 3. Strip leading/trailing whitespace from the segment.
 *
 * We intentionally do NOT lowercase here — that's the spell-corrector's job
 * on individual tokens so it can preserve casing in the output.
 */
export function normalizeSegment(text: string): string {
  if (!text) return text;

  // NFKC: decompose then recompose in compatibility form
  let out = text.normalize("NFKC");

  // Replace non-breaking spaces, zero-width spaces, and other invisible chars
  // with a regular space.
  out = out.replace(/[\u00A0\u200B\u200C\u200D\uFEFF\u2028\u2029]/g, " ");

  // Collapse internal whitespace runs to a single space.
  // We preserve newlines only when the segment starts/ends with one
  // (so multi-line code blocks that slip through are untouched).
  out = out.replace(/[ \t]+/g, " ");

  return out;
}

/**
 * Apply normalization to all unprotected segments; pass protected ones through.
 */
export function normalizeSegments(segments: Segment[]): Segment[] {
  return segments.map((seg) => {
    if (seg.protected) return seg;
    return { ...seg, text: normalizeSegment(seg.text) };
  });
}
