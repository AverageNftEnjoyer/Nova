import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..", "..", "..")
const secrets = await import(pathToFileURL(path.join(repoRoot, "src", "security", "secrets", "index.js")).href)

const previous = {
  NODE_ENV: process.env.NODE_ENV,
  NOVA_ALLOW_TEST_KEY: process.env.NOVA_ALLOW_TEST_KEY,
  NOVA_TEST_MASTER_KEY_HEX: process.env.NOVA_TEST_MASTER_KEY_HEX,
  NOVA_TEST_FORCE_DPAPI_FAIL: process.env.NOVA_TEST_FORCE_DPAPI_FAIL,
}

process.env.NOVA_ALLOW_TEST_KEY = "1"
process.env.NOVA_TEST_MASTER_KEY_HEX = randomBytes(32).toString("hex")
delete process.env.NOVA_TEST_FORCE_DPAPI_FAIL
secrets.resetSecretsCache()

const results = []
async function test(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false })
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

await test("nv1 round-trip, randomized IV, and metadata", () => {
  const plain = "héllo 世界\n" + "x".repeat(10_000)
  const first = secrets.encryptSecret(plain)
  const second = secrets.encryptSecret(plain)
  assert.match(first, /^nv1:/)
  assert.notEqual(first, second)
  assert.equal(secrets.decryptSecret(first), plain)
  assert.deepEqual(secrets.decryptSecretWithMeta(first), { value: plain, keyIndex: 0, format: "nv1" })
  assert.equal(secrets.isSecretCiphertext(first), true)
})

await test("AAD mismatch and ciphertext tampering fail closed", () => {
  const encrypted = secrets.encryptSecret("bound", "integrations:openai.apiKey")
  assert.equal(secrets.decryptSecret(encrypted, "integrations:openai.apiKey"), "bound")
  assert.equal(secrets.decryptSecret(encrypted, "integrations:other.apiKey"), "")
  const raw = Buffer.from(encrypted.slice(4), "base64")
  raw[12] ^= 1
  assert.equal(secrets.decryptSecret(`nv1:${raw.toString("base64")}`, "integrations:openai.apiKey"), "")
})

await test("fresh-data format rejects legacy and malformed ciphertext", () => {
  for (const value of ["", "garbage", "a.b.c", "a:b:c:d", "nv1:", "nv1:AAAA"]) {
    assert.equal(secrets.decryptSecret(value), "")
    assert.equal(secrets.isSecretCiphertext(value), false)
  }
})

await test("encryption failure never falls back to plaintext", () => {
  process.env.NOVA_TEST_FORCE_DPAPI_FAIL = "1"
  secrets.resetSecretsCache()
  assert.throws(
    () => secrets.encryptSecret("must-not-persist"),
    (error) => error instanceof secrets.SecretsUnavailableError && !error.message.includes("must-not-persist"),
  )
  delete process.env.NOVA_TEST_FORCE_DPAPI_FAIL
  secrets.resetSecretsCache()
})

await test("masking and deep redaction do not mutate input", () => {
  const input = {
    apiKey: "sk-live-abcdefghijklmnopqrstuvwxyz",
    nested: { accessToken: "token-value", note: "keep" },
    message: "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
  }
  const output = secrets.redactSecrets(input)
  assert.equal(output.apiKey, "[redacted]")
  assert.equal(output.nested.accessToken, "[redacted]")
  assert.equal(output.nested.note, "keep")
  assert.equal(output.message, "[redacted]")
  assert.equal(input.nested.accessToken, "token-value")
  assert.equal(secrets.maskSecret("sk-abcdefghijklmnop"), "sk-…mnop")
})

secrets.resetSecretsCache()
for (const [name, value] of Object.entries(previous)) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

const failures = results.filter((result) => !result.ok)
console.log(`\n${results.length - failures.length}/${results.length} checks passed`)
process.exit(failures.length ? 1 : 0)
