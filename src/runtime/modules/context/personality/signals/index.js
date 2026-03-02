/**
 * Personality Profile — Signal Extraction
 *
 * Converts raw inputs (user text, HUD settings) into typed personality signals.
 * Signals are consumed by the engine for scoring and candidate management.
 */

import { FEEDBACK_PATTERNS, PERSONALITY_SOURCE_WEIGHTS, PERSONALITY_DIMENSIONS } from "../constants/index.js";

/**
 * Apply source weight to a raw confidence value.
 * @param {number} confidence
 * @param {string} source
 * @returns {number}
 */
function weightedConfidence(confidence, source) {
  const weight = Number(PERSONALITY_SOURCE_WEIGHTS[source] || 0.5);
  return Math.min(1.0, Number(confidence) * weight);
}

/**
 * Validate that a value is legal for a given dimension.
 * @param {string} field
 * @param {string} value
 * @returns {boolean}
 */
function isValidDimensionValue(field, value) {
  const dim = PERSONALITY_DIMENSIONS[field];
  if (!dim) return false;
  return dim.values.includes(String(value || "").trim());
}

/**
 * Extract feedback signals by pattern-matching user text.
 * Returns high-confidence signals for explicit corrections like
 * "be more direct", "too verbose", "don't ask follow-ups".
 *
 * @param {string} userText
 * @returns {Array<{field: string, value: string, confidence: number, source: string, reason: string}>}
 */
export function extractFeedbackSignals(userText) {
  const text = String(userText || "").trim();
  if (!text) return [];

  const signals = [];
  for (const { pattern, field, value, confidence, source } of FEEDBACK_PATTERNS) {
    if (!pattern.test(text)) continue;
    if (!isValidDimensionValue(field, value)) continue;
    signals.push({
      field,
      value,
      confidence: weightedConfidence(confidence, source),
      source,
      reason: "feedback_pattern_match",
    });
  }
  return signals;
}

/**
 * Extract settings-sync signals from HUD seed data.
 * These have the highest possible confidence (user explicitly set them in settings).
 *
 * @param {object|null} seedData — seed.data from HUD settings_sync
 * @returns {Array<{field: string, value: string, confidence: number, source: string, reason: string}>}
 */
export function extractSettingsSignals(seedData) {
  if (!seedData || typeof seedData !== "object") return [];

  const SETTINGS_KEYS = [
    "proactivity",
    "humor_level",
    "risk_tolerance",
    "structure_preference",
    "challenge_level",
  ];

  const signals = [];
  for (const field of SETTINGS_KEYS) {
    const value = String(seedData[field] || "").trim();
    if (!value || !isValidDimensionValue(field, value)) continue;
    signals.push({
      field,
      value,
      confidence: weightedConfidence(1.0, "settings_sync"),
      source: "settings_sync",
      reason: `seed_${field}`,
    });
  }
  return signals;
}

/**
 * Extract memory-update signals from a parsed MEMORY.md section.
 * Looks for lines like: "proactivity: proactive" or "humor_level: subtle".
 *
 * @param {string} memoryText
 * @returns {Array<{field: string, value: string, confidence: number, source: string, reason: string}>}
 */
export function extractMemorySignals(memoryText) {
  const text = String(memoryText || "").trim();
  if (!text) return [];

  const signals = [];
  for (const field of Object.keys(PERSONALITY_DIMENSIONS)) {
    const pattern = new RegExp(`(?<![a-z0-9_])${field}(?![a-z0-9_])\\s*[=:]+\\s*(\\S+)`, "i");
    const match = pattern.exec(text);
    if (!match) continue;
    const value = String(match[1] || "").toLowerCase().trim();
    if (!isValidDimensionValue(field, value)) continue;
    signals.push({
      field,
      value,
      confidence: weightedConfidence(0.88, "memory_update"),
      source: "memory_update",
      reason: "memory_text_inference",
    });
  }
  return signals;
}
