# Handoff — V.63 Alpha (2026-09-20)

Paused by the user mid-project. A new Claude session should be able to resume from this file alone.
Read order: this file → `sqlite-contract.md` (next project, fully specified) → `sprint2-contract.md` (finished, reference only).

**Nothing is committed.** Repo rule (`CLAUDE.md`): *Build, test, prepare. User commits. Always.* Do not commit or push.

---

## 1. Where we stopped (one paragraph)

Two things happened this session:

1. **Phantom Roadmap Sprint 2 (= Phase 2, Agent Tasks UI) is DONE and verified** (details §2).
2. **"Local-first SQLite + encrypted secrets" is DESIGNED but NOT STARTED in code.** The contract is written (`sqlite-contract.md`). Phase 1 workers W1 (DB foundation) and W2 (encryption unify) were launched and then **stopped by the user before writing any files** — confirmed: `src/db/` and `src/security/` do not exist. The next action is to relaunch W1 and W2 in parallel (§5).

Version was bumped to **V.63 Alpha** (`hud/lib/meta/version/index.ts`, history entry + `NOVA_VERSION`; `CLAUDE.md` "Current" line). The V.63 entry states truthfully that SQLite/encryption are designed, not implemented.

---

## 2. Sprint 2 — completed work (verified)

Scope decided with the user: Agent Tasks module + create-task modal; Notes renamed and kept; Active Agents Monitor and `/tasks/[id]` page **not** built (out of scope).

| Area | Files (under `hud/` unless noted) |
|---|---|
| Rename | `app/home/components/placeholder-2-home-module.tsx` → `notes-home-module.tsx` (`NotesHomeModule`; it is the live Notes feature, not a placeholder). `placeholder-1-home-module.tsx` deleted; replaced by `agent-tasks-home-module.tsx` (`AgentTasksHomeModule`). |
| Types / store | `lib/agents/types.ts`, `task-store.ts` (per-user JSON at `.user/user-context/<userId>/agent-tasks/agent-tasks.json`, atomic writes, per-user mutex), `task-events.ts` (globalThis bus), `task-stats.ts` (client-safe stats) |
| Runner | `lib/agents/task-runner.ts` — **SIMULATED** (1s ticks; priority→FIFO promotion; max 5 concurrent; `[sim:fail]` in a prompt forces failure). Phase 4 of the Phantom roadmap replaces it with real agent processes. |
| API | `app/api/agent-tasks/route.ts` (GET/POST/PATCH `{id,action:play|pause|stop}`/DELETE), `app/api/agent-tasks/stream/route.ts` (SSE). Auth via `requireLocalUser` (`lib/auth/local-user.ts`); rate-limit policies `agentTasksRead/Write` added in `lib/security/rate-limit/index.ts`. |
| Hook | `app/home/hooks/use-agent-tasks.ts` → `{ tasks, stats, loading, error, connection, refresh, createTask, runAction }` (SSE with 6s polling fallback) |
| UI | `components/agents/task-card.tsx`, `task-list.tsx`, `create-task-modal.tsx` |
| Smokes | `scripts/smoke/agent-tasks/agent-tasks-smoke.mjs` (12 checks), `agent-tasks-ui-smoke.mjs` (8 checks); run both with `npm run smoke:agent-tasks` (root) |

Deviations from what the user originally answered (already reported to them):
- Stored as **JSON files, not SQLite** (hud had no SQLite dep). It sits behind a store interface; workstream **W5** of the SQLite project moves it to SQLite.
- Added a 6th status `cancelled` (user Stop) so a stop isn't shown as a failure.
- Permission mode is stored/displayed only (no enforcement until Phantom Phase 4).

Verified at the time: both smokes pass; sprint paths typecheck clean; manager review PASS on A, B, C. **Not verified:** nothing was tested in a browser (dev server was broken by others' in-progress work) — light/dark theme and 1024×768 / 1920×1080 layout were code-read only. A short low-severity fix pass was applied after review (modal `role="dialog"`, stale error reset on reopen, light-mode badge contrast, live "Started Xs ago").

Known, deliberately unfixed minor items: runner does one file read per second per user even when idle; a dev hot-reload can leave a stale runner interval closure (restart clears); create-task modal has no focus trap.

---

## 3. The other author (IMPORTANT working-tree context)

The user has a **parallel session/author actively editing this same working tree** (Supabase removal, boot-up screen removal, auth → `requireLocalUser`, etc.). At handoff time `git status` shows ~179 changed entries; **most are NOT ours.** Rules for a resuming session:
- Before editing any pre-existing file: `git status` + check mtime; re-read immediately before editing; never revert other changes.
- Ours are only: the Sprint 2 files in §2, the `NotesHomeModule` rename, the `rate-limit/index.ts` additions, `hud/lib/meta/version/index.ts`, `CLAUDE.md` version line, `package.json` `smoke:agent-tasks` script, and `docs/handoff/**`.
- Untracked `hud/lib/security/encryption.ts` (async, raw key in `~/.nova-encryption-key`) is the other author's and **shadows** the real module `hud/lib/security/encryption/index.ts`, breaking ~25 callers (`Promise<string>` type errors in `lib/integrations/**`). The user's later decision supersedes it → W2 deletes it. It was still present at handoff.
- At last check the dev server on :3000 returned 500 (`settings-modal.tsx` imported the deleted `@/lib/media/bootMusicStorage`). That may have been fixed since — re-check.
- Three files still had type imports of the deleted `@/lib/supabase/server`: `hud/lib/integrations/{phantom/service,polymarket/server,runtime/snapshot}.ts`.

---

## 4. The user's decisions for the SQLite project (binding)

The user's goals: **all user data lives only on their PC (SQLite), and every API key/secret they enter must be encrypted and safe** — they don't want anyone thinking the software steals API keys.

1. **Master key = Windows DPAPI-wrapped.** Random 32-byte key generated once, wrapped with DPAPI `CurrentUser`, blob stored in the data dir. No password prompt, Windows-only is OK, no native dep (PowerShell/.NET, secret via stdin only). Unwrap once per process, cache in memory → API stays **synchronous**.
2. **`better-sqlite3` everywhere** (Next server in `hud/` and the agent runtime in root `src/`).
3. Earlier standing instruction from the user for this session: use a **management subagent + worker subagents, verify with the management agent, then continue; don't ask permission; only speak to the user with a question or when done.** (Agent IDs don't survive between sessions — spawn a new management agent and point it at the contract.)

## 5. NEXT STEPS — resume exactly here

Contract: `docs/handoff/2026-09-20-v63/sqlite-contract.md` (260 lines; §12 has the ownership matrix and order).

1. **Relaunch Phase 1 in parallel:**
   - **W1 — DB foundation** (`src/db/**` JS + `.d.ts`, migrations as JS modules, `nova.db` in the data dir with WAL/busy_timeout, importer framework with stub importer/migration files so W3–W6 each own one file, durable better-sqlite3 install for hud + root, `serverExternalPackages` in Next config, W1 smokes in `scripts/smoke/local-db/`).
   - **W2 — Encryption unify** (shared sync core `src/security/secrets/`: AES-256-GCM, `nv1:` prefix, HKDF data key, DPAPI-wrapped master key, fail-closed `SecretsUnavailableError`, back-compat decrypt of both legacy formats (`iv.tag.ct` env-key format and the draft `salt:iv:tag:ct`), redaction helper; `hud/lib/security/encryption/index.ts` becomes a thin server-only re-export with the exports existing callers use; **delete** `hud/lib/security/encryption.ts`; W2 smokes).
2. Manager agent verifies W1 + W2 (read files, run smokes, typecheck gate). W2 must **lower** the hud error count.
3. **Phase 2 in parallel:** W3 integrations config/tokens + agent-sync; W4 missions + job ledger (SQLite transactions with `BEGIN IMMEDIATE`; the old Supabase claim/lease/heartbeat/complete/fail SQL is at `git show HEAD:hud/supabase/migrations/*.sql`) + telemetry/versioning/dead-letter/run-log; W5 notes + agent-tasks + calendar + small stores; W6 chat threads/messages/memory/tool_runs + runtime Supabase leftovers.
4. **Phase 3 — W7:** Supabase leftovers/scripts (`scripts/cleanup-supabase-auth.mjs`, `scripts/fix-auth-final.mjs`, several smokes, `hud/tsconfig.gmail-tests.json`, ~15 `src/runtime/**` files), dependency cleanup, security audit (no outbound calls that could carry keys other than the user's own chosen provider calls; disable Next telemetry with `NEXT_TELEMETRY_DISABLED=1`), docs (`docs/security/local-data.md`), final full verification. End state: hud typecheck = 0 errors.

### Assumptions in the contract that still need the user's confirmation
1. DPAPI makes secret storage **Windows-only**.
2. `memory.db` and the Coinbase DB stay separate SQLite files but move under the data dir; only the rest goes into `nova.db`.
3. Markdown workspace documents stay as files.
4. `hud/electron/main.js` only loads `http://localhost:3000` (production path points at a static `out/` that can't serve API routes) — so the app isn't an offline bundle yet; packaging requirements are documented, not attempted.
5. The old plaintext `~/.nova-encryption-key` is purged only after every legacy value is migrated.
6. Honest limit to tell the user: local encryption defeats copied-database/backup/other-account access, but **not malware running as the same Windows user** (DPAPI is per-login). Don't overclaim in docs/UI.

---

## 6. Environment facts / commands

- **Root deps:** installed with `npm ci --ignore-scripts` (so native builds were skipped). The management agent fetched a prebuilt `better-sqlite3` 12.6.2 binary into root `node_modules` (gitignored) — it works on Node v24.13.0 but is **not durable**; W1 must fix the install path. hud has no `better-sqlite3` yet.
- **Root typecheck:** `cd /c/Nova && ./hud/node_modules/.bin/tsc --noEmit -p tsconfig.json` (clean; `rootDir: "src"` was added to the root `tsconfig.json` for the TS 6 warning). Root has no local `tsc` binary; use hud's 5.9.3.
- **hud typecheck:** `hud/tsconfig.json` has `ignoreDeprecations: "6.0"`, which hud's tsc 5.9.3 rejects (TS5103). Use the override config: `cd /c/Nova/hud && ./node_modules/.bin/tsc -p ../docs/handoff/2026-09-20-v63/tsconfig.hud-verify.json`. Baseline at handoff start of the SQLite project: 196 error lines (`tsc-baseline-hud.txt`); **184** at the moment this doc was written (the other author is still migrating). Gate: zero errors in files a workstream owns; total never rises; W7 ends at 0.
- **Sprint 2 smokes:** `cd /c/Nova && npm run smoke:agent-tasks`.
- **Data today:** per-user JSON under `.user/user-context/local-user/…` plus `better-sqlite3` in `src/memory/*`, `src/integrations/coinbase/store`, `scripts/coinbase/rollback-store.mjs`. Old Supabase tables (threads, messages, memories, thread_summaries, tool_runs, integration_configs, job_runs, scheduler_leases, job_audit_events) are described by the deleted migrations in `git show HEAD:supabase/migrations/*` and `HEAD:hud/supabase/migrations/*`.
- The job ledger (`hud/lib/missions/job-ledger/store.ts`) is currently **in-memory Maps**, not durable.
- Project preferences (from memory/CLAUDE.md): fix bugs one at a time and verify TypeScript clean before moving on; smoke tests go in `scripts/smoke/<own subfolder>`; remove confirmed-dead code instead of leaving stubs.
- The roadmap that started this is `PHANTOM_INTEGRATION_ROADMAP.md` (Phases, not Sprints; "Sprint 2" = Phase 2). Not started: Phase 4 multi-agent orchestration (real agent processes, worktrees), Active Agents Monitor, `/tasks/[id]` page.

## 7. Files in this folder
- `HANDOFF.md` — this file
- `sqlite-contract.md` — work contract for the SQLite + encryption project (W1–W7)
- `sprint2-contract.md` — finished Sprint 2 contract (reference)
- `tsconfig.hud-verify.json`, `tsc-baseline-hud.txt` — typecheck tooling/baseline
