export type AgentTaskStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled"
// "cancelled" = user Stop (terminal), kept distinct from "failed".
export type AgentTaskPriority = "low" | "normal" | "high"
export type AgentProvider = "claude" | "openai" | "gemini" | "grok"
export type AgentPermissionMode = "default" | "accept-edits" | "plan-mode" | "dont-ask" | "bypass"
export type AgentTaskAction = "play" | "pause" | "stop"
export type AgentTaskUiAction = AgentTaskAction | "delete"

export interface AgentTask {
  id: string
  userId: string
  name: string
  prompt: string
  agent: AgentProvider
  model: string
  status: AgentTaskStatus
  priority: AgentTaskPriority
  permissionMode: AgentPermissionMode
  progress: number
  /** Total input tokens (cached + cache-write included). Uncached = tokensIn - cachedInputTokens - cacheWriteInputTokens. */
  tokensIn: number
  tokensOut: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  costUsd: number
  error?: string
  result?: string
  toolCalls?: string[]
  pauseReason?: "user" | "approval"
  pendingApproval?: {
    toolName: string
    reason: string
    approvalKey: string
    expiresAt: string
  }
  approvedTools?: string[]
  approvedToolExpiries?: Record<string, string>
  attachedFiles?: string[]
  contextId?: string
  worktreePath?: string
  branchName?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  pausedAt?: string
  completedAt?: string
}

export interface CreateAgentTaskInput {
  name?: string
  prompt: string
  agent: AgentProvider
  model: string
  priority?: AgentTaskPriority
  permissionMode?: AgentPermissionMode
  attachedFiles?: string[]
  contextId?: string
  useWorktree?: boolean
}

export interface AgentTaskStats {
  queued: number
  running: number
  paused: number
  completed: number
  failed: number
  cancelled: number
  totalCostTodayUsd: number
  totalTokensToday: number
}

export type AgentTaskEvent =
  | { type: "task.upserted"; task: AgentTask }
  | { type: "task.deleted"; id: string }

export const AGENT_TASK_MAX_CONCURRENT = 5
export const AGENT_TASK_TERMINAL: readonly AgentTaskStatus[] = ["completed", "failed", "cancelled"]
