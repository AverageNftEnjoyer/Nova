/**
 * Server/runtime idle-cost smoke (npm run smoke:perf-server).
 *
 * Covers what is testable without a microphone, PowerShell or a running Next server:
 *   - voice-loop failure backoff (pure helper + a real loop with a failing recordMic: no spin, one pause line)
 *   - recordMic is async (spawn-based; rejects instead of throwing synchronously)
 *   - on-demand system metrics are TTL-cached and single-flight; no boot-time spawn; no push on WS connect
 *   - DPAPI failure cache is >= 10 minutes
 *   - agent task runner timer sleeps when nothing is queued/running and wakes on create/resume
 *   - job ledger reclaim/execution-tick/scheduler idle paths (no write lock at idle, enqueue wake hook, mission cache)
 *
 * Everything runs against a throwaway NOVA_DATA_DIR.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "typescript"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-perf-server-smoke-"))
const previousDataDir = process.env.NOVA_DATA_DIR
process.env.NOVA_DATA_DIR = path.join(tempRoot, "data")
process.env.NOVA_ALLOW_TEST_KEY = "1"
process.env.NOVA_TEST_MASTER_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const dbModulePath = path.join(repoRoot, "src", "db", "index.js").replace(/\\/g, "/")

const results = []
async function run(name, fn) {
  try {
    await fn()
    results.push({ status: "PASS", name })
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.stack || error.message : String(error) })
  }
}
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const importRepo = (relativePath) => import(pathToFileURL(path.join(repoRoot, relativePath)).href)

// ─── 1. voice loop failure backoff ───────────────────────────────────────────

const backoffMod = await importRepo("src/runtime/audio/voice-loop/failure-backoff.js")

await run("VL-1 backoff doubles from 1s, caps at 30s, pauses on the 5th consecutive failure, resets on success", () => {
  const b = backoffMod.createFailureBackoff()
  const steps = [1, 2, 3, 4, 5].map(() => b.recordFailure())
  assert.deepEqual(steps.map((s) => s.delayMs), [1000, 2000, 4000, 8000, 16000])
  assert.deepEqual(steps.map((s) => s.paused), [false, false, false, false, true])
  assert.equal(steps[0].first, true)
  assert.equal(steps[1].first, false)
  b.recordSuccess()
  assert.equal(b.recordFailure().delayMs, 1000, "success resets the sequence")

  const wide = backoffMod.createFailureBackoff({ maxFailures: 20 })
  let last
  for (let i = 0; i < 12; i += 1) last = wide.recordFailure()
  assert.equal(last.delayMs, 30000, "delay is capped at 30s")
})

await run("VL-2 voice loop with an always-failing recordMic does not spin and logs one line then pauses", async () => {
  const { startVoiceLoop } = await importRepo("src/runtime/audio/voice-loop/index.js")
  let attempts = 0
  const errors = []
  const originalError = console.error
  console.error = (...args) => errors.push(args.map(String).join(" "))
  const noop = () => {}
  const deps = {
    handleInput: async () => {},
    wakeWordRuntime: {},
    broadcast: noop,
    broadcastState: noop,
    getBusy: () => false,
    setBusy: noop,
    getMuted: () => false,
    getCurrentVoice: () => "default",
    getVoiceEnabled: () => false,
    getVoiceRoutingUserContextId: () => "smoke-user",
    getSuppressVoiceWakeUntilMs: () => 0,
    setSuppressVoiceWakeUntilMs: noop,
    createMicCapturePath: () => path.join(tempRoot, "mic.wav"),
    recordMic: async () => {
      attempts += 1
      throw new Error("Mic capture failed: no device")
    },
    transcribe: async () => "",
    speak: async () => {},
    stopSpeaking: noop,
    MIC_RECORD_SECONDS: 1,
    MIC_RETRY_SECONDS: 1,
    MIC_IDLE_DELAY_MS: 50,
    VOICE_WAKE_COOLDOWN_MS: 0,
    VOICE_POST_RESPONSE_GRACE_MS: 0,
    VOICE_DUPLICATE_TEXT_COOLDOWN_MS: 0,
    VOICE_DUPLICATE_COMMAND_COOLDOWN_MS: 0,
    VOICE_AFTER_WAKE_SUPPRESS_MS: 0,
  }
  void startVoiceLoop(deps)
  await sleep(600)
  console.error = originalError
  // Old behavior: thousands of attempts in 600ms. New: 1 attempt, then a 1s backoff.
  assert.equal(attempts, 1, `expected 1 attempt in 600ms, saw ${attempts}`)
  assert.ok(errors.length <= 1, `expected at most one log line so far, saw ${errors.length}`)
  assert.ok(!errors.some((line) => line.includes("\n    at ")), "no stack traces in the log")
})

await run("VL-3 recordMic is async and rejects (never throws synchronously or blocks) when sox is unavailable", async () => {
  const voice = await importRepo("src/runtime/modules/audio/voice/index.js")
  const originalPath = process.env.PATH
  const originalPathUpper = process.env.Path
  process.env.PATH = ""
  process.env.Path = ""
  try {
    const pending = voice.recordMic(path.join(tempRoot, "x.wav"), 1)
    assert.ok(pending instanceof Promise, "recordMic returns a Promise")
    await assert.rejects(pending, /Mic capture failed/)
  } finally {
    process.env.PATH = originalPath
    if (originalPathUpper !== undefined) process.env.Path = originalPathUpper
  }
  const source = read("src/runtime/modules/audio/voice/index.js")
  assert.ok(!/spawnSync\(/.test(source), "voice module no longer uses spawnSync")
  assert.ok(/child\.kill\(\)/.test(source), "hung captures are killed on timeout")
})

await run("VL-4 voice loop awaits recordMic", () => {
  const source = read("src/runtime/audio/voice-loop/index.js")
  assert.equal((source.match(/await recordMic\(/g) ?? []).length, 2)
  assert.ok(!/^\s*recordMic\(/m.test(source), "no un-awaited recordMic call")
})

// ─── 2. system metrics ───────────────────────────────────────────────────────

await run("SM-1 on-demand metrics are TTL-cached and single-flight", async () => {
  const metrics = await importRepo("src/runtime/modules/infrastructure/metrics/index.js")
  assert.ok(metrics.ON_DEMAND_METRICS_TTL_MS >= 60_000, "TTL is at least 60s")
  metrics.resetOnDemandMetricsCache()
  let collects = 0
  const collect = async () => {
    collects += 1
    await sleep(30)
    return { cpu: { usage: collects } }
  }
  const burst = await Promise.all([1, 2, 3, 4, 5].map(() => metrics.getSystemMetrics({ collect })))
  assert.equal(collects, 1, "concurrent requests share one collection")
  assert.ok(burst.every((value) => value.cpu.usage === 1))
  await metrics.getSystemMetrics({ collect })
  assert.equal(collects, 1, "cached within the TTL")
  await metrics.getSystemMetrics({ collect, ttlMs: 0 })
  assert.equal(collects, 2, "expired TTL collects again")

  metrics.resetOnDemandMetricsCache()
  const stale = await metrics.getSystemMetrics({ collect: async () => ({ cpu: { usage: 9 } }) })
  const failing = await metrics.getSystemMetrics({ collect: async () => null, ttlMs: 0 })
  assert.deepEqual(failing, stale, "failed refresh falls back to the last good value")
  metrics.resetOnDemandMetricsCache()
})

await run("SM-2 no boot-time metrics spawn, no push on WS connect, poll mode keeps its own path", async () => {
  const metricsSource = read("src/runtime/modules/infrastructure/metrics/index.js")
  const onceBranch = metricsSource.indexOf('if (mode !== "poll")')
  const initialSend = metricsSource.indexOf("sendMetrics(broadcast, userContextId);")
  assert.ok(onceBranch > 0 && initialSend > onceBranch, "initial send only happens after the non-poll early return")
  assert.ok(/NOVA_METRICS_MODE/.test(metricsSource))

  const gatewaySource = read("src/runtime/infrastructure/hud-gateway/index.js")
  const connection = gatewaySource.slice(gatewaySource.indexOf('wss.on("connection"'))
  const beforeClose = connection.slice(0, connection.indexOf('ws.on("close"'))
  assert.ok(!/getSystemMetrics\(/.test(beforeClose), "connect handler no longer calls getSystemMetrics")
  assert.ok(/getSystemMetrics,/.test(gatewaySource), "explicit request_system_metrics path is still wired")
})

// ─── 3. secrets failure cache ────────────────────────────────────────────────

await run("SE-1 DPAPI failure cache is at least 10 minutes", () => {
  const source = read("src/security/secrets/index.js")
  const match = source.match(/const FAILURE_CACHE_MS = ([^\n]+)/)
  assert.ok(match, "FAILURE_CACHE_MS present")
  const value = Function(`return (${match[1].replace(/\/\/.*$/, "")})`)()
  assert.ok(value >= 10 * 60_000, `FAILURE_CACHE_MS is ${value}`)
})

// ─── 4. agent task runner idle stop ──────────────────────────────────────────

function transpile(relativePaths) {
  for (const relativePath of relativePaths) {
    const output = ts.transpileModule(read(relativePath), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    })
    const target = path.join(tempRoot, "ts", relativePath.replace(/\.ts$/, ".js"))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, output.outputText.split("../../../src/db/index.js").join(dbModulePath), "utf8")
  }
}
transpile([
  "hud/lib/agents/types.ts",
  "hud/lib/agents/task-events.ts",
  "hud/lib/agents/task-stats.ts",
  "hud/lib/git/worktree-manager.ts",

  "hud/lib/agents/task-store.ts",
  "hud/lib/agents/task-runner.ts",
  "hud/app/integrations/constants/types.ts",
  "hud/app/integrations/constants/pricing.ts",
  "hud/app/integrations/constants/openai-models.ts",
  "hud/app/integrations/constants/claude-models.ts",
  "hud/app/integrations/constants/grok-models.ts",
  "hud/app/integrations/constants/gemini-models.ts",
])
const tsRequire = createRequire(path.join(tempRoot, "ts", "loader.cjs"))
const taskStore = tsRequire("./hud/lib/agents/task-store.js")
const taskRunner = tsRequire("./hud/lib/agents/task-runner.js")

await run("TR-1 runner timer stops when nothing is queued/running and wakes on create and resume", async () => {
  const user = "perf-user"
  const g = globalThis
  taskRunner.stopTaskRunner()

  taskRunner.ensureTaskRunnerStarted(user)
  assert.ok(g.__novaAgentTaskRunner.timer, "a newly seen user gets one tick to look for work")
  await sleep(1400)
  assert.equal(g.__novaAgentTaskRunner.timer, null, "idle tick clears the interval")

  taskRunner.ensureTaskRunnerStarted(user)
  assert.equal(g.__novaAgentTaskRunner.timer, null, "re-registering an idle user does not restart the timer")

  const task = await taskStore.createTask(user, { prompt: "idle test", agent: "claude", model: "claude-sonnet-4-5" })
  assert.ok(g.__novaAgentTaskRunner.timer, "create wakes the timer")

  await taskStore.applyTaskAction(user, task.id, "stop")
  await sleep(1400)
  assert.equal(g.__novaAgentTaskRunner.timer, null, "cancelled task leaves nothing active, timer sleeps again")

  await taskStore.applyTaskAction(user, task.id, "play")
  assert.ok(g.__novaAgentTaskRunner.timer, "resume/retry wakes the timer")

  await taskStore.applyTaskAction(user, task.id, "pause")
  await sleep(1400)
  assert.equal(g.__novaAgentTaskRunner.timer, null, "paused task is not active")
  assert.equal(taskStore.hasActiveTasks(user), false)
  taskRunner.stopTaskRunner()
})

// ─── 5. job ledger / execution tick / scheduler idle paths ───────────────────

await run("JL-1 reclaimExpiredLeases takes no write lock when nothing is expired; enqueue notifies subscribers", async () => {
  const { jobLedger, subscribeJobEnqueued } = await importRepo("src/runtime/modules/services/missions/job-ledger/index.js")
  const { getDb } = await importRepo("src/db/index.js")
  const db = getDb()

  let woke = 0
  const unsubscribe = subscribeJobEnqueued(() => { woke += 1 })
  const enq = await jobLedger.enqueue({ id: "perf-run-1", user_id: "perf-user", mission_id: "m1", idempotency_key: "k1" })
  assert.equal(enq.ok, true)
  assert.equal(woke, 1, "enqueue wakes in-process subscribers")
  const dup = await jobLedger.enqueue({ id: "perf-run-2", user_id: "perf-user", mission_id: "m1", idempotency_key: "k1" })
  assert.equal(dup.ok, false)
  assert.equal(woke, 1, "a rejected enqueue does not wake")
  unsubscribe()

  // Hold the write lock from a second connection; an idle reclaim must not need it.
  const Database = createRequire(path.join(repoRoot, "package.json"))("better-sqlite3")
  const other = new Database(db.name)
  other.pragma("busy_timeout = 5000")
  other.exec("BEGIN IMMEDIATE")
  try {
    const started = Date.now()
    const reclaimed = await jobLedger.reclaimExpiredLeases()
    assert.equal(reclaimed, 0)
    assert.ok(Date.now() - started < 1000, `idle reclaim waited ${Date.now() - started}ms for the write lock`)
  } finally {
    other.exec("ROLLBACK")
    other.close()
  }
})

await run("JL-2 mission change token moves on in-process writes; scheduler and execution tick source guards", async () => {
  const store = await importRepo("src/runtime/modules/services/missions/persistence/sqlite-store.js")
  const before = store.getMissionsChangeToken()
  assert.equal(typeof before, "string")
  assert.equal(store.getMissionsChangeToken(), before, "stable when nothing changed")
  const now = new Date().toISOString()
  store.upsertMissionRecord("perf-user", "m-token", () => ({ id: "m-token", createdAt: now, updatedAt: now, status: "active" }), {})
  const afterWrite = store.getMissionsChangeToken()
  assert.notEqual(afterWrite, before, "upsert changes the token")
  store.deleteMissionRecord("perf-user", "m-token")
  assert.notEqual(store.getMissionsChangeToken(), afterWrite, "delete changes the token")

  const scheduler = read("hud/lib/notifications/scheduler/index.ts")
  assert.ok(/getMissionsChangeToken\(\)/.test(scheduler) && /loadMissions: loadMissionsForSchedulerTick/.test(scheduler))
  const tick = read("hud/lib/missions/workflow/execution-tick.ts")
  assert.ok(/EXECUTION_TICK_IDLE_INTERVAL_MS/.test(tick) && /subscribeJobEnqueued\(wakeExecutionTick\)/.test(tick))
  assert.ok(/setTimeout\(\(\) => \{\s*void runExecutionTickLoop\(\)/.test(tick), "adaptive setTimeout chain")
  assert.ok(!/setInterval\(/.test(tick), "no fixed interval left in the execution tick")
})

// ─── cleanup + report ────────────────────────────────────────────────────────

taskRunner.stopTaskRunner()
try {
  const { closeDb } = await importRepo("src/db/index.js")
  closeDb()
} catch {
  // best effort
}
if (previousDataDir === undefined) delete process.env.NOVA_DATA_DIR
else process.env.NOVA_DATA_DIR = previousDataDir
try {
  fs.rmSync(tempRoot, { recursive: true, force: true })
} catch {
  // best effort (Windows may still hold the sqlite file briefly)
}

let failed = 0
for (const { status, name, detail } of results) {
  if (status === "FAIL") failed += 1
  console.log(`${status} ${name}${detail ? `\n     ${detail}` : ""}`)
}
console.log(`\n${results.length - failed}/${results.length} checks passed`)
// The voice loop under test never returns; exit explicitly.
process.exit(failed === 0 ? 0 : 1)
