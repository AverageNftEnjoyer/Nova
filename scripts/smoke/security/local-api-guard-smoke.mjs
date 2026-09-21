import "../lib/isolated-data-dir.mjs" // isolate NOVA_DATA_DIR (must stay the first import)
/**
 * Local API / gateway guard smoke.
 *  - hud/lib/security/local-request-guard.ts (used by hud/proxy.ts): foreign Host / Origin / Sec-Fetch-Site rejected,
 *    loopback + no-Origin (runtime, Electron main, curl) allowed.
 *  - hud/lib/security/provider-base-url.ts: a stored key is never paired with a request-supplied base URL; request base
 *    URLs must be safe https.
 *  - static checks: the six probe routes go through the resolver, the config PATCH validates base URLs, proxy.ts wires the guard.
 *  - WebSocket gateway upgrade check (pure helper + a real ws server using the verifyClient callback).
 *  - ChatKit runner disables Agents SDK tracing and no longer defaults `store` on.
 * hud TS is transpiled into an OS temp dir (same approach as scripts/smoke/agent-tasks/agent-tasks-smoke.mjs).
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "typescript"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-local-api-guard-smoke-"))
process.on("exit", () => {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  } catch {
    // best effort
  }
})

const results = []
function record(status, name, detail = "") {
  results.push({ status, name, detail })
}
async function run(name, fn) {
  try {
    await fn()
    record("PASS", name)
  } catch (error) {
    record("FAIL", name, error instanceof Error ? error.message : String(error))
  }
}
function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
}
function transpile(relativePaths) {
  for (const relativePath of relativePaths) {
    const output = ts.transpileModule(read(relativePath), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    })
    const target = path.join(tempRoot, relativePath.replace(/\.ts$/, ".js"))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, output.outputText, "utf8")
  }
}

transpile([
  "hud/lib/security/local-request-guard.ts",
  "hud/lib/security/provider-base-url.ts",
])
// Transpiled files are CommonJS; a package.json in the temp root keeps Node from treating them as ESM.
fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ type: "commonjs" }))
const requireTemp = createRequire(path.join(tempRoot, "noop.js"))
const guard = requireTemp("./hud/lib/security/local-request-guard.js")
const providerUrl = requireTemp("./hud/lib/security/provider-base-url.js")
const originGuard = await import(
  pathToFileURL(path.join(repoRoot, "src/runtime/infrastructure/hud-gateway/origin-guard/index.js")).href
)

const req = (over = {}) => ({ method: "POST", host: "localhost:3000", origin: null, secFetchSite: null, ...over })

// ---------------------------------------------------------------- HUD request guard
await run("guard: allows loopback Host with no Origin (runtime, Electron main, curl)", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "LOCALHOST:3000"]) {
    assert.deepEqual(guard.evaluateLocalRequest(req({ host })), { ok: true }, host)
  }
})
await run("guard: allows same-origin browser requests (localhost and 127.0.0.1)", () => {
  assert.equal(guard.evaluateLocalRequest(req({ origin: "http://localhost:3000", secFetchSite: "same-origin" })).ok, true)
  assert.equal(
    guard.evaluateLocalRequest(req({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", secFetchSite: "same-origin" })).ok,
    true,
  )
  assert.equal(guard.evaluateLocalRequest(req({ host: "[::1]:3000", origin: "http://[::1]:3000" })).ok, true)
  assert.equal(guard.evaluateLocalRequest(req({ secFetchSite: "none" })).ok, true)
})
await run("guard: rejects foreign Host (DNS rebinding) for every method", () => {
  const hosts = [
    "evil.example", "evil.example:3000", "localhost.evil.example:3000", "127.0.0.1.evil.example", "192.168.1.5:3000",
    "0.0.0.0:3000", "", null, "localhost:3000@evil.example", "localhost:3000, evil.example",
  ]
  for (const method of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) {
    for (const host of hosts) {
      const decision = guard.evaluateLocalRequest(req({ method, host }))
      assert.equal(decision.ok, false, `${method} host=${host}`)
      assert.equal(decision.reason, "host")
    }
  }
})
await run("guard: rejects foreign / null / other-port Origin on state-changing methods", () => {
  const origins = [
    "https://evil.example", "http://evil.example:3000", "null", "http://localhost:5173",
    "http://localhost.evil.example:3000", "file://", "http://localhost:3000@evil.example", "chrome-extension://abc",
  ]
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const origin of origins) {
      const decision = guard.evaluateLocalRequest(req({ method, origin }))
      assert.equal(decision.ok, false, `${method} origin=${origin}`)
      assert.equal(decision.reason, "origin")
    }
  }
})
await run("guard: rejects cross-site / same-site Sec-Fetch-Site on state-changing methods", () => {
  for (const secFetchSite of ["cross-site", "same-site"]) {
    const decision = guard.evaluateLocalRequest(req({ secFetchSite }))
    assert.equal(decision.ok, false, secFetchSite)
    assert.equal(decision.reason, "fetch-site")
  }
})
await run("guard: safe methods still allow cross-site navigations (OAuth callbacks) on a loopback Host", () => {
  assert.equal(guard.evaluateLocalRequest(req({ method: "GET", origin: null, secFetchSite: "cross-site" })).ok, true)
})

// ---------------------------------------------------------------- provider base URL policy
await run("base URL: validate accepts public https and rejects unsafe values", () => {
  assert.deepEqual(providerUrl.validateProviderBaseUrl("https://api.openai.com/v1/"), { ok: true, url: "https://api.openai.com/v1" })
  const bad = [
    "", "not a url", "http://api.openai.com/v1", "https://user:pw@api.openai.com/v1", "https://localhost:8080/v1",
    "https://127.0.0.1/v1", "https://[::1]/v1", "https://10.0.0.5/v1", "https://192.168.1.2/v1", "https://169.254.169.254/latest",
    "https://api.openai.com/v1?x=1", "https://api.openai.com/v1#frag", "ftp://api.openai.com", "https://2130706433/v1", "https://0x7f.0.0.1/v1",
    "https://[::ffff:127.0.0.1]/v1", "https://[fe80::1]/v1", "https://[fd00::1]/v1", "https://100.64.0.1/v1", "https://intranet/v1", "https://router.local/v1",
  ]
  for (const value of bad) {
    assert.equal(providerUrl.validateProviderBaseUrl(value).ok, false, value)
  }
})
const stored = { storedApiKey: "sk-STORED", storedBaseUrl: "https://api.openai.com/v1", defaultBaseUrl: "https://api.openai.com/v1" }
await run("base URL: stored key + attacker base URL is refused and never resolved", () => {
  const attack = providerUrl.resolveProviderProbeTarget({ ...stored, callerApiKey: undefined, callerBaseUrl: "https://attacker.example" })
  assert.equal(attack.ok, false)
  assert.equal(attack.status, 400)
  assert.ok(!JSON.stringify(attack).includes("sk-STORED"))
  const blank = providerUrl.resolveProviderProbeTarget({ ...stored, callerApiKey: "   ", callerBaseUrl: "https://attacker.example" })
  assert.equal(blank.ok, false)
})
await run("base URL: stored key resolves only to the stored base URL", () => {
  const same = providerUrl.resolveProviderProbeTarget({ ...stored, callerApiKey: undefined, callerBaseUrl: "https://api.openai.com/v1/" })
  assert.deepEqual(same, { ok: true, apiKey: "sk-STORED", baseUrl: "https://api.openai.com/v1" })
  const none = providerUrl.resolveProviderProbeTarget({ ...stored, callerApiKey: undefined, callerBaseUrl: undefined })
  assert.deepEqual(none, { ok: true, apiKey: "sk-STORED", baseUrl: "https://api.openai.com/v1" })
})
await run("base URL: typed key may test a validated custom base URL, never a private one", () => {
  const ok = providerUrl.resolveProviderProbeTarget({ ...stored, callerApiKey: "sk-TYPED", callerBaseUrl: "https://gateway.example.com/v1" })
  assert.deepEqual(ok, { ok: true, apiKey: "sk-TYPED", baseUrl: "https://gateway.example.com/v1" })
  for (const bad of ["http://gateway.example.com", "https://127.0.0.1:9999", "https://u:p@gateway.example.com"]) {
    assert.equal(providerUrl.resolveProviderProbeTarget({ ...stored, callerApiKey: "sk-TYPED", callerBaseUrl: bad }).ok, false, bad)
  }
})

// ---------------------------------------------------------------- static wiring checks
const PROBE_ROUTES = [
  "list-claude-models", "list-gemini-models", "test-claude-model", "test-gemini-model", "test-grok-model", "test-openai-model",
]
await run("static: six probe routes use the resolver and no longer fall back from body.baseUrl to the stored key", () => {
  for (const name of PROBE_ROUTES) {
    const src = read(`hud/app/api/integrations/${name}/route.ts`)
    assert.ok(src.includes("resolveProviderProbeTarget("), `${name} must call resolveProviderProbeTarget`)
    assert.ok(!/body\.baseUrl\.trim\(\)\)\s*\|\|/.test(src), `${name} must not prefer body.baseUrl with a stored fallback`)
    assert.ok(!/\bconfig\.\w+\.apiKey\.trim\(\)/.test(src), `${name} must not read the stored key directly`)
    assert.ok(/redirect:\s*"error"/.test(src), `${name} must not follow redirects with a key attached`)
  }
})
await run("static: config PATCH validates changed provider base URLs", () => {
  const src = read("hud/app/api/integrations/config/route.ts")
  assert.ok(src.includes("validateProviderBaseUrl("))
  assert.ok(/label: "OpenAI"[\s\S]*label: "Claude"[\s\S]*label: "Grok"[\s\S]*label: "Gemini"/.test(src))
})
await run("static: proxy.ts runs the local request guard before the rate limiter and answers 403", () => {
  const src = read("hud/proxy.ts")
  assert.ok(src.includes("evaluateLocalRequest("))
  assert.ok(src.indexOf("evaluateLocalRequest(") < src.indexOf("const ip = getClientIp(req)"))
  assert.ok(src.includes("status: 403"))
  assert.ok(src.includes('"/api/:path*"'))
  const helper = read("hud/lib/security/local-request-guard.ts")
  assert.ok(!/^import\b.*(server-only|"@\/)/m.test(helper), "guard must stay free of server-only and @/ imports")
})
await run("static: gateway registers verifyClient", () => {
  const src = read("src/runtime/infrastructure/hud-gateway/index.js")
  assert.ok(src.includes("verifyClient: createGatewayVerifyClient()"))
})
await run("static: ChatKit runner disables tracing and store defaults off", () => {
  const runner = read("src/integrations/chatkit/runner/index.ts")
  assert.ok(/setTracingDisabled\(true\)/.test(runner) || /tracingDisabled:\s*true/.test(runner))
  assert.ok(/traceIncludeSensitiveData:\s*false/.test(runner))
  const config = read("src/integrations/chatkit/config/index.ts")
  assert.ok(/NOVA_CHATKIT_STORE,\s*false\)/.test(config), "store must default to false")
  assert.ok(!/NOVA_CHATKIT_STORE=1/.test(read(".env.example")), ".env.example must not opt into store")
})

// ---------------------------------------------------------------- WebSocket gateway
await run("ws helper: no Origin (non-browser client) and local HUD origins are allowed", () => {
  const env = {}
  assert.deepEqual(originGuard.checkGatewayUpgrade({ origin: undefined, host: "127.0.0.1:8765" }, env), { ok: true })
  assert.deepEqual(originGuard.checkGatewayUpgrade({ origin: undefined, host: "localhost:8765" }, env), { ok: true })
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
    assert.deepEqual(originGuard.checkGatewayUpgrade({ origin, host: "127.0.0.1:8765" }, env), { ok: true }, origin)
  }
})
await run("ws helper: foreign Origin, wrong port, null Origin and foreign Host are rejected", () => {
  const env = {}
  const origins = [
    "https://evil.example", "http://evil.example:3000", "http://localhost:4000", "null", "file://",
    "http://localhost.evil.example:3000", "https://localhost:3000x",
  ]
  for (const origin of origins) {
    assert.deepEqual(originGuard.checkGatewayUpgrade({ origin, host: "127.0.0.1:8765" }, env), { ok: false, reason: "origin" }, origin)
  }
  for (const host of ["evil.example:8765", "attacker.example", "10.0.0.2:8765"]) {
    assert.deepEqual(originGuard.checkGatewayUpgrade({ origin: undefined, host }, env), { ok: false, reason: "host" }, host)
  }
})
await run("ws helper: HUD port env and extra origins extend the allowlist", () => {
  const env = { NOVA_HUD_PORT: "4321", NOVA_WS_ALLOWED_ORIGINS: "https://hud.internal:8443" }
  assert.equal(originGuard.checkGatewayUpgrade({ origin: "http://localhost:4321", host: "127.0.0.1:8765" }, env).ok, true)
  assert.equal(originGuard.checkGatewayUpgrade({ origin: "https://hud.internal:8443", host: "127.0.0.1:8765" }, env).ok, true)
  assert.equal(originGuard.checkGatewayUpgrade({ origin: "http://localhost:4322", host: "127.0.0.1:8765" }, env).ok, false)
})
await run("ws server: verifyClient rejects foreign Origin (403, one log line, no payload) and accepts local / no Origin", async () => {
  const { WebSocketServer, WebSocket } = await import("ws")
  const logs = []
  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    verifyClient: originGuard.createGatewayVerifyClient({ env: {}, log: (line) => logs.push(line) }),
  })
  await new Promise((resolve) => wss.on("listening", resolve))
  const { port } = wss.address()
  const attempt = (headers) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers })
      ws.on("open", () => {
        ws.close()
        resolve("open")
      })
      ws.on("unexpected-response", (_req, res) => {
        res.resume()
        resolve(`http-${res.statusCode}`)
      })
      ws.on("error", () => resolve("error"))
    })
  try {
    assert.equal(await attempt({}), "open")
    assert.equal(await attempt({ Origin: "http://localhost:3000" }), "open")
    assert.equal(await attempt({ Origin: "https://evil.example" }), "http-403")
    assert.equal(await attempt({ Origin: "null" }), "http-403")
    assert.equal(await attempt({ Host: "evil.example" }), "http-403")
    assert.equal(logs.length, 3)
    assert.ok(logs.every((line) => line.startsWith("[Gateway] Rejected WebSocket upgrade") && !line.includes("evil")))
  } finally {
    for (const client of wss.clients) client.terminate()
    await new Promise((resolve) => wss.close(resolve))
  }
})

let failed = 0
for (const item of results) {
  if (item.status === "FAIL") failed += 1
  console.log(`[${item.status}] ${item.name}${item.detail ? ` :: ${item.detail}` : ""}`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
