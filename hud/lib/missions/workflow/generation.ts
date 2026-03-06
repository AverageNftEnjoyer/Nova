/**
 * Workflow Generation helpers for mission-native generation.
 */

import "server-only"

import { cleanText } from "../text/cleaning"
import { detectTopicsInPrompt } from "../topics/detection"
export {
  deriveScheduleFromPrompt,
  inferRequestedOutputChannel,
  normalizeOutputChannelId,
} from "../../../../src/runtime/modules/services/missions/generation-helpers/index.js"

/**
 * Check if prompt requests immediate output.
 */
export function promptRequestsImmediateOutput(prompt: string): boolean {
  const text = String(prompt || "").toLowerCase()
  return /\b(now|immediately|immediate|right away|asap)\b/.test(text)
}

export function buildPromptGroundedAiPrompt(prompt: string): string {
  const dynamicAiPrompt = detectTopicsInPrompt(prompt).aiPrompt
  const userIntent = cleanText(String(prompt || "")).slice(0, 220)
  if (!userIntent) return dynamicAiPrompt
  return [
    `User request: ${userIntent}`,
    "Write a concrete, production-grade mission response grounded only in upstream step data.",
    "State unavailable fields explicitly instead of guessing.",
    dynamicAiPrompt,
  ].join("\n")
}
