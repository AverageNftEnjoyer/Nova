/**
 * Personality Profile — Prompt Renderer
 *
 * Converts a personality dimension map into a compact system prompt section.
 * Token-budgeted, confidence-gated, and overlay-aware.
 */

import { PERSONALITY_DIMENSIONS, DIMENSION_INSTRUCTIONS, PERSONALITY_PROMPT_MAX_TOKENS } from "../constants/index.js";

const MIN_CONFIDENCE = 0.52;

function countApproxTokens(text) {
  return Math.ceil(String(text || "").length / 3.5);
}

/**
 * Render a single dimension to a prompt line.
 * Returns empty string if below min confidence or no instruction found.
 *
 * @param {string} field
 * @param {object} dimState
 * @returns {string}
 */
function renderDimension(field, dimState) {
  if (!dimState) return "";
  const value = String(dimState.selectedValue || "").trim();
  const confidence = Number(dimState.selectedConfidence || 0);
  if (!value || confidence < MIN_CONFIDENCE) return "";

  const instruction = DIMENSION_INSTRUCTIONS[field]?.[value];
  if (!instruction) return "";

  const label = PERSONALITY_DIMENSIONS[field]?.label || field;
  const suffix = dimState._overlayApplied ? " [context]" : "";
  return `- ${label}${suffix}: ${instruction}`;
}

/**
 * Build the Personality Calibration prompt section from overlaid dimension map.
 *
 * @param {object} dimensions — result of applyContextOverlay()
 * @param {{ maxTokens?: number }} opts
 * @returns {string}
 */
export function buildPersonalityPromptSection(dimensions, opts = {}) {
  if (!dimensions || typeof dimensions !== "object") return "";

  const maxTokens = Math.max(60, Number(opts.maxTokens || PERSONALITY_PROMPT_MAX_TOKENS));

  const lines = [
    "Personality calibration (learned per-user, context-adaptive):",
    ...Object.keys(PERSONALITY_DIMENSIONS).map((field) => renderDimension(field, dimensions[field])),
  ];

  const filtered = lines.map((l) => String(l).trim()).filter(Boolean);
  if (filtered.length <= 1) return ""; // Only the header line — nothing to inject

  const out = [];
  for (const line of filtered) {
    const candidate = [...out, line].join("\n");
    if (countApproxTokens(candidate) > maxTokens) break;
    out.push(line);
  }

  return out.length > 1 ? out.join("\n") : "";
}
