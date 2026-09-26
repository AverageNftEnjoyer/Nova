import type { AgentPermissionMode, AgentProvider, AgentTaskBudgetState } from "@/lib/agents/types"

export type DeploymentKind = "task" | "automation"
export type DeploymentStatus = "draft" | "ready" | "active" | "paused" | "archived"
export type DeploymentRunStatus =
  | "pending"
  | "queued"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "dead"

export interface DeploymentBudgetEstimate {
  costUsd: number | null
  tokens: number | null
  confidence: "low" | "medium" | "high"
}

export interface DeploymentPlan {
  outcome: string
  acceptanceCriteria: string[]
  kind: DeploymentKind
  specialists: string[]
  tools: string[]
  context: string[]
  risk: "low" | "medium" | "high"
  budgetEstimate: DeploymentBudgetEstimate
  reviewRequired: boolean
  rationale: string
}

export interface DeploymentConfig {
  provider?: AgentProvider
  model?: string
  permissionMode?: AgentPermissionMode
  costBudgetUsd?: number | null
  tokenBudget?: number | null
  priority?: "low" | "normal" | "high"
  useWorktree?: boolean
  attachedFiles?: string[]
  contextId?: string
  schedule?: Record<string, unknown>
  reliability?: {
    maxAttempts?: number
    timeoutMs?: number
  }
}

export interface Deployment {
  id: string
  userId: string
  kind: DeploymentKind
  status: DeploymentStatus
  title: string
  outcome: string
  acceptanceCriteria: string[]
  plan: DeploymentPlan | null
  config: DeploymentConfig
  missionId: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface DeploymentRun {
  id: string
  userId: string
  deploymentId: string
  deploymentRevision: number
  jobRunId: string | null
  agentTaskId: string | null
  status: DeploymentRunStatus
  permissionMode: AgentPermissionMode
  costBudgetUsd: number | null
  tokenBudget: number | null
  budgetState?: AgentTaskBudgetState
  cancellationRequestedAt: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export interface DeploymentEvent {
  seq: number
  eventId: string
  userId: string
  deploymentId: string
  runId: string | null
  type: string
  actor: string
  ts: string
  data: Record<string, unknown>
}

export interface CreateDeploymentInput {
  id?: string
  kind: DeploymentKind
  title?: string
  outcome: string
  acceptanceCriteria?: string[]
  plan?: DeploymentPlan | null
  config?: DeploymentConfig
  missionId?: string | null
  status?: DeploymentStatus
}
