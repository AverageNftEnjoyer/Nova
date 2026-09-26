export interface DeploymentEffectReservation {
  ok: boolean
  tracked: boolean
  duplicate: boolean
  status?: "reserved" | "committed" | "failed"
  result?: unknown
}

export function isDeploymentRunCancelled(input: {
  userId: string
  runId: string
}): boolean

export function reserveDeploymentEffect(input: {
  userId: string
  runId: string
  effectKey: string
  toolName: string
  leaseToken?: string
}): DeploymentEffectReservation

export function settleDeploymentEffect(input: {
  userId: string
  runId: string
  effectKey: string
  leaseToken?: string
  ok: boolean
  result?: unknown
}): { ok: boolean }
