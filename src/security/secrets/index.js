/**
 * Nova secrets core — shared by the HUD (Next server) and the agent runtime.
 *
 * Every API key / token a user enters is encrypted with AES-256-GCM before it is
 * written anywhere. The data key is derived (HKDF) from a random 32-byte master
 * key that is wrapped with Windows DPAPI (CurrentUser scope) and stored in
 * `<dataDir>/keys/master.key.dpapi`. The plaintext master key exists only in
 * process memory. There is no weaker fallback: when DPAPI is unavailable,
 * `encryptSecret` throws `SecretsUnavailableError` instead of writing plaintext.
 *
 * Everything here is SYNCHRONOUS so existing callers stay drop-in.
 *
 * Known limit (be honest in docs/UI): DPAPI is per Windows login. It stops copied
 * databases / backups / other Windows accounts, but not malware that runs as the
 * same Windows user.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { resolveDataDir } from "../../db/paths.js"

const NV1_PREFIX = "nv1:"
const KEY_FILE_HEADER = "NOVA-DPAPI-1"
const KEY_DIR_NAME = "keys"
const KEY_FILE_NAME = "master.key.dpapi"
const HKDF_SALT = "nova"
const HKDF_INFO = "nova/secrets/v1"
// Failed DPAPI unwraps block the event loop (execFileSync, up to DPAPI_TIMEOUT_MS): retry rarely.
const FAILURE_CACHE_MS = 10 * 60_000
const DPAPI_TIMEOUT_MS = 20_000
const REDACTED = "[redacted]"
const KEY_FILE_RECOVERY_HINT =
  "If it is damaged or came from another PC or Windows account, remove keys/master.key.dpapi from the Nova data folder and re-enter your API keys."

export class SecretsUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = "SecretsUnavailableError"
  }
}

// ---------------------------------------------------------------------------
// Data directory: the single shared resolver in src/db/paths.js (imports only
// fs/os/path + the workspace-user-root helper, so no native dependency and no cycle).
// ---------------------------------------------------------------------------

function keyFilePath() {
  return path.join(resolveDataDir(), KEY_DIR_NAME, KEY_FILE_NAME)
}

// ---------------------------------------------------------------------------
// Test-only switches. Honoured ONLY when NODE_ENV=test or NOVA_ALLOW_TEST_KEY=1.
// ---------------------------------------------------------------------------

function testFlagsEnabled() {
  return process.env.NODE_ENV === "test" || process.env.NOVA_ALLOW_TEST_KEY === "1"
}

function testKeyOverride() {
  if (!testFlagsEnabled()) return null
  const hex = String(process.env.NOVA_TEST_MASTER_KEY_HEX || "").trim()
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null
  return Buffer.from(hex, "hex")
}

function forceDpapiFailure() {
  return testFlagsEnabled() && process.env.NOVA_TEST_FORCE_DPAPI_FAIL === "1"
}

// ---------------------------------------------------------------------------
// Process-wide state (globalThis so duplicated module instances — Next HMR,
// bundler copies — share one cached key and one exit hook).
// ---------------------------------------------------------------------------

function state() {
  if (!globalThis.__novaSecretsState) {
    globalThis.__novaSecretsState = { keyPath: "", masterKey: null, dataKey: null, failure: null, exitHook: false }
  }
  const st = globalThis.__novaSecretsState
  if (!st.exitHook) {
    st.exitHook = true
    process.once("exit", () => zeroCachedKeys())
  }
  return st
}

function zeroCachedKeys() {
  const st = globalThis.__novaSecretsState
  if (!st) return
  st.masterKey?.fill(0)
  st.dataKey?.fill(0)
  st.masterKey = null
  st.dataKey = null
  st.keyPath = ""
}

/** Drops cached key material and the DPAPI failure cache. For tests and shutdown. */
export function resetSecretsCache() {
  zeroCachedKeys()
  const st = globalThis.__novaSecretsState
  if (st) st.failure = null
}

// ---------------------------------------------------------------------------
// DPAPI wrapping. Key material travels over the child's STDIN only — never argv,
// env or a temp file. Scripts are fixed strings (no interpolation).
//
// FROZEN: the DPAPI optional-entropy string 'NovaAIO/master-key/v1' below must never
// change. DPAPI mixes it into the wrapping, so changing it makes every existing
// keys/master.key.dpapi undecryptable and orphans all stored secrets. (It is a public
// domain-separation label, not a secret.) A new scheme needs a new key-file header
// and a migration, not an edit here.
// ---------------------------------------------------------------------------

const PS_PROTECT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Security",
  "$e=[Text.Encoding]::UTF8.GetBytes('NovaAIO/master-key/v1')",
  "$b=[Convert]::FromBase64String(([Console]::In.ReadToEnd()).Trim())",
  "$p=[Security.Cryptography.ProtectedData]::Protect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Array]::Clear($b,0,$b.Length)",
  "[Console]::Out.Write([Convert]::ToBase64String($p))",
].join("\n")

const PS_UNPROTECT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Security",
  "$e=[Text.Encoding]::UTF8.GetBytes('NovaAIO/master-key/v1')",
  "$b=[Convert]::FromBase64String(([Console]::In.ReadToEnd()).Trim())",
  "$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($p))",
  "[Array]::Clear($p,0,$p.Length)",
].join("\n")

function powershellPath() {
  const root = process.env.SystemRoot || process.env.windir
  if (root) {
    const full = path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    if (fs.existsSync(full)) return full
  }
  return "powershell.exe"
}

function runPowerShell(script, stdin) {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  return execFileSync(
    powershellPath(),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    {
      input: stdin,
      encoding: "utf8",
      windowsHide: true,
      timeout: DPAPI_TIMEOUT_MS,
      maxBuffer: 1 << 20,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim()
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

function dpapiWrap(key) {
  const out = runPowerShell(PS_PROTECT, key.toString("base64"))
  if (!BASE64_RE.test(out)) throw new Error("dpapi-wrap-output-invalid")
  return out
}

function dpapiUnwrap(blobBase64) {
  const out = runPowerShell(PS_UNPROTECT, blobBase64)
  if (!BASE64_RE.test(out)) throw new Error("dpapi-unwrap-output-invalid")
  const key = Buffer.from(out, "base64")
  if (key.length !== 32) {
    key.fill(0)
    throw new Error("dpapi-unwrap-length-invalid")
  }
  return key
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Returns the wrapped blob (base64) or null when no key file exists. Throws when the file is malformed. */
function readWrappedBlob(file) {
  let raw
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch (error) {
    if (error && error.code === "ENOENT") return null
    throw new SecretsUnavailableError(
      `The Nova master key file could not be read. ${KEY_FILE_RECOVERY_HINT}`,
    )
  }
  const lines = raw.split(/\r?\n/)
  const blob = String(lines[1] || "").trim()
  if (lines[0] !== KEY_FILE_HEADER || !BASE64_RE.test(blob)) {
    throw new SecretsUnavailableError(`The Nova master key file is malformed. ${KEY_FILE_RECOVERY_HINT}`)
  }
  return blob
}

function readWrappedBlobWithRetry(file) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return readWrappedBlob(file)
    } catch (error) {
      // A non-atomic writer (filesystem without hard links) can be observed half-written.
      if (attempt >= 5) throw error
      sleepSync(50)
    }
  }
}

/**
 * Creates the master key file if nobody has yet. Returns { blob, key }: `key` is the
 * fresh plaintext key when THIS process won the race (saves an unwrap), else null and
 * `blob` is the winner's wrapped key.
 */
function createWrappedKey(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const fresh = randomBytes(32)
  let blob
  try {
    blob = dpapiWrap(fresh)
  } catch (error) {
    fresh.fill(0)
    throw error
  }
  const content = `${KEY_FILE_HEADER}\n${blob}\n`
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  fs.writeFileSync(tmp, content, { flag: "wx", mode: 0o600 })
  let won = false
  try {
    try {
      fs.linkSync(tmp, file) // atomic, fails with EEXIST if another process won
      won = true
    } catch (error) {
      if (error && error.code === "EEXIST") {
        won = false
      } else {
        try {
          fs.writeFileSync(file, content, { flag: "wx", mode: 0o600 })
          won = true
        } catch (fallbackError) {
          if (!fallbackError || fallbackError.code !== "EEXIST") throw fallbackError
        }
      }
    }
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      // best effort
    }
  }
  if (won) return { blob, key: fresh }
  fresh.fill(0)
  const winner = readWrappedBlobWithRetry(file)
  if (!winner) throw new SecretsUnavailableError("The Nova master key file disappeared during creation.")
  return { blob: winner, key: null }
}

function unavailable(reason) {
  return new SecretsUnavailableError(
    `${reason} Nova cannot encrypt secrets right now. Secrets are never stored in plaintext. ` +
      "If keys/master.key.dpapi came from another PC or Windows account, remove it and re-enter your API keys.",
  )
}

function deriveDataKey(masterKey) {
  return Buffer.from(hkdfSync("sha256", masterKey, Buffer.from(HKDF_SALT), Buffer.from(HKDF_INFO), 32))
}

function deriveInfoKey(masterKey, info, bytes = 32) {
  const label = String(info || "").trim() || "nova/application/v1"
  return Buffer.from(hkdfSync("sha256", masterKey, Buffer.from(HKDF_SALT), Buffer.from(label), bytes))
}

/**
 * Returns the 32-byte data key, or null when no master key exists and `create` is false.
 * Throws SecretsUnavailableError when a key is needed but DPAPI cannot provide it.
 */
function getDataKey(create) {
  if (forceDpapiFailure()) throw unavailable("DPAPI is unavailable (forced by test flag).")

  const override = testKeyOverride()
  if (override) return deriveDataKey(override)

  if (process.platform !== "win32") throw unavailable("Windows DPAPI is not available on this platform.")

  const st = state()
  let file
  try {
    file = keyFilePath()
  } catch {
    throw unavailable("The Nova data directory is not usable.")
  }
  if (st.keyPath === file && st.dataKey) return st.dataKey
  if (st.failure && st.failure.path === file && Date.now() - st.failure.at < FAILURE_CACHE_MS) {
    throw unavailable("Windows DPAPI could not unlock the Nova master key.")
  }

  let master = null
  try {
    let blob = readWrappedBlob(file)
    if (!blob) {
      if (!create) return null
      const created = createWrappedKey(file)
      blob = created.blob
      master = created.key
    }
    if (!master) master = dpapiUnwrap(blob)
  } catch (error) {
    if (error instanceof SecretsUnavailableError) throw error
    st.failure = { path: file, at: Date.now() }
    throw unavailable("Windows DPAPI could not unlock the Nova master key.")
  }

  zeroCachedKeys()
  st.keyPath = file
  st.masterKey = master
  st.dataKey = deriveDataKey(master)
  st.failure = null
  return st.dataKey
}

// ---------------------------------------------------------------------------
// Ciphertext shapes
// ---------------------------------------------------------------------------

function parseNv1(input) {
  if (!input.startsWith(NV1_PREFIX)) return null
  const body = input.slice(NV1_PREFIX.length)
  if (!BASE64_RE.test(body)) return null
  const raw = Buffer.from(body, "base64")
  if (raw.length < 12 + 16) return null
  return { iv: raw.subarray(0, 12), tag: raw.subarray(12, 28), ct: raw.subarray(28) }
}

export function isSecretCiphertext(value) {
  if (typeof value !== "string") return false
  const input = value.trim()
  if (!input) return false
  return Boolean(parseNv1(input))
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypts to "nv1:" + base64(iv12 || tag16 || ct). `context` is bound as GCM AAD so a
 * ciphertext cannot be moved to a different field. Throws SecretsUnavailableError when
 * the master key cannot be obtained — never falls back to plaintext or a weak key.
 */
export function encryptSecret(plainText, context) {
  const value = String(plainText || "")
  if (!value) return ""
  const key = getDataKey(true)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 })
  if (context) cipher.setAAD(Buffer.from(String(context), "utf8"))
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return NV1_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")
}

function decryptNv1(parsed, context) {
  let key
  try {
    key = getDataKey(false)
  } catch {
    return null
  }
  if (!key) return null
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, parsed.iv, { authTagLength: 16 })
    if (context) decipher.setAAD(Buffer.from(String(context), "utf8"))
    decipher.setAuthTag(parsed.tag)
    return Buffer.concat([decipher.update(parsed.ct), decipher.final()]).toString("utf8")
  } catch {
    return null
  }
}

const NO_RESULT = Object.freeze({ value: "", keyIndex: -1, format: "none" })

/**
 * Never throws and never logs. keyIndex: 0 = current nv1 key, -1 = failure/empty.
 */
export function decryptSecretWithMeta(payload, context) {
  try {
    const input = String(payload || "").trim()
    if (!input) return { ...NO_RESULT }

    if (input.startsWith(NV1_PREFIX)) {
      const parsed = parseNv1(input)
      const value = parsed ? decryptNv1(parsed, context) : null
      return value === null ? { ...NO_RESULT } : { value, keyIndex: 0, format: "nv1" }
    }
  } catch {
    // fall through: decryption failure is reported as an empty result, never an exception
  }
  return { ...NO_RESULT }
}

export function decryptSecret(payload, context) {
  return decryptSecretWithMeta(payload, context).value
}

/**
 * Loads (or creates, when `create` is true) the master key into the in-process cache and returns
 * whether it is ready. Call it BEFORE opening a database transaction or importer: the first
 * DPAPI call spawns PowerShell (~0.5-1 s, up to 20 s under AV) and must not happen while a
 * write lock is held. Never throws, never returns key material.
 */
export function warmSecrets(create = true) {
  try {
    return getDataKey(create !== false) !== null
  } catch {
    return false
  }
}

/**
 * Derives a deterministic application secret from the DPAPI master key.
 * Used for local OAuth state signing and similar non-storage purposes.
 * Never logs or returns the master key itself.
 */
export function deriveApplicationSecret(info, bytes = 32) {
  const size = Number.isFinite(Number(bytes)) ? Math.max(16, Math.min(64, Math.trunc(Number(bytes)))) : 32
  if (forceDpapiFailure()) throw unavailable("DPAPI is unavailable (forced by test flag).")

  const override = testKeyOverride()
  if (override) return deriveInfoKey(override, info, size).toString("hex")

  // Ensure the master key is loaded/created, then HKDF with a purpose-specific info string.
  getDataKey(true)
  const st = state()
  if (!st.masterKey) throw unavailable("The Nova master key is not available.")
  return deriveInfoKey(st.masterKey, info, size).toString("hex")
}

/** Never returns key material. */
export function getMasterKeyStatus() {
  try {
    if (testKeyOverride() && !forceDpapiFailure()) return { ready: true, source: "test-override", createdAt: null }
    const file = keyFilePath()
    if (!fs.existsSync(file)) return { ready: false, source: "none", createdAt: null }
    const stat = fs.statSync(file)
    const createdAt = (stat.birthtime && stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime).toISOString()
    let ready = false
    try {
      ready = getDataKey(false) !== null
    } catch {
      ready = false
    }
    return { ready, source: "dpapi", createdAt }
  } catch {
    return { ready: false, source: "none", createdAt: null }
  }
}

// ---------------------------------------------------------------------------
// Masking / redaction
// ---------------------------------------------------------------------------

/** "sk-…a1b2"-style hint. At most 8 visible characters (including the ellipsis). */
export function maskSecret(value) {
  const text = String(value || "")
  if (!text) return ""
  if (text.length < 8) return "••••"
  const tail = Math.min(4, Math.floor(text.length / 4))
  const head = text.length >= 16 ? 3 : 0
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

// Field names whose values are redacted wholesale. Suffix match covers apiKey/private_key/secret_key/
// clientSecret/accessToken/*Enc/Authorization; the extra alternations cover wallet + credential material.
const SECRET_KEY_NAME_RE = new RegExp(
  [
    "(key|secret|token|password|passwd|passphrase|mnemonic|seed|credentials?|authorization|cookie|enc)$",
    "(seed|recovery|backup)[_-]?phrase$",
    "^auth([_-]?(token|header|key|secret|code|bearer|cookie))?$",
  ].join("|"),
  "i",
)

const INLINE_SECRET_PATTERNS = [
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bxai-[A-Za-z0-9]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bya29\.[0-9A-Za-z_-]{20,}/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi,
  // PEM private keys (Coinbase CDP / wallet keys). The second form also catches a block truncated before its END line.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g,
  // Serialized JSON fragments inside free text, e.g. {"privateKey":"..."} embedded in a string value.
  /"[A-Za-z_-]*(?:secret|token|password|private_?key|api_?key)"\s*:\s*"(?:[^"\\]|\\.)*"/gi,
]

const MAX_REDACT_DEPTH = 32

function redactString(text) {
  if (isSecretCiphertext(text)) return REDACTED
  let out = text
  for (const pattern of INLINE_SECRET_PATTERNS) out = out.replace(pattern, REDACTED)
  return out
}

function redactValue(value, seen, depth) {
  if (typeof value === "string") return redactString(value)
  if (value === null || typeof value !== "object") return value
  if (depth >= MAX_REDACT_DEPTH) return REDACTED
  if (value instanceof Date) return new Date(value.getTime())
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return "[binary]"
  if (seen.has(value)) return seen.get(value)
  if (value instanceof Error) {
    return { name: value.name, message: redactString(String(value.message || "")) }
  }
  if (Array.isArray(value)) {
    const out = []
    seen.set(value, out)
    for (const item of value) out.push(redactValue(item, seen, depth + 1))
    return out
  }
  const out = {}
  seen.set(value, out)
  for (const [name, child] of Object.entries(value)) {
    const sensitive = SECRET_KEY_NAME_RE.test(name)
    if (sensitive && ((typeof child === "string" && child !== "") || (child !== null && typeof child === "object"))) {
      out[name] = REDACTED
    } else {
      out[name] = redactValue(child, seen, depth + 1)
    }
  }
  return out
}

/** Deep-clones `value`, replacing secret-looking fields/strings with "[redacted]". Never mutates the input. */
export function redactSecrets(value) {
  return redactValue(value, new WeakMap(), 0)
}
