import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import test from "node:test"

import { encodeBase58, verifySolanaMessageSignature } from "../crypto.ts"

test("phantom crypto verifies a valid ed25519 signed message", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const publicDer = publicKey.export({ format: "der", type: "spki" }) as Buffer
  const publicKeyBytes = publicDer.subarray(-32)
  const walletAddress = encodeBase58(publicKeyBytes)
  const message = Buffer.from("Nova Phantom Verification\nNonce: abc123", "utf8")
  const signature = sign(null, message, privateKey)

  const verified = verifySolanaMessageSignature({
    walletAddress,
    message,
    signatureBase64: signature.toString("base64"),
  })

  assert.equal(verified, true)
})

test("phantom crypto rejects a signature from a different keypair", () => {
  const { publicKey } = generateKeyPairSync("ed25519")
  const { privateKey: wrongPrivateKey } = generateKeyPairSync("ed25519")
  const publicDer = publicKey.export({ format: "der", type: "spki" }) as Buffer
  const publicKeyBytes = publicDer.subarray(-32)
  const walletAddress = encodeBase58(publicKeyBytes)
  const message = Buffer.from("Nova Phantom Verification\nNonce: abc123", "utf8")
  const signature = sign(null, message, wrongPrivateKey)

  const verified = verifySolanaMessageSignature({
    walletAddress,
    message,
    signatureBase64: signature.toString("base64"),
  })

  assert.equal(verified, false)
})
