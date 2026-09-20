/**
 * Agent Tasks Behavior Smoke
 * Exercises hud/lib/agents (store + SIMULATED runner + events) against a temp workspace,
 * plus source guards for the SSE route and hook. hud TS is transpiled into an OS temp dir.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const originalCwd = process.cwd()
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-agent-tasks-smoke-"))
const workspace = path.join(tempRoot, "workspace")
fs.mkdirSync(workspace, { recursive: true })

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
    const source = read(relativePath)
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    })
    const target = path.join(tempRoot, relativePath.replace(/\.ts$/, ".js"))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, output.outputText, "utf8")
  }
}

transpile([
  "hud/lib/agents/types.ts",
  "hud/lib/agents/task-events.ts",
  "hud/lib/agents/task-stats.ts",
  "hud/lib/agents/task-store.ts",
  "hud/lib/agents/task-runner.ts",
  "hud/app/integrations/constants/types.ts",
  "hud/app/integrations/constants/pricing.ts",
  "hud/app/integrations/constants/openai-models.ts",
  "hud/app/integrations/constants/claude-models.ts",
  "hud/app/integrations/constants/grok-models.ts",
  "hud/app/integrations/constants/gemini-models.ts",
])

const require = createRequire(path.join(tempRoot, "loader.cjs"))
const store = require("./hud/lib/agents/task-store.js")
const runner = require("./hud/lib/agents/task-runner.js")
const events = require("./hud/lib/agents/task-events.js")
const { AGENT_TASK_MAX_CONCURRENT } = require("./hud/lib/agents/types.js")

// The store resolves its files from process.cwd(); the basename must not be "hud".
process.chdir(workspace)

const PRICED_MODEL = "claude-sonnet-4-5"
const UNPRICED_MODEL = "unpriced-model-x"
const NOW_MS = Date.parse("2026-09-20T12:00:00.000Z")

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// createdAt has ms resolution and drives FIFO order, so space creations apart.
async function makeTask(userId, overrides = {}) {
  const task = await store.createTask(userId, {
    prompt: "do the thing",
    agent: "claude",
    model: PRICED_MODEL,
    ...overrides,
  })
  await sleep(4)
  return task
}

async function tick(userId, times = 1) {
  for (let i = 0; i < times; i += 1) await runner.tickTaskRunner(userId, NOW_MS)
}

async function statusMap(userId) {
  const tasks = await store.listTasks(userId)
  return new Map(tasks.map((t) => [t.id, t]))
}

function ids(tasks) {
  return tasks.map((t) => t.id)
}

function collectEvents(userId) {
  const collected = []
  const unsubscribe = events.subscribeTaskEvents(userId, (event) => collected.push(event))
  return { collected, unsubscribe }
}

// Shared across the scheduling checks: 7 tasks queued for one user.
const U1 = "smoke-u1"
const sched = {}

await run("B-1 promotion order is priority then FIFO, capped at 5 running", async () => {
  assert.equal(AGENT_TASK_MAX_CONCURRENT, 5)
  const plan = [
    ["low0", "low"],
    ["low1", "low"],
    ["high2", "high"],
    ["normal3", "normal"],
    ["high4", "high"],
    ["normal5", "normal"],
    ["low6", "low"],
  ]
  for (const [name, priority] of plan) sched[name] = await makeTask(U1, { name, priority })

  await tick(U1)
  const byId = await statusMap(U1)
  const running = [...byId.values()].filter((t) => t.status === "running")
  const queued = [...byId.values()].filter((t) => t.status === "queued")
  assert.equal(running.length, 5, "exactly 5 running")
  assert.equal(queued.length, 2, "2 remain queued")
  assert.deepEqual(
    new Set(ids(running)),
    new Set(ids([sched.high2, sched.high4, sched.normal3, sched.normal5, sched.low0])),
  )
  assert.deepEqual(new Set(ids(queued)), new Set(ids([sched.low1, sched.low6])))
  for (const task of running) {
    assert.equal(task.progress, 5, "promoted task advances on its first tick")
    assert.ok(task.startedAt, "startedAt set on first run")
  }
})

await run("B-2 pause frees a slot and the next queued task is promoted", async () => {
  const paused = await store.applyTaskAction(U1, sched.high2.id, "pause")
  assert.equal(paused.status, "paused")
  assert.ok(paused.pausedAt)
  await tick(U1)
  const byId = await statusMap(U1)
  assert.equal(byId.get(sched.high2.id).status, "paused", "paused task untouched by runner")
  assert.equal(byId.get(sched.low1.id).status, "running", "next FIFO queued task promoted")
  assert.equal(byId.get(sched.low6.id).status, "queued")
  assert.equal([...byId.values()].filter((t) => t.status === "running").length, 5)
})

await run("B-3 resume goes to queued, then runs once a slot is free (stop -> cancelled)", async () => {
  const resumed = await store.applyTaskAction(U1, sched.high2.id, "play")
  assert.equal(resumed.status, "queued")
  assert.equal(resumed.pausedAt, undefined)
  await tick(U1)
  let byId = await statusMap(U1)
  assert.equal(byId.get(sched.high2.id).status, "queued", "no free slot: stays queued")

  const stopped = await store.applyTaskAction(U1, sched.normal3.id, "stop")
  assert.equal(stopped.status, "cancelled")
  assert.ok(stopped.completedAt)
  await tick(U1)
  byId = await statusMap(U1)
  assert.equal(byId.get(sched.high2.id).status, "running", "higher priority wins the freed slot")
  assert.equal(byId.get(sched.low6.id).status, "queued")
  assert.equal(byId.get(sched.normal3.id).status, "cancelled", "cancelled task untouched by runner")
})

await run("B-4 completes at progress 100; cost > 0 for a priced model, 0 for an unpriced one", async () => {
  const user = "smoke-u2"
  const priced = await makeTask(user, { model: PRICED_MODEL })
  const unpriced = await makeTask(user, { model: UNPRICED_MODEL })
  await tick(user, 19)
  let byId = await statusMap(user)
  assert.equal(byId.get(priced.id).status, "running")
  assert.equal(byId.get(priced.id).progress, 95)
  assert.ok(byId.get(priced.id).costUsd > 0)
  assert.ok(byId.get(priced.id).tokensIn > 0 && byId.get(priced.id).tokensOut > 0)

  await tick(user)
  byId = await statusMap(user)
  for (const task of [byId.get(priced.id), byId.get(unpriced.id)]) {
    assert.equal(task.status, "completed")
    assert.equal(task.progress, 100)
    assert.ok(task.completedAt)
  }
  assert.ok(byId.get(priced.id).costUsd > 0, "priced model has cost")
  assert.equal(byId.get(unpriced.id).costUsd, 0, "unpriced model costs 0")
})

await run("B-5 [sim:fail] prompt fails at progress >= 50 with an error", async () => {
  const user = "smoke-u3"
  const doomed = await makeTask(user, { prompt: `will fail ${runner.SIM_FAIL_MARKER}` })
  await tick(user, 9)
  let task = (await statusMap(user)).get(doomed.id)
  assert.equal(task.status, "running")
  assert.equal(task.progress, 45)
  await tick(user)
  task = (await statusMap(user)).get(doomed.id)
  assert.equal(task.status, "failed")
  assert.equal(task.progress, 50)
  assert.equal(task.error, "Simulated failure")
  assert.ok(task.completedAt)

  const retried = await store.applyTaskAction(user, doomed.id, "play")
  assert.equal(retried.status, "queued", "failed task can be retried")
  assert.equal(retried.progress, 0)
  assert.equal(retried.error, undefined)
})

await run("B-6 recoverInterruptedTasks moves running -> queued", async () => {
  const user = "smoke-u4"
  const task = await makeTask(user)
  await tick(user)
  assert.equal((await statusMap(user)).get(task.id).status, "running")
  assert.equal(await store.recoverInterruptedTasks(user), 1)
  assert.equal((await statusMap(user)).get(task.id).status, "queued")
  assert.equal(await store.recoverInterruptedTasks(user), 0, "nothing left to recover")
})

await run("B-7 events publish exactly once per changed task; unchanged tick emits nothing", async () => {
  const user = "smoke-u5"
  const { collected, unsubscribe } = collectEvents(user)
  try {
    const a = await makeTask(user)
    const b = await makeTask(user)
    assert.equal(collected.length, 2, "one task.upserted per created task")
    assert.ok(collected.every((e) => e.type === "task.upserted"))

    collected.length = 0
    await tick(user)
    assert.equal(collected.length, 2, "promote + advance is a single event per task")
    assert.deepEqual(new Set(collected.map((e) => e.task.id)), new Set([a.id, b.id]))
    assert.ok(collected.every((e) => e.task.status === "running" && e.task.progress === 5))

    await store.applyTaskAction(user, a.id, "pause")
    await store.applyTaskAction(user, b.id, "pause")
    collected.length = 0
    await tick(user)
    assert.equal(collected.length, 0, "tick over paused tasks emits nothing")

    await store.deleteTask(user, a.id)
    assert.deepEqual(collected, [{ type: "task.deleted", id: a.id }])

    collected.length = 0
    await store.applyTaskAction(user, b.id, "play")
    await store.applyTaskAction(user, b.id, "play")
    assert.equal(collected.length, 1, "no-op action publishes nothing")
  } finally {
    unsubscribe()
  }
})

await run("B-8 event bus: unsubscribe, listener isolation, per-user delivery", async () => {
  const seen = []
  const unsubscribe = events.subscribeTaskEvents("bus-a", (event) => seen.push(event))
  const survivors = []
  const unsubscribeThrower = events.subscribeTaskEvents("bus-a", () => {
    throw new Error("boom")
  })
  const unsubscribeSurvivor = events.subscribeTaskEvents("bus-a", (event) => survivors.push(event))

  events.publishTaskEvent("bus-a", { type: "task.deleted", id: "x" })
  events.publishTaskEvent("bus-b", { type: "task.deleted", id: "y" })
  assert.equal(seen.length, 1, "other user's event not delivered")
  assert.equal(survivors.length, 1, "a throwing listener does not block others")

  unsubscribe()
  unsubscribeThrower()
  unsubscribeSurvivor()
  events.publishTaskEvent("bus-a", { type: "task.deleted", id: "z" })
  assert.equal(seen.length, 1, "no delivery after unsubscribe")
  assert.equal(survivors.length, 1)
})

await run("B-9 runner lifecycle: idempotent start, recovery on first register, unref'd timer, stop clears it", async () => {
  const user = "smoke-u6"
  const g = globalThis
  const task = await makeTask(user)
  await tick(user)
  const before = (await statusMap(user)).get(task.id)
  assert.equal(before.status, "running")

  runner.ensureTaskRunnerStarted(user)
  const state = g.__novaAgentTaskRunner
  const timer = state.timer
  assert.ok(timer, "interval started")
  runner.ensureTaskRunnerStarted(user)
  assert.equal(g.__novaAgentTaskRunner.timer, timer, "second start reuses the same timer")
  assert.equal(timer.hasRef(), false, "timer is unref'd so the process can exit")

  await sleep(200)
  assert.equal((await statusMap(user)).get(task.id).status, "queued", "interrupted task recovered on first register")

  await sleep(1300)
  const ticked = (await statusMap(user)).get(task.id)
  assert.equal(ticked.status, "running", "interval tick promoted it")
  assert.ok(ticked.progress > before.progress, "and advanced it")

  runner.stopTaskRunner()
  assert.equal(g.__novaAgentTaskRunner.timer, null, "stop clears the interval")
  assert.equal(g.__novaAgentTaskRunner.users.size, 0)
  const frozen = (await statusMap(user)).get(task.id).progress
  await sleep(1200)
  assert.equal((await statusMap(user)).get(task.id).progress, frozen, "no ticks after stop")
})

await run("B-10 SSE route source guard (snapshot first, forwarding, heartbeat, abort cleanup)", () => {
  const source = read("hud/app/api/agent-tasks/stream/route.ts")
  assert.ok(source.includes("text/event-stream; charset=utf-8"))
  assert.ok(source.includes("no-cache, no-transform"))
  assert.ok(source.includes('type: "snapshot"'))
  assert.ok(source.includes("subscribeTaskEvents(userId"))
  assert.ok(source.includes('": ping\\n\\n"') && source.includes("25_000"))
  assert.ok(source.includes('req.signal.addEventListener("abort", cleanup)'))
  assert.ok(source.includes("unsubscribe()") && source.includes("clearInterval(heartbeat)"))
  assert.ok(source.includes("ensureTaskRunnerStarted(userId)"))
  assert.ok(source.includes("RATE_LIMIT_POLICIES.agentTasksRead"))
  assert.ok(
    source.indexOf("subscribeTaskEvents(userId") < source.indexOf('type: "snapshot"'),
    "subscribes before reading the snapshot so nothing is missed",
  )
})

await run("B-11 route, runner and hook source guards", () => {
  const route = read("hud/app/api/agent-tasks/route.ts")
  assert.equal((route.match(/ensureTaskRunnerStarted\(auth\.userId\)/g) ?? []).length, 2, "GET + POST start the runner")
  assert.ok(read("hud/lib/agents/task-runner.ts").includes("SIMULATED AGENT TASK RUNNER"))

  const hook = read("hud/app/home/hooks/use-agent-tasks.ts")
  assert.ok(hook.startsWith('"use client"'))
  assert.ok(hook.includes("export function useAgentTasks()"))
  assert.ok(hook.includes("new EventSource(STREAM_URL"))
  assert.ok(hook.includes("POLL_INTERVAL_MS = 6_000") && hook.includes("STREAM_RETRY_MS = 30_000"))
  assert.ok(hook.includes('document.visibilityState === "visible"'))
  assert.ok(hook.includes("ACTIVE_USER_CHANGED_EVENT"))
  assert.ok(hook.includes('action === "delete" ? "DELETE" : "PATCH"'))
  assert.ok(!hook.includes("console."), "no console logging")
})

await run("B-12 core lib files avoid server-only and the @/ alias", () => {
  for (const file of ["types", "task-events", "task-stats", "task-store", "task-runner"]) {
    const source = read(`hud/lib/agents/${file}.ts`)
    assert.ok(!source.includes("server-only"), `${file} imports server-only`)
    assert.ok(!/from\s+"@\//.test(source), `${file} uses the @/ alias`)
  }
})

process.chdir(originalCwd)
runner.stopTaskRunner()
fs.rmSync(tempRoot, { recursive: true, force: true })

let failed = 0
for (const { status, name, detail } of results) {
  if (status === "FAIL") failed += 1
  console.log(`${status} ${name}${detail ? `\n     ${detail}` : ""}`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
