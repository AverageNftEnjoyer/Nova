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
const executionTickSource = read("hud/lib/missions/workflow/execution-tick.ts")
const missionTypesSource = read("hud/lib/missions/types/index.ts")
const purgeSource = read("hud/lib/missions/purge/index.ts")
const schedulerSource = read("hud/lib/notifications/scheduler/index.ts")
const retryPolicySource = read("hud/lib/missions/retry-policy.ts")
const runDeadLetterSource = read("hud/lib/missions/job-ledger/dead-letter.ts")
const migrationV1 = read("hud/supabase/migrations/20260301_job_runner.sql")
const migrationV2 = read("hud/supabase/migrations/20260302_scheduler_lease_procedures.sql")
const migrationV3 = read("hud/supabase/migrations/20260303_execution_tick_running_reclaim.sql")
const migrationV4 = read("hud/supabase/migrations/20260307_fail_job_run_with_retry.sql")
const migrationV5 = read("hud/supabase/migrations/20260307_claim_job_run_lease_with_limits.sql")
const migrationV6 = read("hud/supabase/migrations/20260307_heartbeat_job_run_lease.sql")
const migrationV7 = read("hud/supabase/migrations/20260307_complete_job_run.sql")
const executionTickRouteSource = read("hud/app/api/missions/execution-tick/route.ts")

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

await run("JL-S8 job-ledger dead-letter writer persists terminal queue failures per user context", () => {
  assert.ok(runDeadLetterSource.includes("appendMissionRunDeadLetter"))
  assert.ok(runDeadLetterSource.includes("mission-run-dead-letter.jsonl"))
  assert.ok(runDeadLetterSource.includes(".user"))
})

await run("JL-S9 failRun writes dead-letter and escalates retry-enqueue failure to dead", () => {
  assert.ok(storeSource.includes("appendMissionRunDeadLetter"))
  assert.ok(storeSource.includes("max_attempts_exhausted"))
  assert.ok(storeSource.includes("RETRY_ENQUEUE_FAILED"))
  assert.ok(storeSource.includes("retry_enqueue_failed"))
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

await run("JL-M4 Phase 4 migration creates fail_job_run_with_retry procedure", () => {
  assert.ok(migrationV4.includes("CREATE OR REPLACE FUNCTION fail_job_run_with_retry"))
  assert.ok(migrationV4.includes("FOR UPDATE"))
  assert.ok(migrationV4.includes("INSERT INTO job_runs"))
  assert.ok(migrationV4.includes("RETRY_ENQUEUE_FAILED"))
  assert.ok(migrationV4.includes("GRANT EXECUTE"))
})

await run("JL-M5 Phase 6 migration creates lean claim_job_run_lease_with_limits procedure", () => {
  assert.ok(migrationV5.includes("CREATE OR REPLACE FUNCTION claim_job_run_lease_with_limits"))
  assert.ok(migrationV5.includes("FOR UPDATE"))
  assert.ok(migrationV5.includes("lease_token TEXT"))
  assert.ok(!migrationV5.includes("job_run JSONB"))
  assert.ok(migrationV5.includes("GRANT EXECUTE"))
})

await run("JL-M6 Phase 8 migration creates heartbeat_job_run_lease procedure", () => {
  assert.ok(migrationV6.includes("CREATE OR REPLACE FUNCTION heartbeat_job_run_lease"))
  assert.ok(migrationV6.includes("heartbeat_at = now()"))
  assert.ok(migrationV6.includes("lease_expires_at = now() +"))
  assert.ok(migrationV6.includes("status IN ('claimed', 'running')"))
  assert.ok(migrationV6.includes("GRANT EXECUTE"))
})

await run("JL-M7 Phase 9 migration creates complete_job_run procedure", () => {
  assert.ok(migrationV7.includes("CREATE OR REPLACE FUNCTION complete_job_run"))
  assert.ok(migrationV7.includes("FOR UPDATE"))
  assert.ok(migrationV7.includes("status = 'running'"))
  assert.ok(migrationV7.includes("v_finished_at := now()"))
  assert.ok(migrationV7.includes("duration_ms = GREATEST"))
  assert.ok(migrationV7.includes("GRANT EXECUTE"))
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

await run("JL-W7 scheduler uses idempotency key for dedup (Phase 3 — replaced inflightMissions)", () => {
  // Phase 3: idempotency_key on enqueue provides dedup across ticks/workers
  assert.ok(schedulerSource.includes("idempotency_key"))
  assert.ok(schedulerSource.includes("idempotencyKey"))
  assert.ok(schedulerSource.includes("nativeDayStamp"))
  // inflightMissions removed — idempotency_key handles cross-tick dedup
  assert.ok(!schedulerSource.includes("inflightMissions.has("), "inflightMissions.has should be gone in Phase 3")
})

await run("JL-W8 scheduler enqueues with source=scheduler and priority", () => {
  assert.ok(schedulerSource.includes("jobLedger.enqueue("))
  assert.ok(schedulerSource.includes('source: "scheduler"'))
  assert.ok(schedulerSource.includes("priority: 5"))
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

// ─── Phase 3: Job-Driven Execution Tick ──────────────────────────────────────

await run("JL-P3-1 execution-tick exports runExecutionTick", () => {
  assert.ok(executionTickSource.includes("export async function runExecutionTick("))
  assert.ok(executionTickSource.includes("export type ExecutionTickResult ="))
})

await run("JL-P3-2 execution-tick uses getPendingRuns + claimRun + startRun pipeline", () => {
  assert.ok(executionTickSource.includes("jobLedger.getPendingRuns("))
  assert.ok(executionTickSource.includes("jobLedger.claimRun("))
  assert.ok(executionTickSource.includes("jobLedger.startRun("))
})

await run("JL-P3-3 execution-tick builds pre-claimed slot via makePreClaimedSlot", () => {
  assert.ok(executionTickSource.includes("makePreClaimedSlot("))
  assert.ok(executionTickSource.includes('import { makePreClaimedSlot }'))
})

await run("JL-P3-4 execution-tick calls executeMission with preClaimedSlot", () => {
  assert.ok(executionTickSource.includes("executeMission("))
  assert.ok(executionTickSource.includes("preClaimedSlot: slot"))
})

await run("JL-P3-5 execution-tick updates mission metadata after run", () => {
  assert.ok(executionTickSource.includes("upsertMission("))
  assert.ok(executionTickSource.includes("lastRunAt:"))
  assert.ok(executionTickSource.includes("lastSentLocalDate:"))
  assert.ok(executionTickSource.includes("lastRunStatus:"))
})

await run("JL-P3-6 execution-tick handles MISSION_NOT_FOUND by failing the run", () => {
  assert.ok(executionTickSource.includes("MISSION_NOT_FOUND"))
  assert.ok(executionTickSource.includes("jobLedger.failRun("))
})

await run("JL-P3-7 execution-tick propagates scheduledAtOverride via input_snapshot", () => {
  assert.ok(executionTickSource.includes("input_snapshot"))
  assert.ok(executionTickSource.includes("scheduledAtOverride"))
  assert.ok(executionTickSource.includes("deleteRescheduleOverride("))
})

await run("JL-P3-8 types exports PreClaimedSlot + preClaimedSlot on ExecuteMissionInput", () => {
  assert.ok(missionTypesSource.includes("export interface PreClaimedSlot {"))
  assert.ok(missionTypesSource.includes("preClaimedSlot?: PreClaimedSlot"))
})

await run("JL-P3-9 execution-guard exports makePreClaimedSlot", () => {
  assert.ok(guardSource.includes("export function makePreClaimedSlot("))
  // Must use outcomeReported guard (first caller wins — same pattern as acquireMissionExecutionSlot)
  assert.ok(guardSource.includes("outcomeReported"))
})

await run("JL-P3-10 execute-mission skips acquireMissionExecutionSlot when preClaimedSlot provided", () => {
  assert.ok(executeMissionSource.includes("input.preClaimedSlot"))
  assert.ok(executeMissionSource.includes("MissionExecutionGuardDecision"))
  // Retry loop must be skipped when preClaimedSlot is set
  assert.ok(executeMissionSource.includes("!input.preClaimedSlot &&"))
})

// ─── Phase 4: Execution-Tick Own Loop ────────────────────────────────────────

await run("JL-P4-1 execution-tick defines ExecutionTickState type with timer loop fields", () => {
  assert.ok(executionTickSource.includes("type ExecutionTickState ="))
  assert.ok(executionTickSource.includes("timer: NodeJS.Timeout | null"))
  assert.ok(executionTickSource.includes("running: boolean"))
  assert.ok(executionTickSource.includes("tickInFlight: boolean"))
  assert.ok(executionTickSource.includes("tickIntervalMs: number"))
  assert.ok(executionTickSource.includes("totalTickCount: number"))
  assert.ok(executionTickSource.includes("overlapSkipCount: number"))
  assert.ok(executionTickSource.includes("lastTickClaimedCount"))
  assert.ok(executionTickSource.includes("lastTickCompletedCount"))
  assert.ok(executionTickSource.includes("lastTickFailedCount"))
  assert.ok(executionTickSource.includes("lastTickSkippedCount"))
})

await run("JL-P4-2 execution-tick uses globalThis singleton (__novaExecutionTick)", () => {
  assert.ok(executionTickSource.includes("__novaExecutionTick"), "__novaExecutionTick key not found")
  // Must assign back (two-step pattern)
  const assignIdx = executionTickSource.indexOf("__novaExecutionTick = ")
  assert.ok(assignIdx !== -1, "globalThis singleton must be assigned back")
})

await run("JL-P4-3 execution-tick has own timer loop with EXECUTION_TICK_INTERVAL_MS and watchdog", () => {
  assert.ok(executionTickSource.includes("EXECUTION_TICK_INTERVAL_MS"))
  assert.ok(executionTickSource.includes("EXECUTION_TICK_WATCHDOG_MS"))
  assert.ok(executionTickSource.includes("etState.tickInFlight = true"))
  assert.ok(executionTickSource.includes("etState.tickInFlight = false"))
  assert.ok(executionTickSource.includes("etState.overlapSkipCount += 1"))
})

await run("JL-P4-4 execution-tick calls reclaimExpiredLeases before getPendingRuns in runExecutionTickInternal", () => {
  const fnStart = executionTickSource.indexOf("async function runExecutionTickInternal(")
  assert.ok(fnStart !== -1, "runExecutionTickInternal not found")
  const fnBody = executionTickSource.slice(fnStart)
  const reclaimIdx = fnBody.indexOf("reclaimExpiredLeases()")
  const pendingRunsIdx = fnBody.indexOf("getPendingRuns(")
  assert.ok(reclaimIdx !== -1, "reclaimExpiredLeases not called in runExecutionTickInternal")
  assert.ok(reclaimIdx < pendingRunsIdx, "reclaimExpiredLeases must precede getPendingRuns")
})

await run("JL-P4-5 heartbeat is self-managed by makePreClaimedSlot (clears in release(), survives executeRun timeout)", () => {
  // Heartbeat lives in execution-guard's makePreClaimedSlot, not in executeRun,
  // so the lease stays alive even after executeRun returns due to a per-mission timeout.
  const fnStart = guardSource.indexOf("export function makePreClaimedSlot(")
  assert.ok(fnStart !== -1, "makePreClaimedSlot not found in guardSource")
  const fnBody = guardSource.slice(fnStart)
  assert.ok(fnBody.includes("heartbeatConfig"), "heartbeatConfig param not found in makePreClaimedSlot")
  assert.ok(fnBody.includes("setInterval("), "setInterval not found in makePreClaimedSlot")
  assert.ok(fnBody.includes("heartbeatTimer"), "heartbeatTimer variable not found")
  assert.ok(fnBody.includes("clearInterval("), "clearInterval not found")
  // clearInterval must be inside release(), not in executeRun
  const releaseIdx = fnBody.indexOf("async release(")
  assert.ok(releaseIdx !== -1, "release() method not found")
  const releaseBody = fnBody.slice(releaseIdx, releaseIdx + 300)
  assert.ok(releaseBody.includes("clearInterval("), "clearInterval must be inside release()")
  // executeRun must NOT have standalone heartbeat timer
  const erStart = executionTickSource.indexOf("async function executeRun(")
  const erEnd = executionTickSource.indexOf("\nasync function ", erStart + 1)
  const erBody = executionTickSource.slice(erStart, erEnd !== -1 ? erEnd : erStart + 5000)
  assert.ok(!erBody.includes("heartbeatTimer"), "executeRun must not manage heartbeatTimer (moved to slot)")
  // executeRun passes heartbeatConfig to makePreClaimedSlot
  assert.ok(erBody.includes("intervalMs") || erBody.includes("onBeat"), "executeRun must pass heartbeat config to makePreClaimedSlot")
})

await run("JL-P4-6 heartbeat interval is Math.floor(EXECUTION_TICK_LEASE_MS / 3)", () => {
  assert.ok(
    executionTickSource.includes("Math.floor(EXECUTION_TICK_LEASE_MS / 3)"),
    "Heartbeat interval must be Math.floor(EXECUTION_TICK_LEASE_MS / 3)",
  )
})

await run("JL-P4-7 execution-tick exports ensureExecutionTickStarted, stopExecutionTick, getExecutionTickState", () => {
  assert.ok(executionTickSource.includes("export function ensureExecutionTickStarted("))
  assert.ok(executionTickSource.includes("export function stopExecutionTick("))
  assert.ok(executionTickSource.includes("export function getExecutionTickState("))
})

await run("JL-P4-8 ensureExecutionTickStarted guards on etState.running && etState.timer and uses setInterval", () => {
  const fnStart = executionTickSource.indexOf("export function ensureExecutionTickStarted(")
  assert.ok(fnStart !== -1)
  const fnBody = executionTickSource.slice(fnStart, fnStart + 600)
  assert.ok(fnBody.includes("etState.running && etState.timer"), "Guard must check both running and timer")
  assert.ok(fnBody.includes("setInterval("), "setInterval not found in ensureExecutionTickStarted")
  assert.ok(fnBody.includes("etState.timer = setInterval"), "etState.timer must be assigned")
  assert.ok(fnBody.includes("etState.running = true"))
})

await run("JL-P4-9 stopExecutionTick clears timer with no scheduler lease release", () => {
  const fnStart = executionTickSource.indexOf("export function stopExecutionTick(")
  assert.ok(fnStart !== -1)
  const fnBody = executionTickSource.slice(fnStart, fnStart + 400)
  assert.ok(fnBody.includes("clearInterval("), "clearInterval not found in stopExecutionTick")
  assert.ok(fnBody.includes("etState.running = false"))
  // No leader election — must NOT call releaseSchedulerLease
  assert.ok(!fnBody.includes("releaseSchedulerLease"), "stopExecutionTick must not touch scheduler leases")
})

await run("JL-P4-10 scheduler no longer calls runExecutionTick inline", () => {
  assert.ok(
    !schedulerSource.includes("runExecutionTick"),
    "scheduler must not call runExecutionTick — execution-tick has its own loop in Phase 4",
  )
  assert.ok(schedulerSource.includes("ensureExecutionTickStarted"), "scheduler must import ensureExecutionTickStarted")
})

await run("JL-P4-11 ensureMissionSchedulerStarted calls ensureExecutionTickStarted()", () => {
  const fnStart = schedulerSource.indexOf("export function ensureMissionSchedulerStarted(")
  assert.ok(fnStart !== -1)
  const fnBody = schedulerSource.slice(fnStart, fnStart + 800)
  assert.ok(fnBody.includes("ensureExecutionTickStarted()"), "ensureMissionSchedulerStarted must call ensureExecutionTickStarted()")
})

await run("JL-P4-12 execution-tick route exports GET POST DELETE with requireSupabaseApiUser", () => {
  assert.ok(executionTickRouteSource.includes("export async function GET("))
  assert.ok(executionTickRouteSource.includes("export async function POST("))
  assert.ok(executionTickRouteSource.includes("export async function DELETE("))
  assert.ok(executionTickRouteSource.includes("requireSupabaseApiUser"))
  assert.ok(executionTickRouteSource.includes("ensureExecutionTickStarted"))
  assert.ok(executionTickRouteSource.includes("getExecutionTickState"))
  assert.ok(executionTickRouteSource.includes("stopExecutionTick"))
  assert.ok(executionTickRouteSource.includes('runtime = "nodejs"'))
  assert.ok(executionTickRouteSource.includes('dynamic = "force-dynamic"'))
})

await run("JL-P4-13 execution-tick route GET supports ?ensure=1 to start the loop", () => {
  const getStart = executionTickRouteSource.indexOf("export async function GET(")
  assert.ok(getStart !== -1)
  const getBody = executionTickRouteSource.slice(getStart, getStart + 400)
  assert.ok(getBody.includes('"ensure"'))
  assert.ok(getBody.includes('"1"'))
  assert.ok(getBody.includes("ensureExecutionTickStarted()"))
})

await run("JL-P4-14 migration V3 extends reclaim_expired_job_leases to include running status", () => {
  assert.ok(migrationV3.includes("CREATE OR REPLACE FUNCTION reclaim_expired_job_leases"))
  assert.ok(
    migrationV3.includes("IN ('claimed', 'running')"),
    "Migration must use IN ('claimed', 'running') in WHERE clause",
  )
  assert.ok(migrationV3.includes("SECURITY DEFINER"))
  assert.ok(migrationV3.includes("GRANT EXECUTE"))
  assert.ok(migrationV3.includes("idx_job_runs_lease_expiry"))
  assert.ok(migrationV3.includes("DROP INDEX IF EXISTS idx_job_runs_lease_expiry"))
})

// ─── Post-Phase-4 Cleanup Fixes ──────────────────────────────────────────────

const schedulerRouteSource = read("hud/app/api/missions/scheduler/route.ts")

await run("JL-W1-A execution-guard accepts source param and maps trigger→webhook", () => {
  assert.ok(guardSource.includes("source?: "), "source param must be optional in input type")
  // Must map trigger → webhook and manual → manual
  assert.ok(guardSource.includes('"trigger" ? "webhook"') || guardSource.includes('"trigger"') && guardSource.includes('"webhook"'), "must map trigger to webhook")
  assert.ok(guardSource.includes('"manual"'), "must handle manual source")
  // ledgerSource variable used in enqueue (not hardcoded "scheduler")
  const enqueueIdx = guardSource.indexOf("jobLedger.enqueue(")
  assert.ok(enqueueIdx !== -1)
  const enqueueBody = guardSource.slice(enqueueIdx, enqueueIdx + 200)
  assert.ok(!enqueueBody.includes('source: "scheduler"'), "enqueue source must not be hardcoded to scheduler")
})

await run("JL-W1-B cancelPendingForMission includes running status", () => {
  const fnStart = storeSource.indexOf("async cancelPendingForMission(")
  assert.ok(fnStart !== -1)
  const fnBody = storeSource.slice(fnStart, fnStart + 400)
  assert.ok(fnBody.includes('"running"'), 'cancelPendingForMission must include "running" in status filter')
  assert.ok(fnBody.includes('"pending"'))
  assert.ok(fnBody.includes('"claimed"'))
})

await run("JL-W3-A execute-mission computes maxAttempts from mission.settings (no optional chain)", () => {
  // mission.settings is required on Mission — no ?. needed
  assert.ok(
    executeMissionSource.includes("mission.settings.retryOnFail"),
    "must use mission.settings.retryOnFail (not optional chain)",
  )
  assert.ok(
    executeMissionSource.includes("mission.settings.retryCount + 1"),
    "must use retryCount + 1 (no dead ?? 2 fallback)",
  )
})

await run("JL-W8-A scheduler max_attempts formula uses retryCount+1 with no dead fallback", () => {
  assert.ok(
    schedulerSource.includes("liveMission.settings.retryOnFail"),
    "must use liveMission.settings.retryOnFail (no ?.)",
  )
  assert.ok(
    schedulerSource.includes("liveMission.settings.retryCount + 1"),
    "must use retryCount + 1 (no ?? 2)",
  )
})

await run("JL-W9-A ensureMissionSchedulerStarted calls timer.unref()", () => {
  const fnStart = schedulerSource.indexOf("export function ensureMissionSchedulerStarted(")
  assert.ok(fnStart !== -1)
  const fnBody = schedulerSource.slice(fnStart, fnStart + 800)
  assert.ok(fnBody.includes("state.timer.unref()"), "state.timer.unref() must be called")
})

await run("JL-P4-8-A ensureExecutionTickStarted calls timer.unref()", () => {
  const fnStart = executionTickSource.indexOf("export function ensureExecutionTickStarted(")
  assert.ok(fnStart !== -1)
  const fnBody = executionTickSource.slice(fnStart, fnStart + 600)
  assert.ok(fnBody.includes("etState.timer.unref()"), "etState.timer.unref() must be called")
})

await run("JL-W13-A stopMissionScheduler calls stopExecutionTick for symmetric lifecycle", () => {
  const fnStart = schedulerSource.indexOf("export function stopMissionScheduler(")
  assert.ok(fnStart !== -1)
  const fnBody = schedulerSource.slice(fnStart, fnStart + 600)
  assert.ok(fnBody.includes("stopExecutionTick()"), "stopMissionScheduler must call stopExecutionTick()")
})

await run("JL-W13-B scheduler imports stopExecutionTick", () => {
  assert.ok(schedulerSource.includes("stopExecutionTick"), "scheduler must import stopExecutionTick")
})

await run("JL-P16-C2-A scheduler route returns combinedState with executionTick key", () => {
  assert.ok(schedulerRouteSource.includes("combinedState"), "schedulerRouteSource must define combinedState")
  assert.ok(schedulerRouteSource.includes("getExecutionTickState"), "must import getExecutionTickState")
  assert.ok(schedulerRouteSource.includes("executionTick:"), "combinedState must include executionTick key")
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
