import { randomBytes } from "node:crypto"

import { buildIntegrationsHref } from "@/lib/integrations/navigation"
import {
  PHANTOM_SOLANA_SIGN_IN_CHAIN_ID,
  PHANTOM_SOLANA_SIGN_IN_VERSION,
  maskPhantomWalletAddress,
  type PhantomAuthChallenge,
} from "./types.ts"

export function normalizePhantomOrigin(value: unknown): string {
  const raw = String(value || "").trim()
  if (!raw) return "unknown-origin"
  try {
    return new URL(raw).origin
  } catch {
    return raw.slice(0, 200)
  }
}

export function normalizePhantomUri(value: unknown): string {
  const raw = String(value || "").trim()
  if (!raw) return "http://localhost:3000/integrations"
  try {
    return new URL(raw).toString()
  } catch {
    const origin = normalizePhantomOrigin(raw)
    return `${origin.replace(/\/+$/, "")}/integrations`
  }
}

function extractDomainFromUri(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return "localhost"
  }
}

export function buildPhantomChallengeMessage(params: {
  domain: string
  walletAddress: string
  statement: string
  uri: string
  versionLabel: string
  chainId: string
  nonce: string
  issuedAt: string
  expiresAt: string
  resources: string[]
}): string {
  const resourcesBlock = params.resources.length > 0
    ? `Resources:\n${params.resources.map((resource) => `- ${resource}`).join("\n")}`
    : ""
  return [
    `${params.domain} wants you to sign in with your Solana account:`,
    params.walletAddress,
    "",
    params.statement,
    "",
    `URI: ${params.uri}`,
    `Version: ${params.versionLabel}`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expiration Time: ${params.expiresAt}`,
    resourcesBlock,
    "",
    "Request ID: nova-phantom-auth",
  ].join("\n")
}

export function createPhantomAuthChallenge(params: {
  userContextId: string
  walletAddress: string
  accessTokenHash: string
  version: number
  origin?: string
  nowMs?: number
  ttlMs: number
}): PhantomAuthChallenge {
  const issuedAt = new Date(params.nowMs || Date.now()).toISOString()
  const expiresAt = new Date((params.nowMs || Date.now()) + params.ttlMs).toISOString()
  const nonce = randomBytes(18).toString("base64url")
  const challengeId = randomBytes(18).toString("hex")
  const uri = normalizePhantomUri(params.origin)
  const origin = normalizePhantomOrigin(uri)
  const domain = extractDomainFromUri(uri)
  const statement =
    "Sign in to Nova to verify wallet ownership. This signs a message only and does not authorize custody, transactions, or autonomous trading."
  const resources = [
    `${origin.replace(/\/+$/, "")}${buildIntegrationsHref("phantom")}`,
    `${origin.replace(/\/+$/, "")}/integrations#polymarket`,
  ]
  const message = buildPhantomChallengeMessage({
    domain,
    walletAddress: params.walletAddress,
    statement,
    uri,
    versionLabel: PHANTOM_SOLANA_SIGN_IN_VERSION,
    chainId: PHANTOM_SOLANA_SIGN_IN_CHAIN_ID,
    nonce,
    issuedAt,
    expiresAt,
    resources,
  })
  return {
    challengeId,
    walletAddress: params.walletAddress,
    walletLabel: maskPhantomWalletAddress(params.walletAddress),
    message,
    nonce,
    origin,
    domain,
    uri,
    statement,
    versionLabel: PHANTOM_SOLANA_SIGN_IN_VERSION,
    chainId: PHANTOM_SOLANA_SIGN_IN_CHAIN_ID,
    resources,
    issuedAt,
    expiresAt,
    accessTokenHash: params.accessTokenHash,
    version: params.version,
  }
}
