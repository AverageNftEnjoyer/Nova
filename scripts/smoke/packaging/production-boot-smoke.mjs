/**
 * Closure 4 gate: boot the packaged production server (the same `startProductionServices` entry
 * Electron's main process loads) plus the staged runtime scheduler, without `npm run dev`.
 *
 * Proves:
 *   - Next responds on the loopback port the packager uses
 *   - a queued `agent_tasks` row in that process's SQLite database is claimed (status leaves queued)
 *     via an in-process fake handleInput, so no model API key is required
 *   - stop() returns and the process is able to exit
 *   - NOVA_PACKAGED=1 resolves the data directory to %APPDATA%\Nova (here, a fake APPDATA), never
 *     under the install tree
 *
 * Data directory: scripts/smoke/lib/isolated-data-dir.mjs (os.tmpdir()). This script must not write
 * C:/Nova/hud/_final_boot_datadir or the repo `.user` database.
 *
 * Requires `hud/dist/win-unpacked` from `npx electron-builder --win --x64 --dir` (after
 * `electron:prepare-runtime`). Set NOVA_PRODUCTION_SMOKE_ALLOW_SOURCE=1 plus
 * NOVA_PRODUCTION_SMOKE_HUD / NOVA_PRODUCTION_SMOKE_RUNTIME only to debug the same entry against a
 * source tree. That run is not the packaging proof.
 */
import "../lib/isolated-data-dir.mjs"
import { isolatedDataDir } from "../lib/isolated-data-dir.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

process.env.NOVA_AGENT_TASK_POLL_MS = "20"
process.env.NOVA_AGENT_TASK_HEARTBEAT_MS = "50"
process.env.NOVA_AGENT_TASK_LEASE_MS = "5000"
process.env.NEXT_TELEMETRY_DISABLED = "1"
process.env.NODE_ENV = "production"
delete process.env.NOVA_PACKAGED

const allowSource = process.env.NOVA_PRODUCTION_SMOKE_ALLOW_SOURCE === "1"
const hudDir = path.resolve(
  process.env.NOVA_PRODUCTION_SMOKE_HUD
    || path.join(repoRoot, "hud", "dist", "win-unpacked", "resources", "app"),
)
const runtimeRoot = path.resolve(
  process.env.NOVA_PRODUCTION_SMOKE_RUNTIME
    || path.join(repoRoot, "hud", "dist", "win-unpacked", "resources", "runtime-resources"),
)
const layout = hudDir.includes(`${path.sep}win-unpacked${path.sep}`) ? "win-unpacked" : "source"

function statStamp(file) {
  if (!fs.existsSync(file)) return null
  const stat = fs.statSync(file)
  return `${stat.size}:${stat.mtimeMs}`
}

function isUnder(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true))
    })
  })
}

function assertPackagedDataDirResolvesOutsideInstall() {
  const fakeAppData = fs.mkdtempSync(path.join(os.tmpdir(), "nova-packaged-appdata-"))
  const pathsHref = pathToFileURL(path.join(runtimeRoot, "src", "db", "paths.js")).href
  const script = `
    const { resolveDataDir } = await import(${JSON.stringify(pathsHref)});
    process.stdout.write(resolveDataDir());
  `
  const childEnv = { ...process.env, APPDATA: fakeAppData, NOVA_PACKAGED: "1", NOVA_WORKSPACE_ROOT: runtimeRoot }
  delete childEnv.NOVA_DATA_DIR
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: childEnv,
    encoding: "utf8",
    windowsHide: true,
  })
  try {
    assert.equal(result.status, 0, `packaged data-dir child failed: ${result.stderr || result.stdout}`)
    const resolved = String(result.stdout || "").trim()
    const expected = path.join(fakeAppData, "Nova")
    assert.equal(path.resolve(resolved), path.resolve(expected), `NOVA_PACKAGED=1 resolved to ${resolved}`)
    assert.equal(isUnder(resolved, hudDir), false, "packaged data dir must not sit inside the app directory")
    assert.equal(isUnder(resolved, runtimeRoot), false, "packaged data dir must not sit inside runtime-resources")
    assert.equal(fs.existsSync(path.join(resolved, "nova.db")), false, "path check must not create nova.db")
  } finally {
    fs.rmSync(fakeAppData, { recursive: true, force: true })
  }
}

function waitFor(predicate, label, timeoutMs) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      let value
      try {
        value = predicate()
      } catch (error) {
        clearInterval(timer)
        reject(error)
        return
      }
      if (value) {
        clearInterval(timer)
        resolve(value)
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`Timed out waiting for ${label}`))
      }
    }, 20)
  })
}

async function main() {
  assert.equal(
    allowSource || layout === "win-unpacked",
    true,
    `Packaged layout missing at ${hudDir}. From hud/, run: npm run build && npm run electron:prepare-runtime && npx electron-builder --win --x64 --dir`,
  )
  assert.equal(fs.existsSync(path.join(hudDir, "electron", "production-server.js")), true, `missing production-server.js under ${hudDir}`)
  assert.equal(fs.existsSync(path.join(runtimeRoot, "src", "runtime", "core", "entrypoint", "index.js")), true, `missing runtime entrypoint under ${runtimeRoot}`)
  assert.equal(fs.existsSync(path.join(hudDir, ".next", "BUILD_ID")), true, `missing production .next build under ${hudDir}`)
  if (layout === "win-unpacked") {
    assert.equal(
      fs.existsSync(path.join(hudDir, ".next", "standalone")),
      false,
      "packaged app must not ship .next/standalone (it nests a previous Electron binary)",
    )
    assert.equal(fs.existsSync(path.join(hudDir, "_final_boot_datadir")), false)
  }

  const mainJs = fs.readFileSync(path.join(hudDir, "electron", "main.js"), "utf8")
  assert.match(mainJs, /NOVA_PACKAGED = '1'/)
  assert.match(mainJs, /startProductionServices/)
  assert.doesNotMatch(mainJs, /start-agent-task/)
  assert.doesNotMatch(mainJs, /loadFile\(/)
  assert.doesNotMatch(mainJs, /out\/index\.html/)
  assert.doesNotMatch(mainJs, /spawn\([^)]*claude/)

  const preloadJs = fs.readFileSync(path.join(hudDir, "electron", "preload.js"), "utf8")
  assert.doesNotMatch(preloadJs, /start-agent-task/)

  console.log(`[production-boot] layout=${layout}`)
  console.log(`[production-boot] dataDir=${isolatedDataDir}`)
  console.log(`[production-boot] hudDir=${hudDir}`)
  console.log(`[production-boot] runtimeRoot=${runtimeRoot}`)

  assertPackagedDataDirResolvesOutsideInstall()
  console.log("[production-boot] NOVA_PACKAGED=1 data dir is %APPDATA%\\Nova (fake APPDATA), outside the install tree")

  assert.equal(await portFree(8765), true, "127.0.0.1:8765 is already in use; stop the other Nova runtime before this smoke")

  const realDevDb = path.join(repoRoot, ".user", "nova.db")
  const realPackagedDb = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Nova", "nova.db")
  const before = {
    dev: statStamp(realDevDb),
    packaged: statStamp(realPackagedDb),
  }

  const { startProductionServices } = require(path.join(hudDir, "electron", "production-server.js"))
  let seen = null
  const services = await startProductionServices({
    hudDir,
    runtimeRoot,
    handleInput: async (prompt, opts) => {
      seen = {
        prompt,
        provider: opts?.preferredProvider,
        model: opts?.preferredModel,
        autonomousTask: opts?.autonomousTask,
      }
      return { ok: true, reply: "packaged-claim-ok", promptTokens: 3, completionTokens: 5 }
    },
  })
  console.log(`[production-boot] Next + runtime listening on 127.0.0.1:${services.port}`)

  const home = await fetch(`http://127.0.0.1:${services.port}/`, { signal: AbortSignal.timeout(60_000) })
  assert.equal(home.status < 500, true, `GET / returned ${home.status}`)
  console.log(`[production-boot] GET / -> ${home.status}`)

  // The window's WebSocket to the runtime gateway must be accepted from the HUD's real (random) port.
  // A refused upgrade is what makes the packaged HUD show the agent as DOWN.
  const { WebSocket } = require(path.join(runtimeRoot, "node_modules", "ws"))
  const gatewayOpened = await new Promise((resolve) => {
    const socket = new WebSocket("ws://127.0.0.1:8765", { headers: { Origin: `http://127.0.0.1:${services.port}` } })
    const timer = setTimeout(() => { socket.terminate(); resolve(false) }, 10_000)
    socket.on("open", () => { clearTimeout(timer); socket.close(); resolve(true) })
    socket.on("error", () => { clearTimeout(timer); resolve(false) })
  })
  assert.equal(gatewayOpened, true, "runtime gateway refused a WebSocket from the HUD origin (HUD would show DOWN)")
  console.log("[production-boot] gateway accepted WebSocket from HUD origin")

  const hashedSqlite = fs
    .readdirSync(path.join(hudDir, ".next", "node_modules"))
    .filter((name) => name.startsWith("better-sqlite3-"))
  assert.ok(hashedSqlite.length > 0, "packaged Next server is missing .next/node_modules/better-sqlite3-<hash>")
  const apiRes = await fetch(`http://127.0.0.1:${services.port}/api/agent-tasks`, {
    signal: AbortSignal.timeout(60_000),
  })
  const apiText = await apiRes.text()
  assert.equal(
    /cannot find module/i.test(apiText) && /better-sqlite3/i.test(apiText),
    false,
    `GET /api/agent-tasks -> ${apiRes.status} ${apiText}`,
  )
  assert.notEqual(apiRes.status, 500, `GET /api/agent-tasks -> 500 ${apiText}`)
  assert.equal(apiRes.status, 200, `GET /api/agent-tasks -> ${apiRes.status} ${apiText}`)
  const apiBody = JSON.parse(apiText)
  assert.equal(apiBody.ok, true, apiText)
  assert.ok(Array.isArray(apiBody.tasks), apiText)
  console.log(`[production-boot] GET /api/agent-tasks -> ${apiRes.status} ok=${apiBody.ok} tasks=${apiBody.tasks.length}`)

  const dbFile = path.join(isolatedDataDir, "nova.db")
  assert.equal(fs.existsSync(dbFile), true, `runtime did not create ${dbFile}`)
  assert.equal(isUnder(dbFile, hudDir), false, `nova.db was created inside the app dir: ${dbFile}`)
  assert.equal(isUnder(dbFile, runtimeRoot), false, `nova.db was created inside the runtime dir: ${dbFile}`)
  const ignoredExisting = new Set([path.resolve(realDevDb), path.resolve(realPackagedDb)])
  for (const candidate of [
    path.join(hudDir, "nova.db"),
    path.join(runtimeRoot, "nova.db"),
    path.join(runtimeRoot, ".user", "nova.db"),
  ]) {
    if (ignoredExisting.has(path.resolve(candidate))) continue
    assert.equal(fs.existsSync(candidate), false, `database appeared inside the install tree: ${candidate}`)
  }

  const Database = require(path.join(runtimeRoot, "node_modules", "better-sqlite3"))
  const db = new Database(dbFile)
  db.pragma("busy_timeout = 5000")
  try {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO agent_tasks
         (user_id, id, name, prompt, agent, model, status, priority, permission_mode, progress,
          tokens_in, tokens_out, cost_usd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 'high', 'default', 0, 0, 0, 0, ?, ?)`,
    ).run(
      "production-boot",
      "packaged-claim",
      "packaged-claim",
      "packaged-claim-prompt",
      "openai",
      "gpt-4.1-mini",
      now,
      now,
    )

    const row = await waitFor(
      () => {
        const current = db.prepare(
          "SELECT status, result_text, tokens_in, tokens_out FROM agent_tasks WHERE id = 'packaged-claim'",
        ).get()
        return current && current.status !== "queued" ? current : null
      },
      "status to leave queued",
      20_000,
    )

    assert.notEqual(row.status, "queued")
    assert.equal(row.status, "completed", `task ended as ${row.status} result=${row.result_text}`)
    assert.equal(row.result_text, "packaged-claim-ok")
    assert.equal(row.tokens_in, 3)
    assert.equal(row.tokens_out, 5)
    assert.equal(seen?.provider, "openai")
    assert.equal(seen?.model, "gpt-4.1-mini")
    assert.equal(seen?.autonomousTask, true)
    assert.match(String(seen?.prompt || ""), /packaged-claim-prompt/)
    console.log(`[production-boot] scheduler claimed task; status=${row.status}`)
  } finally {
    db.close()
  }

  const stopStarted = Date.now()
  await services.stop()
  const stopMs = Date.now() - stopStarted
  assert.equal(stopMs < 15_000, true, `stop() took ${stopMs}ms`)
  console.log(`[production-boot] stop() returned in ${stopMs}ms`)

  assert.equal(await portFree(8765), true, "runtime gateway still listening on 8765 after stop()")
  assert.equal(statStamp(realDevDb), before.dev, "smoke wrote the repo .user/nova.db")
  assert.equal(statStamp(realPackagedDb), before.packaged, "smoke wrote %APPDATA%\\Nova\\nova.db")
  assert.equal(fs.existsSync(path.join(repoRoot, "hud", "_final_boot_datadir")), false)
  console.log("[production-boot] PASS")
}

const bootWatchdog = setTimeout(() => {
  console.error("[production-boot] FAILED: boot timed out")
  process.exit(1)
}, 180_000)

main()
  .then(() => {
    clearTimeout(bootWatchdog)
    process.exitCode = 0
    const hangTimer = setTimeout(() => {
      const names = process._getActiveHandles().map((handle) => handle?.constructor?.name || typeof handle)
      console.error("[production-boot] FAILED: stop() left the process hanging", names)
      process.exit(1)
    }, 8_000)
    hangTimer.unref()
  })
  .catch((error) => {
    clearTimeout(bootWatchdog)
    console.error("[production-boot] FAILED:", error?.stack || error)
    process.exit(1)
  })
