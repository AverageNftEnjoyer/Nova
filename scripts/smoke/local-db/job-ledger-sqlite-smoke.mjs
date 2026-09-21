/**
 * SQLite job-ledger smoke: enqueue/claim/complete/fail/retry/lease semantics against nova.db.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../../..")
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-job-ledger-sqlite-"))
process.env.NOVA_DATA_DIR = tempRoot
process.env.NOVA_ALLOW_TEST_KEY = "1"
process.env.NOVA_TEST_MASTER_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
process.env.NOVA_MISSION_EXECUTION_MAX_INFLIGHT_PER_USER = "1"
process.env.NOVA_MISSION_EXECUTION_MAX_INFLIGHT_GLOBAL = "2"

const { jobLedger, readJobRun } = await import(
  pathToFileURL(path.join(repoRoot, "src/runtime/modules/services/missions/job-ledger/index.js")).href
)

const results = []
async function run(name, fn) {
  try {
    await fn()
    results.push({ status: "PASS", name })
  } catch (error) {
    results.push({
      status: "FAIL",
      name,
      detail: error instanceof Error ? error.stack || error.message : String(error),
    })
  }
}

const uid = "ledger-smoke-user"
const missionId = "mission-ledger-1"

await run("enqueue creates pending job", async () => {
  const result = await jobLedger.enqueue({
    id: "job-a",
    user_id: uid,
    mission_id: missionId,
    idempotency_key: "idem-a",
    max_attempts: 2,
  })
  assert.equal(result.ok, true)
  const row = readJobRun("job-a")
  assert.equal(row?.status, "pending")
})

await run("duplicate idempotency key is rejected", async () => {
  const result = await jobLedger.enqueue({
    id: "job-a-dup",
    user_id: uid,
    mission_id: missionId,
    idempotency_key: "idem-a",
  })
  assert.equal(result.ok, false)
})

await run("claim/start/complete succeeds with matching lease", async () => {
  const claim = await jobLedger.claimRun({ jobRunId: "job-a", leaseDurationMs: 60_000 })
  assert.equal(claim.ok, true)
  assert.ok(claim.leaseToken)
  const started = await jobLedger.startRun({ jobRunId: "job-a", leaseToken: claim.leaseToken })
  assert.equal(started.ok, true)
  const completed = await jobLedger.completeRun({
    jobRunId: "job-a",
    leaseToken: claim.leaseToken,
    outputSummary: { ok: true },
  })
  assert.equal(completed.ok, true)
  assert.equal(readJobRun("job-a")?.status, "succeeded")
})

await run("failRun enqueues retry then dead at max attempts", async () => {
  await jobLedger.enqueue({
    id: "job-b",
    user_id: uid,
    mission_id: missionId,
    max_attempts: 2,
  })
  const claim1 = await jobLedger.claimRun({ jobRunId: "job-b", leaseDurationMs: 60_000 })
  assert.equal(claim1.ok, true)
  await jobLedger.startRun({ jobRunId: "job-b", leaseToken: claim1.leaseToken })
  const fail1 = await jobLedger.failRun({
    jobRunId: "job-b",
    leaseToken: claim1.leaseToken,
    errorCode: "boom",
    errorDetail: "first failure",
  })
  assert.equal(fail1.ok, true)
  assert.equal(readJobRun("job-b")?.status, "failed")

  const pending = await jobLedger.getPendingRuns({
    limit: 10,
    userIds: [uid],
    now: new Date(Date.now() + 24 * 60 * 60_000),
  })
  const retry = pending.find((row) => row.source === "retry" || row.attempt >= 1)
  assert.ok(retry, "expected retry row")
  const claim2 = await jobLedger.claimRun({ jobRunId: retry.id, leaseDurationMs: 60_000 })
  assert.equal(claim2.ok, true)
  await jobLedger.startRun({ jobRunId: retry.id, leaseToken: claim2.leaseToken })
  const fail2 = await jobLedger.failRun({
    jobRunId: retry.id,
    leaseToken: claim2.leaseToken,
    errorCode: "boom",
    errorDetail: "final failure",
  })
  assert.equal(fail2.ok, true)
  assert.equal(readJobRun(retry.id)?.status, "dead")
})

await run("scheduler lease is exclusive across holders", async () => {
  const first = await jobLedger.acquireSchedulerLease({
    scope: "smoke-scope",
    holderId: "holder-1",
    ttlMs: 60_000,
  })
  assert.equal(first.acquired, true)
  const second = await jobLedger.acquireSchedulerLease({
    scope: "smoke-scope",
    holderId: "holder-2",
    ttlMs: 60_000,
  })
  assert.equal(second.acquired, false)
  assert.equal(second.reason, "already_held")
  const released = await jobLedger.releaseSchedulerLease({ scope: "smoke-scope", holderId: "holder-1" })
  assert.equal(released.ok, true)
})

const passCount = results.filter((result) => result.status === "PASS").length
const failCount = results.filter((result) => result.status === "FAIL").length
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : ""
  console.log(`[${result.status}] ${result.name}${detail}`)
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`)
try {
  fs.rmSync(tempRoot, { recursive: true, force: true })
} catch {
  // ignore cleanup failures on Windows file locks
}
if (failCount > 0) process.exit(1)
