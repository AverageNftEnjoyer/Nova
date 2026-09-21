import {
  decryptSecret,
  encryptSecret,
  isSecretCiphertext,
} from "../../../security/secrets/index.js";

export interface EncryptedTokenEnvelope {
  keyId: string;
  payload: string;
}

function toNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Encrypt Coinbase tokens with the shared DPAPI-backed secrets core.
 * `keyId` is retained for envelope compatibility; all new values use `nv1`.
 */
export function encryptTokenForStorage(plainText: string): EncryptedTokenEnvelope | null {
  const value = toNonEmptyString(plainText);
  if (!value) return null;
  try {
    const payload = encryptSecret(value, "coinbase:token");
    if (!payload) return null;
    return { keyId: "nv1", payload };
  } catch {
    return null;
  }
}

export function decryptTokenFromStorage(envelope: EncryptedTokenEnvelope | null): string {
  if (!envelope) return "";
  const payload = toNonEmptyString(envelope.payload);
  if (!payload) return "";
  if (!isSecretCiphertext(payload) && !payload.includes(".")) return "";
  // Shared decrypt handles nv1. Legacy env-key envelopes are unsupported on fresh installs.
  return decryptSecret(payload, "coinbase:token");
}
