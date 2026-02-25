/**
 * Personality Profile — Public API
 *
 * Single entry point for the chat handler. Handles load → signal extraction →
 * scoring → persistence → overlay → prompt injection in one call.
 */

import {
  resolvePersonalityPaths,
  loadPersonalityProfile,
  persistPersonalityProfile,
  appendPersonalityAuditEvent,
} from "./storage.js";
import { createEmptyPersonalityProfile, applySignalsToProfile, applyContextOverlay } from "./engine.js";
import { extractFeedbackSignals, extractSettingsSignals, extractMemorySignals } from "./signals.js";
import { buildPersonalityPromptSection } from "./prompt.js";

/**
 * Sync the personality profile for one conversation turn and return a prompt section.
 *
 * @param {{
 *   userContextId: string,
 *   workspaceDir?: string,
 *   userText?: string,
 *   sessionIntent?: string,
 *   seedData?: object,
 *   memoryText?: string,
 *   conversationId?: string,
 *   nowMs?: number,
 *   maxPromptTokens?: number,
 * }} params
 * @returns {{
 *   promptSection: string,
 *   appliedSignals: number,
 *   changes: Array,
 * }}
 */
export function syncPersonalityFromTurn({
  userContextId,
  workspaceDir,
  userText,
  sessionIntent,
  seedData,
  memoryText,
  conversationId,
  nowMs = Date.now(),
  maxPromptTokens,
} = {}) {
  const paths = resolvePersonalityPaths({ userContextId, workspaceDir });
  if (!paths.userContextId) return { promptSection: "", appliedSignals: 0, changes: [] };

  // Load or create profile
  const existing = loadPersonalityProfile(paths);
  const profile = existing || createEmptyPersonalityProfile({ userContextId, nowMs });

  // Collect signals from all sources
  const signals = [
    ...extractSettingsSignals(seedData),
    ...extractMemorySignals(memoryText),
    ...extractFeedbackSignals(userText),
  ];

  const { profile: updatedProfile, changes } = applySignalsToProfile(profile, signals, nowMs);

  // Persist if anything changed
  if (changes.length > 0 || !existing) {
    persistPersonalityProfile(paths, updatedProfile);
    if (changes.length > 0) {
      appendPersonalityAuditEvent(paths, {
        ts: new Date(nowMs).toISOString(),
        timestampMs: nowMs,
        conversationId: String(conversationId || ""),
        appliedSignals: signals.length,
        changes,
      });
    }
  }

  // Apply context overlay (non-persistent — for this response only)
  const overlayDimensions = applyContextOverlay(updatedProfile, sessionIntent);

  // Build prompt section
  const promptSection = buildPersonalityPromptSection(overlayDimensions, {
    maxTokens: maxPromptTokens,
  });

  return {
    promptSection,
    appliedSignals: signals.length,
    changes,
  };
}

// Re-export for tests and tooling
export { createEmptyPersonalityProfile } from "./engine.js";
export { buildPersonalityPromptSection } from "./prompt.js";
export { PERSONALITY_DIMENSIONS, CONTEXT_OVERLAYS, FEEDBACK_PATTERNS } from "./constants.js";
