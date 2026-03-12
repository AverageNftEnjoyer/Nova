import "server-only"

import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"

import { resolveWorkspaceRoot } from "@/lib/workspace/root"
import {
  DEFAULT_PHANTOM_WALLET_AUTH_STATE,
  normalizePhantomWalletAuthState,
  type PhantomWalletAuthState,
} from "./types.ts"

const STATE_DIR_NAME = "state"
const AUTH_STATE_FILE_NAME = "phantom-wallet-auth.json"
const writesByPath = new Map<string, Promise<void>>()
const locksByUserId = new Map<string, Promise<void>>()

function sanitizeUserContextId(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized.slice(0, 96)
}

export function resolvePhantomWalletAuthStatePath(userId: string, workspaceRootInput?: string): string {
  const workspaceRoot = resolveWorkspaceRoot(workspaceRootInput)
  return path.join(workspaceRoot, ".user", "user-context", sanitizeUserContextId(userId), STATE_DIR_NAME, AUTH_STATE_FILE_NAME)
}

async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  const resolved = path.resolve(filePath)
  const previous = writesByPath.get(resolved) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(resolved), { recursive: true })
      const tmpPath = `${resolved}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
      await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
      try {
        await copyFile(resolved, `${resolved}.bak`)
      } catch {
        // First write.
      }
      await rename(tmpPath, resolved)
    })
  writesByPath.set(resolved, next)
  try {
    await next
  } finally {
    if (writesByPath.get(resolved) === next) {
      writesByPath.delete(resolved)
    }
  }
}

async function readStateFile(filePath: string): Promise<PhantomWalletAuthState | null> {
  try {
    const raw = await readFile(filePath, "utf8")
    if (!raw.trim()) return null
    return normalizePhantomWalletAuthState(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function readPhantomWalletAuthState(
  userId: string,
  workspaceRootInput?: string,
): Promise<PhantomWalletAuthState> {
  const scopedUserId = sanitizeUserContextId(userId)
  if (!scopedUserId) return { ...DEFAULT_PHANTOM_WALLET_AUTH_STATE }
  const filePath = resolvePhantomWalletAuthStatePath(scopedUserId, workspaceRootInput)
  const primary = await readStateFile(filePath)
  if (primary) return primary
  const backup = await readStateFile(`${filePath}.bak`)
  if (backup) {
    await atomicWriteJson(filePath, backup)
    return backup
  }
  return { ...DEFAULT_PHANTOM_WALLET_AUTH_STATE }
}

export async function updatePhantomWalletAuthState(
  userId: string,
  updater: (current: PhantomWalletAuthState) => PhantomWalletAuthState | Promise<PhantomWalletAuthState>,
  workspaceRootInput?: string,
): Promise<PhantomWalletAuthState> {
  const scopedUserId = sanitizeUserContextId(userId)
  if (!scopedUserId) throw new Error("Invalid user context ID.")
  const previous = locksByUserId.get(scopedUserId) ?? Promise.resolve()
  let result!: PhantomWalletAuthState
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await readPhantomWalletAuthState(scopedUserId, workspaceRootInput)
      const updated = normalizePhantomWalletAuthState(await updater(current))
      result = {
        ...updated,
        updatedAt: new Date().toISOString(),
      }
      await atomicWriteJson(resolvePhantomWalletAuthStatePath(scopedUserId, workspaceRootInput), result)
    })
  locksByUserId.set(scopedUserId, next)
  try {
    await next
    return result
  } finally {
    if (locksByUserId.get(scopedUserId) === next) {
      locksByUserId.delete(scopedUserId)
    }
  }
}
