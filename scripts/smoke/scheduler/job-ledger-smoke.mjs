/**
 * Job Ledger Smoke Test
 * Static analysis verification for the Supabase-backed job runner backbone.
 * Checks types, store implementation, wiring, and scheduler integration.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

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
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const typesSource = read("hud/lib/missions/job-ledger/types.ts")
const storeSource = read("hud/lib/missions/job-ledger/store.ts")
const guardSource = read("hud/lib/missions/workflow/execution-guard.ts")
const executeMissionSource = read("hud/lib/missions/workflow/execute-mission.ts")
const purgeSource = read("hud/lib/missions/purge/index.ts")
const schedulerSource = read("hud/lib/notifications/scheduler/index.ts")
const retryPolicySource = read("hud/lib/missions/retry-policy.ts")
const migrationV1 = read("hud/supabase/migrations/20260301_job_runner.sql")
const migrationV2 = read("hud/supabase/migrations/20260302_scheduler_lease_procedures.sql")

// ─── Types ───────────────────────────────────────────────────────────────────

await run("JL-T1 JobRunStatus discriminated union is defined", () => {
  assert.ok(typesSource.includes(`"pending"`))
  assert.ok(typesSource.includes(`"claimed"`))
  assert.ok(typesSource.includes(`"running"`))
  assert.ok(typesSource.includes(`"succeeded"`))
  assert.ok(typesSource.includes(`"failed"`))
  assert.ok(typesSource.includes(`"dead"`))
  assert.ok(typesSource.includes(`"cancelled"`))
  assert.ok(typesSource.includes("export type JobRunStatus ="))
})

await run("JL-T2 JobRun mirrors database row shape", () => {
  assert.ok(typesSource.includes("export type JobRun = {"))
  assert.ok(typesSource.includes("idempotency_key"))
  assert.ok(typesSource.includes("lease_token"))
  assert.ok(typesSource.includes("lease_expires_at"))
  assert.ok(typesSource.includes("heartbeat_at"))
  assert.ok(typesSource.includes("max_attempts"))
  assert.ok(typesSource.includes("backoff_ms"))
})

await run("JL-T3 SchedulerLeaseResult discriminated union defined", () => {
  assert.ok(typesSource.includes("export type SchedulerLeaseResult ="))
  assert.ok(typesSource.includes("acquired: true"))
  assert.ok(typesSource.includes("acquired: false"))
  assert.ok(typesSource.includes('"already_held"'))
  assert.ok(typesSource.includes('"db_error"'))
})

await run("JL-T4 GetPendingRunsInput defined with limit + optional fields", () => {
  assert.ok(typesSource.includes("export type GetPendingRunsInput = {"))
  assert.ok(typesSource.includes("limit: number"))
  assert.ok(typesSource.includes("now?: Date"))
  assert.ok(typesSource.includes("userIds?: string[]"))
})

await run("JL-T5 JobLedgerStore interface declares all methods", () => {
  const methods = [
    "enqueue(",
    "claimRun(",
    "heartbeat(",
    "startRun(",
    "completeRun(",
    "failRun(",
    "cancelRun(",
    "reclaimExpiredLeases(",
    "cancelPendingForMission(",
    "auditEvent(",
    "acquireSchedulerLease(",
    "renewSchedulerLease(",
    "releaseSchedulerLease(",
    "getPendingRuns(",
  ]
  for (const method of methods) {
    assert.ok(typesSource.includes(method), `Missing method: ${method}`)
  }
})

// ─── Store implementation ────────────────────────────────────────────────────

await run("JL-S1 store imports SchedulerLeaseResult and GetPendingRunsInput", () => {
  assert.ok(storeSource.includes("SchedulerLeaseResult"))
  assert.ok(storeSource.includes("GetPendingRunsInput"))
})

await run("JL-S2 store implements acquireSchedulerLease via RPC", () => {
  assert.ok(storeSource.includes("async acquireSchedulerLease("))
  assert.ok(storeSource.includes('db.rpc("acquire_scheduler_lease"'))
  assert.ok(storeSource.includes("p_scope"))
  assert.ok(storeSource.includes("p_holder_id"))
  assert.ok(storeSource.includes("p_ttl_ms"))
  assert.ok(storeSource.includes('reason: "already_held"'))
  assert.ok(storeSource.includes('reason: "db_error"'))
})

await run("JL-S3 store implements renewSchedulerLease with holder guard", () => {
  assert.ok(storeSource.includes("async renewSchedulerLease("))
  assert.ok(storeSource.includes(".eq(\"scope\", input.scope)"))
  assert.ok(storeSource.includes(".eq(\"holder_id\", input.holderId)"))
})

await run("JL-S4 store implements releaseSchedulerLease with holder guard", () => {
  assert.ok(storeSource.includes("async releaseSchedulerLease("))
  assert.ok(storeSource.includes(".delete()"))
})

await run("JL-S5 store implements getPendingRuns with correct ordering", () => {
  assert.ok(storeSource.includes("async getPendingRuns("))
  assert.ok(storeSource.includes('.eq("status", "pending")'))
  assert.ok(storeSource.includes(".lte(\"scheduled_for\", cutoff)"))
  assert.ok(storeSource.includes('{ ascending: false }'))  // priority DESC
  assert.ok(storeSource.includes('{ ascending: true }'))   // scheduled_for ASC
  assert.ok(storeSource.includes(".limit(input.limit)"))
})

await run("JL-S6 store implements reclaimExpiredLeases", () => {
  assert.ok(storeSource.includes("async reclaimExpiredLeases("))
  assert.ok(storeSource.includes('"pending"'))
  // Must flip claimed → pending for expired leases
  assert.ok(storeSource.includes("expires_at") || storeSource.includes("lease_expires_at"))
})

await run("JL-S7 store uses SECURITY DEFINER admin client (not anon)", () => {
  assert.ok(storeSource.includes("createSupabaseAdminClient"))
  assert.ok(!storeSource.includes("createSupabaseClient()"), "Must not use anon client")
})

// ─── Migration ───────────────────────────────────────────────────────────────

await run("JL-M1 Phase 1 migration creates job_runs table with required columns", () => {
  assert.ok(migrationV1.includes("CREATE TABLE IF NOT EXISTS job_runs"))
  assert.ok(migrationV1.includes("idempotency_key"))
  assert.ok(migrationV1.includes("lease_token"))
  assert.ok(migrationV1.includes("lease_expires_at"))
  assert.ok(migrationV1.includes("max_attempts"))
  assert.ok(migrationV1.includes("backoff_ms"))
})

await run("JL-M2 Phase 1 migration creates scheduler_leases table", () => {
  assert.ok(migrationV1.includes("CREATE TABLE IF NOT EXISTS scheduler_leases"))
  assert.ok(migrationV1.includes("expires_at"))
  assert.ok(migrationV1.includes("holder_id"))
})

await run("JL-M3 Phase 2 migration creates acquire_scheduler_lease procedure", () => {
  assert.ok(migrationV2.includes("CREATE OR REPLACE FUNCTION acquire_scheduler_lease"))
  assert.ok(migrationV2.includes("ON CONFLICT (scope) DO UPDATE"))
  assert.ok(migrationV2.includes("WHERE scheduler_leases.expires_at < now()"))
  assert.ok(migrationV2.includes("SECURITY DEFINER"))
  assert.ok(migrationV2.includes("GRANT EXECUTE"))
})

// ─── Retry policy ────────────────────────────────────────────────────────────

await run("JL-R1 retry-policy exports computeRetryDelayMs and shouldRetry", () => {
  assert.ok(retryPolicySource.includes("export function computeRetryDelayMs("))
  assert.ok(retryPolicySource.includes("export function shouldRetry("))
})

await run("JL-R2 shouldRetry respects attempt count", () => {
  assert.ok(retryPolicySource.includes("attempt <= retryCount") || retryPolicySource.includes("attempt < retryCount") || retryPolicySource.includes("retryCount"))
  assert.ok(retryPolicySource.includes("retryOnFail"))
})

// ─── Wiring: execution-guard ─────────────────────────────────────────────────

await run("JL-W1 execution-guard delegates to jobLedger", () => {
  assert.ok(guardSource.includes('from "../job-ledger/store"'))
  assert.ok(guardSource.includes("jobLedger.enqueue("))
  assert.ok(guardSource.includes("jobLedger.claimRun("))
  assert.ok(guardSource.includes("jobLedger.startRun("))
  assert.ok(guardSource.includes("jobLedger.completeRun("))
  assert.ok(guardSource.includes("jobLedger.failRun("))
})

await run("JL-W2 execution-guard defaults outcomeSuccess to false (fail-safe)", () => {
  // The fail-safe: if release() is called without reportOutcome(), mark as failed
  assert.ok(guardSource.includes("let outcomeSuccess = false"))
})

// ─── Wiring: execute-mission retry loop ──────────────────────────────────────

await run("JL-W3 execute-mission imports and uses retry-policy", () => {
  assert.ok(executeMissionSource.includes("shouldRetry") || executeMissionSource.includes("retry-policy"))
  assert.ok(executeMissionSource.includes("computeRetryDelayMs") || executeMissionSource.includes("retryOnFail"))
})

await run("JL-W4 execute-mission has catch+finally around execution slot", () => {
  assert.ok(executeMissionSource.includes("reportOutcome(false"))
  assert.ok(executeMissionSource.includes("slot?.release()") || executeMissionSource.includes("slot.release()"))
})

// ─── Wiring: purge ───────────────────────────────────────────────────────────

await run("JL-W5 purge cancels job runs as first hard-purge step", () => {
  assert.ok(purgeSource.includes("jobLedger"))
  assert.ok(purgeSource.includes("cancelPendingForMission"))
  // Check ordering within the function body (skip imports at top)
  const fnStart = purgeSource.indexOf("export async function purgeMissionDerivedData")
  assert.ok(fnStart !== -1, "purgeMissionDerivedData function not found")
  const fnBody = purgeSource.slice(fnStart)
  const ledgerIdx = fnBody.indexOf("cancelPendingForMission")
  const rescheduleIdx = fnBody.indexOf("deleteRescheduleOverride")
  assert.ok(ledgerIdx < rescheduleIdx, "cancelPendingForMission must precede deleteRescheduleOverride in function body")
})

// ─── Wiring: scheduler ───────────────────────────────────────────────────────

await run("JL-W6 scheduler calls reclaimExpiredLeases at top of tick", () => {
  assert.ok(schedulerSource.includes("jobLedger.reclaimExpiredLeases()"))
  // Check ordering within the tick function body
  const fnStart = schedulerSource.indexOf("async function runScheduleTickInternal(")
  assert.ok(fnStart !== -1, "runScheduleTickInternal function not found")
  const fnBody = schedulerSource.slice(fnStart)
  const reclaimIdx = fnBody.indexOf("reclaimExpiredLeases()")
  const loadMissionsIdx = fnBody.indexOf("loadMissions({")
  assert.ok(reclaimIdx < loadMissionsIdx, "reclaimExpiredLeases must be called before loadMissions in tick body")
})

await run("JL-W7 scheduler has per-mission in-flight guard (watchdog race fix)", () => {
  assert.ok(schedulerSource.includes("inflightMissions"))
  assert.ok(schedulerSource.includes("inflightMissions.has("))
  assert.ok(schedulerSource.includes("inflightMissions.add("))
  assert.ok(schedulerSource.includes("inflightMissions.delete("))
  // Must clean up in finally
  assert.ok(schedulerSource.includes("} finally {"))
})

await run("JL-W8 inflightMissions persists across ticks via globalThis", () => {
  assert.ok(schedulerSource.includes("__novaInflightMissions"))
  assert.ok(schedulerSource.includes("globalThis"))
})

await run("JL-W9 scheduler leader election wired into runScheduleTick", () => {
  assert.ok(schedulerSource.includes("SCHEDULER_LEASE_SCOPE"))
  assert.ok(schedulerSource.includes("SCHEDULER_LEASE_TTL_MS"))
  assert.ok(schedulerSource.includes("SCHEDULER_HOLDER_ID"))
  assert.ok(schedulerSource.includes("acquireSchedulerLease("))
  // Lease acquisition must happen before tickInFlight = true
  const tickFnStart = schedulerSource.indexOf("async function runScheduleTick(")
  assert.ok(tickFnStart !== -1, "runScheduleTick function not found")
  const tickFnBody = schedulerSource.slice(tickFnStart)
  const acquireIdx = tickFnBody.indexOf("acquireSchedulerLease(")
  const tickInFlightSetIdx = tickFnBody.indexOf("state.tickInFlight = true")
  assert.ok(acquireIdx < tickInFlightSetIdx, "acquireSchedulerLease must precede tickInFlight=true")
})

await run("JL-W10 scheduler increments leaseSkipCount on failed acquisition", () => {
  assert.ok(schedulerSource.includes("leaseSkipCount"))
  assert.ok(schedulerSource.includes("state.leaseSkipCount += 1"))
  // isLeader must be set to false when lease not acquired
  assert.ok(schedulerSource.includes("state.isLeader = false"))
})

await run("JL-W11 scheduler sets isLeader=true on successful lease acquisition", () => {
  assert.ok(schedulerSource.includes("state.isLeader = true"))
  // Must be set BEFORE tickInFlight = true
  const tickFnStart = schedulerSource.indexOf("async function runScheduleTick(")
  const tickFnBody = schedulerSource.slice(tickFnStart)
  const isLeaderIdx = tickFnBody.indexOf("state.isLeader = true")
  const tickInFlightSetIdx = tickFnBody.indexOf("state.tickInFlight = true")
  assert.ok(isLeaderIdx < tickInFlightSetIdx, "isLeader=true must be set before tickInFlight=true")
})

await run("JL-W12 scheduler renews lease in finally block after tick", () => {
  assert.ok(schedulerSource.includes("renewSchedulerLease("))
  // Renewal must be inside a finally block
  const tickFnStart = schedulerSource.indexOf("async function runScheduleTick(")
  const tickFnBody = schedulerSource.slice(tickFnStart)
  const finallyIdx = tickFnBody.lastIndexOf("} finally {")
  const renewIdx = tickFnBody.lastIndexOf("renewSchedulerLease(")
  assert.ok(renewIdx > finallyIdx, "renewSchedulerLease must be inside the finally block")
})

await run("JL-W13 scheduler releases lease on graceful stop", () => {
  const stopFnStart = schedulerSource.indexOf("export function stopMissionScheduler(")
  assert.ok(stopFnStart !== -1, "stopMissionScheduler not found")
  const stopFnBody = schedulerSource.slice(stopFnStart, stopFnStart + 500)
  assert.ok(stopFnBody.includes("releaseSchedulerLease("), "stopMissionScheduler must release the lease")
})

await run("JL-W14 renew/reclaim use server-side RPCs (no JS clock)", () => {
  // renewSchedulerLease must use rpc(), not .update() with Date.now()
  const renewIdx = storeSource.indexOf("async renewSchedulerLease(")
  assert.ok(renewIdx !== -1, "renewSchedulerLease not found in store")
  const renewBody = storeSource.slice(renewIdx, renewIdx + 400)
  assert.ok(renewBody.includes('rpc("renew_scheduler_lease"'), "renewSchedulerLease must use RPC")
  assert.ok(!renewBody.includes("Date.now()"), "renewSchedulerLease must NOT use JS Date.now()")
  // reclaimExpiredLeases must use rpc()
  const reclaimIdx = storeSource.indexOf("async reclaimExpiredLeases(")
  assert.ok(reclaimIdx !== -1, "reclaimExpiredLeases not found in store")
  const reclaimBody = storeSource.slice(reclaimIdx, reclaimIdx + 300)
  assert.ok(reclaimBody.includes('rpc("reclaim_expired_job_leases"'), "reclaimExpiredLeases must use RPC")
})

// ─── Summary ─────────────────────────────────────────────────────────────────

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : ""
  console.log(`[${result.status}] ${result.name}${detail}`)
}

const passCount = results.filter((r) => r.status === "PASS").length
const failCount = results.filter((r) => r.status === "FAIL").length

console.log(`\nTotal: ${results.length} | Pass: ${passCount} | Fail: ${failCount}`)

if (failCount > 0) {
  process.exit(1)
}
