/** utility = one-off helper calls (mission suggestions, model tests, Gmail summary); embedding = memory index. */
export type LlmUsageLedgerSource = "chat" | "agent-task" | "mission" | "utility" | "embedding"

export const LLM_USAGE_SOURCES: readonly LlmUsageLedgerSource[]

/** Token counts: inputTokens is the TOTAL input (cached + cache-write included); uncached is computed by readers. */
export interface LlmUsageLedgerInput {
  userId: string
  /** ISO-8601; defaults to now when missing or invalid. */
  ts?: string
  source: LlmUsageLedgerSource
  refId?: string
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
  /** null = model has no known pricing. */
  costUsd?: number | null
}

export interface LlmUsageLedgerRow {
  id: string
  userId: string
  ts: string
  source: LlmUsageLedgerSource
  refId: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  costUsd: number | null
}

export interface LlmUsageLedgerFilter {
  source?: LlmUsageLedgerSource
  refId?: string
  /** Inclusive lower bound (ISO-8601). */
  sinceTs?: string
}

export interface LlmUsageLedgerTotals {
  calls: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  /** Sum over priced rows only. */
  costUsd: number
}

/** Throws on a missing userId or unknown source. Returns the generated row id. */
export function insertLlmUsage(record: LlmUsageLedgerInput): string
/** NOVA_LLM_USAGE_RETENTION_DAYS, default 90, clamped to [1, 3650]. */
export function resolveLlmUsageRetentionDays(): number
/** Deletes rows (all users) older than the retention period; returns the deleted count. */
export function pruneLlmUsage(options?: { retentionDays?: number; now?: Date | number | string }): number
/** Prunes at most once per 24 h per process (first call always prunes); null when skipped. */
export function maybePruneLlmUsage(options?: { now?: Date | number | string }): number | null
/** Newest first; default limit 100, max 1000. */
export function listLlmUsage(userId: string, options?: LlmUsageLedgerFilter & { limit?: number }): LlmUsageLedgerRow[]
export function sumLlmUsage(userId: string, options?: LlmUsageLedgerFilter): LlmUsageLedgerTotals
