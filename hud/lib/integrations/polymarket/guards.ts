import { normalizePhantomIntegrationConfig, type PhantomIntegrationConfig } from "../phantom/types.ts"
import { normalizePolymarketEvmAddress } from "./api.ts"
import type { PolymarketIntegrationConfig } from "./types.ts"

export function isVerifiedPhantomEvmReadyForPolymarket(phantom: PhantomIntegrationConfig): boolean {
  return Boolean(
    phantom.connected &&
    String(phantom.verifiedAt || "").trim().length > 0 &&
    String(phantom.evmAddress || "").trim().length > 0,
  )
}

export function shouldResetPolymarketForPhantomIdentity(
  polymarket: Pick<PolymarketIntegrationConfig, "connected" | "walletAddress">,
  phantom: PhantomIntegrationConfig,
): boolean {
  if (!polymarket.connected) return false
  if (!isVerifiedPhantomEvmReadyForPolymarket(phantom)) return true
  return normalizePolymarketEvmAddress(polymarket.walletAddress) !== normalizePolymarketEvmAddress(phantom.evmAddress)
}

export type PolymarketWalletBindingValidation =
  | {
      ok: true
      walletAddress: string
    }
  | {
      ok: false
      code: "POLYMARKET_WALLET_REQUIRED" | "POLYMARKET_PHANTOM_EVM_REQUIRED" | "POLYMARKET_WALLET_MISMATCH"
      message: string
      status: number
    }

export function validatePolymarketWalletBinding(params: {
  walletAddress: string
  phantom: PhantomIntegrationConfig
}): PolymarketWalletBindingValidation {
  const normalizedWalletAddress = normalizePolymarketEvmAddress(params.walletAddress)
  if (!normalizedWalletAddress) {
    return {
      ok: false,
      code: "POLYMARKET_WALLET_REQUIRED",
      message: "A valid Polymarket wallet address is required.",
      status: 400,
    }
  }

  const phantom = normalizePhantomIntegrationConfig(params.phantom)
  if (!isVerifiedPhantomEvmReadyForPolymarket(phantom)) {
    return {
      ok: false,
      code: "POLYMARKET_PHANTOM_EVM_REQUIRED",
      message: "Connect and verify Phantom with a Polygon-ready EVM wallet before binding Polymarket.",
      status: 409,
    }
  }

  if (normalizePolymarketEvmAddress(phantom.evmAddress) !== normalizedWalletAddress) {
    return {
      ok: false,
      code: "POLYMARKET_WALLET_MISMATCH",
      message: "Polymarket binding must match the verified Phantom EVM wallet for this user.",
      status: 409,
    }
  }

  return {
    ok: true,
    walletAddress: normalizedWalletAddress,
  }
}
