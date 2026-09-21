import "server-only"

/**
 * Thin server-only entry point for secret encryption. The implementation lives in the
 * shared core so the HUD and the agent runtime use exactly the same code and key:
 * `src/security/secrets/index.js` (AES-256-GCM, DPAPI-wrapped master key, synchronous API).
 */
export {
  SecretsUnavailableError,
  decryptSecret,
  decryptSecretWithMeta,
  encryptSecret,
  getMasterKeyStatus,
  isSecretCiphertext,
  maskSecret,
  redactSecrets,
  warmSecrets,
} from "../../../../src/security/secrets/index.js"
