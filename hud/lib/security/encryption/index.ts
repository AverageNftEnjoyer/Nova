import "server-only"

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

function deriveKeyMaterial(rawValue: string): Buffer {
  const raw = String(rawValue || "").trim()
  if (!raw) throw new Error("NOVA_ENCRYPTION_KEY is required.")
  try {
    const decoded = Buffer.from(raw, "base64")
    if (decoded.length === 32) return decoded
  } catch {
    // ignore and fall back to hash branch
  }
  return createHash("sha256").update(raw).digest()
}

function parseFallbackKeys(): string[] {
  const raw = String(process.env.NOVA_ENCRYPTION_KEY_FALLBACKS || "").trim()
  if (!raw) return []
  return raw
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function getKeyMaterials(): Buffer[] {
  const raw = String(process.env.NOVA_ENCRYPTION_KEY || "").trim()
  if (!raw) {
    throw new Error("NOVA_ENCRYPTION_KEY is required.")
  }
  const candidates = [raw, ...parseFallbackKeys()]
  const out: Buffer[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    out.push(deriveKeyMaterial(candidate))
  }
  return out
}

function getPrimaryKeyMaterial(): Buffer {
  const materials = getKeyMaterials()
  if (materials.length === 0) throw new Error("NOVA_ENCRYPTION_KEY is required.")
  return materials[0]
}

export function encryptSecret(plainText: string): string {
  const value = String(plainText || "")
  if (!value) return ""
  const key = getPrimaryKeyMaterial()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`
}

export function decryptSecretWithMeta(payload: string): { value: string; keyIndex: number } {
  const input = String(payload || "").trim()
  if (!input) return { value: "", keyIndex: -1 }
  const parts = input.split(".")
  if (parts.length !== 3) return { value: "", keyIndex: -1 }
  let keys: Buffer[] = []
  try {
    keys = getKeyMaterials()
  } catch {
    return { value: "", keyIndex: -1 }
  }
  for (let index = 0; index < keys.length; index += 1) {
    try {
      const iv = Buffer.from(parts[0], "base64")
      const tag = Buffer.from(parts[1], "base64")
      const enc = Buffer.from(parts[2], "base64")
      const decipher = createDecipheriv("aes-256-gcm", keys[index], iv)
      decipher.setAuthTag(tag)
      const out = Buffer.concat([decipher.update(enc), decipher.final()])
      return { value: out.toString("utf8"), keyIndex: index }
    } catch {
      // try next key
    }
  }
  return { value: "", keyIndex: -1 }
}

export function decryptSecret(payload: string): string {
  return decryptSecretWithMeta(payload).value
}
