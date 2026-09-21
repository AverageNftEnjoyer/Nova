export type SecretFormat = "nv1" | "none"

export interface DecryptedSecret {
  value: string
  /** 0 = current nv1 key, -1 = failure/empty. */
  keyIndex: number
  format: SecretFormat
}

export interface MasterKeyStatus {
  ready: boolean
  source: "dpapi" | "test-override" | "none"
  createdAt: string | null
}

/** Thrown by encryptSecret when the master key cannot be obtained. Never falls back to plaintext. */
export class SecretsUnavailableError extends Error {}

/** "" -> ""; otherwise "nv1:" + base64(iv12 || tag16 || ct). `context` is bound as GCM AAD. */
export function encryptSecret(plainText: string, context?: string): string

/** Never throws, never logs. Returns "" on any failure. */
export function decryptSecret(payload: string, context?: string): string

export function decryptSecretWithMeta(payload: string, context?: string): DecryptedSecret

/** True for a structurally valid nv1 ciphertext. */
export function isSecretCiphertext(value: unknown): boolean

/** "sk-…a1b2"-style hint; at most 8 visible characters; "" for empty input. */
export function maskSecret(value: string): string

/** Deep-clones `value`, replacing secret-looking fields and strings with "[redacted]". */
export function redactSecrets<T>(value: T): T

/** Never returns key material. */
export function getMasterKeyStatus(): MasterKeyStatus

/** Drops cached key material and the DPAPI failure cache (tests / shutdown). */
export function resetSecretsCache(): void

/**
 * Loads (or, with `create` true, creates) the master key into the in-process cache and reports whether
 * it is ready. Call it BEFORE opening a DB transaction or importer, because the first DPAPI call spawns
 * PowerShell. Never throws, never returns key material.
 */
export function warmSecrets(create?: boolean): boolean

/**
 * Deterministic hex secret derived from the DPAPI master key for local signing uses
 * (for example OAuth CSRF state). Throws SecretsUnavailableError when DPAPI is down.
 */
export function deriveApplicationSecret(info: string, bytes?: number): string
