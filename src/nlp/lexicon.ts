/**
 * lexicon.ts
 *
 * Token-skip heuristics for spell correction.
 *
 * The goal is NOT a hardcoded list of brands or proper nouns — that approach
 * is brittle and never complete. Instead we use structural/orthographic
 * heuristics that catch the broad classes of tokens that should never be
 * corrected:
 *
 *   - Too short or too long to correct safely
 *   - Contains digits (version numbers, model names, IDs, dates)
 *   - Mixed case that isn't simple Title Case (camelCase, PascalCase, acronyms)
 *   - Looks like a file extension, flag, or CLI option
 *   - Looks like a contraction fragment
 *   - Starts with uppercase AND the dictionary doesn't know the lowercase form
 *     (handled in spellcorrect.ts — proper nouns pass through)
 *
 * User-extensible: call addSkipWords() to add project-specific terms that
 * should never be corrected (e.g. internal codenames, custom commands).
 */

// ─── Length bounds ────────────────────────────────────────────────────────────

const MIN_TOKEN_LEN = 3;   // "go", "ok", "hi" — too risky to correct
const MAX_TOKEN_LEN = 30;  // very long tokens are likely identifiers

// High-signal domain terms that should be preserved verbatim.
const DEFAULT_SKIP_WORDS = new Set<string>([
  "crypto",
]);

// ─── User-extensible skip set ─────────────────────────────────────────────────

const USER_SKIP_WORDS = new Set<string>();

/**
 * Add words that should never be spell-corrected.
 * Case-insensitive. Use for project-specific jargon, internal codenames, etc.
 */
export function addSkipWords(words: string[]): void {
  for (const w of words) {
    USER_SKIP_WORDS.add(w.toLowerCase().trim());
  }
}

/** @deprecated Use addSkipWords instead. */
export function addLexiconTerms(terms: string[]): void {
  addSkipWords(terms);
}

// ─── Structural heuristics ────────────────────────────────────────────────────

/**
 * Returns true if this token should be passed through without any
 * spell-correction attempt.
 */
export function isSkippableToken(token: string): boolean {
  if (!token) return true;

  const len = token.length;

  // Length bounds
  if (len < MIN_TOKEN_LEN || len > MAX_TOKEN_LEN) return true;

  // Default and user-added skip words
  const lower = token.toLowerCase();
  if (DEFAULT_SKIP_WORDS.has(lower) || USER_SKIP_WORDS.has(lower)) return true;

  // Contains any digit — version numbers, model names, dates, IDs
  if (/\d/.test(token)) return true;

  // Contraction fragments that start with apostrophe
  if (token.startsWith("'")) return true;

  // CLI flags / options: --flag, -f
  if (/^-/.test(token)) return true;

  // File extensions as standalone tokens: .tsx, .json
  if (/^\.[a-zA-Z]{1,8}$/.test(token)) return true;

  // ALL_CAPS — acronyms, constants, env vars
  if (token === token.toUpperCase() && len >= 2) return true;

  // camelCase or PascalCase with multiple humps — identifiers
  // Detects: myFunction, MyComponent, getUserById, XMLParser
  if (/[a-z][A-Z]/.test(token) || /[A-Z]{2,}[a-z]/.test(token)) return true;

  // kebab-case-with-multiple-segments — likely a slug or identifier
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}$/.test(token)) return true;

  return false;
}

/**
 * @deprecated Use isSkippableToken instead.
 */
export function isLexiconTerm(token: string): boolean {
  return isSkippableToken(token);
}
