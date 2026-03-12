import "server-only"

import { createHash } from "node:crypto"

import { syncAgentRuntimeIntegrationsSnapshot } from "@/lib/integrations/runtime/agent-sync"
import { loadIntegrationsConfig, updateIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { shouldResetPolymarketForPhantomIdentity } from "@/lib/integrations/polymarket/guards"
import {
  DEFAULT_POLYMARKET_INTEGRATION_CONFIG,
  normalizePolymarketIntegrationConfig,
} from "@/lib/integrations/polymarket/types"
import type { VerifiedSupabaseRequest } from "@/lib/supabase/server"
import { resolveWorkspaceRoot } from "@/lib/workspace/root"
import { readPhantomWalletAuthState, updatePhantomWalletAuthState } from "./auth-state.ts"
import { createPhantomAuthChallenge } from "./challenge.ts"
import { normalizeSolanaWalletAddress, verifySolanaMessageSignature } from "./crypto.ts"
import {
  buildDisconnectedPhantomAuthState,
  buildVerifiedPhantomAuthState,
  validatePhantomChallengeState,
} from "./guards.ts"
import {
  DEFAULT_PHANTOM_CAPABILITIES,
  DEFAULT_PHANTOM_INTEGRATION_CONFIG,
  PHANTOM_CHAIN_ID,
  PHANTOM_PROVIDER_ID,
  maskPhantomWalletAddress,
  normalizeEthereumWalletAddress,
  normalizePhantomIntegrationConfig,
  type PhantomChallengeResponse,
  type PhantomDisconnectReason,
  type PhantomVerificationResult,
} from "./types.ts"

const PHANTOM_CHALLENGE_TTL_MS = Math.max(
  60_000,
  Math.min(
    15 * 60_000,
    Number.parseInt(process.env.NOVA_PHANTOM_CHALLENGE_TTL_MS || String(5 * 60_000), 10) || 5 * 60_000,
  ),
)

const operationLocks = new Map<string, Promise<void>>()

class PhantomServiceError extends Error {
  public readonly code: string
  public readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function normalizeUserContextId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

function assertUserContextId(value: unknown): string {
  const normalized = normalizeUserContextId(value)
  if (!normalized) {
    throw new PhantomServiceError("PHANTOM_USER_CONTEXT_REQUIRED", "Authenticated user context is required.", 401)
  }
  return normalized
}

function hashAccessToken(value: unknown): string {
  return createHash("sha256")
    .update(String(value || "").trim())
    .digest("hex")
}

async function runScopedOperation<T>(userContextId: string, operation: () => Promise<T>): Promise<T> {
  const previous = operationLocks.get(userContextId) ?? Promise.resolve()
  let result!: T
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      result = await operation()
    })
  operationLocks.set(userContextId, next)
  try {
    await next
    return result
  } finally {
    if (operationLocks.get(userContextId) === next) {
      operationLocks.delete(userContextId)
    }
  }
}

function normalizeSolanaWalletAddressOrThrow(value: unknown): string {
  try {
    return normalizeSolanaWalletAddress(String(value || ""))
  } catch {
    throw new PhantomServiceError("PHANTOM_WALLET_INVALID", "A valid Phantom wallet address is required.", 400)
  }
}

function normalizeOptionalEvmAddressOrThrow(value: unknown): string {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const normalized = normalizeEthereumWalletAddress(raw)
  if (!normalized) {
    throw new PhantomServiceError("PHANTOM_EVM_ADDRESS_INVALID", "A valid EVM wallet address is required.", 400)
  }
  return normalized
}

function verifySolanaSignatureOrThrow(params: {
  walletAddress: string
  message: string
  signatureBase64: string
}): boolean {
  try {
    return verifySolanaMessageSignature(params)
  } catch {
    throw new PhantomServiceError("PHANTOM_SIGNATURE_INVALID", "Wallet signature payload is invalid.", 400)
  }
}

function emptyVerificationResult(): PhantomVerificationResult {
  return {
    provider: PHANTOM_PROVIDER_ID,
    chain: PHANTOM_CHAIN_ID,
    connected: false,
    walletAddress: "",
    walletLabel: "",
    connectedAt: "",
    verifiedAt: "",
    evmAddress: "",
    evmLabel: "",
    evmChainId: "",
    evmConnectedAt: "",
    capabilities: { ...DEFAULT_PHANTOM_CAPABILITIES },
  }
}

export async function issuePhantomChallenge(params: {
  verified: VerifiedSupabaseRequest
  walletAddress: string
  origin?: string
}): Promise<PhantomChallengeResponse> {
  const userContextId = assertUserContextId(params.verified?.user?.id)
  const walletAddress = normalizeSolanaWalletAddressOrThrow(params.walletAddress)
  return runScopedOperation(userContextId, async () => {
    const authState = await readPhantomWalletAuthState(userContextId, resolveWorkspaceRoot())
    const challenge = createPhantomAuthChallenge({
      userContextId,
      walletAddress,
      accessTokenHash: hashAccessToken(params.verified.accessToken),
      version: authState.version,
      origin: params.origin,
      ttlMs: PHANTOM_CHALLENGE_TTL_MS,
    })

    await updatePhantomWalletAuthState(
      userContextId,
      (current) => ({
        ...current,
        currentChallenge: challenge,
        lastInvalidationReason: "",
      }),
      resolveWorkspaceRoot(),
    )

    return {
      provider: PHANTOM_PROVIDER_ID,
      chain: PHANTOM_CHAIN_ID,
      walletAddress,
      walletLabel: maskPhantomWalletAddress(walletAddress),
      challengeId: challenge.challengeId,
      message: challenge.message,
      messageKind: "siws",
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
      capabilities: { ...DEFAULT_PHANTOM_CAPABILITIES },
    }
  })
}

export async function verifyPhantomChallenge(params: {
  verified: VerifiedSupabaseRequest
  walletAddress: string
  signatureBase64: string
  evmAddress?: string
  evmChainId?: string
}): Promise<PhantomVerificationResult> {
  const userContextId = assertUserContextId(params.verified?.user?.id)
  const walletAddress = normalizeSolanaWalletAddressOrThrow(params.walletAddress)
  const evmAddress = normalizeOptionalEvmAddressOrThrow(params.evmAddress)
  const evmChainId = String(params.evmChainId || "").trim().slice(0, 64)
  return runScopedOperation(userContextId, async () => {
    const authState = await readPhantomWalletAuthState(userContextId, resolveWorkspaceRoot())
    const validation = validatePhantomChallengeState({
      authState,
      walletAddress,
      accessTokenHash: hashAccessToken(params.verified.accessToken),
    })
    if (!validation.ok) {
      if (validation.clearChallenge) {
        await updatePhantomWalletAuthState(
          userContextId,
          (current) => ({
            ...current,
            currentChallenge: null,
            lastInvalidationReason: validation.invalidationReason || "challenge_expired",
          }),
          resolveWorkspaceRoot(),
        )
      }
      throw new PhantomServiceError(validation.code || "PHANTOM_CHALLENGE_INVALID", validation.message || "Wallet verification failed.", 409)
    }
    const challenge = authState.currentChallenge
    if (!challenge) {
      throw new PhantomServiceError("PHANTOM_CHALLENGE_MISSING", "No active Phantom verification challenge exists.", 409)
    }
    if (!verifySolanaSignatureOrThrow({
      walletAddress,
      message: challenge.message,
      signatureBase64: params.signatureBase64,
    })) {
      throw new PhantomServiceError("PHANTOM_SIGNATURE_INVALID", "Wallet signature could not be verified.", 401)
    }

    const currentConfig = await loadIntegrationsConfig(params.verified)
    const previousPhantom = normalizePhantomIntegrationConfig((currentConfig as typeof currentConfig & { phantom?: unknown }).phantom)
    const now = new Date().toISOString()
    const shouldResetPolymarket = shouldResetPolymarketForPhantomIdentity(currentConfig.polymarket, {
      ...previousPhantom,
      connected: true,
      verifiedAt: now,
      evmAddress,
    })
    const nextPhantom = {
      connected: true,
      provider: PHANTOM_PROVIDER_ID,
      chain: PHANTOM_CHAIN_ID,
      walletAddress,
      walletLabel: maskPhantomWalletAddress(walletAddress),
      connectedAt:
        previousPhantom.connected && previousPhantom.walletAddress === walletAddress && previousPhantom.connectedAt
          ? previousPhantom.connectedAt
          : now,
      verifiedAt: now,
      lastDisconnectedAt: "",
      evmAddress,
      evmLabel: evmAddress ? maskPhantomWalletAddress(evmAddress) : "",
      evmChainId,
      evmConnectedAt: evmAddress
        ? (previousPhantom.evmAddress === evmAddress && previousPhantom.evmConnectedAt ? previousPhantom.evmConnectedAt : now)
        : "",
      preferences: {
        ...previousPhantom.preferences,
      },
      capabilities: {
        ...DEFAULT_PHANTOM_CAPABILITIES,
        solanaConnected: true,
        solanaVerified: true,
        evmAvailable: previousPhantom.preferences.allowAgentEvmContext && evmAddress.length > 0,
        approvalGatedPolymarket: previousPhantom.preferences.allowApprovalGatedPolymarket,
        approvalGatedPolymarketReady:
          previousPhantom.preferences.allowApprovalGatedPolymarket &&
          previousPhantom.preferences.allowAgentEvmContext &&
          evmAddress.length > 0,
      },
    }
    const nextConfig = await updateIntegrationsConfig(
      {
        phantom: nextPhantom,
        ...(shouldResetPolymarket
          ? {
              polymarket: normalizePolymarketIntegrationConfig({
                ...DEFAULT_POLYMARKET_INTEGRATION_CONFIG,
                lastProfileSyncAt: currentConfig.polymarket.lastProfileSyncAt,
              }),
            }
          : {}),
      } as never,
      params.verified,
    )
    await updatePhantomWalletAuthState(
      userContextId,
      (current) => buildVerifiedPhantomAuthState(current, walletAddress, now),
      resolveWorkspaceRoot(),
    )
    await syncAgentRuntimeIntegrationsSnapshot(resolveWorkspaceRoot(), userContextId, nextConfig)

    return {
      provider: PHANTOM_PROVIDER_ID,
      chain: PHANTOM_CHAIN_ID,
      connected: true,
      walletAddress,
      walletLabel: maskPhantomWalletAddress(walletAddress),
      connectedAt: nextPhantom.connectedAt,
      verifiedAt: now,
      evmAddress: nextPhantom.evmAddress,
      evmLabel: nextPhantom.evmLabel,
      evmChainId: nextPhantom.evmChainId,
      evmConnectedAt: nextPhantom.evmConnectedAt,
      capabilities: nextPhantom.capabilities,
    }
  })
}

export async function disconnectPhantomBinding(params: {
  verified: VerifiedSupabaseRequest
  reason?: PhantomDisconnectReason
}): Promise<PhantomVerificationResult & { lastDisconnectedAt: string }> {
  const userContextId = assertUserContextId(params.verified?.user?.id)
  return runScopedOperation(userContextId, async () => {
    const now = new Date().toISOString()
    const currentConfig = await loadIntegrationsConfig(params.verified)
    const previousPhantom = normalizePhantomIntegrationConfig((currentConfig as typeof currentConfig & { phantom?: unknown }).phantom)
    const nextConfig = await updateIntegrationsConfig(
      {
        phantom: {
          ...DEFAULT_PHANTOM_INTEGRATION_CONFIG,
          preferences: {
            ...previousPhantom.preferences,
          },
          lastDisconnectedAt: now,
        },
        ...(currentConfig.polymarket.connected
          ? {
              polymarket: normalizePolymarketIntegrationConfig({
                ...DEFAULT_POLYMARKET_INTEGRATION_CONFIG,
                lastProfileSyncAt: currentConfig.polymarket.lastProfileSyncAt,
              }),
            }
          : {}),
      } as never,
      params.verified,
    )
    await updatePhantomWalletAuthState(
      userContextId,
      (current) => buildDisconnectedPhantomAuthState(current, now, params.reason || "unknown"),
      resolveWorkspaceRoot(),
    )
    await syncAgentRuntimeIntegrationsSnapshot(resolveWorkspaceRoot(), userContextId, nextConfig)

    return {
      ...emptyVerificationResult(),
      lastDisconnectedAt: now,
    }
  })
}

export function toPhantomServiceError(error: unknown): { code: string; status: number; message: string } {
  if (error instanceof PhantomServiceError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
    }
  }
  return {
    code: "PHANTOM_SERVICE_FAILED",
    status: 500,
    message: error instanceof Error ? error.message : "Phantom wallet operation failed.",
  }
}
