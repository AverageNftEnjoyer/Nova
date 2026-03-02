/**
 * Personality Profile — Constants
 *
 * Dimension definitions, context overlays, feedback patterns, and source weights.
 * All tuneable values live here — no magic numbers elsewhere.
 */

export const PERSONALITY_SCHEMA_VERSION = 1;
export const PERSONALITY_FILE_NAME = "personality-profile.json";
export const PERSONALITY_AUDIT_FILE_NAME = "personality-profile.jsonl";
export const PERSONALITY_PROMPT_MAX_TOKENS = Math.max(
  80,
  Number.parseInt(process.env.NOVA_PERSONALITY_PROMPT_MAX_TOKENS || "160", 10) || 160,
);
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_CANDIDATES_PER_DIMENSION = 8;
export const SCORE_ADD_PER_SIGNAL = 0.8;

// ── Behavior dimensions ────────────────────────────────────────────────────────
// Each has ordered values (low → high), decay config, and stability band.
// stabilityBand: required confidence delta before switching the selected value.

export const PERSONALITY_DIMENSIONS = {
  proactivity: {
    values: ["reactive", "balanced", "proactive"],
    halfLifeDays: 45,
    minActivation: 0.34,
    minMargin: 0.08,
    stabilityBand: 0.15,
    maxChars: 24,
    label: "Proactivity",
  },
  humor_level: {
    values: ["none", "subtle", "playful"],
    halfLifeDays: 60,
    minActivation: 0.33,
    minMargin: 0.09,
    stabilityBand: 0.12,
    maxChars: 24,
    label: "Humor",
  },
  risk_tolerance: {
    values: ["conservative", "balanced", "bold"],
    halfLifeDays: 90,
    minActivation: 0.38,
    minMargin: 0.10,
    stabilityBand: 0.18,
    maxChars: 24,
    label: "Risk tolerance",
  },
  structure_preference: {
    values: ["freeform", "mixed", "structured"],
    halfLifeDays: 45,
    minActivation: 0.35,
    minMargin: 0.08,
    stabilityBand: 0.10,
    maxChars: 24,
    label: "Response structure",
  },
  challenge_level: {
    values: ["supportive", "neutral", "challenger"],
    halfLifeDays: 60,
    minActivation: 0.35,
    minMargin: 0.10,
    stabilityBand: 0.14,
    maxChars: 24,
    label: "Challenge mode",
  },
};

// ── Context overlays ───────────────────────────────────────────────────────────
// Applied ON TOP of the base profile for this response only (non-persistent).
// null = do not override this dimension for this context.
// "upgrade_only" = only move value toward higher index, never lower.
// Explicit string = strict override regardless of base value.

export const CONTEXT_OVERLAYS = {
  coding: {
    structure_preference: "structured",
    proactivity: "proactive",
    challenge_level: "challenger",
    humor_level: null,
  },
  planning: {
    structure_preference: "structured",
    proactivity: "proactive",
    challenge_level: null,
    humor_level: null,
  },
  personal: {
    challenge_level: "supportive",
    structure_preference: "freeform",
    humor_level: "subtle",      // Upgrade to at least subtle; won't downgrade playful
    risk_tolerance: null,
  },
  finance: {
    risk_tolerance: "conservative",
    structure_preference: "structured",
    humor_level: { value: "none", strict: true }, // Strict — finance context removes humor
    challenge_level: null,
  },
  research: {
    structure_preference: "structured",
    challenge_level: "neutral",
    proactivity: "balanced",
    humor_level: null,
  },
  operations: {
    structure_preference: "structured",
    proactivity: "proactive",
    challenge_level: null,
    humor_level: null,
  },
};

// Dimensions where context overlay is a floor (upgrade only), not a strict override.
// An overlay entry can opt out of floor behavior per-context by using { value, strict: true }.
export const OVERLAY_FLOOR_DIMENSIONS = new Set(["humor_level", "proactivity"]);

// ── Source weights ─────────────────────────────────────────────────────────────
// Multiplied against signal.confidence before scoring.

export const PERSONALITY_SOURCE_WEIGHTS = {
  explicit_correction: 1.20,
  settings_sync: 1.00,
  memory_update: 0.90,
  user_message_inference: 0.55,
  transcript_observation: 0.50,
};

// ── Prompt instruction copy ────────────────────────────────────────────────────

export const DIMENSION_INSTRUCTIONS = {
  proactivity: {
    reactive: "Only answer what was directly asked. Do not offer unsolicited suggestions.",
    balanced: "Occasionally surface relevant next steps when clearly helpful.",
    proactive: "Actively surface next steps, spot issues, and suggest improvements unprompted.",
  },
  humor_level: {
    none: "Keep responses strictly professional. No humor or levity.",
    subtle: "Light wit is welcome when it fits naturally. Stay tasteful.",
    playful: "Humor and banter are welcome. Match the user's energy.",
  },
  risk_tolerance: {
    conservative: "Frame advice conservatively. Highlight risks and prefer safe defaults.",
    balanced: "Balance opportunity and risk in recommendations.",
    bold: "User tolerates risk. Favor ambitious options and decisive recommendations.",
  },
  structure_preference: {
    freeform: "Prefer flowing prose. Avoid over-structuring with bullets or headers.",
    mixed: "Mix prose and structure as the content warrants.",
    structured: "Use clear structure: bullets, headers, numbered lists as appropriate.",
  },
  challenge_level: {
    supportive: "Validate the user's approach. Be encouraging and affirming.",
    neutral: "Give balanced perspective without strong push-back.",
    challenger: "Respectfully challenge assumptions, push back on weak approaches, offer alternatives.",
  },
};

// ── Feedback patterns ──────────────────────────────────────────────────────────
// Matched against user messages. High-confidence when explicit_correction source.

export const FEEDBACK_PATTERNS = [
  {
    pattern: /\b(too|way too|very)\s+(verbose|long|wordy|detailed)\b/i,
    field: "structure_preference", value: "freeform", confidence: 0.90, source: "explicit_correction",
  },
  {
    pattern: /\b(more\s+detail|more\s+thorough|go\s+deeper|elaborate|expand\s+on)\b/i,
    field: "structure_preference", value: "structured", confidence: 0.82, source: "user_message_inference",
  },
  {
    pattern: /\b(be\s+more\s+direct|just\s+tell\s+me|get\s+to\s+the\s+point|stop\s+hedging)\b/i,
    field: "challenge_level", value: "challenger", confidence: 0.90, source: "explicit_correction",
  },
  {
    pattern: /\b(don'?t\s+(ask|give|add)\s+(follow[\-\s]?ups?|questions)|stop\s+asking\s+questions)\b/i,
    field: "proactivity", value: "reactive", confidence: 0.92, source: "explicit_correction",
  },
  {
    pattern: /\b(use\s+(bullets|bullet\s+points|headers?|numbered\s+lists?)|organize\s+(your|this|it)|add\s+structure)\b/i,
    field: "structure_preference", value: "structured", confidence: 0.85, source: "explicit_correction",
  },
  {
    pattern: /\b(no\s+(jokes?|humor|sarcasm)|keep\s+it\s+professional|stay\s+serious|be\s+serious)\b/i,
    field: "humor_level", value: "none", confidence: 0.90, source: "explicit_correction",
  },
  {
    pattern: /\b(be\s+more\s+casual|lighten\s+up|relax|you\s+can\s+be\s+funny|have\s+some\s+fun)\b/i,
    field: "humor_level", value: "playful", confidence: 0.82, source: "explicit_correction",
  },
  {
    pattern: /\b(be\s+more\s+careful|be\s+conservative|don'?t\s+take\s+risks?|play\s+it\s+safe)\b/i,
    field: "risk_tolerance", value: "conservative", confidence: 0.82, source: "explicit_correction",
  },
  {
    pattern: /\b(be\s+bold|think\s+bigger|take\s+(a\s+)?risk|push\s+the\s+envelope|go\s+bold)\b/i,
    field: "risk_tolerance", value: "bold", confidence: 0.78, source: "explicit_correction",
  },
  {
    pattern: /\b(just\s+answer|only\s+(answer|respond|reply)\s+what\s+i\s+ask|don'?t\s+add\s+extra)\b/i,
    field: "proactivity", value: "reactive", confidence: 0.88, source: "explicit_correction",
  },
  {
    pattern: /\b(what\s+should\s+i\s+do\s+next|suggest|what\s+else|next\s+steps?|what\s+do\s+you\s+recommend)\b/i,
    field: "proactivity", value: "proactive", confidence: 0.55, source: "user_message_inference",
  },
  {
    pattern: /\b(push\s+back|challenge\s+(me|that|this)|be\s+critical|poke\s+holes)\b/i,
    field: "challenge_level", value: "challenger", confidence: 0.82, source: "explicit_correction",
  },
  {
    pattern: /\b(be\s+supportive|encourage\s+me|validate\s+(this|that|my))\b/i,
    field: "challenge_level", value: "supportive", confidence: 0.80, source: "explicit_correction",
  },
];
