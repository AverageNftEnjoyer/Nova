# Smoke Tests

Smoke tests are plain Node scripts (`.mjs`). Each one runs a set of named checks, prints `PASS` / `FAIL` / `SKIP` lines
and exits non-zero on any failure. Run them from the repo root through the npm scripts in the root `package.json`
(for example `npm run smoke:local-db`), or directly with `node scripts/smoke/<area>/<file>.mjs`.

All smoke tests under `scripts/smoke/` live in a subfolder, one per area. Do not add smoke files directly in
`scripts/smoke/`. The Coinbase suites live in `scripts/coinbase/smoke/` and are listed below as well.

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

## How to read the tables

- **npm script**: the root `package.json` script that runs the file directly. "none" means no script runs it; run it
  with `node`. A file can also run inside an aggregate script (next section).
- **Needs**:
  - `none`: offline. Uses fakes, stubs or a local fake server and a temp data dir.
  - `build`: imports compiled code from `dist/`. Run `npm run build:agent-core` first when calling `node` directly
    (most npm scripts for these files already do it).
  - `network`: makes real outbound calls.
  - `API key`: needs a real provider key.
  - `integration`: needs a connected integration (for example Spotify).
  - `user id`: needs `NOVA_SMOKE_USER_CONTEXT_ID`. Without it the script skips (exit 0) or fails, as noted.
- "Source check" means the smoke reads source files and asserts on their contents instead of running the code.
- Smokes named `*-live-*` in `routing/` are not live against external services. They run the real `handleInput`
  routing path with a fake model runtime (`apiKey: "smoke-test-key"`) and stubbed workers.
- "Possibly stale" marks smokes whose code suggests they no longer match the current storage or setup. Each note says
  why. They were not run while writing this file.

## Aggregate scripts

| Script | What it runs |
| --- | --- |
| `npm test` | `build:agent-core`, then `test:node`: `node:test` unit suites (`src/**/*.test.*`, `dist/**/*.test.js`) on a temp data dir. Not smokes. |
| `npm run smoke` | `core/runtime-smoke.mjs` only. |
| `npm run smoke:audit` | The six `audit/*/smoke.mjs` scripts. |
| `npm run smoke:local-db` | `db-foundation`, `multiprocess`, `job-ledger-sqlite`, `authoritative-persistence`, `tool-runs`, `data-paths`, `no-real-data-writes`, `ui-storage` (all in `local-db/`). |
| `npm run smoke:agent-tasks` | `build:agent-core`, then all six `agent-tasks/` smokes. |
| `npm run smoke:token-usage` | `usage-normalize`, `cost-math`, `llm-usage-ledger` (in `token-efficiency/`). |
| `npm run smoke:src-routing` | `build:agent-core`, `routing/src-routing-arbitration-smoke.mjs`, then 28 more routing scripts: operator handlers, finalization, preflight, dispatch, context hints, worker executors, platform-contract persistence, the Discord / Gmail / calendar / diagnostics / files / missions / web-research / market / Polymarket / Telegram / reminders / shutdown / voice-TTS domain smokes, market closure, voice-TTS transport, the calendar / market / Polymarket / reminders / voice-TTS `-live` smokes, and Telegram lane isolation. |
| `npm run smoke:src-scheduler` | `scheduler/src-scheduler-stability`, `smoke:src-scheduler-core-performance`, `smoke:execution-tick-performance`, `smoke:job-ledger`. |
| `npm run smoke:src-missions` | `quality/src-mission-quality`, `smoke:src-mission-output-contract`, `smoke:src-mission-agent-runtime`, `smoke:src-mission-ts-checks`, `ops:mission-legacy-audit:strict`. |
| `npm run smoke:src-security` | `security/src-security-hardening`, then `smoke:src-runtime-hardening`. |
| `npm run smoke:src-transport` | `routing/src-transport-stability`, then `smoke:runtime-hud-gateway-performance`. |
| `npm run smoke:src-tool-loop-rc-gate` | `smoke:src-tools`, `smoke:src-tool-loop-guardrails` (which also runs `smoke:src-tool-runtime-bootstrap`), `smoke:src-tool-loop-concurrency`, `smoke:src-routing`, `smoke:src-user-isolation`. |
| `npm run smoke:src-coinbase-ci` | The ten Coinbase suites: storage, chat, mission-runtime, command-matrix, report-delivery-retention, observability-resilience, privacy-consent, integration-surface, rollout-controls, mission-contracts. |
| `npm run smoke:src-identity-intelligence` | Identity unit, identity runtime, identity profile divergence. |
| `npm run smoke:src-chatkit-release` | ChatKit runtime config, shadow routing, serve routing, structured workflow, release readiness. |
| `npm run smoke:spotify` | `smoke:hud-spotify-integration`, `smoke:hud-spotify-boot-spam-throttle`, `smoke:runtime-spotify-isolation`. |
| `npm run smoke:src-isolation-closure` | User isolation, policy approval store, HUD policy approval handoff, org-chart live, short-term context persistence, reminders live, calendar isolation, retention isolation. |
| `npm run smoke:src-release` | The release chain: `build:agent-core`, eval, prompt, missions, scheduler, scheduler soak, Discord and Telegram delivery, transport, user isolation, tools, security, memory, routing, plugin isolation, security regression, pending-poll resilience, Coinbase CI, Coinbase readiness, agent tasks, isolation closure, release readiness, then `build:hud`. |
| `npm run verify:release-readiness` | Runs `smoke:src-release` (through `verification/verify-release-readiness.mjs`). |
| `npm run ops:mission-prod-ready` | `smoke:src-mission-telemetry-reliability` plus two `ops:` scripts. |

## Smokes by area

### agent-tasks/ (6)

All six run in `npm run smoke:agent-tasks` (no per-file scripts).

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `agent-task-runtime-smoke.mjs` | `smoke:agent-tasks` | Real agent-task scheduler with a fake `handleInput`: priority/FIFO order, max 5 concurrent, provider/model pinning, usage and result persistence. | none |
| `agent-task-provider-contract-smoke.mjs` | `smoke:agent-tasks` | Claude tool loop against a local fake HTTP server: native `tool_use` / `tool_result` round trip and real usage numbers. | none |
| `agent-task-store-smoke.mjs` | `smoke:agent-tasks` | HUD task store (TS transpiled to a temp dir): immutable managed attachments, atomic task contexts, approvals and cleanup. | none |
| `agent-task-execution-context-smoke.mjs` | `smoke:agent-tasks` | Task workspace and attachment preparation (delimiters escaped, host paths hidden) and the per-permission-mode tool policy for file and exec tools. | build |
| `agent-tasks-ui-smoke.mjs` | `smoke:agent-tasks` | Source check of the Agent Tasks UI: home module wiring, all 6 statuses, list grouping, 5 permission modes, 4 providers, no legacy `/api/tasks`, no `console.log`. | none |
| `file-drop-smoke.mjs` | `smoke:agent-tasks` | Source check of file drag-and-drop: `attachedFiles` in types, modal dropzone, Electron drop handling, task store and migration 0006 (`attached_files`). | none |

### audit/ (6)

Regression tests for past audit findings. Each file is `audit/<name>/smoke.mjs`. All run in `npm run smoke:audit`.

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `p1-it-word-regression/smoke.mjs` | `smoke:audit:p1-it-regression` | The word "it" after a crypto conversation no longer fires `coinbase_portfolio_report`; real balance follow-ups still do. | none |
| `p2-rule-newline/smoke.mjs` | `smoke:audit:p2-rule-newline` | Newlines (`\n`, `\r\n`) in a Coinbase report preference become one single-line rule in `kv_state`; no SKILL.md side file is written. | none |
| `p5-workspace-write/smoke.mjs` | `smoke:audit:p5-workspace-write` | Coinbase preferences are stored in `kv_state` per user, independent of `workspaceDir` / cwd, with no leak between users. | none |
| `p6-skills-depth/smoke.mjs` | `smoke:audit:p6-skills-depth` | Skill discovery survives a 12-level directory tree, still finds depth-1 skills and ignores skills deeper than 8 levels. | none |
| `skills-apostrophe/smoke.mjs` | `smoke:audit:skills-apostrophe` | `extractSkillMetadata` does not throw on apostrophes in `read_when`. Documents the current (known lossy) behavior so a worse regression is caught. | none |
| `starter-seeding/smoke.mjs` | `smoke:audit:starter-seeding` | `ensureStarterSkillsForUser` seeds skills once (idempotent), into the right folder, and does not throw on a missing path. | none |

### calendar/ (2)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `hud-calendar-isolation-smoke.mjs` | `smoke:calendar:isolation` | Source check: calendar API routes are user-scoped, reschedule overrides are per-user SQLite rows, calendar WebSocket events are user-bound. | none |
| `hud-calendar-reschedule-smoke.mjs` | `smoke:calendar:reschedule` | Source check: the scheduler reads reschedule overrides, the API writes and removes them, the calendar page and `useNovaState` carry calendar WebSocket events. | none |

### conversation/ (13)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `live-latency-check.mjs` | `smoke:live-latency` | Opt-in wrapper. With `NOVA_LIVE_LATENCY=1` it reads the active provider key from the real `nova.db` (read-only), seeds a temp data dir and runs the 30-turn check below. Without it, prints a skip and exits 0. Not in the release chain. | API key, network (opt-in) |
| `src-conversation-quality-30turn-smoke.mjs` | none (run via `smoke:live-latency`) | 30 real conversation turns through `handleInput`; scores reply quality and checks p50/p95/p99 latency. Fails if no seeded user context or key. | API key, network |
| `src-chatkit-serve-routing-smoke.mjs` | `smoke:src-chatkit-serve-routing` | `shouldServeChatKit` decisions for serve mode off/on, intent allowlist, sample percent and ChatKit disabled. | none |
| `src-chatkit-shadow-routing-smoke.mjs` | `smoke:src-chatkit-shadow-routing` | Same decision checks for ChatKit shadow mode (`shouldRunChatKitShadow`). | none |
| `src-chatkit-structured-workflow-smoke.mjs` | `smoke:src-chatkit-structured-workflow` | Structured ChatKit workflow plan is research, summarize, display; the runner retries a failed step and completes all 3 steps (stub step executor). | build |
| `src-identity-intelligence-unit-smoke.mjs` | `smoke:src-identity-intelligence-unit` | Identity engine: explicit preferences beat seed defaults, newer facts supersede stale ones, prompt token cap, per-user isolation, corrupt snapshot recovery, protected-class inference blocked. | none |
| `src-identity-intelligence-runtime-smoke.mjs` | `smoke:src-identity-intelligence-runtime` | Real `handleInput` turns write a user-scoped identity snapshot and audit trail and keep a stable session. Skips (exit 0) without a user id. Possibly stale: with a user id it needs a working provider for that user, but the forced temp data dir has none. | user id, API key |
| `src-memory-convergence-smoke.mjs` | `smoke:src-memory` | MEMORY.md update parity, retrieval relevance and token budget, reindex on write, rerank, long-thread recall, embedding failures fail closed, request-scoped diagnostics. | build |
| `src-output-constraints-smoke.mjs` | `smoke:src-output-constraints` | Parsing and validation of reply constraints: one word, exact bullet count, JSON-only and required keys, sentence count; rewrite merge. | none |
| `src-pending-poll-resilience-smoke.mjs` | `smoke:src-pending-poll-resilience` | Source check: no legacy merge pipeline in the chat hook, transport ignores plain assistant payloads, stream lifecycle events, idempotent SQLite upsert, explicit sync points. | none |
| `src-persona-context-smoke.mjs` | `smoke:src-persona` | Persona files load from the user-context path, template-only seeding, persona prompt composition, no cross-user leakage. | build |
| `src-retention-isolation-smoke.mjs` | `smoke:src-retention-isolation` | Mostly source checks: user-scoped thread reads, idempotent message writes, strict conversation routing, scoped broadcasts, explicit deletes only, transcript line caps and pruning. | none |
| `src-user-preferences-smoke.mjs` | `smoke:src-user-preferences` | Preferred-name handling: "call me" parsing, confidence rules, overrides, MEMORY.md fallback, prompt section. | none |

### core/ (7)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `runtime-smoke.mjs` | `smoke` | Provider selection (strict and fallback), integrations runtime shape, auto memory extraction, session transcript isolation, tool runtime (file tool, per-user `memory.db`), voice wake gating, Brave-only web search. With no connected provider it sends requests with a dummy key to the real provider URLs and expects them to fail (passes offline too). Possibly stale: its user lookup still checks for legacy `integrations-config.json` files. | network attempted |
| `src-chatkit-runtime-config-smoke.mjs` | `smoke:src-chatkit-runtime-config` | ChatKit config is off by default, requires `OPENAI_API_KEY` when enabled, validates model / reasoning / timeout env overrides. | build |
| `src-provider-smoke.mjs` | `smoke:src-providers` | `src/providers` loads from `dist`, requires a `userContextId`, seeded runtime parity (compat vs src), strict and fallback selection, agent tasks pin provider and model. Unconfigured providers are called with a dummy key and must fail. | build, network attempted |
| `src-runtime-relocation-smoke.mjs` | `smoke:src-relocation` | Relocated runtime modules exist under `src/`, smokes and the import graph no longer use `agent/` paths, relocated providers / memory / session / tools / wake modules work. | none |
| `src-session-parity.mjs` | `smoke:src-session` | Session key and user-context matrix, transcript routing and idle reset parity between a legacy runtime and the src runtime. Possibly stale: the legacy side is a `sessions.json` file store. | build |
| `src-shell-parity-smoke.mjs` | `smoke:src-shell` | Source check: runtime shell files exist, the src entrypoint owns startup, the launcher defaults to it. | none |
| `src-user-root-smoke.mjs` | `smoke:src-user-root` | `src/.user` is a sentinel file that blocks nested user state; runtime constants never point at it; workspace roots normalize to the repo root. | build |

### hud/ (7)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `hud-integrations-secret-input-guard-smoke.mjs` | `guard:hud-integrations-secrets` | Source check: no `type="password"` input in `hud/app/integrations` outside `SecretInput.tsx`. | none |
| `hud-spotify-boot-spam-throttle-smoke.mjs` | `smoke:hud-spotify-boot-spam-throttle` | Source check: per-user device-unavailable cooldown, no auto-launch of Spotify desktop, no browser-tab fallback. | none |
| `hud-spotify-integration-smoke.mjs` | `smoke:hud-spotify-integration` | Source check: Spotify API routes, playback contract, client-safe config, setup UI, home status, icon, runtime snapshot, request timeouts, user-scoped favorites, playlist matching, scope checks. | none |
| `hud-spotify-playlist-favorites-live-smoke.mjs` | none | Live Spotify: exact and near-miss playlist lookup, favorite set and clear. Possibly stale: defaults to a hard-coded user id, imports `.ts` files directly, and the forced temp data dir has no Spotify tokens. | integration, network |
| `hud-spotify-search-precision-smoke.mjs` | none | Source check: "track by artist" parsing, strict track+artist lookup before generic search, hard fail when now-playing does not match. | none |
| `hud-thread-delete-canary-smoke.mjs` | `smoke:hud-thread-delete-canary` | A real HUD thread turn writes a scoped session and transcript; deleting the thread removes them; audit and alert log fields. Skips (exit 0) without a user id. Possibly stale: the turn needs a working provider, which the forced temp data dir does not have. | user id, API key |
| `hud-thread-delete-transcript-smoke.mjs` | `smoke:hud-thread-delete-transcript` | Thread cleanup removes SQLite session and transcript rows; optimistic conversation hint cleanup stays scoped. | none |

### lib/ (helpers, not smokes)

| File | Purpose |
| --- | --- |
| `isolated-data-dir.mjs` | Points `NOVA_DATA_DIR` at a throwaway temp dir. Import it first. Also used by `test:node`. |
| `seed-runtime-integrations.mjs` | Writes the per-user runtime integrations snapshot row (`integration_state`) into the temp DB. Refuses to run outside a temp data dir. |
| `user-state-readers.mjs` | Reads sessions, transcripts and `kv_state` for a user from the temp DB (replaces the old per-user JSON file reads). |

### local-db/ (10, plus a worker)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `db-foundation-smoke.mjs` | `smoke:local-db` | Migrations (fresh, re-run, ordered, rollback, late stubs), pragmas, `tx` and savepoints, `kv_state` scoping, data-dir resolution (override, packaged, dev, `src/.user` forbidden), singleton, 4-process write contention and migrate race. | none |
| `multiprocess-smoke.mjs` | `smoke:local-db` | 4 processes x 200 mixed kv / transaction ops on one `nova.db`: no `SQLITE_BUSY` escapes, no lost writes. | none |
| `job-ledger-sqlite-smoke.mjs` | `smoke:job-ledger` (also in `smoke:local-db`, `smoke:src-scheduler`) | Job ledger: enqueue, duplicate idempotency key rejected, claim/start/complete with lease, retry then dead at max attempts, exclusive scheduler lease. | none |
| `authoritative-persistence-smoke.mjs` | `smoke:local-db` | Missions, job-ledger runs and sessions persist in SQLite as the source of truth. | none |
| `tool-runs-smoke.mjs` | `smoke:local-db` | `tool_runs` audit trail: redaction, 2 KB cap, never throws, database failures swallowed, tool loop records every call and keeps working without the table, per-user pruning. | none |
| `data-paths-smoke.mjs` | `smoke:local-db` | Per-user paths (user-context root, `memory.db`, sessions, identity, provider runtime, thread-delete audit logs) follow the data dir; no code hardcodes `<root>/.user/user-context`. | build |
| `no-real-data-writes-smoke.mjs` | `smoke:local-db` | Runs 15 representative smokes with `NOVA_DATA_DIR` unset and fails if row counts in the real `nova.db` (dev and packaged locations, opened read-only) or the real data-dir paths change. Skips a location with no DB. Close Nova first. | none |
| `ui-storage-smoke.mjs` | `smoke:ui-storage` (also in `smoke:local-db`) | Settings mirror: key allowlist, size caps, per-user isolation, request body caps, merge rules, offline client queue, account delete purge. | none |
| `encryption-smoke.mjs` | `smoke:encryption` | `nv1:` round trip with random IV, AAD mismatch and tampering fail, legacy and malformed ciphertext rejected, no plaintext fallback, masking does not mutate input. Uses a test master key, not DPAPI. | none |
| `local-data-smoke.mjs` | none | Notes, agent tasks and calendar overrides on SQLite: per-user CRUD, caps, rollback, events, data survives reopen, migration 0004. Possibly stale: `docs/token-efficiency/PROGRESS.md` reports it failing on the `worktree-manager` import path. | none |
| `db-worker.mjs` | - | Child-process worker for `db-foundation` and `multiprocess`. Not a smoke. | - |

### logging/ (1)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `structured-logger-smoke.mjs` | `smoke:structured-logger` | Source check of `hud/lib/logging/structured-logger.ts`: exports, all four levels, reserved fields cannot be overwritten, PII sanitizer, serialize fallback, console routing, server-only. | none |

### media/ (1)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `background-assets-smoke.mjs` | `smoke:background-assets` | Custom background storage: path under the data dir, chunked upload, magic-byte and extension checks, size caps, hostile ids, Range reads, asset cap, delete, orphan reconcile, purge. | none |

### missions/ (10)

Only the telemetry smoke has an npm script. `src-mission-persistence-smoke.mjs` also runs inside `no-real-data-writes`.

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `src-mission-build-execution-smoke.mjs` | none | Mission build request runner with injected dependencies: idempotency key, pending and completed states, scheduler start, telemetry, calendar sync. | none |
| `src-mission-build-from-prompt-smoke.mjs` | none | Build-from-prompt with a fake LLM and mission factory produces a mission for a Telegram digest prompt. | none |
| `src-mission-build-service-smoke.mjs` | none | Mission build input normalization, idempotency key, payload summary and assistant reply. | none |
| `src-mission-calendar-mirror-smoke.mjs` | none | Mission schedule sync to Google Calendar with stubbed create/delete calls. | none |
| `src-mission-generation-helpers-smoke.mjs` | none | Schedule and timezone from prompt text; output channel normalization and inference. | none |
| `src-mission-graph-validation-smoke.mjs` | none | Mission graph validation for versioning on valid and invalid graphs. | none |
| `src-mission-llm-graph-parser-smoke.mjs` | none | Parsing LLM-produced nodes and connections, including unknown node types. | none |
| `src-mission-persistence-smoke.mjs` | none | Mission load / upsert / delete round trip for one user. | none |
| `src-mission-scheduler-service-smoke.mjs` | none | `ensureMissionSchedulerStarted` starts the scheduler once. | none |
| `src-mission-telemetry-reliability-smoke.mjs` | `smoke:src-mission-telemetry-reliability` | Mission telemetry event types, retention and SLO config, sanitizer, user-scoped store, SLO evaluator, lifecycle events, reliability API and rate limit, guidance docs. | none |

### packaging/ (2)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `production-boot-smoke.mjs` | `smoke:production-boot` | Boots the packaged production server and runtime scheduler from `hud/dist/win-unpacked`: Next answers on loopback, a queued agent task is claimed (fake `handleInput`), clean stop, `NOVA_PACKAGED=1` resolves to `%APPDATA%\Nova` (a fake APPDATA). | packaged build (`electron-builder --dir`) |
| `version-sync-smoke.mjs` | `smoke:version-sync` | `hud/package.json` version matches `NOVA_VERSION` (`V.XX` -> `0.XX.0`) and the auto-update wiring (feed config, updater module, Electron main) is present. | none |

### perf/ (4)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `idle-measure.mjs` | `perf:idle` | Measurement tool, not in any test chain. Starts the runtime and `next start` on a temp data dir with provider keys blanked, measures idle CPU with the page visible and hidden in Chromium, and runs correctness checks (request guard, WebSocket origin guard, SSE, same-origin POSTs) unless `--skip-checks`. | Playwright Chromium, HUD production build (built if missing) |
| `perf-client-polling-source-guard-smoke.mjs` | `smoke:perf-client` | Source check: HUD pollers (Spotify, notes, dev logs, missions) are visibility-gated with slow cadences; conversation persistence is debounced; dev-logs route answers 304. | none |
| `perf-ui-source-guard-smoke.mjs` | `smoke:perf-ui` | Source check: page-active controller, global animation pause, keyframes do not animate filter or blur, reduced motion, background video pauses, Electron DevTools gated behind `NOVA_DEVTOOLS`. | none |
| `server-idle-cost-smoke.mjs` | `smoke:perf-server` | Voice-loop failure backoff, async `recordMic`, TTL-cached system metrics, DPAPI failure cache of at least 10 minutes, job ledger and scheduler idle paths take no write lock. | none |

### quality/ (6)

`chatkit-release-baseline.json` holds the thresholds for the ChatKit release gate.

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `src-chatkit-release-readiness-smoke.mjs` | `smoke:src-chatkit-release-readiness` | ChatKit release gate: reliability, p50/p95/p99 and quality score against the baseline, using recent `archive/logs/chatkit-events.jsonl` if it has at least 8 serve events, else `fixtures/chatkit-release-events.jsonl`. Writes `archive/logs/chatkit-release-readiness-report.json` in the repo. | build |
| `src-eval-regression-smoke.mjs` | `smoke:src-eval` | Regression gates: runs the transport smoke and prompt fixtures, mission quality and tool behavior checks, and confirms the gate scripts are still wired. Spawns child smokes. | none |
| `src-mission-quality-smoke.mjs` | `smoke:src-missions` | Mission quality module exposes scoring, guardrails and tunables; workflow output applies guardrails before dispatch; legacy fallback output path removed. | none |
| `src-prompt-budget-smoke.mjs` | `smoke:src-prompt` | Prompt budget constants and helpers; chat handler uses budgeted context and history; mission AI executors are bounded before LLM calls; with a fresh-install persona, per-turn context (memory recall, short-term context) reaches the final user turn and the static system prompt stays identical between turns. | none |
| `src-release-readiness-smoke.mjs` | `smoke:src-release-readiness` | Source check: the release chain includes the required gates (Coinbase, Telegram, Discord, scheduler soak, isolation closure), the verify script exists, version, release and env docs are updated. | none |
| `src-response-quality-guard-smoke.mjs` | `smoke:src-response-quality` | Inbound sanitizer (ANSI, bracketed paste), vague-request classifier, readability repair, reply normalizer. | none |

### routing/ (52, plus a runner)

`run-multilayer-checkpoint.ps1` runs 23 routing and tool-loop suites in one pass and prints pass/fail per suite
(`-StopOnFail` stops at the first failure). It has no npm script. It is the only runner for several files marked
"none" below.

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `src-routing-arbitration-smoke.mjs` | `smoke:src-routing` (first step) | The active provider always wins: no failover on cost, latency, tool bias or preferred-provider hints. | build |
| `src-operator-routing-handlers-smoke.mjs` | `smoke:src-operator-routing-handlers` | Mission-context cancel and confirm; weather confirm yes, no and stale pending confirmation. | none |
| `src-operator-finalization-smoke.mjs` | `smoke:src-operator-finalization` | Finalizer derives user/session context, stamps org-chart hints, writes dev-log payloads, logs mapped errors, swallows shadow-eval rejection. | none |
| `src-operator-preflight-smoke.mjs` | `smoke:src-operator-preflight` | Preprocess bypass, dedupe gate, TTL-cached runtime snapshot per user, runtime selection, fallback when the preferred provider is not ready. | none |
| `src-operator-dispatch-smoke.mjs` | `smoke:src-operator-dispatch` | Each route (chat, Spotify, Polymarket, Coinbase, Gmail, Telegram, Discord, calendar, reminders, web research, crypto, market, files, diagnostics, voice, TTS) delegates to its worker and updates short-term context only on success; policy approval grant forwarding. | none |
| `src-operator-context-hints-smoke.mjs` | `smoke:src-operator-context-hints` | Assistant cancel clears context; each lane's contextual follow-up emits its hint summary. | none |
| `src-operator-worker-executors-smoke.mjs` | `smoke:src-operator-worker-executors` | Every lane maps to an executor kind and uses its dedicated worker, never the generic execute path; force flags can be disabled. | none |
| `src-operator-intent-signals-smoke.mjs` | none | Direct and follow-up intent detection for the media, finance, comms, productivity and system lanes (including Spotify vs YouTube). | none |
| `src-operator-lane-registry-consistency-smoke.mjs` | none | Lane ids and route flags are unique; each lane maps to a registry worker and declares intent and follow-up wiring. | none |
| `src-operator-lane-wiring-smoke.mjs` | none | Lane snapshot reader covers all lanes; mission-context timestamp comparison; dispatch input maps route decisions to lane keys. | none |
| `src-operator-route-decisions-smoke.mjs` | none | Lane precedence: YouTube vs Spotify, earliest follow-up wins, voice over TTS, no match. | none |
| `src-org-chart-delegation-smoke.mjs` | none | Delegation envelopes (operator, council, manager, worker) for every lane, failure normalization, policy approval gate, required scoped ids, parallel isolation. | none |
| `src-org-chart-routing-registry-smoke.mjs` | none | Each request type resolves to the right manager and worker; missions go to the planning council; unmatched routes fall back to diagnostics. | none |
| `src-org-chart-live-isolation-smoke.mjs` | `smoke:src-org-chart-live` | Real org-chart flow with a fake model stays isolated across two users sharing one conversation id. | none |
| `src-multilayer-agentic-completeness-smoke.mjs` | none | Source check: every operator lane has registry route/response tokens and the missions agent has its handlers, policy and intent helpers; prints a completeness %. | none |
| `src-short-term-context-policies-smoke.mjs` | none | Every lane domain has a context policy, unknown domains fall back to the assistant policy, follow-up / cancel / new-topic classification. | none |
| `src-short-term-context-persistence-smoke.mjs` | `smoke:src-short-term-context-persistence` | Calendar, voice and TTS short-term context persists per user; clearing is scoped by user and conversation. | none |
| `src-platform-contract-persistence-smoke.mjs` | `smoke:src-platform-contract-persistence` | Mission, weather and crypto follow-up state persists per user and conversation, survives a fresh module load, clears scoped. | none |
| `src-platform-contract-live-smoke.mjs` | `smoke:src-platform-contract-live` | Real `handleInput` with a fake model: mission confirmation stays on one scoped thread; artifacts and mission state are user-scoped. | none |
| `src-policy-approval-store-smoke.mjs` | `smoke:src-policy-approval-store` | Policy approval grants are user + conversation scoped, one-time, and stored in SQLite. | none |
| `src-plugin-isolation-smoke.mjs` | `smoke:src-plugin-isolation` | Plugin file/network tools are denied without grants, allowed with grants, and the denylist wins over the allowlist. | build |
| `src-delegated-chat-worker-contract-smoke.mjs` | none | Delegated chat worker normalizes summaries to the canonical contract, requires `executeChatRequest`, keeps diagnostics. `docs/token-efficiency/PROGRESS.md` reports P31-C4 failing (expects a `fallbackReason` field that does not exist). | none |
| `src-delegated-domain-service-smoke.mjs` | `smoke:src-delegated-domain` | Delegated domain service normalizes scoped summary metadata and reports scoped failure metadata. | none |
| `src-handle-input-special-workers-smoke.mjs` | none | `handleInput` sends memory updates to the memory worker and shutdown requests to the shutdown worker. | none |
| `src-calendar-domain-service-smoke.mjs` | `smoke:src-calendar-domain` | Calendar service: scoped agenda, direct reschedule, scoped error without context, Google Calendar create and update stay on the calendar lane. | none |
| `src-calendar-live-smoke.mjs` | `smoke:src-calendar-live` | Real `handleInput` with a fake model and stubbed calendar worker: calendar prompts stay on the calendar lane; artifacts are user-scoped. | none |
| `src-diagnostics-domain-service-smoke.mjs` | `smoke:src-diagnostics-domain` | Diagnostics service: scoped context required, status returns a runtime snapshot, unsupported prompts stay on the lane. | none |
| `src-discord-domain-worker-smoke.mjs` | `smoke:src-discord-domain` | Discord service: per-user webhook targets, secrets redacted in errors, normalized failure codes, channel id validation. | none |
| `src-files-domain-service-smoke.mjs` | `smoke:src-files-domain` | Files service: scoped context required, list goes through the `ls` tool adapter, unsupported prompts stay on the lane. | none |
| `src-gmail-domain-service-smoke.mjs` | `smoke:src-gmail-domain` | Gmail service with stub tools: capabilities summary, unread list through the Gmail tool adapter, drafts need explicit confirmation. | none |
| `src-market-domain-service-smoke.mjs` | `smoke:src-market-domain` | Market service: scoped query and success envelope, short-term follow-up context, deterministic failure without context. | none |
| `src-market-closure-smoke.mjs` | `smoke:src-market-closure` | Market worker scopes `stopSpeaking` and `speak` by `userContextId`. | none |
| `src-market-nonweather-live-smoke.mjs` | `smoke:src-market-live` | Real `handleInput` with a fake model: non-weather market prompts go to the market lane, weather prompts to the weather lane, artifacts are user-scoped. | none |
| `src-missions-domain-service-smoke.mjs` | `smoke:src-missions-domain` | Missions service: scoped context, pending and successful build responses mapped, failures stay on the lane. | none |
| `src-notes-domain-smoke.mjs` | none | A note is created from a HUD-scoped command; notes stay isolated per user. | none |
| `src-polymarket-domain-service-smoke.mjs` | `smoke:src-polymarket-domain` | Polymarket service with a mocked `fetch`: query and envelopes, follow-up context, price, leaderboard and compare actions, alerts through the mission builder. | none |
| `src-polymarket-live-smoke.mjs` | `smoke:src-polymarket-live` | Real `handleInput` with a fake model: follow-up hints across a thread; artifacts are user-scoped. | none |
| `src-reminders-domain-service-smoke.mjs` | `smoke:src-reminders-domain` | Reminders create / update / remove without generic delegation; follow-up state persists across a fresh module load and is user-scoped. | none |
| `src-reminders-live-smoke.mjs` | `smoke:src-reminders-live` | Real `handleInput` with a fake model: follow-up hints, user-scoped state, the reminders worker writes scoped transcripts and logs. | none |
| `src-shutdown-domain-service-smoke.mjs` | `smoke:src-shutdown-domain` | Shutdown service requires scoped context, stops and replies, and exits the process only when enabled. | none |
| `src-telegram-domain-service-smoke.mjs` | `smoke:src-telegram-domain` | Telegram config resolved per user, normalized failure envelope, token-like provider errors redacted. | none |
| `src-telegram-lane-isolation-stress-smoke.mjs` | `smoke:src-telegram-lane-isolation` | Concurrent Telegram lane runs keep user contexts isolated. | none |
| `src-voice-tts-domain-service-smoke.mjs` | `smoke:src-voice-tts-domain` | Voice and TTS commands update scoped state and speak without generic delegation; unsupported prompts stay on the lane; explicit scoped errors. | none |
| `src-voice-tts-live-smoke.mjs` | `smoke:src-voice-tts-live` | Real `handleInput` with a fake model: voice and TTS lanes use the real workers; artifacts stay user-scoped across shared conversation ids. | none |
| `src-voice-tts-runtime-isolation-smoke.mjs` | `smoke:src-voice-tts-runtime` | Per-user voice runtime state (busy, muted, voice, wake suppression) stays isolated across async contexts. | none |
| `src-voice-tts-transport-smoke.mjs` | `smoke:src-voice-tts-transport` | Source check: voice runtime resolves a scoped user before emitting state, no unscoped voice transitions, `handleInput` can inject voice and TTS workers. | none |
| `src-web-research-domain-service-smoke.mjs` | `smoke:src-web-research-domain` | Web research service: scoped context, `web_search` through a stubbed provider adapter, unsupported prompts stay on the lane. | none |
| `src-tool-loop-smoke.mjs` | `smoke:src-tools` | Tool module layout, registry and execution parity, exec approval modes (ask / auto / off), dangerous tools blocked by default, link understanding, tool output caps (huge `read` and `memory_get` results paged by following their truncation markers rebuild the source exactly; huge `exec` and unregistered-tool output capped with a how-to marker). | build |
| `src-tool-loop-guardrails-smoke.mjs` | `smoke:src-tool-loop-guardrails` | Tool-loop timeout constants, budget clamping, per-step tool-call cap, timeout classifier, guardrail hooks and production defaults in source. | none |
| `src-tool-loop-concurrency-smoke.mjs` | `smoke:src-tool-loop-concurrency` | Simulated concurrent tool loops respect per-turn time budgets; per-user aggregation stays partitioned. | none |
| `src-tool-runtime-bootstrap-smoke.mjs` | `smoke:src-tool-runtime-bootstrap` | Tool runtime bootstrap failure is bounded (no warning loop, no `npm.cmd` EINVAL spawn). | none |
| `src-transport-stability-smoke.mjs` | `smoke:src-transport` | Runtime shell wiring, HUD state and stream event contracts, voice-loop guards, inbound dedupe, reply normalization, wake word follows the assistant name. | none |

### runtime/ (9)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `hud-gateway-performance-smoke.mjs` | `smoke:runtime-hud-gateway-performance` (also in `smoke:src-transport`) | HUD WebSocket gateway: stream deltas batched per user, slow consumers closed, backpressure-aware send, duplicate state chatter compacted. | none |
| `hud-policy-approval-handoff-smoke.mjs` | `smoke:runtime-hud-policy-approval-handoff` | A HUD op token grants a persisted, session-scoped policy approval; messages without a token do not. | none |
| `spotify-user-context-isolation-smoke.mjs` | `smoke:runtime-spotify-isolation` | Source check: playback route scopes to the local identity and verifies the runtime token; Spotify adapter keeps scoped auth headers; runtime snapshot has a Spotify block. | none |
| `src-scheduler-soak-latency-smoke.mjs` | `smoke:src-scheduler-soak-latency` | Concurrent soak of the chat request scheduler: queue and end-to-end latency within p95/p99 targets; saturation returns `queue_full` with a bounded `retryAfterMs`. Tunable with `NOVA_SMOKE_SCHED_*`. | none |
| `dev-conversation-log-retention-smoke.mjs` | none | Dev conversation log writes only under the user's scoped path, skips without a user, and no global `.user/logs` paths remain. | none |
| `hud-thinking-orb-invariant-smoke.mjs` | none | Source check: the gateway emits thinking state immediately for `hud_message` and keeps it visible for a minimum time. | none |
| `integration-api-bridge-smoke.mjs` | none | Source check: the shared integration bridge is deleted; Spotify and YouTube services own timeout and retry; the missions lane uses its service adapter. | none |
| `spotify-intent-routing-smoke.mjs` | none | Source check: Spotify intent phrases, Spotify/YouTube lanes route to their workers, no desktop fallback, no hard-coded playlists. | none |
| `openai-request-tuning-smoke.mjs` | `smoke:openai-request-tuning` | OpenAI request tuning: GPT-5.6 strict passes send `reasoning_effort: "low"` (the models reject `"minimal"`), older gpt-5 keeps `"minimal"`, gpt-5-pro sends none, non-gpt-5 and non-OpenAI get no tuning. | none |

### scheduler/ (14)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `src-scheduler-stability-smoke.mjs` | `smoke:src-scheduler` (first step) | Source check: no overlapping ticks, observability endpoint, run outcome accounting, leader election fields, queue-worker mode, user-scoped rate-limited queue APIs, queue metrics in the missions HUD. | none |
| `src-scheduler-core-performance-smoke.mjs` | `smoke:src-scheduler-core-performance` | Scheduler core reloads each active user and keeps per-user enqueue caps while round-robining users. | none |
| `execution-tick-performance-smoke.mjs` | `smoke:execution-tick-performance` | Execution tick picks a fair round-robin batch across users and loads each user's missions once per tick. | none |
| `src-scheduler-store-smoke.mjs` | `smoke:src-scheduler-store` | SQLite mission store: versioned schema, atomic writes, corruption recovery; scheduler is enqueue-only. | none |
| `src-scheduler-delivery-smoke.mjs` | `smoke:src-scheduler-delivery` | Day-lock guard for daily triggers, retry backoff and max retries, `runKey` attempts in the run log and metrics. | none |
| `src-scheduler-skills-snapshot-smoke.mjs` | `smoke:src-scheduler-skills` | Mission skill snapshots are fingerprinted and carried through the scheduler, execution tick, manual triggers and workflow context; Coinbase skill doc exists. | none |
| `src-scheduler-coinbase-pnl-comment-delivery-smoke.mjs` | `smoke:src-scheduler-coinbase-pnl-comment` | Scheduled delivery payload includes the personality PnL comment line. | none |
| `src-coinbase-workflow-step-artifact-smoke.mjs` | `smoke:src-coinbase-workflow-step` | Coinbase mission step: generation emits a `coinbase` step, execution persists the artifact and re-reads it next run, telemetry is user-safe. | none |
| `src-coinbase-workflow-step-isolation-smoke.mjs` | `smoke:src-coinbase-workflow-step-isolation` | Coinbase step artifacts cannot be read across users. | none |
| `src-discord-delivery-smoke.mjs` | `smoke:src-discord-delivery` | Discord delivery with a fake `fetch`: URL validation (no private IPs), retry classification, partial outcomes, encrypted webhook storage, timeouts, 429 backoff, concurrency cap, cross-user isolation, API route checks, scheduler outage safety. | none |
| `src-telegram-delivery-smoke.mjs` | `smoke:src-telegram-delivery` | Telegram delivery with a fake `fetch`: HTML sanitizing, retry after timeout, multi-chat partial failures, chunking long messages by section. | none |
| `src-mission-output-contract-smoke.mjs` | `smoke:src-mission-output-contract` | Mission output formatting: Coinbase JSON to bounded readable text, Telegram and Slack dispatch, NBA score and quote parsing, morning briefing sections survive errors and noisy input. | none |
| `src-mission-agent-runtime-smoke.mjs` | `smoke:src-mission-agent-runtime` | Mission agent executors: deterministic supervisor merge order, sync and async subworkflows with scoped context, child failure mapping. | none |
| `src-mission-ts-checks-smoke.mjs` | `smoke:src-mission-ts-checks` | Transpiles and runs the HUD mission `*.check.ts` files (graph shape, agent executors, versioning). | none |

### security/ (6)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `local-api-guard-smoke.mjs` | `smoke:security-guard` | Local request guard (foreign Host / Origin / Sec-Fetch-Site rejected, loopback allowed), provider base-URL rules (a stored key is never sent to a request-supplied URL), WebSocket origin check on a real local `ws` server, ChatKit tracing and store off. | none |
| `src-security-hardening-smoke.mjs` | `smoke:src-security` | Private-IP classifier and SSRF guard block internal targets; prompt-injection pattern detection; external-content wrapper sanitizes nested markers. | build |
| `src-runtime-hardening-regression-smoke.mjs` | `smoke:src-runtime-hardening` (also in `smoke:src-security`) | Source check: no blocking `execSync` in the launcher, async argv spawn for voice capture, no shell-string `execSync` in tool bootstrap, metrics broadcast scoped by `userContextId`. | none |
| `src-security-regression-net-smoke.mjs` | `smoke:src-security-regression` | Network and security guards, transport and tool-policy regressions, scheduler reliability, safe runtime defaults, and the release chain still has the security, memory, routing and isolation gates. | none |
| `src-user-context-isolation-smoke.mjs` | `smoke:src-user-isolation` | Per-user scheduler concurrency, supersede keys and inflight caps; user-scoped HUD session keys; transcript and memory isolation; SessionStore scope; gateway ownership; org-chart scoped ids. | build |
| `src-identity-profile-divergence-smoke.mjs` | `smoke:src-identity-profile-divergence` | Identity profiles stay distinct per user under concurrent scheduler load. | none |

### token-efficiency/ (4, plus a helper)

Stage 0 of the token-efficiency project (usage tracking and an offline baseline). Background: `docs/token-efficiency/BASELINE.md`.

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `token-baseline-harness.mjs` | `smoke:token-baseline` | Drives the real runtime (routing, prompt assembly, completions, tool loops, a mission run) with fake OpenAI-compatible and Anthropic models, captures every model request and reports size, tool-schema share, stable prefix and simulated provider cache reads/writes per scenario. Checks the static system prompt is byte-identical on every call, per-turn context rides on the final user turn, Claude requests carry `cache_control` breakpoints, every call after the first reads from the simulated cache, cache tokens reach `llm_usage` and the session totals, Gmail tools get the runtime's user in both tool loops, and in the large-read scenario a 3,000-line `read` reaches the model as one capped window with a paging marker. Fails on any real network attempt. `--out <file>` saves the JSON results. | build |
| `usage-normalize-smoke.mjs` | `smoke:token-usage` | Provider `usage` payloads (OpenAI, Gemini, xAI, Anthropic including SSE events) normalize to total input, output, cached and cache-write tokens; malformed payloads; summing; usage source resolution. | none |
| `cost-math-smoke.mjs` | `smoke:token-usage` | Cost math in `src/providers/pricing`: every provider table is priced, cached / cache-write / uncached split, rate fallbacks, clamping, unknown model returns null, two pinned prices. | none |
| `llm-usage-ledger-smoke.mjs` | `smoke:token-usage` | `llm_usage` ledger: one row per call with cost, never throws, usage observer, retention pruning (`NOVA_LLM_USAGE_RETENTION_DAYS`), user purge; the agent-task service stores tokens, cache split and cost for failed and approval-paused attempts, cumulatively. | none |
| `token-harness-lib.mjs` | - | Helper for the harness: network guard, fake OpenAI-compatible client, fake Anthropic endpoint, request metrics. Not a smoke. | - |

### verification/ (1)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `verify-release-readiness.mjs` | `verify:release-readiness` | Runs `npm run smoke:src-release` and exits with its status. | same as `smoke:src-release` |

### workstreams/ (4)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `src-workstream-d-latency-smoke.mjs` | `smoke:src-workstream-d-latency` | Fast-lane greeting skips tool bootstrap, web intents enable tools, tool policy, latency stage telemetry, fast-lane prompt budget, timeout wrapper aborts work. | none |
| `src-workstream-e-session-key-smoke.mjs` | `smoke:src-workstream-e-session-key` | Session key stays stable across optimistic / server conversation id remaps (one runtime check, the rest source checks on the HUD chat hooks). Skips (exit 0) without a user id. | user id |
| `src-workstream-b-live-smoke.mjs` | `smoke:src-workstream-b-live` | Real `handleInput` turns: one-word, bullet-count, JSON-only and sentence-count compliance. Skips (exit 0) without a user id. Possibly stale: needs a provider key for that user, which the forced temp data dir does not have. | user id, API key, network |
| `src-workstream-d-live-latency-smoke.mjs` | `smoke:src-workstream-d-live-latency` | Real 10-turn mixed HUD workload with latency percentiles. Exits 1 without a user id or provider key. Possibly stale: same temp data dir problem, and its user lookup still checks for legacy `integrations-config.json` files. | user id, API key, network |

### worktree/ (1)

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `worktree-smoke.mjs` | `smoke:worktree` | Branch names generated from prompts (feat / fix / refactor / chore / docs, sanitizing, fallback, length limit). Creating and deleting worktrees is not exercised, although the header says so. | Node type stripping (the script passes `--experimental-strip-types`) |

### fixtures/

`chatkit-release-events.jsonl`: fallback event data for `quality/src-chatkit-release-readiness-smoke.mjs`.

### scripts/coinbase/smoke/ (12)

These write their SQLite files to `scripts/coinbase/.tmp/` in the repo, not to the temp data dir.

| File | npm script | What it checks | Needs |
| --- | --- | --- | --- |
| `src-coinbase-storage-smoke.mjs` | `smoke:src-coinbase-storage` | `CoinbaseDataStore`: idempotency claims, OAuth token save/read, snapshots, report history, audit log. | build |
| `src-coinbase-chat-fast-path-smoke.mjs` | `smoke:src-coinbase-chat` | Crypto intent detection (tickers, aliases, typos, weather is not crypto) and fast-path replies with stub Coinbase tools, scoped per user. | build |
| `src-coinbase-mission-runtime-smoke.mjs` | `smoke:src-coinbase-mission-runtime` | Source check: Coinbase mission build, execution and fetch paths, retry and dead-letter, run metadata in thread writes and reads, Telegram hydration. | none |
| `src-coinbase-command-matrix-smoke.mjs` | `smoke:src-coinbase-command-matrix` | 29 Coinbase command cases through the fast path with stub tools, including disabled categories and user isolation. | build |
| `src-coinbase-report-delivery-retention-smoke.mjs` | `smoke:src-coinbase-report-delivery-retention` | Report renderers, output dispatch channels and email adapter, export and retention routes enforce auth and user scope, scoped pruning. | build |
| `src-coinbase-observability-resilience-smoke.mjs` | `smoke:src-coinbase-observability-resilience` | Structured logs with ids, latency and error metrics, alert triggers, circuit breaker, no cross-user log leakage. | build |
| `src-coinbase-privacy-consent-smoke.mjs` | `smoke:src-coinbase-privacy-consent` | No investment disclaimer in reports or fast-path replies, consent-gated transaction access, privacy settings, scoped secure delete. | build |
| `src-coinbase-integration-surface-smoke.mjs` | `smoke:src-coinbase-integration-surface` | Parser and mapper units, HTTP retry and error mapping, per-user OAuth connect / refresh / revoke, runtime isolation under load, mission idempotency, UI/API hooks, CI wiring. The live probe uses a mocked `fetch` unless `NOVA_COINBASE_LIVE_TESTS=1` or `NOVA_COINBASE_API_KEY` + `NOVA_COINBASE_API_SECRET` are set. | build; API key and network for the opt-in live probe |
| `src-coinbase-rollout-controls-smoke.mjs` | `smoke:src-coinbase-rollout-controls` | Feature flag off, alpha/beta cohorts, deterministic ramp percentage, kill switch, telemetry go/no-go thresholds, rollout KPI report. | build |
| `src-coinbase-mission-contracts-smoke.mjs` | `smoke:src-coinbase-mission-contracts` | Mostly source checks: prompts map to Coinbase primitives, authenticated data in the scheduler path, data gating, retry and dead-letter, mission metadata in transcripts. | build |
| `src-coinbase-pnl-personality-comment-smoke.mjs` | `smoke:src-coinbase-pnl-personality` | PnL personality comments: 10 comments for moves of 10% or more, none below the threshold, deterministic per seed. | none |
| `src-coinbase-readiness-gate.mjs` | `smoke:src-coinbase-readiness` | Runs `smoke:src-coinbase-rollout-controls` with `NOVA_COINBASE_READINESS_MODE=1`. | build |

## Browser tests (Playwright)

`hud/tests/smoke/` holds Playwright specs, configured in `hud/playwright.config.ts`. Run them from `hud/` with
`npm run test:smoke` (also `test:smoke:ui`, `test:smoke:headed`).

| File | What it checks |
| --- | --- |
| `agent-tasks.spec.ts` | Agent Tasks module on the home page (header, create button, stats, empty state) and `/api/agent-tasks` create, reject invalid, list, pause/play/stop actions, delete, and the max-concurrent limit. |

Playwright starts `npm run dev` on port 3000 (or reuses a running server). That server uses the normal data dir
(`<repo>/.user` in dev), not a temp dir, so the API tests create and delete tasks in your real `nova.db`.

## Backlog and opt-in checks

- Coinbase unit/integration tests (`scripts/coinbase/tests/*.mjs`) never existed; the dead `test:coinbase*` npm scripts were
  removed. Real Coinbase unit tests are backlog. Coverage today is the `smoke:src-coinbase-*` suites.
- `npm run smoke:live-latency` is the live 30-turn conversation quality/latency check. It is NOT in the release chain
  (`smoke:src-release`). It skips with exit 0 unless `NOVA_LIVE_LATENCY=1`; when enabled it reads the provider key from the
  real `nova.db` read-only and runs the conversation in a temp data dir. See `conversation/live-latency-check.mjs`.
- 28 smoke files (plus the `.ps1` runner) have no npm script of their own: every file marked "none" above. Eight run
  through `routing/run-multilayer-checkpoint.ps1`, `src-mission-persistence-smoke.mjs` runs inside
  `no-real-data-writes-smoke.mjs`, and the 30-turn check runs through `smoke:live-latency`; the rest only run by hand.

## Adding a smoke

1. Put it in the subfolder for its area (`scripts/smoke/<area>/`). If no folder fits, create one and add a section here.
2. Name it `<prefix>-<what>-smoke.mjs` (prefixes such as `src-`, `hud-`). Keep names stable.
3. Make `import "../lib/isolated-data-dir.mjs"` the first import if it can touch `src/db`, runtime stores or user files.
   Never read or write the real `.user/` data. Use fakes for providers and integrations; gate anything live behind an
   env var and skip with exit 0 when it is not set.
4. Print one `PASS` / `FAIL` / `SKIP` line per check and exit non-zero on failure.
5. Add an npm script in the root `package.json` (`smoke:<area>-<name>`), and add it to an aggregate script if it
   belongs in one (for example `smoke:src-release`).
6. Add a row to the table for its folder in this file.
