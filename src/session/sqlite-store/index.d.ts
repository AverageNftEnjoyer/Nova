export interface StoredSessionEntry {
  sessionId: string
  sessionKey: string
  updatedAt: number
  createdAt: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  contextTokens: number
  model: string
  userContextId?: string
  origin?: { label: string; provider: string; from: string; to: string }
  [extra: string]: unknown
}

export interface StoredTranscriptTurn {
  role: string
  content: unknown
  timestamp: number
  tokens?: { input?: number; output?: number; total?: number }
  meta?: Record<string, unknown>
}

export interface ThreadRecord {
  id: string
  title: string
  pinned: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface ThreadMessageRecord {
  id: string
  threadId: string
  role: string
  content: string
  createdAt: string
  metadata: Record<string, unknown>
}

export interface ThreadMessageInput {
  id: string
  role: string
  content: string
  createdAt: string
  metadata?: Record<string, unknown>
  toolName?: string
}

export interface ToolRunInput {
  id?: string
  threadId?: string
  toolName: string
  input?: unknown
  output?: unknown
  status?: string
  latencyMs?: number
  /** Per-field cap (chars) for the redacted JSON; larger payloads are stored as a truncated preview. */
  maxChars?: number
}

export interface ToolRunRecord {
  id: string
  toolName: string
  input: unknown
  output: unknown
  status: string
  latencyMs: number | null
  createdAt: string
}

// Sessions
export function getSessionEntry(userId: string, sessionKey: string): StoredSessionEntry | null
export function findSessionEntryAcrossUsers(sessionKey: string): { userId: string; entry: StoredSessionEntry } | null
export function putSessionEntry(userId: string, sessionKey: string, entry: object): void
export function updateSessionEntry(
  userId: string,
  sessionKey: string,
  updater: (current: StoredSessionEntry | null) => StoredSessionEntry | null,
): StoredSessionEntry | null
export function deleteSessionEntry(userId: string, sessionKey: string): boolean
export function listSessionEntries(userId: string): Record<string, StoredSessionEntry>
export function findUserIdForSessionId(sessionId: string): string

// Transcripts
export function appendSessionTurn(
  userId: string,
  sessionId: string,
  turn: { role: string; content: unknown; timestamp?: number; tokens?: object; meta?: object },
  opts?: { maxTurns?: number },
): void
export function loadSessionTurns(userId: string, sessionId: string): StoredTranscriptTurn[]
export function pruneSessionTurnsOlderThan(cutoffMs: number): number
export function deleteSessionData(
  userId: string,
  targets?: { sessionKeys?: string[]; sessionIds?: string[] },
): { removedSessionEntries: number; removedTranscriptTurns: number }
export function findSessionKeysForConversation(userId: string, conversationIds: string[]): string[]

// Threads / messages
export function listThreads(userId: string): ThreadRecord[]
export function listThreadMessages(userId: string): ThreadMessageRecord[]
export function createThread(userId: string, title?: string): ThreadRecord
export function threadExists(userId: string, threadId: string): boolean
export function patchThread(
  userId: string,
  threadId: string,
  patch?: { title?: string; pinned?: boolean; archived?: boolean },
): boolean
export function listThreadMessageMetadata(
  userId: string,
  threadId: string,
  limit?: number,
): Array<{ metadata: Record<string, unknown> }>
export function deleteThread(userId: string, threadId: string): boolean
export function upsertThreadMessages(userId: string, threadId: string, messages: ThreadMessageInput[]): number | null

// Summaries / tool runs
export function getThreadSummary(userId: string, threadId: string): { summary: string; updatedAt: string } | null
export function setThreadSummary(userId: string, threadId: string, summary: string): void
export function recordToolRun(userId: string, run: ToolRunInput): string
export const TOOL_LOOP_RUN_MAX_CHARS: number
/** Never throws. Redacts + caps (2KB) and records one tool-loop invocation; returns the run id or null. */
export function recordToolRunSafe(userId: string, run: Omit<ToolRunInput, "id" | "maxChars">): string | null
export function listToolRuns(userId: string, threadId?: string, limit?: number): ToolRunRecord[]
