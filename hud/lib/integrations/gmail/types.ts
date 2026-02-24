import type { IntegrationsStoreScope } from "../server-store"

export const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth"
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
export const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo"
export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1"

export const DEFAULT_GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
]

export interface GmailOAuthStatePayload {
  ts: number
  nonce: string
  userId: string
  returnTo: string
}

export interface GmailMessageSummary {
  id: string
  threadId: string
  from: string
  subject: string
  date: string
  snippet: string
}

export interface GmailAccountRecord {
  id: string
  email: string
  scopes: string[]
  enabled: boolean
  accessTokenEnc: string
  refreshTokenEnc: string
  tokenExpiry: number
  connectedAt: string
}

export interface GmailClientConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  appUrl: string
}

export interface GmailTokenRefreshResult {
  accessToken: string
  expiresIn: number
}

export type GmailErrorCode =
  | "gmail.invalid_request"
  | "gmail.invalid_state"
  | "gmail.unauthorized"
  | "gmail.forbidden"
  | "gmail.not_found"
  | "gmail.rate_limited"
  | "gmail.oauth_failed"
  | "gmail.token_missing"
  | "gmail.not_connected"
  | "gmail.account_not_found"
  | "gmail.no_recipients"
  | "gmail.idempotency_conflict"
  | "gmail.timeout"
  | "gmail.cancelled"
  | "gmail.network"
  | "gmail.transient"
  | "gmail.internal"

export type GmailScope = IntegrationsStoreScope

export interface GmailSendMessageInput {
  to: string
  subject: string
  text: string
  accountId?: string
  threadId?: string
  inReplyTo?: string
  references?: string[]
  idempotencyKey?: string
  timeoutMs?: number
  signal?: AbortSignal
  scope?: GmailScope
}

export interface GmailSendMessageResult {
  id: string
  threadId: string
  deduplicated: boolean
}
