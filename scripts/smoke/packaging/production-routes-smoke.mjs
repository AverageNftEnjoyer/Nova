/**
 * Packaging safety net for size trims (hud dependency moves, node_modules filters, better-sqlite3 trim,
 * dropping sharp). Two independent checks against the PACKAGED app (`hud/dist/win-unpacked`):
 *
 *  A. Static guard. Every bare-name `require("x")` / `import("x")` in `.next/server/**` must be a Node
 *     builtin, `next/*`, a relative path, or an allowlisted Turbopack hashed external (`jsdom-<hash>`,
 *     `better-sqlite3-<hash>`), and every hashed external must exist in `.next/node_modules`. Anything
 *     else means the server would `require` a package that the packager no longer ships, so the build
 *     fails here instead of the installed app failing on the first request that touches it.
 *
 *  B. Route sweep. Boots the packaged services exactly like production-boot-smoke.mjs (isolated data dir,
 *     fake handleInput), then GETs every page route and every GET-capable API route from
 *     `.next/app-path-routes-manifest.json` (dynamic segments get a dummy value). A route passes when it
 *     answers < 500 (redirects are not followed). The body must never contain "Cannot find module" or
 *     "MODULE_NOT_FOUND". Routes that legitimately answer 5xx are listed in ALLOWED_5XX with a reason.
 *
 * Requires `hud/dist/win-unpacked` (from `npm run build && npm run electron:prepare-runtime &&
 * npx electron-builder --win --x64 --dir`, run in hud/).
 */
import "../lib/isolated-data-dir.mjs"
import assert from "node:assert/strict"
import { builtinModules, createRequire } from "node:module"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

process.env.NOVA_AGENT_TASK_POLL_MS = "20"
process.env.NOVA_AGENT_TASK_HEARTBEAT_MS = "50"
process.env.NOVA_AGENT_TASK_LEASE_MS = "5000"
process.env.NEXT_TELEMETRY_DISABLED = "1"
process.env.NODE_ENV = "production"
delete process.env.NOVA_PACKAGED

const hudDir = path.resolve(
  process.env.NOVA_PRODUCTION_SMOKE_HUD || path.join(repoRoot, "hud", "dist", "win-unpacked", "resources", "app"),
)
const runtimeRoot = path.resolve(
  process.env.NOVA_PRODUCTION_SMOKE_RUNTIME
    || path.join(repoRoot, "hud", "dist", "win-unpacked", "resources", "runtime-resources"),
)

// Routes that may legitimately answer >= 500 with no credentials/network in this sandbox. Keep this
// empty unless a route is proven to do so, and always say why.
/** @type {Map<string, string>} */
const ALLOWED_5XX = new Map([
  // Next's built-in global error boundary page. Requested directly (not as a result of a render error) it
  // answers 500 by design; it is only rendered so its chunk is proven loadable (the body check still applies).
  ["/_global-error", "Next built-in error boundary answers 500 when requested directly"],
  // Pre-existing app behavior: a missing query/id fails zod validation and is reported as youtube.internal (500)
  // instead of a 400. The route module itself loads and runs; only the input is empty here.
  ["/api/integrations/youtube/search", "empty query -> zod error mapped to 500 (pre-existing)"],
  ["/api/integrations/youtube/video", "missing id -> zod error mapped to 500 (pre-existing)"],
  // These call the public Polymarket API with the dummy id this smoke substitutes for the dynamic segment;
  // upstream answers 404/422 (or is unreachable offline) and the route relays that as 500/502.
  ["/api/polymarket/book/smoke-tokenId", "upstream 404 for a dummy token id"],
  ["/api/polymarket/history/smoke-tokenId", "upstream failure for a dummy token id"],
  ["/api/polymarket/leaderboard", "public upstream answers non-2xx / unreachable offline"],
  ["/api/polymarket/market/smoke-id", "upstream 422 for a dummy market id"],
  ["/api/polymarket/orderbook/smoke-tokenId", "upstream 404 for a dummy token id"],
])

// Bare specifiers that are allowed in the packaged server output.
const HASHED_EXTERNALS = [/^jsdom-[0-9a-f]{16}$/, /^better-sqlite3-[0-9a-f]{16}$/]
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
// `require("something")` appears verbatim inside a comment of Turbopack's own runtime chunk
// (`[turbopack]_runtime.js`) as an example of a bare require. It is documentation, never executed.
const RUNTIME_COMMENT_SPECIFIERS = new Map([["something", /\[turbopack\]_runtime\.js$/]])

/**
 * Regexes: a call to `require(` or `import(` whose ONLY argument is a string literal (single, double
 * or backtick quoted). Turbopack's CommonJS server output emits externals as `require("<name>")`, and
 * ESM externals as `import("<name>")`. Non-literal calls (`require(id)`) cannot be judged statically and
 * are covered by the route sweep instead. `\b` keeps `xrequire(` and `.import(` prefixes honest enough
 * for this output; `from "x"` static imports are not scanned because the server chunks are CJS.
 */
const SPECIFIER_PATTERNS = [
  /\brequire\(\s*(["'`])([^"'`\r\n]+)\1\s*\)/g,
  /\bimport\(\s*(["'`])([^"'`\r\n]+)\1\s*\)/g,
]

function listJsFiles(dir) {
  const files = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (/\.(?:js|cjs|mjs)$/.test(entry.name)) files.push(full)
    }
  }
  return files
}

function isAllowedSpecifier(specifier, file) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return true
  if (BUILTINS.has(specifier)) return true
  if (specifier === "next" || specifier.startsWith("next/")) return true
  if (HASHED_EXTERNALS.some((re) => re.test(specifier))) return true
  const commentOnly = RUNTIME_COMMENT_SPECIFIERS.get(specifier)
  if (commentOnly && commentOnly.test(file)) return true
  return false
}

function runStaticRequireGuard() {
  const serverDir = path.join(hudDir, ".next", "server")
  assert.equal(fs.existsSync(serverDir), true, `missing ${serverDir}`)
  const files = listJsFiles(serverDir)
  assert.ok(files.length > 50, `suspiciously few server files (${files.length}) under ${serverDir}`)
  /** @type {Map<string, string[]>} */
  const offenders = new Map()
  const hashedSeen = new Set()
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8")
    for (const pattern of SPECIFIER_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const specifier = match[2]
        if (HASHED_EXTERNALS.some((re) => re.test(specifier))) hashedSeen.add(specifier)
        if (!isAllowedSpecifier(specifier, file)) {
          const list = offenders.get(specifier) || []
          list.push(path.relative(serverDir, file))
          offenders.set(specifier, list)
        }
      }
    }
  }
  assert.equal(
    offenders.size,
    0,
    "packaged .next/server requires packages that are not shipped (move to dependencies, or allowlist deliberately):\n"
      + [...offenders].map(([name, where]) => `  ${name}  <- ${where.slice(0, 3).join(", ")}`).join("\n"),
  )
  const nextModules = path.join(hudDir, ".next", "node_modules")
  for (const hashed of hashedSeen) {
    assert.equal(fs.existsSync(path.join(nextModules, hashed, "package.json")), true, `hashed external ${hashed} is missing from .next/node_modules`)
  }
  console.log(`[production-routes] static guard: ${files.length} server files scanned, hashed externals present: ${[...hashedSeen].join(", ") || "none"}`)
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)))
  })
}

/** Source route file for a manifest key such as "/api/foo/route" (used only to see which methods exist). */
function sourceHasGet(routeKey) {
  const file = path.join(repoRoot, "hud", "app", `${routeKey}.ts`)
  if (!fs.existsSync(file)) return null
  return /export\s+(?:async\s+function|const|function)\s+GET\b/.test(fs.readFileSync(file, "utf8"))
}

/** Reads at most ~256 KB / 3 s of a body (SSE streams never end), then cancels it. */
async function readBounded(res) {
  if (!res.body) return ""
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  const deadline = Date.now() + 3_000
  try {
    while (Date.now() < deadline && text.length < 256 * 1024) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve(null), Math.max(1, deadline - Date.now()))),
      ])
      if (!chunk || chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return text
}

function collectRoutes() {
  const manifestFile = path.join(hudDir, ".next", "app-path-routes-manifest.json")
  assert.equal(fs.existsSync(manifestFile), true, `missing ${manifestFile}`)
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"))
  const pages = []
  const apis = []
  const skipped = []
  for (const [key, url] of Object.entries(manifest)) {
    const concrete = String(url).replace(/\[([^\]]+)\]/g, "smoke-$1")
    if (!String(url).startsWith("/api")) {
      // Pages and metadata routes (favicon.ico, ...): plain GET.
      pages.push({ key, url: concrete })
      continue
    }
    const hasGet = sourceHasGet(key)
    assert.notEqual(hasGet, null, `no source file for API route ${key}; cannot tell whether it supports GET`)
    if (hasGet) apis.push({ key, url: concrete })
    else skipped.push(String(url))
  }
  return { pages, apis, skipped }
}

async function main() {
  assert.equal(
    fs.existsSync(path.join(hudDir, "electron", "production-server.js")),
    true,
    `Packaged layout missing at ${hudDir}. From hud/, run: npm run build && npm run electron:prepare-runtime && npx electron-builder --win --x64 --dir`,
  )
  assert.equal(fs.existsSync(path.join(runtimeRoot, "src", "runtime", "core", "entrypoint", "index.js")), true, `missing runtime entrypoint under ${runtimeRoot}`)

  runStaticRequireGuard()

  const { pages, apis, skipped } = collectRoutes()
  console.log(`[production-routes] ${pages.length} page/metadata routes, ${apis.length} GET API routes (${skipped.length} API routes without GET skipped)`)

  assert.equal(await portFree(8765), true, "127.0.0.1:8765 is already in use; stop the other Nova runtime before this smoke")

  const { startProductionServices } = require(path.join(hudDir, "electron", "production-server.js"))
  const services = await startProductionServices({
    hudDir,
    runtimeRoot,
    handleInput: async () => ({ ok: true, reply: "routes-smoke", promptTokens: 1, completionTokens: 1 }),
  })
  console.log(`[production-routes] Next + runtime listening on 127.0.0.1:${services.port}`)

  const failures = []
  const allowedHits = []
  try {
    for (const route of [...pages, ...apis]) {
      const startedAt = Date.now()
      let status = 0
      let body = ""
      try {
        const res = await fetch(`http://127.0.0.1:${services.port}${route.url}`, {
          redirect: "manual",
          headers: { Accept: "text/html,application/json" },
          signal: AbortSignal.timeout(60_000),
        })
        status = res.status
        body = await readBounded(res)
      } catch (error) {
        failures.push(`${route.url} -> request failed: ${error?.message || error}`)
        continue
      }
      const moduleError = /cannot find module|MODULE_NOT_FOUND/i.test(body)
      if (moduleError) failures.push(`${route.url} -> ${status} body mentions a missing module: ${body.slice(0, 300)}`)
      if (status >= 500) {
        const reason = ALLOWED_5XX.get(route.url)
        if (reason) allowedHits.push(`${route.url} -> ${status} (allowed: ${reason})`)
        else if (!moduleError) failures.push(`${route.url} -> ${status}: ${body.slice(0, 300)}`)
      }
      console.log(`[production-routes] ${String(status).padStart(3)} ${String(Date.now() - startedAt).padStart(5)}ms ${route.url}`)
    }
  } finally {
    await services.stop()
  }

  for (const line of allowedHits) console.log(`[production-routes] ${line}`)
  assert.equal(failures.length, 0, `route sweep failures:\n${failures.map((line) => `  ${line}`).join("\n")}`)
  assert.equal(await portFree(8765), true, "runtime gateway still listening on 8765 after stop()")
  console.log(`[production-routes] PASS (${pages.length + apis.length} routes)`)
}

const watchdog = setTimeout(() => {
  console.error("[production-routes] FAILED: timed out")
  process.exit(1)
}, 420_000)

main()
  .then(() => {
    clearTimeout(watchdog)
    process.exit(0)
  })
  .catch((error) => {
    clearTimeout(watchdog)
    console.error("[production-routes] FAILED:", error?.stack || error)
    process.exit(1)
  })
