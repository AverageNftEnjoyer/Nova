/**
 * Encryption utilities for storing API keys and secrets
 * Uses AES-256-GCM for encryption with a machine-specific key
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import { homedir } from "os"

const ALGORITHM = "aes-256-gcm"
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 16
const SALT_LENGTH = 64
const TAG_LENGTH = 16
const PBKDF2_ITERATIONS = 100000

/**
 * Get or create the encryption key for this machine
 * Stored in user's home directory (persistent across app updates)
 */
async function getMasterKey(): Promise<Buffer> {
  const keyPath = path.join(homedir(), ".nova-encryption-key")

  try {
    const keyData = await fs.readFile(keyPath)
    return keyData
  } catch {
    // Generate new key on first run
    const newKey = randomBytes(KEY_LENGTH)
    await fs.writeFile(keyPath, newKey, { mode: 0o600 }) // Owner read/write only
    return newKey
  }
}

/**
 * Derive encryption key from master key + salt using PBKDF2
 */
function deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
  return pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256")
}

/**
 * Encrypt a secret string
 * Returns: salt:iv:tag:ciphertext (all base64 encoded)
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  if (!plaintext) return ""

  const masterKey = await getMasterKey()
  const salt = randomBytes(SALT_LENGTH)
  const key = deriveKey(masterKey, salt)
  const iv = randomBytes(IV_LENGTH)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  // Format: salt:iv:tag:ciphertext
  return [
    salt.toString("base64"),
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":")
}

/**
 * Decrypt a secret string
 */
export async function decryptSecret(ciphertext: string): Promise<string> {
  if (!ciphertext) return ""

  const parts = ciphertext.split(":")
  if (parts.length !== 4) {
    throw new Error("Invalid encrypted data format")
  }

  const [saltB64, ivB64, tagB64, encryptedB64] = parts
  const salt = Buffer.from(saltB64, "base64")
  const iv = Buffer.from(ivB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  const encrypted = Buffer.from(encryptedB64, "base64")

  const masterKey = await getMasterKey()
  const key = deriveKey(masterKey, salt)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ])

  return decrypted.toString("utf8")
}

/**
 * Decrypt with metadata (returns both decrypted value and metadata)
 */
export async function decryptSecretWithMeta(
  ciphertext: string
): Promise<{ decrypted: string; metadata?: Record<string, unknown> }> {
  const decrypted = await decryptSecret(ciphertext)
  return { decrypted }
}

/**
 * Batch encrypt multiple secrets
 */
export async function encryptSecrets(
  secrets: Record<string, string>
): Promise<Record<string, string>> {
  const encrypted: Record<string, string> = {}

  for (const [key, value] of Object.entries(secrets)) {
    if (value) {
      encrypted[key] = await encryptSecret(value)
    }
  }

  return encrypted
}

/**
 * Batch decrypt multiple secrets
 */
export async function decryptSecrets(
  encrypted: Record<string, string>
): Promise<Record<string, string>> {
  const decrypted: Record<string, string> = {}

  for (const [key, value] of Object.entries(encrypted)) {
    if (value) {
      try {
        decrypted[key] = await decryptSecret(value)
      } catch (error) {
        console.error(`Failed to decrypt ${key}:`, error)
        decrypted[key] = ""
      }
    }
  }

  return decrypted
}
