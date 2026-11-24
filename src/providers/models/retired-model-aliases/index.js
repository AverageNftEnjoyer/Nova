// Retired model IDs -> current replacements, shared by the runtime, the HUD and migration 16.
// Dependency-free on purpose (like src/providers/pricing): the HUD, including client components, imports it.
//
// Only models that are RETIRED (requests fail) or officially REDIRECTED are listed. Models that are deprecated but
// still served keep working as stored (they are priced in LEGACY_MODEL_PRICING_USD_PER_1M), e.g. gpt-4.1,
// gpt-4.1-mini, gpt-4.1-nano (shutdown 2026-10-23), gpt-4o, gemini-2.5-pro / -flash / -flash-lite, claude-opus-4-5+,
// claude-sonnet-4-5 / 4-6, claude-haiku-4-5, grok-3-mini, grok-4.20-*. Re-check the pages below before adding one.
//
// Official sources, all read 2026-09-24:
//   Anthropic  https://platform.claude.com/docs/en/about-claude/model-deprecations
//   OpenAI     https://developers.openai.com/api/docs/deprecations
//   Google     https://ai.google.dev/gemini-api/docs/deprecations
//   xAI        https://docs.x.ai/developers/migration/may-15-retirement
//
// Replacement rule: same provider, same tier, and always a CURRENT model offered in Nova's pickers
// (src/providers/pricing *_MODEL_PRICING_USD_PER_1M), so a rewritten choice shows up as a normal picker entry.
// When the provider's documented replacement is itself a picker model it is used as is; otherwise (the documented
// replacement is an older, still-served model) the picker model of the same tier is used:
//   Anthropic documents claude-sonnet-4-6 / claude-opus-4-8 (both active, not in the pickers) -> claude-sonnet-5 /
//     claude-opus-5-5, the current Sonnet / Opus (claude-sonnet-5 is also cheaper than sonnet-4-6).
//   Google documents gemini-3.6-flash (served, not in the pickers) for retired Flash models -> gemini-3.8-flash,
//     the current stable Flash.
//   OpenAI's own later deprecations map gpt-4 / gpt-4o / o1 / o3-mini to gpt-5.6-sol and o4-mini to gpt-5.6-terra;
//     the older entries whose documented replacement (gpt-4.1, o3, o4-mini) is itself superseded follow that.
//   xAI documents a server-side redirect; the listed target is used (grok-4.3, grok-build-0.1).

const ANTHROPIC_DEPRECATIONS = "https://platform.claude.com/docs/en/about-claude/model-deprecations";
const OPENAI_DEPRECATIONS = "https://developers.openai.com/api/docs/deprecations";
const GOOGLE_DEPRECATIONS = "https://ai.google.dev/gemini-api/docs/deprecations";
const XAI_MAY_15_RETIREMENT = "https://docs.x.ai/developers/migration/may-15-retirement";

/** Exact retired IDs (lower case). */
export const RETIRED_MODEL_ALIASES = Object.freeze([
  // ----- Anthropic (requests to retired models fail) -----
  // Claude Opus 4.1, retired 2026-08-05 (documented replacement claude-opus-4-8). claude-opus-4-1 was its alias.
  { provider: "claude", id: "claude-opus-4-1-20250805", replacement: "claude-opus-5-5", retired: "2026-08-05", source: ANTHROPIC_DEPRECATIONS },
  { provider: "claude", id: "claude-opus-4-1", replacement: "claude-opus-5-5", retired: "2026-08-05", source: ANTHROPIC_DEPRECATIONS },
  // Claude Opus 4 / Sonnet 4, retired 2026-06-15 (documented replacements claude-opus-4-8 / claude-sonnet-4-6).
  // claude-opus-4-0 / claude-sonnet-4-0 were their aliases.
  { provider: "claude", id: "claude-opus-4-20250514", replacement: "claude-opus-5-5", retired: "2026-06-15", source: ANTHROPIC_DEPRECATIONS },
  { provider: "claude", id: "claude-opus-4-0", replacement: "claude-opus-5-5", retired: "2026-06-15", source: ANTHROPIC_DEPRECATIONS },
  { provider: "claude", id: "claude-sonnet-4-20250514", replacement: "claude-sonnet-5", retired: "2026-06-15", source: ANTHROPIC_DEPRECATIONS },
  { provider: "claude", id: "claude-sonnet-4-0", replacement: "claude-sonnet-5", retired: "2026-06-15", source: ANTHROPIC_DEPRECATIONS },

  // ----- OpenAI (shut down on or before 2026-09-24) -----
  // gpt-4.5-preview, shut down 2025-07-14 (documented replacement gpt-4.1, itself superseded).
  { provider: "openai", id: "gpt-4.5-preview", replacement: "gpt-5.6-sol", retired: "2025-07-14", source: OPENAI_DEPRECATIONS },
  { provider: "openai", id: "gpt-4.5-preview-2025-02-27", replacement: "gpt-5.6-sol", retired: "2025-07-14", source: OPENAI_DEPRECATIONS },
  // o1-preview, shut down 2025-07-28 (documented replacement o3; the o1 / o3 line now maps to gpt-5.6-sol).
  { provider: "openai", id: "o1-preview", replacement: "gpt-5.6-sol", retired: "2025-07-28", source: OPENAI_DEPRECATIONS },
  { provider: "openai", id: "o1-preview-2024-09-12", replacement: "gpt-5.6-sol", retired: "2025-07-28", source: OPENAI_DEPRECATIONS },
  // o1-mini, shut down 2025-10-27 (documented replacement o4-mini, whose own replacement is gpt-5.6-terra).
  { provider: "openai", id: "o1-mini", replacement: "gpt-5.6-terra", retired: "2025-10-27", source: OPENAI_DEPRECATIONS },
  { provider: "openai", id: "o1-mini-2024-09-12", replacement: "gpt-5.6-terra", retired: "2025-10-27", source: OPENAI_DEPRECATIONS },
  // chatgpt-4o-latest, shut down 2026-02-17 (documented replacement gpt-5.1-chat-latest; gpt-4o maps to gpt-5.6-sol).
  { provider: "openai", id: "chatgpt-4o-latest", replacement: "gpt-5.6-sol", retired: "2026-02-17", source: OPENAI_DEPRECATIONS },

  // ----- Google (shut down on or before 2026-09-24) -----
  // Gemini 2.5 Pro previews, shut down 2025-12-02 (documented replacement gemini-3.1-pro-preview).
  { provider: "gemini", id: "gemini-2.5-pro-preview-03-25", replacement: "gemini-3.1-pro-preview", retired: "2025-12-02", source: GOOGLE_DEPRECATIONS },
  { provider: "gemini", id: "gemini-2.5-pro-preview-05-06", replacement: "gemini-3.1-pro-preview", retired: "2025-12-02", source: GOOGLE_DEPRECATIONS },
  { provider: "gemini", id: "gemini-2.5-pro-preview-06-05", replacement: "gemini-3.1-pro-preview", retired: "2025-12-02", source: GOOGLE_DEPRECATIONS },
  // Gemini 2.5 Flash previews (documented replacement gemini-3.6-flash). The page spells the September preview
  // "-09-25"; its API code is "-09-2025" (as for the flash-lite preview below), so both spellings are mapped.
  { provider: "gemini", id: "gemini-2.5-flash-preview-05-20", replacement: "gemini-3.8-flash", retired: "2025-11-18", source: GOOGLE_DEPRECATIONS },
  { provider: "gemini", id: "gemini-2.5-flash-preview-09-25", replacement: "gemini-3.8-flash", retired: "2026-02-17", source: GOOGLE_DEPRECATIONS },
  { provider: "gemini", id: "gemini-2.5-flash-preview-09-2025", replacement: "gemini-3.8-flash", retired: "2026-02-17", source: GOOGLE_DEPRECATIONS },
  // Gemini 2.5 Flash-Lite preview, shut down 2026-03-31 (documented replacement gemini-3.1-flash-lite).
  { provider: "gemini", id: "gemini-2.5-flash-lite-preview-09-2025", replacement: "gemini-3.1-flash-lite", retired: "2026-03-31", source: GOOGLE_DEPRECATIONS },
  // Gemini 2.0 Flash, shut down 2026-06-01 (documented replacement gemini-3.6-flash).
  { provider: "gemini", id: "gemini-2.0-flash", replacement: "gemini-3.8-flash", retired: "2026-06-01", source: GOOGLE_DEPRECATIONS },
  { provider: "gemini", id: "gemini-2.0-flash-001", replacement: "gemini-3.8-flash", retired: "2026-06-01", source: GOOGLE_DEPRECATIONS },
  // Gemini 2.0 Flash-Lite, shut down 2026-06-01 (documented replacement gemini-3.1-flash-lite).
  { provider: "gemini", id: "gemini-2.0-flash-lite", replacement: "gemini-3.1-flash-lite", retired: "2026-06-01", source: GOOGLE_DEPRECATIONS },
  { provider: "gemini", id: "gemini-2.0-flash-lite-001", replacement: "gemini-3.1-flash-lite", retired: "2026-06-01", source: GOOGLE_DEPRECATIONS },
  // Gemini 2.0 Flash-Lite previews, shut down 2025-12-09 (documented replacement gemini-2.5-flash-lite, not a picker model).
  { provider: "gemini", id: "gemini-2.0-flash-lite-preview", replacement: "gemini-3.1-flash-lite", retired: "2025-12-09", source: GOOGLE_DEPRECATIONS },
  { provider: "gemini", id: "gemini-2.0-flash-lite-preview-02-05", replacement: "gemini-3.1-flash-lite", retired: "2025-12-09", source: GOOGLE_DEPRECATIONS },

  // ----- xAI (retired 2026-05-15; requests redirect server-side to the listed target) -----
  { provider: "grok", id: "grok-4-0709", replacement: "grok-4.3", retired: "2026-05-15", source: XAI_MAY_15_RETIREMENT },
  { provider: "grok", id: "grok-4-fast-reasoning", replacement: "grok-4.3", retired: "2026-05-15", source: XAI_MAY_15_RETIREMENT },
  { provider: "grok", id: "grok-4-fast-non-reasoning", replacement: "grok-4.3", retired: "2026-05-15", source: XAI_MAY_15_RETIREMENT },
  { provider: "grok", id: "grok-4-1-fast-reasoning", replacement: "grok-4.3", retired: "2026-05-15", source: XAI_MAY_15_RETIREMENT },
  { provider: "grok", id: "grok-4-1-fast-non-reasoning", replacement: "grok-4.3", retired: "2026-05-15", source: XAI_MAY_15_RETIREMENT },
  { provider: "grok", id: "grok-3", replacement: "grok-4.3", retired: "2026-05-15", source: XAI_MAY_15_RETIREMENT },
  { provider: "grok", id: "grok-code-fast-1", replacement: "grok-build-0.1", retired: "2026-05-15", source: XAI_MAY_15_RETIREMENT },
].map((entry) => Object.freeze(entry)));

/**
 * Whole families, only where the provider has retired EVERY model of the family (checked against the page).
 * Anthropic: every Claude 3 / 3.5 / 3.7 model is retired (claude-3-haiku-20240307 last, on 2026-04-20); the
 * documented replacements are Haiku -> claude-haiku-4-5-20251001, Sonnet -> claude-sonnet-4-6, Opus ->
 * claude-opus-4-8, mapped by tier to the picker models. Claude 2.x (retired 2025-07-21, replacement Opus) and
 * Claude 1.x / Instant (retired 2024-11-06, replacement claude-haiku-4-5-20251001) likewise. The patterns also cover
 * the old "-latest" aliases of those models.
 */
export const RETIRED_MODEL_FAMILIES = Object.freeze([
  { provider: "claude", pattern: /^claude-3(?:-[57])?-haiku(?:-|$)/, replacement: "claude-haiku-4-5-20251001", retired: "2026-04-20", source: ANTHROPIC_DEPRECATIONS, description: "claude-3*-haiku*" },
  { provider: "claude", pattern: /^claude-3(?:-[57])?-sonnet(?:-|$)/, replacement: "claude-sonnet-5", retired: "2026-02-19", source: ANTHROPIC_DEPRECATIONS, description: "claude-3*-sonnet*" },
  { provider: "claude", pattern: /^claude-3(?:-[57])?-opus(?:-|$)/, replacement: "claude-opus-5-5", retired: "2026-01-05", source: ANTHROPIC_DEPRECATIONS, description: "claude-3*-opus*" },
  { provider: "claude", pattern: /^claude-2(?:\.\d+)?$/, replacement: "claude-opus-5-5", retired: "2025-07-21", source: ANTHROPIC_DEPRECATIONS, description: "claude-2, claude-2.x" },
  { provider: "claude", pattern: /^claude-(?:instant-)?1(?:\.\d+)?$/, replacement: "claude-haiku-4-5-20251001", retired: "2024-11-06", source: ANTHROPIC_DEPRECATIONS, description: "claude-1.x, claude-instant-1.x" },
].map((entry) => Object.freeze(entry)));

const EXACT_BY_ID = new Map(RETIRED_MODEL_ALIASES.map((entry) => [entry.id, entry]));

function normalizeProvider(provider) {
  const key = String(provider || "").trim().toLowerCase();
  if (key === "anthropic") return "claude";
  if (key === "xai") return "grok";
  if (key === "google") return "gemini";
  return key;
}

/**
 * The retired-model entry that applies to `model`, or null. Case-insensitive, exact IDs first, then families.
 * With a provider, only that provider's entries match (a custom base URL of another provider may legitimately
 * serve an ID that one provider retired); without one, any provider's entry matches (IDs do not collide).
 */
export function findRetiredModel(provider, model) {
  const key = String(model || "").trim().toLowerCase();
  if (!key) return null;
  const providerKey = normalizeProvider(provider);
  const exact = EXACT_BY_ID.get(key);
  if (exact && (!providerKey || exact.provider === providerKey)) return exact;
  for (const family of RETIRED_MODEL_FAMILIES) {
    if (providerKey && family.provider !== providerKey) continue;
    if (family.pattern.test(key)) return family;
  }
  return null;
}

export function isRetiredModelId(provider, model) {
  return findRetiredModel(provider, model) !== null;
}

// IDs already reported by resolveCurrentModelId (one line per retired ID per process). No secrets are logged.
const reportedAliases = new Set();

/**
 * The model ID to send: the current replacement for a retired ID, otherwise `model` unchanged (trimmed).
 * Logs one line per retired ID per process unless `options.log === false` (pickers, migrations that log themselves).
 */
export function resolveCurrentModelId(provider, model, options = {}) {
  const trimmed = String(model ?? "").trim();
  const entry = findRetiredModel(provider, trimmed);
  if (!entry) return trimmed;
  if (options?.log !== false) {
    const key = trimmed.toLowerCase();
    if (!reportedAliases.has(key)) {
      reportedAliases.add(key);
      console.warn(
        `[Models] "${trimmed}" was retired by the provider on ${entry.retired}; using "${entry.replacement}" instead (${entry.source}).`,
      );
    }
  }
  return entry.replacement;
}

/** Every mapping, exact IDs first, then families (for docs, smokes and diagnostics). */
export function listRetiredModelAliases() {
  return [
    ...RETIRED_MODEL_ALIASES.map((entry) => ({ kind: "exact", match: entry.id, ...entry })),
    ...RETIRED_MODEL_FAMILIES.map(({ pattern, description, ...rest }) => ({
      kind: "family",
      match: description,
      pattern: pattern.source,
      ...rest,
    })),
  ];
}
