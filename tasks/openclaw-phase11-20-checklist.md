# OpenClaw Upgrade Plan: Phase 11-20

Status key: `[ ]` pending, `[-]` in progress, `[x]` complete

Assumption: Phase 1-10 are already complete in Nova. This plan covers the remaining high-value upstream capabilities from `.tmp/openclaw-upstream` that can improve Nova quality, safety, and workflow reliability.

## Scope Guardrails

- Port only architecture and reliability wins relevant to Nova core (`src/agent`, `src/runtime`, `src/memory`, `src/tools`, `src/skills`, `src/config`).
- Do not port channel-specific stacks (`discord`, `slack`, `telegram`, `whatsapp`, `imessage`, `line`, `signal`) unless explicitly requested.
- Every phase requires:
  - code changes
  - smoke test run
  - log artifact captured in `logs/openclaw-phaseNN.log`

## Phase 11: Network SSRF Hardening

- [x] Goal: Protect all external fetch/tool URL flows against SSRF, loopback, private ranges, and unsafe redirects.
- [x] Source candidates:
  - `.tmp/openclaw-upstream/src/infra/net/ssrf.ts`
  - `.tmp/openclaw-upstream/src/infra/net/fetch-guard.ts`
  - `.tmp/openclaw-upstream/src/infra/net/hostname.ts`
- [x] Nova targets:
  - `src/tools/*`
  - `src/runtime/modules/*` (any fetch calls)
  - `src/agent/*` URL intake points
- [x] Smoke test:
  - `npm run smoke:src-transport`
  - targeted test: blocked `http://127.0.0.1`, blocked RFC1918 IPs, allowed public HTTPS
- [x] Log:
  - `logs/openclaw-phase11.log`

## Phase 12: External Content Safety Pipeline

- [x] Goal: Sanitize and classify risky external content before it reaches prompts/tools.
- [x] Source candidates:
  - `.tmp/openclaw-upstream/src/security/external-content.ts`
  - `.tmp/openclaw-upstream/src/security/scan-paths.ts`
- [x] Nova targets:
  - `src/agent/*` context assembly
  - `src/skills/*` tool invocation boundaries
- [x] Smoke test:
  - prompt injection payload pass/fail cases
  - unsafe markdown/link payload filtering verification
- [x] Log:
  - `logs/openclaw-phase12.log`

## Phase 13: Tool Risk Policy Engine

- [x] Goal: Add policy grades for tools (safe, elevated, dangerous) with explicit runtime enforcement.
- [x] Source candidates:
  - `.tmp/openclaw-upstream/src/security/audit-tool-policy.ts`
  - `.tmp/openclaw-upstream/src/security/dangerous-tools.ts`
  - `.tmp/openclaw-upstream/src/security/dm-policy-shared.ts`
- [x] Nova targets:
  - `src/tools/*`
  - `src/agent/*` tool routing layer
- [x] Smoke test:
  - safe tools execute in normal mode
  - dangerous tools blocked without elevation flag
- [x] Log:
  - `logs/openclaw-phase13.log`

## Phase 14: Cron Store and Migration Hardening

- [x] Goal: Ensure schedules survive restarts/upgrades with deterministic schema migration.
- [x] Source candidates:
  - `.tmp/openclaw-upstream/src/cron/store.ts`
  - `.tmp/openclaw-upstream/src/cron/payload-migration.ts`
  - `.tmp/openclaw-upstream/src/cron/service/store.ts`
- [x] Nova targets:
  - `src/runtime/*` scheduler persistence
  - `data/*` schedule storage format
- [x] Smoke test:
  - create jobs, restart process, verify jobs preserved
  - migration from previous schema fixture
- [x] Log:
  - `logs/openclaw-phase14.log`

## Phase 15: Cron Delivery Reliability and Idempotency

- [x] Goal: Prevent duplicate deliveries and improve retry behavior under failure.
- [x] Source candidates:
  - `.tmp/openclaw-upstream/src/cron/delivery.ts`
  - `.tmp/openclaw-upstream/src/cron/service/locked.ts`
  - `.tmp/openclaw-upstream/src/cron/run-log.ts`
- [x] Nova targets:
  - `src/runtime/*` mission/workflow delivery path
- [x] Smoke test:
  - failed delivery retry scenario
  - duplicate-timer prevention regression
  - existing verifier: `node scripts/verify-phase15.mjs`
- [x] Log:
  - `logs/openclaw-phase15.log`

## Phase 16: Skill Snapshot Isolation for Jobs

- [x] Goal: Scheduled jobs run against stable skill snapshots (no mid-run mutation).
- [x] Source candidates:
  - `.tmp/openclaw-upstream/src/cron/isolated-agent/skills-snapshot.ts`
  - `.tmp/openclaw-upstream/src/cron/isolated-agent/run.ts`
- [x] Nova targets:
  - `src/skills/*`
  - `src/runtime/*` mission execution
- [x] Smoke test:
  - edit skill during queued job and verify consistent job behavior
- [x] Log:
  - `logs/openclaw-phase16.log`

## Phase 17: Routing Arbitration Upgrade

- [x] Goal: Improve model/tool routing decisions with deterministic tie-breaks and cost/latency biasing.
- [x] Source candidates:
  - `.tmp/openclaw-upstream/src/routing/*`
- [x] Nova targets:
  - `src/agent/*`
  - `src/providers/*`
- [x] Smoke test:
  - multi-provider routing scenarios with fixed expected picks
- [x] Log:
  - `logs/openclaw-phase17.log`

## Phase 18: Plugin Isolation and Permission Boundaries

- [x] Goal: Add capability boundaries for plugin-style tools and extension points.
- [x] Source candidates:
  - `.tmp/openclaw-upstream/src/plugins/*`
  - `.tmp/openclaw-upstream/src/plugin-sdk/*`
- [x] Nova targets:
  - `src/tools/*`
  - `src/skills/*`
- [x] Smoke test:
  - plugin denied file/network capability when not granted
  - allowed capability path still works
- [x] Log:
  - `logs/openclaw-phase18.log`

## Phase 19: Memory Relevance and Compression Lift

- [x] Goal: Improve recall quality with tighter relevance ranking and compression under token pressure.
- [x] Source candidates:
  - `.tmp/openclaw-upstream/src/memory/*` (cross-check with existing `src/memory/mmr.ts`)
- [x] Nova targets:
  - `src/memory/*`
  - `src/agent/*` prompt assembly
- [x] Smoke test:
  - long-thread recall benchmark with fixed expected facts retained
- [x] Log:
  - `logs/openclaw-phase19.log`

## Phase 20: Security Regression Net and Final Hardening

- [x] Goal: Build a durable security/quality regression pack and lock defaults.
- [x] Source candidates:
  - `.tmp/openclaw-upstream/src/security/*.test.ts`
  - `.tmp/openclaw-upstream/src/infra/net/*.test.ts`
  - `.tmp/openclaw-upstream/src/cron/*.test.ts`
- [x] Nova targets:
  - `src/**/*`
  - CI smoke workflow definitions
- [x] Smoke test:
  - full smoke suite
  - representative security regression suite
  - `npm run build --prefix hud`
- [x] Log:
  - `logs/openclaw-phase20.log`

## Definition Of Done (Phase 11-20)

- [x] All phase logs present in `logs/`.
- [x] No unresolved TODOs for blocked imports.
- [x] No references to `.tmp/openclaw-upstream` in production runtime paths.
- [x] Smoke tests pass for runtime and HUD build.
- [x] Release notes prepared summarizing reliability, safety, and workflow gains.
