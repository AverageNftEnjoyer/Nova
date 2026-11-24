/** Nova's provider keys ("anthropic" / "xai" / "google" are accepted as synonyms). */
export type RetiredModelProvider = "openai" | "claude" | "gemini" | "grok"

export interface RetiredModelAlias {
  provider: RetiredModelProvider
  /** Retired model ID, lower case. */
  id: string
  /** Current (picker) model of the same provider and tier. */
  replacement: string
  /** Retirement / shutdown / redirect date (YYYY-MM-DD). */
  retired: string
  /** Official page the retirement was read from. */
  source: string
}

export interface RetiredModelFamily {
  provider: RetiredModelProvider
  pattern: RegExp
  replacement: string
  retired: string
  source: string
  description: string
}

export interface RetiredModelListing {
  kind: "exact" | "family"
  /** The exact ID, or a readable description of the family. */
  match: string
  provider: RetiredModelProvider
  replacement: string
  retired: string
  source: string
  id?: string
  /** Family regex source. */
  pattern?: string
}

export const RETIRED_MODEL_ALIASES: readonly RetiredModelAlias[]
export const RETIRED_MODEL_FAMILIES: readonly RetiredModelFamily[]

/** The entry that retires `model` (case-insensitive), or null. A provider limits the match to that provider. */
export function findRetiredModel(provider: string | null | undefined, model: unknown): RetiredModelAlias | RetiredModelFamily | null
export function isRetiredModelId(provider: string | null | undefined, model: unknown): boolean
/**
 * The replacement for a retired ID, otherwise `model` trimmed and unchanged. Logs once per retired ID per process
 * unless `options.log` is false.
 */
export function resolveCurrentModelId(
  provider: string | null | undefined,
  model: unknown,
  options?: { log?: boolean },
): string
export function listRetiredModelAliases(): RetiredModelListing[]
