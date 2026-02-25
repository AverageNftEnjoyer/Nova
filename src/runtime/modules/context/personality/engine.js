/**
 * Personality Profile — Engine
 *
 * Core scoring, candidate management, winner selection (with stability band),
 * and context overlay application. Stateless functions operating on profiles.
 */

import {
  PERSONALITY_DIMENSIONS,
  CONTEXT_OVERLAYS,
  OVERLAY_FLOOR_DIMENSIONS,
  PERSONALITY_SCHEMA_VERSION,
  DAY_MS,
  MAX_CANDIDATES_PER_DIMENSION,
  SCORE_ADD_PER_SIGNAL,
} from "./constants.js";

// ── Profile factory ───────────────────────────────────────────────────────────

/**
 * Create an empty personality profile for a new user.
 * @param {{ userContextId?: string, nowMs?: number }} opts
 * @returns {object}
 */
export function createEmptyPersonalityProfile({ userContextId = "", nowMs = Date.now() } = {}) {
  const dimensions = {};
  for (const key of Object.keys(PERSONALITY_DIMENSIONS)) {
    dimensions[key] = {
      candidates: [],
      selectedValue: null,
      selectedConfidence: 0,
      selectedSource: null,
      selectedUpdatedAt: 0,
    };
  }
  return {
    schemaVersion: PERSONALITY_SCHEMA_VERSION,
    userContextId,
    dimensions,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
}

// ── Decay ─────────────────────────────────────────────────────────────────────

function decayedScore(score, updatedAt, halfLifeDays, nowMs) {
  const ageMs = Math.max(0, nowMs - Number(updatedAt || 0));
  const halfLifeMs = Number(halfLifeDays) * DAY_MS;
  if (halfLifeMs <= 0) return Number(score);
  return Number(score) * Math.pow(0.5, ageMs / halfLifeMs);
}

// ── Candidate management ──────────────────────────────────────────────────────

function upsertCandidate(candidates, signal, halfLifeDays, nowMs) {
  const existing = candidates.find((c) => c.value === signal.value);
  if (existing) {
    const decayed = decayedScore(existing.score, existing.updatedAt, halfLifeDays, nowMs);
    existing.score = decayed + signal.confidence * SCORE_ADD_PER_SIGNAL;
    existing.confidence = Math.min(1, signal.confidence);
    existing.source = signal.source;
    existing.updatedAt = nowMs;
  } else {
    candidates.push({
      value: signal.value,
      score: signal.confidence * SCORE_ADD_PER_SIGNAL,
      confidence: signal.confidence,
      source: signal.source,
      updatedAt: nowMs,
    });
  }
  // Keep only top N candidates by score
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > MAX_CANDIDATES_PER_DIMENSION) {
    candidates.length = MAX_CANDIDATES_PER_DIMENSION;
  }
}

// ── Winner selection (margin + stability band) ────────────────────────────────

/**
 * Select winner from candidates using:
 * 1. Minimum activation threshold
 * 2. Margin over second-place candidate
 * 3. Stability band — require meaningful delta before switching
 *
 * @param {object} dimState  Current dimension state
 * @param {object} dimConfig PERSONALITY_DIMENSIONS entry
 * @param {number} nowMs
 * @returns {{ changed: boolean, selectedValue?, selectedConfidence?, selectedSource?, selectedUpdatedAt? }}
 */
function selectWinner(dimState, dimConfig, nowMs) {
  const { candidates, selectedValue, selectedConfidence } = dimState;
  const { halfLifeDays, minActivation, minMargin, stabilityBand } = dimConfig;

  const scored = candidates
    .map((c) => ({ ...c, decayedScore: decayedScore(c.score, c.updatedAt, halfLifeDays, nowMs) }))
    .sort((a, b) => b.decayedScore - a.decayedScore);

  if (scored.length === 0 || scored[0].decayedScore < minActivation) {
    return { changed: false };
  }

  const top = scored[0];
  const second = scored[1];
  const margin = second ? top.decayedScore - second.decayedScore : top.decayedScore;
  if (margin < minMargin) return { changed: false };

  // Stability band: if already have a selection, require enough delta to switch.
  // Use minActivation as floor for the current score so fully-decayed values don't
  // make the delta look artificially large and bypass the stability check.
  if (selectedValue && top.value !== selectedValue) {
    const currentEntry = scored.find((c) => c.value === selectedValue);
    const currentScore = currentEntry
      ? currentEntry.decayedScore
      : minActivation; // treat fully-evicted as at the threshold
    const delta = top.decayedScore - currentScore;
    if (delta < stabilityBand) return { changed: false };
  }

  // Use minActivation as the second-place floor so a lone candidate doesn't get
  // artificially inflated confidence (avoids single-entry division by ~0.01).
  const secondScore = second?.decayedScore ?? 0;
  const normalizer = top.decayedScore + Math.max(secondScore, minActivation);
  const winnerConfidence = Math.min(0.98, top.decayedScore / normalizer);
  const changed =
    top.value !== selectedValue || Math.abs(winnerConfidence - (selectedConfidence || 0)) > 0.04;

  return {
    changed,
    selectedValue: top.value,
    selectedConfidence: winnerConfidence,
    selectedSource: top.source,
    selectedUpdatedAt: nowMs,
  };
}

// ── Apply signals to profile ──────────────────────────────────────────────────

/**
 * Apply a batch of signals to the personality profile.
 * Returns a new profile object and a list of dimension changes.
 *
 * @param {object} profile
 * @param {Array<{field, value, confidence, source}>} signals
 * @param {number} nowMs
 * @returns {{ profile: object, changes: Array }}
 */
export function applySignalsToProfile(profile, signals, nowMs = Date.now()) {
  if (!profile || !Array.isArray(signals) || signals.length === 0) {
    return { profile, changes: [] };
  }

  const updatedDimensions = { ...profile.dimensions };
  const changes = [];

  for (const signal of signals) {
    const { field, value, confidence } = signal;
    if (!field || !value || !Number.isFinite(confidence) || confidence <= 0) continue;

    const dimConfig = PERSONALITY_DIMENSIONS[field];
    if (!dimConfig) continue;

    // Validate value is in allowed set
    const sanitized = String(value).trim().slice(0, dimConfig.maxChars || 24);
    if (!dimConfig.values.includes(sanitized)) continue;

    const prevState = updatedDimensions[field] || { candidates: [], selectedValue: null, selectedConfidence: 0 };
    const dimState = { ...prevState, candidates: [...(prevState.candidates || [])] };

    upsertCandidate(dimState.candidates, { ...signal, value: sanitized }, dimConfig.halfLifeDays, nowMs);

    const winner = selectWinner(dimState, dimConfig, nowMs);
    if (winner.changed) {
      const prev = dimState.selectedValue;
      dimState.selectedValue = winner.selectedValue;
      dimState.selectedConfidence = winner.selectedConfidence;
      dimState.selectedSource = winner.selectedSource;
      dimState.selectedUpdatedAt = winner.selectedUpdatedAt;
      changes.push({
        field,
        from: prev,
        to: winner.selectedValue,
        confidence: winner.selectedConfidence,
        source: signal.source,
      });
    }

    updatedDimensions[field] = dimState;
  }

  const updatedProfile = { ...profile, dimensions: updatedDimensions, updatedAt: nowMs };
  return { profile: updatedProfile, changes };
}

// ── Context overlay ───────────────────────────────────────────────────────────

/**
 * Apply a context-specific overlay on top of the base profile for the current response.
 * This is NON-PERSISTENT — the overlay applies to prompt injection only.
 *
 * Overlay semantics per dimension:
 * - OVERLAY_FLOOR_DIMENSIONS: only upgrade to higher value index, never downgrade.
 * - Other dimensions with explicit value: always apply (strict override).
 * - null overlay value: skip dimension.
 *
 * @param {object} profile
 * @param {string} sessionIntent — e.g., "coding", "finance", "personal"
 * @returns {object} overlayDimensions — dimensions map for prompt rendering
 */
export function applyContextOverlay(profile, sessionIntent) {
  const overlay = CONTEXT_OVERLAYS[String(sessionIntent || "").toLowerCase()];
  if (!overlay || !profile?.dimensions) return profile?.dimensions || {};

  const overlayDimensions = { ...profile.dimensions };

  for (const [field, overrideEntry] of Object.entries(overlay)) {
    if (overrideEntry === null || overrideEntry === undefined) continue;

    // Support { value, strict: true } entries for per-context strict overrides
    const isStrictEntry = typeof overrideEntry === "object" && overrideEntry.strict === true;
    const overrideValue = isStrictEntry ? overrideEntry.value : overrideEntry;

    if (!overrideValue) continue;

    const dimConfig = PERSONALITY_DIMENSIONS[field];
    const currentState = overlayDimensions[field];
    if (!dimConfig) continue;

    const overrideIdx = dimConfig.values.indexOf(overrideValue);
    if (overrideIdx < 0) continue;

    // New profiles (no selectedValue yet): apply strict entries only
    if (!currentState?.selectedValue) {
      if (isStrictEntry) {
        overlayDimensions[field] = {
          ...(currentState || {}),
          selectedValue: overrideValue,
          selectedConfidence: 0,
          _overlayApplied: true,
        };
      }
      continue;
    }

    const currentIdx = dimConfig.values.indexOf(currentState.selectedValue);

    if (!isStrictEntry && OVERLAY_FLOOR_DIMENSIONS.has(field)) {
      // Floor: only move toward higher index (more "active" value)
      if (overrideIdx > currentIdx) {
        overlayDimensions[field] = { ...currentState, selectedValue: overrideValue, _overlayApplied: true };
      }
    } else {
      // Strict: always apply the override (including downgrades)
      overlayDimensions[field] = { ...currentState, selectedValue: overrideValue, _overlayApplied: true };
    }
  }

  return overlayDimensions;
}
