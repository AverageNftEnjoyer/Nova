export type DevLogTurn = {
  turnId: string
  ts: string
  conversationId: string
  source: string
  sender: string
  userContextId: string
  route: string
  routing?: { provider?: string; model?: string } | null
  usage?: { totalTokens?: number } | null
  timing?: { latencyMs?: number; hotPath?: string } | null
  status?: { ok?: boolean; error?: string } | null
  quality?: { score?: number; tags?: string[] } | null
  input?: { user?: { text?: string; chars?: number } } | null
  output?: { assistant?: { text?: string; chars?: number } } | null
  tools?: { calls?: string[] } | null
}

export type DevLogsSummary = {
  totalTurns: number
  activeConversations: number
  okCount: number
  errorCount: number
  emptyReplyCount: number
  reliabilityPct: number
  totalTokens: number
  averageTokensPerTurn: number
  latencyMs: {
    p50: number
    p95: number
    p99: number
    average: number
  }
  quality: {
    average: number
    min: number
    max: number
  }
  providerBreakdown: Array<{ name: string; count: number }>
  hotPathBreakdown: Array<{ name: string; count: number }>
  conversationBreakdown: Array<{ conversationId: string; turnsCount: number }>
}

export type DevLogsResponse = {
  ok: boolean
  userContextId: string
  logPath: string
  file: {
    exists: boolean
    bytes: number
    updatedAt: string | null
  }
  summary: DevLogsSummary
  turns: DevLogTurn[]
  generatedAt: string
}
