import "server-only"

import { kvGet, kvSet } from "../../../../src/db/index.js"
import {
  DEFAULT_PHANTOM_WALLET_AUTH_STATE,
  normalizePhantomWalletAuthState,
  type PhantomWalletAuthState,
} from "./types.ts"

const NAMESPACE = "phantom-wallet-auth"
const KEY = "state"
const locksByUserId = new Map<string, Promise<void>>()

function sanitizeUserContextId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

export function resolvePhantomWalletAuthStatePath(userId: string, _workspaceRootInput?: string): string {
  const uid = sanitizeUserContextId(userId)
  return uid ? `sqlite:kv_state/${uid}/${NAMESPACE}/${KEY}` : ""
}

export async function readPhantomWalletAuthState(
  userId: string,
  _workspaceRootInput?: string,
): Promise<PhantomWalletAuthState> {
  const uid = sanitizeUserContextId(userId)
  if (!uid) return { ...DEFAULT_PHANTOM_WALLET_AUTH_STATE }
  return normalizePhantomWalletAuthState(kvGet(uid, NAMESPACE, KEY) || DEFAULT_PHANTOM_WALLET_AUTH_STATE)
}

export async function updatePhantomWalletAuthState(
  userId: string,
  updater: (current: PhantomWalletAuthState) => PhantomWalletAuthState | Promise<PhantomWalletAuthState>,
  _workspaceRootInput?: string,
): Promise<PhantomWalletAuthState> {
  const uid = sanitizeUserContextId(userId)
  if (!uid) throw new Error("Invalid user context ID.")
  const previous = locksByUserId.get(uid) ?? Promise.resolve()
  let result!: PhantomWalletAuthState
  const next = previous.catch(() => undefined).then(async () => {
    const current = await readPhantomWalletAuthState(uid)
    result = normalizePhantomWalletAuthState(await updater(current))
    result = { ...result, updatedAt: new Date().toISOString() }
    kvSet(uid, NAMESPACE, KEY, result)
  })
  locksByUserId.set(uid, next)
  try {
    await next
    return result
  } finally {
    if (locksByUserId.get(uid) === next) locksByUserId.delete(uid)
  }
}
