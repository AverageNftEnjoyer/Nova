/**
 * spellcorrect.ts
 *
 * Spell correction backed by nspell + dictionary-en (Hunspell, ~200k word forms).
 * This gives broad coverage of English misspellings without any hardcoded word
 * lists or domain-specific hacks.
 *
 * Algorithm per token:
 *   1. Skip tokens that should never be corrected (see shouldSkip()).
 *   2. If the token is already correct per the dictionary, pass through.
 *   3. Get suggestions from nspell (ranked by edit distance + frequency).
 *   4. Accept the top suggestion only when confidence is high:
 *        - Single unambiguous suggestion, OR
 *        - Top suggestion has a clear edit-distance advantage over the second.
 *   5. Preserve the original token's casing in the corrected output.
 *
 * The dictionary is loaded once and cached. On first call there is a small
 * (~20ms) warm-up; all subsequent calls are synchronous and fast.
 */

import type { Segment } from "./protect.js";
import { isSkippableToken } from "./lexicon.js";

// ─── Informal English direct substitutions ───────────────────────────────────
// These are common informal/phonetic forms that the Hunspell dictionary either
// doesn't know or ranks incorrectly. This is NOT a brand/domain list — it is
// purely informal English that any English speaker would write.
// Keep this small and high-confidence only.

const INFORMAL_SUBS = new Map<string, string>([
  // Phonetic night/time words Hunspell doesn't handle well
  ["nite", "night"],
  ["tonite", "tonight"],
  ["tonigt", "tonight"],
  // Contractions written without apostrophe (Hunspell returns no suggestions)
  ["whats", "what's"],
  ["hows", "how's"],
  ["wheres", "where's"],
  ["whos", "who's"],
  ["thats", "that's"],
  ["theres", "there's"],
  ["heres", "here's"],
  ["lets", "let's"],
  ["doesnt", "doesn't"],
  ["dont", "don't"],
  ["cant", "can't"],
  ["wont", "won't"],
  ["isnt", "isn't"],
  ["arent", "aren't"],
  ["wasnt", "wasn't"],
  ["werent", "weren't"],
  ["havent", "haven't"],
  ["hasnt", "hasn't"],
  ["hadnt", "hadn't"],
  ["didnt", "didn't"],
  ["wouldnt", "wouldn't"],
  ["couldnt", "couldn't"],
  ["shouldnt", "shouldn't"],
  ["im", "I'm"],
  ["ive", "I've"],
  ["youre", "you're"],
  ["youve", "you've"],
  ["youll", "you'll"],
  ["theyre", "they're"],
  ["theyve", "they've"],
  ["theyll", "they'll"],
  ["weve", "we've"],
  ["hes", "he's"],
  ["shes", "she's"],
  // Common through/though/although shortenings
  ["thru", "through"],
  ["tho", "though"],
  ["altho", "although"],
  // Common informal adverbs
  ["prolly", "probably"],
  ["def", "definitely"],
  ["rly", "really"],
  ["tbh", "to be honest"],
  ["btw", "by the way"],
  ["imo", "in my opinion"],
  ["rn", "right now"],
  ["atm", "at the moment"],
  // Common verb shortenings
  ["gonna", "going to"],
  ["wanna", "want to"],
  ["gotta", "got to"],
  ["kinda", "kind of"],
  ["sorta", "sort of"],
  ["hafta", "have to"],
  ["outta", "out of"],
  ["lemme", "let me"],
  ["gimme", "give me"],
  ["dunno", "don't know"],
]);

// ─── nspell lazy singleton ────────────────────────────────────────────────────

interface NSpellInstance {
  correct(word: string): boolean;
  suggest(word: string): string[];
  add(word: string): void;
}

let _spell: NSpellInstance | null = null;
let _spellLoading: Promise<NSpellInstance> | null = null;

async function loadSpell(): Promise<NSpellInstance> {
  if (_spell) return _spell;
  if (_spellLoading) return _spellLoading;

  _spellLoading = (async () => {
    // Dynamic imports — nspell and dictionary-en are CJS/ESM compatible
    const [nspellMod, dictMod] = await Promise.all([
      import("nspell"),
      import("dictionary-en"),
    ]);
    const NSpell = (nspellMod as { default: (aff: unknown, dic: unknown) => NSpellInstance }).default;
    const dict = (dictMod as { default: { aff: unknown; dic: unknown } }).default;
    _spell = NSpell(dict.aff, dict.dic);
    return _spell;
  })();

  return _spellLoading;
}

/**
 * Pre-warm the spell checker. Call at startup so the first user message
 * doesn't pay the load cost.
 */
export async function warmSpellChecker(): Promise<void> {
  await loadSpell();
}

/**
 * Add custom words to the spell checker (e.g. project-specific terms).
 * Words added here are treated as correctly spelled and never corrected.
 */
export async function addCustomWords(words: string[]): Promise<void> {
  const spell = await loadSpell();
  for (const w of words) {
    spell.add(w);
  }
}

// ─── Token-level correction ───────────────────────────────────────────────────

export interface CorrectionRecord {
  from: string;
  to: string;
  reason: string;
  confidence: number;
  offsets?: [number, number];
}

interface TokenCorrection {
  original: string;
  corrected: string;
  record: CorrectionRecord | null;
}

/**
 * Estimate confidence in nspell's top suggestion.
 *
 * nspell ranks suggestions by a combination of edit distance and frequency.
 * We can't rely on our own edit distance calculation matching nspell's internal
 * ranking, so we use the suggestion list structure as the primary signal:
 *
 *   - Very few suggestions (1-2) → high confidence (nspell is sure)
 *   - Many suggestions → lower confidence (ambiguous)
 *   - Large length difference between token and best suggestion → penalise
 *
 * We also compute edit distance between the token and the top suggestion
 * to gate on how far the correction is.
 */
function scoreSuggestions(token: string, suggestions: string[]): { best: string; confidence: number } | null {
  if (suggestions.length === 0) return null;

  const lower = token.toLowerCase();

  // nspell ranks by frequency, not edit distance. We want the suggestion
  // with the smallest edit distance. Among ties on edit distance, prefer:
  //   1. Pure transposition of the input (most common typing error, highest precision)
  //   2. Same length as the input
  //   3. nspell's frequency rank as a final tiebreaker
  const ranked = suggestions
    .map((s, rank) => {
      const sl = s.toLowerCase();
      const dist = approxEditDist(lower, sl);
      const lenDiff = Math.abs(s.length - lower.length);
      // A pure transposition: same length, exactly one pair of adjacent swapped chars
      const isPureTransposition = s.length === lower.length && dist === 1 && isPureSwap(lower, sl);
      return { s, rank, dist, lenDiff, isPureTransposition };
    })
    .filter((x) => x.dist <= 2)
    .sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      // Pure transpositions first (most likely intended word)
      if (a.isPureTransposition !== b.isPureTransposition) return a.isPureTransposition ? -1 : 1;
      if (a.lenDiff !== b.lenDiff) return a.lenDiff - b.lenDiff;
      return a.rank - b.rank;
    });

  if (ranked.length === 0) return null;

  const best = ranked[0];
  if (best.s.toLowerCase() === lower) return null;

  // Count how many suggestions share the minimum edit distance
  const minDist = best.dist;
  const tiedCount = ranked.filter((x) => x.dist === minDist).length;

  // Base confidence from suggestion count (fewer = more confident)
  const n = suggestions.length;
  let confidence: number;
  if (n === 1) {
    confidence = 0.92;
  } else if (n === 2) {
    confidence = 0.88;
  } else if (n <= 4) {
    confidence = 0.82;
  } else if (n <= 8) {
    confidence = 0.76;
  } else if (n <= 15) {
    confidence = 0.68;
  } else {
    return null; // too ambiguous
  }

  // Adjust for edit distance
  if (minDist === 2) confidence -= 0.06;

  // Penalise ties at the same edit distance (multiple equally-close candidates)
  if (tiedCount >= 3) confidence -= 0.14;
  else if (tiedCount >= 2) confidence -= 0.07;

  // Penalise large length changes
  const lenDiff = Math.abs(best.s.length - lower.length);
  if (lenDiff >= 3) confidence -= 0.08;

  // Character-set overlap guard: if the unique characters in the token and the
  // best suggestion are too dissimilar, the correction is likely a wrong-word
  // substitution rather than a typo fix (e.g. spotify→specify, youtube→couture).
  // Genuine typos almost always share ≥70% of their unique character set.
  const tokenChars = new Set(lower.split(""));
  const bestChars = new Set(best.s.toLowerCase().split(""));
  const union = new Set([...tokenChars, ...bestChars]);
  const intersection = [...tokenChars].filter((c) => bestChars.has(c)).length;
  const overlapRatio = intersection / union.size;
  if (overlapRatio < 0.70) return null;

  if (confidence < 0.72) return null;

  return { best: best.s, confidence };
}

/**
 * Damerau-Levenshtein edit distance (includes transpositions), capped at 3.
 * Transpositions are critical for catching swapped-character typos like
 * "ocmmans" → "commands" (oc↔co swap).
 */
function approxEditDist(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 3) return 4;

  // Full DL distance using two-row DP
  const prev2 = new Array<number>(lb + 1).fill(0);
  const prev = Array.from({ length: lb + 1 }, (_, i) => i);
  const curr = new Array<number>(lb + 1).fill(0);

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      // Transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        curr[j] = Math.min(curr[j], prev2[j - 2] + cost);
      }
    }
    prev2.splice(0, prev2.length, ...prev);
    prev.splice(0, prev.length, ...curr);
  }
  return Math.min(prev[lb], 3);
}

/**
 * Returns true if `b` is exactly `a` with one pair of adjacent characters swapped.
 * e.g. isPureSwap("shwo", "show") → true  (w↔o)
 *      isPureSwap("yrok", "york") → true  (r↔o)
 */
function isPureSwap(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diffs = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diffs++;
    if (diffs > 2) return false;
  }
  if (diffs !== 2) return false;
  // Find the two differing positions and check they're adjacent and swapped
  const pos: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) pos.push(i);
  }
  return pos.length === 2 && pos[1] === pos[0] + 1 && a[pos[0]] === b[pos[1]] && a[pos[1]] === b[pos[0]];
}

/** Restore the casing pattern of `original` onto `corrected`. */
function preserveCasing(original: string, corrected: string): string {
  if (!original || !corrected) return corrected;
  if (original === original.toUpperCase()) return corrected.toUpperCase();
  if (
    original[0] === original[0].toUpperCase() &&
    original.slice(1) === original.slice(1).toLowerCase()
  ) {
    return corrected[0].toUpperCase() + corrected.slice(1);
  }
  return corrected; // lowercase or mixed — return as-is from dictionary
}

/**
 * Attempt to correct a single word token using the live spell checker.
 * Returns synchronously if the checker is already loaded; otherwise defers.
 */
export async function correctTokenAsync(token: string, charOffset = 0): Promise<TokenCorrection> {
  const spell = await loadSpell();
  return correctTokenWithSpell(spell, token, charOffset);
}

function correctTokenWithSpell(spell: NSpellInstance, token: string, charOffset: number): TokenCorrection {
  const noop: TokenCorrection = { original: token, corrected: token, record: null };

  // Structural guards — things that should never be corrected
  if (isSkippableToken(token)) return noop;

  const lower = token.toLowerCase();

  // Check informal substitution table first (handles forms the dictionary
  // doesn't know or ranks incorrectly, e.g. nite→night, whats→what's)
  const informalSub = INFORMAL_SUBS.get(lower);
  if (informalSub) {
    const corrected = preserveCasing(token, informalSub);
    return {
      original: token,
      corrected,
      record: {
        from: token,
        to: corrected,
        reason: "informal_form",
        confidence: 0.90,
        offsets: [charOffset, charOffset + token.length],
      },
    };
  }

  // Already correct per the dictionary
  if (spell.correct(token)) return noop;

  // Proper noun heuristic: if the token starts with an uppercase letter and
  // the lowercase form is also unknown to the dictionary, treat it as a
  // proper noun (brand, person, place) and skip without correcting.
  if (token[0] === token[0].toUpperCase() && token[0] !== token[0].toLowerCase()) {
    if (!spell.correct(lower)) return noop;
  }

  const suggestions = spell.suggest(token);
  const scored = scoreSuggestions(token, suggestions);
  if (!scored) return noop;

  const corrected = preserveCasing(token, scored.best);
  if (corrected.toLowerCase() === lower) return noop;

  return {
    original: token,
    corrected,
    record: {
      from: token,
      to: corrected,
      reason: "spell_correction",
      confidence: scored.confidence,
      offsets: [charOffset, charOffset + token.length],
    },
  };
}

// ─── Segment-level correction ─────────────────────────────────────────────────

const TOKEN_RE = /([a-zA-Z']+|[^a-zA-Z']+)/g;

export interface SegmentCorrectionResult {
  text: string;
  corrections: CorrectionRecord[];
}

export async function correctSegmentsAsync(
  segments: Segment[],
): Promise<{ segments: Segment[]; corrections: CorrectionRecord[] }> {
  const spell = await loadSpell();
  const allCorrections: CorrectionRecord[] = [];
  let charOffset = 0;

  const correctedSegments = segments.map((seg) => {
    const segLen = seg.text.length;
    if (seg.protected) {
      charOffset += segLen;
      return seg;
    }

    const corrections: CorrectionRecord[] = [];
    let result = "";
    let localOffset = 0;

    TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TOKEN_RE.exec(seg.text)) !== null) {
      const chunk = match[0];
      if (/^[a-zA-Z']+$/.test(chunk)) {
        const fix = correctTokenWithSpell(spell, chunk, charOffset + localOffset);
        result += fix.corrected;
        if (fix.record) corrections.push(fix.record);
      } else {
        result += chunk;
      }
      localOffset += chunk.length;
    }

    allCorrections.push(...corrections);
    charOffset += segLen;
    return { ...seg, text: result };
  });

  return { segments: correctedSegments, corrections: allCorrections };
}
