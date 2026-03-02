import "server-only"

import { syncAgentRuntimeIntegrationsSnapshot } from "@/lib/integrations/runtime/agent-sync"
import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import type { VerifiedSupabaseRequest } from "@/lib/supabase/server"
import { resolveWorkspaceRoot } from "@/lib/workspace/root"

const ENSURE_TTL_MS = 15_000
const ensureCache = new Map<string, number>()

function normalizeUserId(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

export async function ensureRuntimeIntegrationsSnapshot(
  userId: string,
  verified: VerifiedSupabaseRequest,
): Promise<{ ok: true; filePath: string; userId: string; cached: boolean }> {
  const requestedUserId = normalizeUserId(userId)
  const verifiedUserId = normalizeUserId(verified?.user?.id)
  const scopedUserId = requestedUserId || verifiedUserId
  if (!scopedUserId || scopedUserId !== verifiedUserId) {
    throw new Error("Integration snapshot sync denied: invalid user scope.")
  }

  const now = Date.now()
  const last = ensureCache.get(scopedUserId) || 0
  if (now - last < ENSURE_TTL_MS) {
    return { ok: true, filePath: "", userId: scopedUserId, cached: true }
  }

  const config = await loadIntegrationsConfig(verified)
  const filePath = await syncAgentRuntimeIntegrationsSnapshot(resolveWorkspaceRoot(), scopedUserId, config)
  ensureCache.set(scopedUserId, now)
  return { ok: true, filePath, userId: scopedUserId, cached: false }
}
