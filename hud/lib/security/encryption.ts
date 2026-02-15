import "server-only"

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const DEV_FALLBACK_KEY = randomBytes(32)
let cachedLocalKey: Buffer | null = null

function getLocalKeyPath(): string {
  return path.join(process.cwd(), "data", ".nova_encryption_key")
}

function loadOrCreateLocalKey(): Buffer {
  if (cachedLocalKey) return cachedLocalKey

  const keyPath = getLocalKeyPath()
  try {
    if (existsSync(keyPath)) {
      const raw = readFileSync(keyPath, "utf8").trim()
      const decoded = Buffer.from(raw, "base64")
      if (decoded.length === 32) {
        cachedLocalKey = decoded
        return decoded
      }
    }
  } catch {
    // fall through to regenerate
  }

  try {
    mkdirSync(path.dirname(keyPath), { recursive: true })
    const generated = randomBytes(32)
    writeFileSync(keyPath, generated.toString("base64"), { encoding: "utf8" })
    cachedLocalKey = generated
    return generated
  } catch {
    return DEV_FALLBACK_KEY
  }
}

function getKeyMaterial(): Buffer {
  const raw = String(process.env.NOVA_ENCRYPTION_KEY || "").trim()
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("NOVA_ENCRYPTION_KEY is required in production.")
    }
    // Dev fallback: persist a local key file so encrypted secrets survive app restarts.
    return loadOrCreateLocalKey()
  }

  try {
    const decoded = Buffer.from(raw, "base64")
    if (decoded.length === 32) return decoded
  } catch {
    // ignore and fall back to hash branch
  }

  return createHash("sha256").update(raw).digest()
}

export function encryptSecret(plainText: string): string {
  const value = String(plainText || "")
  if (!value) return ""
  const key = getKeyMaterial()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`
}

export function decryptSecret(payload: string): string {
  const input = String(payload || "").trim()
  if (!input) return ""
  const parts = input.split(".")
  if (parts.length !== 3) return ""
  try {
    const key = getKeyMaterial()
    const iv = Buffer.from(parts[0], "base64")
    const tag = Buffer.from(parts[1], "base64")
    const enc = Buffer.from(parts[2], "base64")
    const decipher = createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAuthTag(tag)
    const out = Buffer.concat([decipher.update(enc), decipher.final()])
    return out.toString("utf8")
  } catch {
    return ""
  }
}
