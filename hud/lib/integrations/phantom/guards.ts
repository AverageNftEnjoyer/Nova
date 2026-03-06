import type { PhantomDisconnectReason, PhantomWalletAuthState } from "./types.ts"

export interface PhantomChallengeValidationResult {
  ok: boolean
  code?: string
  message?: string
  clearChallenge?: boolean
  invalidationReason?: string
}

export function validatePhantomChallengeState(params: {
  authState: PhantomWalletAuthState
  walletAddress: string
  accessTokenHash: string
  nowMs?: number
}): PhantomChallengeValidationResult {
  const challenge = params.authState.currentChallenge
  if (!challenge) {
    return {
      ok: false,
      code: "PHANTOM_CHALLENGE_MISSING",
      message: "No active Phantom verification challenge exists.",
    }
  }
  if (params.accessTokenHash !== challenge.accessTokenHash) {
    return {
      ok: false,
      code: "PHANTOM_SESSION_MISMATCH",
      message: "Wallet verification session is stale. Reconnect Phantom and retry.",
    }
  }
  if (challenge.walletAddress !== params.walletAddress) {
    return {
      ok: false,
      code: "PHANTOM_WALLET_MISMATCH",
      message: "Wallet address changed before verification completed.",
    }
  }
  if (params.authState.version !== challenge.version) {
    return {
      ok: false,
      code: "PHANTOM_BINDING_VERSION_MISMATCH",
      message: "Wallet verification challenge is stale. Reconnect Phantom and retry.",
    }
  }
  if ((params.nowMs || Date.now()) > Date.parse(challenge.expiresAt)) {
    return {
      ok: false,
      code: "PHANTOM_CHALLENGE_EXPIRED",
      message: "Wallet verification challenge expired. Reconnect Phantom and retry.",
      clearChallenge: true,
      invalidationReason: "challenge_expired",
    }
  }
  return { ok: true }
}

export function buildVerifiedPhantomAuthState(
  current: PhantomWalletAuthState,
  walletAddress: string,
  verifiedAt: string,
): PhantomWalletAuthState {
  return {
    ...current,
    version: current.version + 1,
    currentChallenge: null,
    lastVerifiedWalletAddress: walletAddress,
    lastVerifiedAt: verifiedAt,
    lastInvalidationReason: "",
  }
}

export function buildDisconnectedPhantomAuthState(
  current: PhantomWalletAuthState,
  disconnectedAt: string,
  reason: PhantomDisconnectReason | "challenge_expired",
): PhantomWalletAuthState {
  return {
    ...current,
    version: current.version + 1,
    currentChallenge: null,
    lastDisconnectedAt: disconnectedAt,
    lastInvalidationReason: reason,
  }
}

export function shouldInvalidatePhantomWalletBinding(currentWalletAddress: string, nextWalletAddress: string): boolean {
  const current = String(currentWalletAddress || "").trim()
  const next = String(nextWalletAddress || "").trim()
  return Boolean(current) && current !== next
}
