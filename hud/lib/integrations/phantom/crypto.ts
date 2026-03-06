import { createPublicKey, verify } from "node:crypto"

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const BASE58_INDEX = new Map(BASE58_ALPHABET.split("").map((char, index) => [char, index]))
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

function decodeBase64(value: string): Buffer {
  const normalized = String(value || "").trim()
  if (!normalized) throw new Error("Signature is required.")
  const padded = normalized.replace(/-/g, "+").replace(/_/g, "/")
  const remainder = padded.length % 4
  const finalValue = remainder === 0 ? padded : `${padded}${"=".repeat(4 - remainder)}`
  return Buffer.from(finalValue, "base64")
}

export function encodeBase58(input: Uint8Array): string {
  if (!input || input.length === 0) return ""
  const digits = [0]
  for (const byte of input) {
    let carry = byte
    for (let index = 0; index < digits.length; index += 1) {
      const value = digits[index]! * 256 + carry
      digits[index] = value % 58
      carry = Math.floor(value / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }
  let out = ""
  for (const byte of input) {
    if (byte !== 0) break
    out += BASE58_ALPHABET[0]
  }
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    out += BASE58_ALPHABET[digits[index] || 0]
  }
  return out
}

export function decodeBase58(value: string): Buffer {
  const normalized = String(value || "").trim()
  if (!normalized) throw new Error("Wallet address is required.")
  const bytes = [0]
  for (const character of normalized) {
    const digit = BASE58_INDEX.get(character)
    if (digit === undefined) throw new Error("Wallet address is not valid base58.")
    let carry = digit
    for (let index = 0; index < bytes.length; index += 1) {
      const current = bytes[index]! * 58 + carry
      bytes[index] = current & 0xff
      carry = current >> 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  for (const character of normalized) {
    if (character !== BASE58_ALPHABET[0]) break
    bytes.push(0)
  }
  return Buffer.from(bytes.reverse())
}

export function normalizeSolanaWalletAddress(value: string): string {
  const decoded = decodeBase58(value)
  if (decoded.length !== 32) {
    throw new Error("Wallet address must decode to a 32-byte Ed25519 public key.")
  }
  return encodeBase58(decoded)
}

export function verifySolanaMessageSignature(params: {
  walletAddress: string
  message: string | Uint8Array
  signatureBase64: string
}): boolean {
  const walletAddress = normalizeSolanaWalletAddress(params.walletAddress)
  const publicKeyBytes = decodeBase58(walletAddress)
  if (publicKeyBytes.length !== 32) {
    throw new Error("Wallet address must decode to a 32-byte Ed25519 public key.")
  }
  const signature = decodeBase64(params.signatureBase64)
  if (signature.length !== 64) {
    throw new Error("Signature must decode to 64 bytes.")
  }
  const message =
    typeof params.message === "string"
      ? Buffer.from(params.message, "utf8")
      : Buffer.from(params.message)
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
    format: "der",
    type: "spki",
  })
  return verify(null, message, publicKey, signature)
}
