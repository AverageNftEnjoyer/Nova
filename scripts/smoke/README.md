# Smoke Tests

Smoke tests are plain Node scripts (`.mjs`). Each one runs a set of named checks, prints `PASS` / `FAIL` / `SKIP` lines
and exits non-zero on any failure. Run them from the repo root through the npm scripts in the root `package.json`
(for example `npm run smoke:local-db`), or directly with `node scripts/smoke/<area>/<file>.mjs`.

All smoke tests under `scripts/smoke/` live in a subfolder, one per area. Do not add smoke files directly in
`scripts/smoke/`. The Coinbase suites live in `scripts/coinbase/smoke/`.

Browser tests (Playwright) are separate and live in `hud/tests/smoke/` (see the end of this file).

## Test isolation (mandatory)

Every smoke that can reach `src/db`, the runtime stores or the per-user file area must run against a temporary data
directory, never the repo's `.user/` folder. Make this the FIRST import of the script (ES imports run in source order):

```js
import "../lib/isolated-data-dir.mjs" // adjust the relative path
```

The helper replaces `NOVA_DATA_DIR` with a fresh dir under `os.tmpdir()` (an existing `NOVA_DATA_DIR` that is already
under `os.tmpdir()` is kept), clears `NOVA_PACKAGED`, and deletes the dir on exit. Some older smokes create their own
temp dir with `fs.mkdtempSync` and set `NOVA_DATA_DIR` before importing `src/db`; that is also fine.

`npm run smoke:local-db` includes `no-real-data-writes-smoke.mjs`, which fails if a representative set of smokes changes
the real `nova.db` or creates paths in the real data dir.

## What to run

| Script | What it runs |
| --- | --- |
| `npm run smoke:fundamental` | The functional gate: unit and type checks, runtime, SQLite (including deployment migrations), encryption, local API and runtime security, tools, routing core, agent tasks, token regression, and Playwright. |
| `npm run smoke:src-release` | The release chain: prompt, missions, scheduler and delivery, transport, user isolation, tools, security, memory, routing core, plugin isolation, pending-poll resilience, Coinbase CI, agent tasks, token regression, isolation closure, release readiness, then `build:hud`. |
| `npm run verify:release-readiness` | Runs `smoke:src-release`. |
| `npm run smoke:token-deep` | Optional token and cost diagnostics. Not part of the functional gate or the release chain. |

Per-change suites are gone: one-off audit regressions, workstream checks, ChatKit release gates, perf source guards, live latency and token checks, and a separate smoke for every integration lane. Coverage of those areas lives in the suites above (routing core, security, local database, Coinbase CI, token gate) and in the Node unit tests.

## Suites that remain

Helpers in `scripts/smoke/lib/` (`isolated-data-dir`, `seed-runtime-integrations`, `user-state-readers`, `hud-task-store`, `package-resolution-guard`) are not smokes. `local-db/db-worker.mjs` is the child worker for the database foundation and multiprocess smokes.

| Area | npm script | Role |
| --- | --- | --- |
| `core/runtime-smoke.mjs` | `smoke` | Runtime boot smoke. Inside `smoke:fundamental`. |
| `local-db/` | `smoke:local-db` | SQLite foundation, multiprocess access, job ledger, persistence, tool runs, data paths, the real-data write guard, UI storage, local data, retired model ids, deployment migrations. |
| `local-db/encryption-smoke.mjs` | `smoke:encryption` | DPAPI secret encryption. |
| `security/local-api-guard-smoke.mjs` | `smoke:security-guard` | Local API auth guard. |
| `security/src-security-hardening-smoke.mjs` and `src-runtime-hardening-regression-smoke.mjs` | `smoke:src-security` | Runtime security hardening. |
| `security/src-user-context-isolation-smoke.mjs` | `smoke:src-user-isolation` | Per-user context isolation. |
| `routing/src-tool-loop-smoke.mjs` | `smoke:src-tools` | Tool loop. |
| `routing/` operator, arbitration, platform-contract persistence, Telegram lane isolation | `smoke:routing-core` (`smoke:src-routing` is the same gate) | Routing spine. |
| `routing/src-transport-stability-smoke.mjs` plus `runtime/hud-gateway-performance-smoke.mjs` | `smoke:src-transport` | Transport stability. |
| `routing/src-plugin-isolation-smoke.mjs` | `smoke:src-plugin-isolation` | Plugin isolation. |
| `agent-tasks/` (6 files) | `smoke:agent-tasks` | Agent task runtime, provider contract, store, execution context, UI source check, file drop. |
| `token-efficiency/token-regression-gate.mjs` | `smoke:token-gate` | Offline prompt, tool-schema, and cache-prefix gate. Uses `token-baseline-harness.mjs`. |
| `token-efficiency/` usage, cost, caps, routing, budgets, plus `providers/retired-model-aliases-smoke.mjs` and `analytics/analytics-real-writers-smoke.mjs` | `smoke:token-deep` | Optional detail beyond the token gate. |
| `town/town-progress-smoke.mjs` | `smoke:town` | Nova City progression (hud/lib/town): XP math, level curve, quests, buildings, once-only events and ack, tutorial skip, daily rollover, cache, index use. |
| `quality/src-prompt-budget-smoke.mjs` | `smoke:src-prompt` | Prompt budget. |
| `quality/src-mission-quality-smoke.mjs`, mission output contract, agent runtime, TypeScript checks, legacy audit | `smoke:src-missions` | Mission behavior. |
| `scheduler/` stability, core performance, execution tick, plus the job ledger | `smoke:src-scheduler` | Scheduler. |
| `runtime/src-scheduler-soak-latency-smoke.mjs` | `smoke:src-scheduler-soak-latency` | Scheduler soak. |
| `scheduler/src-discord-delivery-smoke.mjs`, `src-telegram-delivery-smoke.mjs` | `smoke:src-discord-delivery`, `smoke:src-telegram-delivery` | Delivery. |
| `conversation/src-memory-convergence-smoke.mjs` | `smoke:src-memory` | Memory. |
| `conversation/src-pending-poll-resilience-smoke.mjs` | `smoke:src-pending-poll-resilience` | Pending poll. |
| policy approval, HUD approval handoff, org-chart isolation, short-term context, reminders, `calendar/hud-calendar-isolation-smoke.mjs`, retention | `smoke:src-isolation-closure` | Isolation closure. |
| `scripts/coinbase/smoke/` (10 files) | `smoke:src-coinbase-ci` | Coinbase storage, chat, missions, commands, delivery, observability, privacy, integration surface, rollout, contracts. |
| `quality/src-release-readiness-smoke.mjs` | `smoke:src-release-readiness` | Source check that the release and fundamental gates still include the required scripts. |
| `packaging/version-sync-smoke.mjs` | `smoke:version-sync` | Package version matches `NOVA_VERSION`. Electron builds run this. |
| `packaging/production-boot-smoke.mjs`, `production-routes-smoke.mjs` | `smoke:production-boot`, `smoke:production-routes` | Packaged build boot and route load. Run after a desktop build. |
| `hud/hud-integrations-secret-input-guard-smoke.mjs` | `guard:hud-integrations-secrets` | HUD typecheck refuses secret fields in integration forms. |
| `verification/verify-release-readiness.mjs` | `verify:release-readiness` | Spawns `smoke:src-release`. |

## Browser tests (Playwright)

`hud/tests/smoke/` holds Playwright specs, configured in `hud/playwright.config.ts`. Run them from `hud/` with
`npm run test:smoke` (also `test:smoke:ui`, `test:smoke:headed`). `smoke:fundamental` runs this suite.

| File | What it checks |
| --- | --- |
| `agent-tasks.spec.ts` | Agent Tasks module on the home page and `/api/agent-tasks` create, reject, list, pause/play/stop, delete, and the max-concurrent limit. |
| `deployments.spec.ts` | Deployments workspace flows. |

Playwright starts its own `npm run dev` on 127.0.0.1, port 3100 (`NOVA_PLAYWRIGHT_PORT`), never reusing a running
server, with `NOVA_DATA_DIR` set to a fresh temp dir created per run and removed on exit, so the specs never touch the
real `nova.db`. Stop any other `next dev` in `hud/` first (Next allows one dev server per project directory).

## Adding a smoke

Add one only when it protects behavior the functional gate or the release chain does not already cover. Do not add a
smoke for a single change, lane, or audit finding.

1. Put it in the subfolder for its area (`scripts/smoke/<area>/`). If no folder fits, create one and add a row above.
2. Name it `<prefix>-<what>-smoke.mjs` (prefixes such as `src-`, `hud-`). Keep names stable.
3. Make `import "../lib/isolated-data-dir.mjs"` the first import if it can touch `src/db`, runtime stores or user files.
   Never read or write the real `.user/` data. Use fakes for providers and integrations.
4. Print one `PASS` / `FAIL` / `SKIP` line per check and exit non-zero on failure.
5. Add an npm script in the root `package.json` and include it in `smoke:fundamental` or `smoke:src-release` when it is part of that gate.
6. Add a row to the table above.
