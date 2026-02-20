/**
 * preprocess.ts
 *
 * Orchestrates the full NLP preprocessing pipeline:
 *   protect → normalize → spellcorrect → reassemble
 *
 * Output:
 *   {
 *     raw_text:    string,             // original, never mutated
 *     clean_text:  string,             // corrected/normalized version
 *     corrections: CorrectionRecord[], // what changed and why
 *     confidence:  number,             // 0-1 overall confidence
 *   }
 *
 * Use clean_text for: tool routing, web search queries, memory recall, LLM.
 * Use raw_text for:   UI display, message persistence.
 */

import { splitProtectedSegments, reassembleSegments } from "./protect.js";
import { normalizeSegments } from "./normalize.js";
import { correctSegmentsAsync, warmSpellChecker, type CorrectionRecord } from "./spellcorrect.js";

export type { CorrectionRecord };

export interface PreprocessResult {
  raw_text: string;
  clean_text: string;
  corrections: CorrectionRecord[];
  /** 1.0 if no corrections; average correction confidence otherwise. */
  confidence: number;
}

/**
 * Run the full preprocessing pipeline on user input text.
 * Returns a Promise — the spell checker loads asynchronously on first call
 * (~20ms warm-up), then all subsequent calls are fast.
 *
 * Never throws — falls back to raw_text on any internal error.
 */
export async function preprocess(rawText: string): Promise<PreprocessResult> {
  const raw_text = String(rawText ?? "");

  if (raw_text.trim().length < 3) {
    return { raw_text, clean_text: raw_text, corrections: [], confidence: 1.0 };
  }

  try {
    const segments = splitProtectedSegments(raw_text);
    const normalized = normalizeSegments(segments);
    const { segments: corrected, corrections } = await correctSegmentsAsync(normalized);
    const clean_text = reassembleSegments(corrected);

    const confidence =
      corrections.length === 0
        ? 1.0
        : corrections.reduce((sum, c) => sum + c.confidence, 0) / corrections.length;

    return { raw_text, clean_text, corrections, confidence };
  } catch {
    return { raw_text, clean_text: raw_text, corrections: [], confidence: 1.0 };
  }
}

/**
 * Pre-warm the spell checker at startup so the first message doesn't pay
 * the dictionary load cost (~20ms).
 */
export { warmSpellChecker };

/**
 * Log a redacted summary of corrections (no user content, just metadata).
 */
export function logCorrections(result: PreprocessResult, context = ""): void {
  if (result.corrections.length === 0) return;
  const prefix = context ? `[NLP:${context}]` : "[NLP]";
  const summary = result.corrections
    .map((c) => `${c.reason}(conf=${c.confidence.toFixed(2)})`)
    .join(", ");
  console.log(`${prefix} ${result.corrections.length} correction(s): ${summary}`);
}
