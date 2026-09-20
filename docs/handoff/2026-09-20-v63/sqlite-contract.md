# Work Contract — Local-first SQLite + Encrypted Secrets

Author: management agent. Workers implement EXACTLY this; deviations → report to management first.
Goal: FULL swap from Supabase/JSON files to one local SQLite DB (`nova.db`); all user data lives only on the user's PC; every API key/secret is encrypted at rest with a DPAPI-protected master key; nothing phones home.

## 0. Ground truth (verified 2026-09-20) and assumptions

1. **Toolchain:** Node v24.13.0, npm 11.5.2, better-sqlite3 **12.6.2** (SQLite 3.51.2). Root `node_modules` had NO binding (`npm ci --ignore-scripts`). I fetched the prebuilt binary for Node 24 (ABI 137) with `cd C:/Nova && node node_modules/better-sqlite3/../prebuild-install/bin.js -r node` run inside `node_modules/better-sqlite3` → `build/Release/better_sqlite3.node`; `new Database(':memory:')` + WAL verified working. **Not durable across `npm ci --ignore-scripts`** → W1 fixes the install path (§2.4).
2. **DPAPI feasibility verified:** Windows PowerShell 5.1 `System.Security.Cryptography.ProtectedData` (CurrentUser) wraps 32 bytes → 262-byte blob in ~0.55 s via `execFileSync`. No native dependency needed.
3. **Two encryption modules exist and conflict:** `hud/lib/security/encryption/index.ts` (sync, `NOVA_ENCRYPTION_KEY`, `iv.tag.ct`, exports `encryptSecret`, `decryptSecret`, `decryptSecretWithMeta → {value,keyIndex}`, fallback keys `NOVA_ENCRYPTION_KEY_FALLBACKS`) is **shadowed** by untracked `hud/lib/security/encryption.ts` (async; raw key file `~/.nova-encryption-key`; `salt:iv:tag:ct`, PBKDF2-100k). Module resolution prefers the file → ~25 callers break (`lib/integrations/{store/server-store,spotify/tokens,youtube/tokens,gmail/tokens,google-calendar/tokens,runtime/agent-sync}`). User decision supersedes both: ONE sync module (§3).
4. **hud job ledger is currently IN-MEMORY** (`hud/lib/missions/job-ledger/store.ts`: `Map`s, `import "server-only"`, human-readable claim reasons) — not durable, single process. The old Supabase RPC semantics survive only in git history (`git show HEAD:hud/supabase/migrations/20260306_claim_job_run_with_limits.sql`, `20260307_{claim_job_run_lease_with_limits,complete_job_run,fail_job_run_with_retry,heartbeat_job_run_lease}.sql`, `20260303_execution_tick_running_reclaim.sql`, `20260301_job_runner.sql`, `20260302*_scheduler_*.sql`). Existing job-ledger smokes still mock Supabase RPCs → obsolete, must be rewritten (W4).
5. **Storage today** = per-user JSON/JSONL under `<workspaceRoot>/.user/user-context/<userId>/{state,logs,calendar,agent-tasks,transcripts}/…`, plus `hud/data/integrations-<userId>.json`, `hud/data/*.jsonl` fallbacks, `.user/memory.db` (better-sqlite3, `src/memory/*`), Coinbase store DB (`src/integrations/coinbase/store`). Workspace root helper pattern: cwd basename `hud` → parent (see `hud/lib/calendar/reschedule-store/index.ts`, `hud/lib/workspace/root`). `src/.user` is a forbidden location (`enforceWorkspaceUserStateInvariant` in `src/runtime/core/constants`) — keep that invariant.
6. **Supabase state:** `@supabase/*` is already absent from root and hud `package.json`; `hud/lib/supabase/` already deleted; `hud/lib/auth/local-user.ts` (`requireLocalUser`, `LOCAL_USER_ID="local-user"`) is the auth shim. Remaining textual mentions listed in §11.
7. **Another author (the user's parallel session) is actively editing this tree** (supabase removal; 179 changed paths). Every worker: run `git status --short` and check mtime of each file before editing; re-read immediately before editing; never revert or "clean up" changes you didn't make; if a file you own changes under you, stop and report.
8. **Typecheck baseline (re-established):** hud verify config `docs/handoff/2026-09-20-v63/tsconfig.hud-verify.json` → **exit 2, 196 error lines** (saved in `docs/handoff/2026-09-20-v63/tsc-baseline-hud.txt`); root `tsc --noEmit -p tsconfig.json` → exit 0. The hud errors are mostly the encryption shadowing (`Promise<string>` not assignable) and supabase-removal fallout (`requireSupabaseApiUser` etc.). **Gate:** (a) zero errors in files a workstream owns/touches; (b) total hud error count never increases vs. the last accepted count; (c) end state (W7) = 0. Command: `cd /c/Nova/hud && ./node_modules/.bin/tsc -p "C:/Nova/docs/handoff/2026-09-20-v63/tsconfig.hud-verify.json"`; root: `cd /c/Nova && ./hud/node_modules/.bin/tsc --noEmit -p tsconfig.json`.
9. **Assumptions (flag to user in final report):** (A) Windows-only DPAPI is acceptable; non-Windows fails closed. (B) `memory.db` (embeddings) and the Coinbase DB stay separate SQLite files (different lifecycle/size, own schema) but MOVE under `resolveDataDir()`; everything else goes in `nova.db`. (C) Markdown workspace docs (SOUL.md, USER.md, MEMORY.md, skills/) remain files — user-editable documents, not secrets. (D) Packaging (`electron/main.js` currently only loads `http://localhost:3000`; `electron-builder.yml` ships `out/**`, `electron/**`, `node_modules/**`) is not a complete offline bundle today; §2.5 documents the native-module requirements but full packaging of the Next+agent servers is out of scope. (E) The DB runs in plain Node processes (Next server + agent via `nova.js`) → system-Node ABI; if it ever moves into the Electron main process it needs `@electron/rebuild`.

## 1. Architecture

```
nova.db  (single file, WAL)                     <dataDir>/nova.db, -wal, -shm
keys/master.key.dpapi  (DPAPI-wrapped 32B key)  <dataDir>/keys/
src/db/                  ← shared JS module (ESM) + hand-written .d.ts, imported by BOTH:
   agent runtime (src/**/*.js)   and   hud server (hud/**/*.ts via relative import, like notes route does today)
src/security/secrets/    ← shared encryption core (sync); hud/lib/security/encryption/index.ts is a thin server-only re-export
```
Why `src/db` in JS + `.d.ts` (not TS): hud already imports `src/**/*.js` with types; root `tsc` only compiles `src/**/*.ts` to dist and hud can't import dist in dev. Both processes resolve `better-sqlite3` from the ROOT `node_modules` (resolution is by importing file location) → exactly one native binding in dev.
Migrations are **JS modules exporting SQL strings** (no runtime `fs` reads, no `import.meta.url` path math) so Next's bundler can't break them.

### 1.1 Data dir
`resolveDataDir()`: `NOVA_DATA_DIR` (absolute; created 0700 equivalent) → else `NOVA_PACKAGED=1` ? `%APPDATA%/Nova` → else `<workspaceRoot>/.user` (dev; already gitignored, `.user/` at .gitignore:9). `nova.db`, `*.db-wal`, `*.db-shm`, `keys/` must never be committed (`*.db*` already ignored) and must be excluded from electron-builder `files` (add `!**/.user/**`, `!**/*.db`, `!**/*.db-wal`, `!**/*.db-shm`, `!**/keys/**`, `!**/data/**`).

## 2. W1 — DB foundation (Phase 1, parallel with W2)

### 2.1 Files (W1 owns)
| Path | Notes |
|---|---|
| `src/db/index.js` + `src/db/index.d.ts` | public API below |
| `src/db/paths.js` | `resolveDataDir`, `resolveWorkspaceRoot` (same logic as existing helpers), `DB_FILENAME="nova.db"` |
| `src/db/migrations/index.js` | ordered array of `{version:number,name:string,sql:string}` imported from the files below |
| `src/db/migrations/0001-core.js` | `meta`, `kv_state` (§2.3) |
| `src/db/migrations/0002-integrations.js`, `0003-missions.js`, `0004-local-data.js`, `0005-chat.js` | **stubs created by W1** (`sql: ""` allowed = no-op) so later workstreams each own exactly one migration file (W3→0002, W4→0003, W5→0004, W6→0005) |
| `src/db/import/index.js` (+ `.d.ts`) | importer framework §6; enumerates `src/db/import/{integrations,missions,local-data,chat}.js` stubs created by W1 |
| `hud/next.config.ts` | add `serverExternalPackages: ["better-sqlite3"]`; keep `turbopack.root` |
| `hud/package.json` | add `better-sqlite3` (same version pin `^12.6.2`) + `@types/better-sqlite3` ONLY if required for packaging/typing; otherwise document why not |
| root `package.json` | add `"postinstall": "prebuild-install --runtime node --dir node_modules/better-sqlite3 || npm rebuild better-sqlite3"`-style script OR document `npm ci` (with scripts) as required; add script `smoke:local-db` chaining §9 smokes |
| `scripts/smoke/local-db/db-foundation-smoke.mjs` | §9 |
| `.gitignore` | ensure `**/keys/`, `nova.db*` covered |
| `electron-builder.yml` | exclusions in §1.1; `asarUnpack: node_modules/better-sqlite3/**` + `npmRebuild` note (§2.5) |

### 2.2 API — `src/db/index.js`
```ts
export const DB_FILENAME: "nova.db"
export function resolveDataDir(): string
export function getDb(): Database           // singleton per process on globalThis.__novaDb; opens <dataDir>/nova.db; applies pragmas; runs migrations once; safe across Next HMR
export function closeDb(): void             // tests/shutdown; also clears the singleton
export function openDbAt(filePath: string, opts?: { readonly?: boolean; skipMigrations?: boolean }): Database   // tests/importer
export function runMigrations(db: Database): { from: number; to: number }
export function tx<T>(fn: (db: Database) => T, mode?: "deferred" | "immediate" | "exclusive"): T   // default "immediate"; nested calls join the outer transaction (savepoint); rollback on throw
export function nowIso(): string            // new Date().toISOString() (UTC, lexicographically comparable)
export function kvGet(userId: string, namespace: string, key: string): unknown | null
export function kvSet(userId: string, namespace: string, key: string, value: unknown): void
export function kvDelete(userId: string, namespace: string, key: string): boolean
export function kvList(userId: string, namespace: string): { key: string; value: unknown; updatedAt: string }[]
```
Pragmas on every connection: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`, `trusted_schema=OFF`. Migrations: `PRAGMA user_version` = last applied version; each migration in its own `BEGIN IMMEDIATE` transaction with the version bump inside; concurrent processes racing to migrate must be safe (re-check `user_version` after acquiring the write lock). Migration files are append-only once merged.

### 2.3 `0001-core` schema
```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE kv_state (
  user_id TEXT NOT NULL, namespace TEXT NOT NULL, key TEXT NOT NULL,
  value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, namespace, key)
) WITHOUT ROWID;
```
`kv_state` is the escape hatch for the many tiny JSON stores (policy approvals, follow-up state, telegram/discord integration-state, voice/user prefs, skill prefs, build-idempotency…). **Rule:** kv values must never contain plaintext secrets (only `nv1:` ciphertext). **Per-user scoping rule for ALL tables:** `user_id TEXT NOT NULL` (values are whatever userId the caller passes — `local-user` today; importer keeps existing folder names), it leads every PK/index, and every query has `WHERE user_id = ?`. No function may accept a missing userId.

### 2.4 Getting the binary
Root: dependency install must build/fetch `better-sqlite3` (drop `--ignore-scripts` from instructions; add the `postinstall`/`npm rebuild` fallback so `npm ci` yields a working binding on Node 24 via prebuilds; fallback `node-gyp` needs MSVC build tools — document). hud: `serverExternalPackages` so Next never bundles the `.node` file. Add `scripts/db/ensure-native.mjs` (W1): loads better-sqlite3, opens `:memory:`, on failure prints the exact fix command and exits 1; `nova.js` (launcher) calls it at startup (W1 edits `nova.js` minimally, owner-checked).
### 2.5 Packaging note (document only, in `docs/security/local-data.md`)
`asarUnpack` must include `node_modules/better-sqlite3/**` (native `.node` cannot load from asar); if DB code ever runs inside Electron, use `electron-builder`'s `npmRebuild: true` + `@electron/rebuild` for Electron 44's ABI. Data dir in a packaged build = `%APPDATA%/Nova` (never inside the install dir).

### 2.6 W1 acceptance
- Root + hud verify typecheck: zero errors in W1 files; hud total ≤ baseline.
- `db-foundation-smoke.mjs` passes: fresh DB → `user_version` = latest; re-run is a no-op; WAL mode on; `busy_timeout` set; migrations apply in order from any older version; failed migration rolls back and leaves `user_version` unchanged; `tx` commit/rollback/nested; `kv*` round-trip + per-user isolation; `NOVA_DATA_DIR` override honored (temp dir); `getDb()` singleton; **multi-process**: 4 child `node` processes × 200 `tx(...,"immediate")` inserts + a concurrent migrate race → exact row count, zero `SQLITE_BUSY` escaping.
- `import` framework skeleton exists with stubs; `scripts/db/ensure-native.mjs` works; `next dev` compiles a route importing `src/db` (verified against a running dev server if available, else state so).

## 3. W2 — Encryption unify (Phase 1, parallel with W1)

### 3.1 Files (W2 owns)
| Path | Action |
|---|---|
| `src/security/secrets/index.js` + `index.d.ts` | NEW shared sync core (used by hud + runtime) |
| `hud/lib/security/encryption/index.ts` | REWRITE as thin `import "server-only"` re-export of the core with the SAME export names/signatures callers use |
| `hud/lib/security/encryption.ts` | **DELETE** (untracked shadowing file; user decision supersedes; check git status/mtime first and note it in the report) |
| `scripts/security/purge-legacy-key.mjs` | NEW: deletes `~/.nova-encryption-key` ONLY with `--yes` AND only after verifying no `salt:iv:tag:ct` values remain in nova.db (or `--force`); overwrites file with zeros before unlink |
| `scripts/smoke/local-db/encryption-smoke.mjs` | §9 |

### 3.2 Exports (all SYNCHRONOUS, drop-in for current callers)
```ts
export function encryptSecret(plainText: string, context?: string): string   // "" → ""; else "nv1:" + base64(iv12 ‖ tag16 ‖ ct); optional context = GCM AAD (binds ciphertext to its field, e.g. "integrations:openai.apiKey")
export function decryptSecret(payload: string, context?: string): string      // never throws; "" on failure; never logs
export function decryptSecretWithMeta(payload: string, context?: string): { value: string; keyIndex: number; format: "nv1" | "legacy-env" | "legacy-machine-key" | "none" }
export function isSecretCiphertext(value: unknown): boolean   // true for nv1 or either legacy shape
export function maskSecret(value: string): string             // "sk-…a1b2" style; never longer than 8 visible chars total; "" for empty
export function redactSecrets<T>(value: T): T                 // deep-clones; replaces values under keys matching /(key|secret|token|password|authorization|cookie|enc)$/i and any string that looks like nv1/legacy ciphertext or a known provider key pattern with "[redacted]"
export function getMasterKeyStatus(): { ready: boolean; source: "dpapi" | "test-override" | "none"; createdAt: string | null }   // NEVER returns key material
export class SecretsUnavailableError extends Error {}         // thrown by encryptSecret only when the master key cannot be obtained (non-Windows/DPAPI failure) — fail closed, never fall back to plaintext or a weak key
```
**`keyIndex` semantics (callers do `if (keyIndex > 0) re-encrypt`):** `0` = current nv1 key; `1` = any legacy format (so existing "rotate on read" caller logic transparently upgrades legacy data to nv1); `-1` = failure/empty.

### 3.3 Algorithm & key management
- AES-256-GCM, 12-byte random IV, 16-byte tag. Data key = **HKDF-SHA256(masterKey, salt="nova", info="nova/secrets/v1")**, 32 bytes; master key never used directly.
- Master key: 32 random bytes generated once; wrapped with **DPAPI CurrentUser** (`ProtectedData.Protect`) via `child_process.execFileSync("powershell.exe", ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-EncodedCommand", <base64 UTF-16LE script>], { input: <base64 key on STDIN>, windowsHide: true })` — key material is passed on **stdin only, never argv, never a temp file, never env**. Wrapped blob file: `<dataDir>/keys/master.key.dpapi` = text `NOVA-DPAPI-1\n<base64 blob>\n`. First creation uses exclusive create (`flag:"wx"`); a racing second process re-reads the winner's file. Unwrap once per process; cache the Buffer in `globalThis.__novaMasterKey` (module-duplication safe); zero-fill on `process.exit` best-effort. Plaintext key exists only in process memory.
- If DPAPI fails (non-Windows, PowerShell missing/blocked): `encryptSecret` throws `SecretsUnavailableError` (message says what to do); `decryptSecret*` returns `""` for nv1 (as failure), still handles legacy env format. No silent weaker fallback.
- Test/CI override: `NOVA_TEST_MASTER_KEY_HEX` (64 hex) honored ONLY when `NODE_ENV==="test"` or `NOVA_ALLOW_TEST_KEY==="1"`; `getMasterKeyStatus().source==="test-override"`; ignored otherwise (log-free).
### 3.4 Back-compat decrypt (format detection by shape)
1. `nv1:` prefix → current.
2. 3 dot-separated base64 parts `iv.tag.ct` → **legacy-env**: keys from `NOVA_ENCRYPTION_KEY` then each `NOVA_ENCRYPTION_KEY_FALLBACKS` (same `deriveKeyMaterial`: base64 that decodes to 32 bytes, else sha256 of the string); first key that authenticates wins.
3. 4 colon-separated base64 parts `salt:iv:tag:ct` → **legacy-machine-key**: raw 32-byte key from `~/.nova-encryption-key` (read-only, never created by new code), PBKDF2-SHA256 100 000 iters, 64-byte salt, IV 16 bytes.
Encrypting always emits nv1. `NOVA_ENCRYPTION_KEY` remains **decrypt-only legacy input** (documented as deprecated in `.env.example`).
### 3.5 W2 acceptance
- hud verify typecheck: the `Promise<string>` errors in `lib/integrations/**` are gone; zero errors in W2 files; hud total strictly decreases vs. baseline (196).
- `encryption-smoke.mjs` passes (uses temp `NOVA_DATA_DIR`; on Windows exercises REAL DPAPI): round-trip incl. unicode/long/empty; two encryptions of same plaintext differ; tamper each of iv/tag/ct → `""`; truncated/garbage → `""` never throws; wrong master key (swap key file/override) → `""`; AAD mismatch → `""`; legacy-env (fixture built with the OLD algorithm + fallback-key index) and legacy-machine-key (fixture built with the other author's algorithm using a temp fake home via `HOME`/`USERPROFILE`) both decrypt and report `keyIndex 1` + correct `format`; master key file on disk ≠ raw key and contains no 32-byte raw key bytes (scan); a **child process** decrypts what the parent encrypted (shared key via DPAPI file); concurrent first-run race (3 processes, fresh dir) converges on ONE master key; `SecretsUnavailableError` path via forced-failure hook (`NOVA_TEST_FORCE_DPAPI_FAIL=1` honored only under test flag).
- `hud/lib/security/encryption.ts` no longer exists; all six caller modules compile unchanged (API compatible) — W2 may NOT edit caller files (W3 owns them).

## 4. W3 — Integrations config/tokens + agent-sync (Phase 2)

Owns: `hud/lib/integrations/**` (server-store, tokens for spotify/youtube/gmail/google-calendar, runtime/agent-sync, runtime/snapshot, phantom/{service,auth-state}, polymarket/server, spotify/skill-prefs), `hud/app/api/integrations/**`, `hud/app/integrations/**`, `src/db/migrations/0002-integrations.js`, `src/db/import/integrations.js`, `hud/app/api/account/delete/route.ts`, `scripts/smoke/local-db/no-plaintext-smoke.mjs`.

**Schema (0002):**
```sql
CREATE TABLE integration_configs (
  user_id TEXT PRIMARY KEY, config_json TEXT NOT NULL, updated_at TEXT NOT NULL
);   -- config_json = today's IntegrationsConfig JSON; EVERY secret-bearing field holds "nv1:" ciphertext only (existing "*Enc" fields keep their names)
CREATE TABLE integration_state (       -- oauth state, nonces, per-integration mutable state (phantom auth-state etc.)
  user_id TEXT NOT NULL, integration TEXT NOT NULL, key TEXT NOT NULL,
  value_json TEXT NOT NULL, expires_at TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, integration, key)
) WITHOUT ROWID;
```
**Store mapping:** `server-store.ts` keeps `loadIntegrationsConfig/saveIntegrationsConfig/updateIntegrationsConfig(scope?)` signatures; only the persistence layer changes (JSON file → `integration_configs` row inside `tx`). `updateIntegrationsConfig` becomes read-merge-write in ONE immediate transaction (fixes lost updates). Provider tokens continue to use `encryptSecret/decryptSecret` unchanged.
**Secret-field registry (`hud/lib/integrations/store/secret-fields.ts`, NEW, W3):** the single list of every secret field path in `IntegrationsConfig` (API keys for openai/claude/grok/gemini/brave/news/coinbase key+secret/polymarket keys/telegram+discord+slack tokens/webhooks/oauth access+refresh tokens/etc. — audit `server-store.ts` interfaces exhaustively). Used by (a) save path: any plaintext found in a registered field is encrypted before write; (b) client masking; (c) the no-plaintext smoke. **`toClientIntegrationsConfig(config)`** returns the config with each secret replaced by `{ set: boolean, last4?: string }`-style masks (via `maskSecret`); `GET /api/integrations/config` and every integrations API route return ONLY this shape; PUT/PATCH accept a plaintext secret only when the user typed a new one; empty/masked placeholder = keep existing. Never echo ciphertext or plaintext to the browser.
**agent-sync/snapshot:** today hud pushes integration snapshots (including keys) to the runtime over HTTP/WS. Preferred: runtime reads `integration_configs` directly via `src/db` + `src/security/secrets` (both processes are the same OS user; DPAPI key is shared) and the key-carrying HTTP hop is deleted. If retained: loopback-only, `verifyRuntimeSharedToken`, never logged, and documented in the outbound-calls table. W3 decides, reports which.
**Supabase leftovers (W3):** replace `VerifiedSupabaseRequest` type imports in `phantom/service.ts`, `polymarket/server.ts`, `runtime/snapshot.ts` (use `LocalUser`/plain userId), remove supabase text in `spotify/tokens`, `use-phantom-setup.ts`, `app/integrations/page.tsx`, `app/polymarket/page.tsx`, `app/api/integrations/spotify/playback/route.ts`; any remaining `requireSupabaseApiUser` → `requireLocalUser` from `@/lib/auth/local-user`.
**Importer (`src/db/import/integrations.js`):** reads `hud/data/integrations-<userId>.json` and any `.user/user-context/<uid>/…` integration files; per secret field: legacy-format ciphertext → decrypt (legacy formats) → `encryptSecret`; **plaintext found in a registered field → encrypt** (and count it in the report); unreadable ciphertext (key lost) → keep the original string under `integration_state("import","unreadable:<path>")` and blank the field, report it. Idempotent via `meta` markers.
**Acceptance:** typecheck zero errors in owned files; `no-plaintext-smoke.mjs` (see §9); masking test (config GET contains no secrets/ciphertext); round-trip save/load preserves every non-secret field exactly; concurrent `updateIntegrationsConfig` from 2 processes loses no update; importer smoke covers legacy env-format + machine-key-format + plaintext inputs.

## 5. W4 — Missions + job ledger + telemetry + versioning + logs (Phase 2)

Owns: `hud/lib/missions/**` (store, telemetry/store, workflow/versioning, workflow/execution-guard, execution-tick, job-ledger/**, templates, skills/snapshot, diff/journal, coinbase-artifacts, output/dispatch persistence bits), `hud/lib/notifications/{dead-letter,run-log,scheduler}/**`, `src/runtime/modules/services/missions/{persistence,scheduler,build-idempotency}/**`, `hud/app/api/missions/**`, `src/db/migrations/0003-missions.js`, `src/db/import/missions.js`, `scripts/smoke/local-db/job-ledger-sqlite-smoke.mjs`; rewrite or delete obsolete `scripts/smoke/scheduler/job-ledger-*-smoke.mjs`.

**Schema (0003):**
```sql
CREATE TABLE missions (user_id TEXT NOT NULL, id TEXT NOT NULL, data_json TEXT NOT NULL, label TEXT, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id)) WITHOUT ROWID;
CREATE TABLE mission_versions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mission_id TEXT NOT NULL, ts TEXT NOT NULL, data_json TEXT NOT NULL);  CREATE INDEX idx_mission_versions ON mission_versions(user_id, mission_id, ts);
CREATE TABLE mission_telemetry (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, ts TEXT NOT NULL, type TEXT NOT NULL, mission_id TEXT, run_id TEXT, data_json TEXT NOT NULL);  CREATE INDEX idx_mission_telemetry ON mission_telemetry(user_id, ts);
CREATE TABLE mission_run_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, mission_id TEXT NOT NULL, ts TEXT NOT NULL, data_json TEXT NOT NULL);  CREATE INDEX idx_mission_run_logs ON mission_run_logs(user_id, mission_id, ts);
CREATE TABLE dead_letters (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('notification','mission_run')), ts TEXT NOT NULL, data_json TEXT NOT NULL);  CREATE INDEX idx_dead_letters ON dead_letters(user_id, kind, ts);
CREATE TABLE job_runs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mission_id TEXT NOT NULL, idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','running','succeeded','failed','dead','cancelled')),
  priority INTEGER NOT NULL DEFAULT 5, scheduled_for TEXT NOT NULL,
  lease_token TEXT, lease_expires_at TEXT, heartbeat_at TEXT,
  attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 1, backoff_ms INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'scheduler', run_key TEXT,
  input_snapshot TEXT, output_summary TEXT, error_code TEXT, error_detail TEXT,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, duration_ms INTEGER
);
CREATE UNIQUE INDEX uq_job_runs_idem ON job_runs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_job_runs_pending ON job_runs(user_id, scheduled_for) WHERE status='pending';
CREATE INDEX idx_job_runs_active  ON job_runs(user_id) WHERE status IN ('claimed','running');
CREATE INDEX idx_job_runs_lease   ON job_runs(lease_expires_at) WHERE status IN ('claimed','running');
CREATE INDEX idx_job_runs_run_key ON job_runs(user_id, run_key) WHERE run_key IS NOT NULL;
CREATE TABLE scheduler_leases (scope TEXT PRIMARY KEY, holder_id TEXT NOT NULL, acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE job_audit_events (id TEXT PRIMARY KEY, job_run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE, user_id TEXT NOT NULL, event TEXT NOT NULL, actor TEXT NOT NULL, ts TEXT NOT NULL, metadata TEXT);  CREATE INDEX idx_job_audit_run ON job_audit_events(job_run_id, ts);
```
Timestamps are UTC ISO-8601 strings (`nowIso()`), compared lexicographically. Retention: append-only tables (`mission_telemetry`, `mission_run_logs`, `dead_letters`, `job_audit_events`) get a `prune(userId, olderThanIso)` helper; defaults match today's caps in the JSONL code (W4 reads them).
**Store mapping:** every exported function of `missions/store`, `telemetry/store`, `versioning/service`, `dead-letter`(×2), `run-log`, and `src/…/missions/persistence` keeps its signature and return shape; only persistence changes. JSONL append → `INSERT`; per-file read/tail → indexed SELECT with the same limit/ordering.
**Job ledger — `jobLedger` keeps the `JobLedgerStore` interface in `types.ts` (comments updated: no Supabase) and current return shapes (`ClaimResult`, `SchedulerLeaseResult`, etc.). Semantics = old SQL (authoritative) — each state transition is ONE `tx(fn,"immediate")` (= `BEGIN IMMEDIATE`; single-writer, so no lost claims across the Next + agent processes):**
- `enqueue`: insert `pending`; duplicate `(user_id, idempotency_key)` → `{ok:false,error:"Job with this idempotency key already exists"}` (UNIQUE index, catch constraint error); audit `job.enqueued`.
- `claimRun`: in one tx: row missing → `{ok:false, reason: not-found text}`; status≠pending → `not pending (status=…)`; global in-flight (`status IN ('claimed','running')`) ≥ `NOVA_MISSION_EXECUTION_MAX_INFLIGHT_GLOBAL` (default 200) → global-cap reason; same-user in-flight ≥ `…_PER_USER` (default 3) → per-user reason; else `UPDATE … SET status='claimed', lease_token='lease_<ts36>_<rand>', lease_expires_at=now+leaseDurationMs, heartbeat_at=now WHERE id=? AND status='pending'` (0 rows changed → "claim raced" reason); audit `job.claimed`. Reason strings stay whatever the current in-memory implementation returns (callers/tests depend on them); internal codes from the old SQL (`not_found`, `not_pending:<status>`, `global_limit`, `per_user_limit`, `claim_raced`) may be added to a `code` field only if `ClaimResult` typing allows without breaking callers.
- `heartbeat`: `UPDATE … SET heartbeat_at=now, lease_expires_at=now+leaseDurationMs WHERE id=? AND lease_token=? AND status IN ('claimed','running')` → boolean = changes>0.
- `startRun`: `claimed`→`running` with matching token; sets `started_at`.
- `completeRun`: matching token AND `status='running'` → `succeeded`, `finished_at`, `duration_ms=max(0,finished−coalesce(started,finished))`, `output_summary`, lease cleared; boolean.
- `failRun`: matching token AND status IN (claimed,running) else `{ok:false, not_found_or_stale_lease}`; `next_attempt = attempt+1`; `max=max(1,max_attempts)`; if `next_attempt >= max` → `dead` (lease cleared, error fields, duration); else → `failed` (backoff = `min(round(base*2^(next_attempt-1) * jitter(0.9–1.1)), maxBackoff)`, base 60000, max 900000 unless the current code's env vars say otherwise) AND insert the retry row (`pending`, `source='retry'`, `attempt=next_attempt`, `scheduled_for=finished+backoff`, id from `retryId`) **in the same tx**; both audit events; dead runs also append to `dead_letters(kind='mission_run')`.
- `cancelRun` / `cancelPendingForMission`: pending/claimed → `cancelled` (as today).
- `reclaimExpiredLeases`: `UPDATE … SET status='pending', lease_token=NULL, lease_expires_at=NULL, heartbeat_at=NULL WHERE status IN ('claimed','running') AND lease_expires_at < now` → returns changes.
- Scheduler leases: `acquire` = one tx: no row, or row expired, or same `holder_id` → upsert `{holder, acquired_at, expires_at}` → `{acquired:true,…}`; else `{acquired:false,reason:"already_held"}`; DB failure → `"db_error"`. `renew`/`release` only for matching holder.
- `getPendingRuns({limit, now?, userIds?})`: `status='pending' AND scheduled_for <= now [AND user_id IN …] ORDER BY priority ASC, scheduled_for ASC LIMIT ?` (W4 diffs this against the current in-memory ordering and reports any difference).
- Remove `import "server-only"` from anything the runtime must import; the ledger core lives in a `server-only`-free module (`hud/lib/missions/job-ledger/sqlite-core.ts` or `src/db`-adjacent JS) so smokes can transpile it (same technique as `agent-tasks-smoke`).
**Importer:** `missions.json`, `mission-versions.jsonl`, `mission-telemetry.jsonl`, run-log + dead-letter JSONL (per-user dirs and `hud/data` fallbacks) → tables; malformed JSONL lines skipped and counted, never fatal. (The in-memory job ledger has nothing to import.)
**Acceptance:** typecheck; `job-ledger-sqlite-smoke.mjs` (temp `NOVA_DATA_DIR`): idempotent enqueue, claim caps (per-user 3 / global env-lowered), double-claim race (2 child processes, exactly one wins), heartbeat extends only with the right token, complete/fail semantics incl. retry row + backoff bounds + `dead` at max attempts, expired-lease reclaim, scheduler-lease exclusivity across 2 processes, audit rows, pending ordering; existing mission/notification behavior unchanged for callers (the mission store/telemetry/version smokes still pass or are rewritten to SQLite).

## 6. Importer framework (W1 builds; each workstream adds one importer file)

`src/db/import/index.js`: `export function runImport(opts?: { dataDir?: string; userIds?: string[]; dryRun?: boolean }): { imported: Record<string, number>; skipped: Record<string, number>; warnings: string[] }`. Runs automatically once per process start from `getDb()` callers' bootstrap (`nova.js` and Next `instrumentation.ts` — W1 wires whichever exists; must be safe to run concurrently in two processes: guarded by `BEGIN IMMEDIATE` + `meta` marker `import:<importer>:<userId>:done`). Each importer: `{ name: string; run(db, ctx: { dataDir; workspaceRoot; userIds: string[]; logger }): { imported: number; skipped: number; warnings: string[] } }`.
Rules: **idempotent** (marker + `INSERT OR IGNORE`/upserts keyed by natural ids; running N times = running once); **non-destructive** (source JSON/JSONL is NEVER deleted or modified; after success the importer writes the marker; a separate `scripts/db/archive-imported-json.mjs --yes` moves originals to `<dataDir>/imported-backup/<ts>/` on the user's explicit command); **transactional per user per importer**; discovers users by scanning `.user/user-context/*` dir names and `hud/data/integrations-*.json`; never logs values (counts + paths only); secrets follow §4 rules. A dry-run reports counts without writing.

## 7. W5 — Notes, agent-tasks, calendar, small hud stores (Phase 2)

Owns: `src/runtime/modules/services/notes/index.js` (+ test), `hud/lib/agents/task-store.ts`, `hud/lib/calendar/reschedule-store/index.ts`, `hud/lib/calendar/**` persistence, `hud/lib/workspace/**` persistence bits that are JSON state (NOT the markdown files), `hud/lib/meta/version` state if any, `hud/app/api/{home/notes,dev-logs}/**` persistence, `src/db/migrations/0004-local-data.js`, `src/db/import/local-data.js`.
**Schema (0004):**
```sql
CREATE TABLE notes (user_id TEXT NOT NULL, id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'manual', updated_by TEXT NOT NULL DEFAULT 'manual', conversation_id TEXT, PRIMARY KEY (user_id, id)) WITHOUT ROWID;  CREATE INDEX idx_notes_updated ON notes(user_id, updated_at DESC);
CREATE TABLE agent_tasks (user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL, agent TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL, permission_mode TEXT NOT NULL, progress INTEGER NOT NULL, tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL, cost_usd REAL NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, paused_at TEXT, completed_at TEXT, PRIMARY KEY (user_id, id)) WITHOUT ROWID;  CREATE INDEX idx_agent_tasks_status ON agent_tasks(user_id, status);
CREATE TABLE calendar_overrides (user_id TEXT NOT NULL, mission_id TEXT NOT NULL, original_time TEXT NOT NULL, overridden_time TEXT NOT NULL, overridden_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, mission_id)) WITHOUT ROWID;
```
Notes keep MAX_NOTES=300/content caps and function signatures (`listHomeNotes, createHomeNote, updateHomeNote, deleteHomeNote, resolveHomeNotesStorePath` — the last becomes a deprecated shim only if still imported; otherwise delete). **agent-tasks:** `task-store.ts` keeps every export/error class/semantics from Sprint 2 (`transact`-style single-writer + event publish AFTER commit; corrupt-file recovery is dropped; the 300 cap stays); the file mutex becomes `tx("immediate")`; the Sprint-2 smokes (`scripts/smoke/agent-tasks/*`) must pass unchanged in behavior (update their temp-dir setup to `NOVA_DATA_DIR`). Small JSON states with no dedicated table → `kv_state` namespaces (`hud-settings`, `version`, …) — W5 lists what it moved. Importer: `home-notes.json`, `agent-tasks.json`, `calendar-overrides.json` (+ legacy `hud/data` locations).
**Acceptance:** typecheck; notes + agent-tasks + calendar behavior smokes pass on SQLite; per-user isolation preserved; importer idempotency smoke (`importer-smoke.mjs` sections for local-data).

## 8. W6 — Chat threads/messages/memory/tool_runs + runtime leftovers (Phase 2)

Owns: `src/session/{store,runtime}/**`, `src/memory/**` (path move only), `src/integrations/coinbase/store/**` (path move only) + `scripts/coinbase/rollback-store.mjs`, `hud/app/api/threads/**`, `hud/app/api/chat/**` persistence, all `src/runtime/**` files with Supabase mentions (list in §11, runtime part) and the runtime JSON state stores (`chat/routing/policy-approval-store`, `services/{follow-up-state,reminders/follow-up-state,telegram/integration-state,discord/integration-state,calendar/provider-adapter}`, `context/{user-preferences,skill-preferences,personality/storage,identity/storage,persona-context}` JSON parts, `services/voice/user-settings`, `chat/telemetry/dev-conversation-log`), `src/db/migrations/0005-chat.js`, `src/db/import/chat.js`.
**Schema (0005, W6 finalizes columns after reading current session/transcript code):** `threads(user_id, id, title, pinned/archived flags, created_at, updated_at)`, `messages(user_id, thread_id, seq INTEGER, id, role, content, ts, meta_json, PRIMARY KEY(user_id, thread_id, seq))` (transcripts JSONL → rows; **append-only insert per message, transactional with the `sessions` index update**), `sessions(user_id, session_key, session_id, data_json, updated_at)` (from `sessions.json`), `thread_summaries(user_id, thread_id, summary, updated_at)`, `tool_runs(id, user_id, thread_id, tool, status, started_at, finished_at, input_json, output_json)` — **tool inputs/outputs MUST be passed through `redactSecrets` before insert**. Small runtime JSON stores → `kv_state` namespaces (one per store). FTS5 for message search is optional/out of scope.
`src/memory/*` and coinbase DB: only change their default paths to `<resolveDataDir()>/memory.db` / `<dataDir>/coinbase.db` (honor `NOVA_MEMORY_DB_PATH`; the importer/first-run **copies** the old `.user/memory.db` if the new path is absent — never deletes the old file). They keep their own better-sqlite3 handles (WAL + busy_timeout set).
**Supabase leftovers (runtime):** remove/replace every Supabase reference in `src/runtime/**` (`infrastructure/hud-gateway/{index,message-handler}`, `chat/core/chat-handler/{index,operator-runtime-selection,operator-runtime-snapshot}`, `chat/workers/finance/polymarket-agent`, `chat/workers/productivity/missions-agent`, `services/calendar/provider-adapter/google-events-hud-http`, `services/missions/{index,provider-adapter}`, `services/polymarket`, `services/spotify/provider-adapter/{index,direct-now-playing,hud-http}`, `services/youtube/provider-adapter`) — auth tokens/`supabaseAccessToken` plumbing between gateway and runtime is deleted; identity = `LOCAL_USER_ID`/userContextId.
**Acceptance:** typecheck; existing routing/session/persona/user-isolation smokes (`smoke:src-session`, `smoke:src-user-isolation`, `smoke:src-persona`, memory smokes) pass against SQLite (updated setup only); `grep -rni supabase src/` → zero; importer smoke for transcripts/sessions (malformed lines counted, not fatal; message order & count preserved).

## 9. Tests (all under `scripts/smoke/local-db/`; each uses a fresh temp `NOVA_DATA_DIR`, never the real `.user`)
- `db-foundation-smoke.mjs` (W1), `encryption-smoke.mjs` (W2), `job-ledger-sqlite-smoke.mjs` (W4), `importer-smoke.mjs` (W1 framework tests; W3/W4/W5/W6 append their sections — sequential appends, one owner at a time), `no-plaintext-smoke.mjs` (W3 creates; W7 extends to all stores), `multiprocess-smoke.mjs` (W1: mixed workload from 4 child processes across kv/notes/job_runs — no `SQLITE_BUSY`, no lost writes).
- **No-plaintext scan (`no-plaintext-smoke.mjs`):** write canary secrets (unique random strings, each in utf8, base64, hex, and URL-encoded forms) through the REAL store functions (integrations config for every provider incl. OAuth tokens, kv, tool_runs input with a key inside, mission node config containing an API-key-looking field) → then byte-scan `nova.db`, `nova.db-wal`, `nova.db-shm`, every file under the temp data dir (including `keys/`), captured stdout/stderr of the child processes, and any `.json`/`.jsonl` written → **zero hits**. Also asserts `GET`-shaped client config (`toClientIntegrationsConfig`) contains no ciphertext/plaintext.
- Root script: `"smoke:local-db": "node scripts/smoke/local-db/db-foundation-smoke.mjs && node …encryption-smoke.mjs && …"` (W1 creates the entry; each owner appends its file). Existing suites that reference Supabase are rewritten or deleted by their owner; none may stay red.

## 10. Secrets hygiene rules (binding on every workstream)
1. Secret-bearing columns/JSON fields hold `nv1:` ciphertext only; there is no code path that writes a plaintext secret to disk (DB, JSON, logs, temp files, crash dumps).
2. Secrets are never returned to the browser unmasked: API responses use `toClientIntegrationsConfig` / `maskSecret`; client components never receive ciphertext either. `SecretInput` keeps `type="password"` (existing guard smoke `hud-integrations-secret-input-guard-smoke.mjs` must keep passing).
3. Never log secrets: no `console.*`/logger call may include a config object, request headers/body of provider calls, or an env dump without `redactSecrets`. Errors thrown from encryption/DPAPI never include key material or the plaintext.
4. Master key: DPAPI-wrapped file only; plaintext key lives in process memory only; never in argv/env/temp files/`localStorage`/the DB. No key material in `getMasterKeyStatus`.
5. `redactSecrets` is applied before persisting tool inputs/outputs, dev-logs, telemetry, dead letters and run logs (they can contain provider responses/headers).
6. Data dir, `nova.db*`, `keys/`, `.env*` are gitignored and excluded from packaging (§1.1); `.env.example` contains no real values and drops Supabase vars + deprecates `NOVA_ENCRYPTION_KEY`.
7. Redaction helper is the single implementation (`src/security/secrets`), re-exported for hud.

## 11. W7 — Supabase removal, dependency cleanup, security audit, docs, full verification (Phase 3; after W3–W6)

**Removal checklist (verify each; remaining mentions at contract time):**
- hud: `app/chat/components/chat-shell-controller.tsx`, `app/home/hooks/use-home-integrations.ts`, `lib/chat/hooks/useNovaState.ts`, `components/auth/auth-fetch-bridge.tsx` (delete if it only bridged Supabase tokens; else strip), `tsconfig.gmail-tests.json`, `lib/docs/organization.md`, `README.md`, `lib/meta/version/index.ts` text, `lib/missions/workflow/execution-guard.ts` comments (W4), `tsconfig.tsbuildinfo` (generated — must be gitignored, not edited).
- root: `tsconfig.json` (`exclude` entry `supabase`), `templates/USER.md`, `scripts/{cleanup-supabase-auth.mjs,cleanup-auth.sh,cleanup_all_auth.py,fix-auth.mjs,fix-auth-final.mjs}` → DELETE (one-off cleanup scripts, dead), smokes mentioning Supabase (`calendar/hud-calendar-isolation`, `routing/src-operator-preflight`, `routing/src-polymarket-domain-service`, `runtime/spotify-user-context-isolation`, `scheduler/{job-ledger-*,src-discord-delivery,src-scheduler-stability}`, `coinbase/smoke/src-coinbase-report-delivery-retention`) — owners of the related workstream fix theirs; W7 catches leftovers.
- `package.json` (root + hud) and both lockfiles: no `@supabase/*`, no `supabase` CLI; `.env.example`/docs: no `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*` vars; `hud/lib/supabase/` stays deleted; `grep -rIi supabase --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git .` → zero (except this contract/changelog if intentionally kept in `docs/`).
**Security audit (W7 produces `docs/security/outbound-calls.md` + `docs/security/local-data.md`):**
1. Grep every outbound-capable call: `fetch(`, `http(s).request/get`, `XMLHttpRequest`, `navigator.sendBeacon`, `new WebSocket`, `axios`, `got`, `undici`, `node-fetch`, `EventSource(` across `src/`, `hud/app`, `hud/lib`, `hud/components`, `hud/electron`, `nova.js`, `scripts/` (non-test). Classify each: (a) user-chosen provider call (OpenAI/Anthropic/xAI/Gemini/Brave/etc. carrying only that provider's key to that provider's host), (b) user-initiated integration (Spotify/Google/Discord/Telegram/Coinbase/Polymarket…) to its own host, (c) localhost IPC, (d) **anything else → must be removed or justified**. Table: file, host, what is sent, whether secrets are included, trigger.
2. Telemetry/analytics SDKs: grep deps + imports for sentry, posthog, segment, amplitude, mixpanel, datadog, logrocket, hotjar, `@vercel/analytics`, `@vercel/speed-insights`, crash reporters, `electron` `crashReporter`/`autoUpdater` feeds. **Next.js anonymous telemetry:** set `NEXT_TELEMETRY_DISABLED=1` in `hud/scripts/next-runner.mjs`, `nova.js` and the Electron env; document.
3. Runtime asset loads: remote fonts/CSS/scripts/images in `hud/app/layout.tsx`, `globals.css`, `public/`, `next/font/google` (build-time only is acceptable; runtime CDN loads are not) and `electron/main.js` (`webPreferences`: contextIsolation on, nodeIntegration off, `will-navigate`/`setWindowOpenHandler` restrict to localhost; CSP header).
4. Key-carrying paths: hud→runtime snapshot (W3's decision), WebSocket 8765 messages, dev-logs route, error responses — confirm no secrets/ciphertext in payloads or logs (grep for `apiKey`, `Enc`, `authorization`, `Bearer`, `refreshToken` in log statements).
5. Storage: `grep -rn "localStorage\|sessionStorage\|document.cookie"` for anything key-like; confirm keys are only entered via `SecretInput` and posted to the local API once.
6. Deliver a signed-off checklist in `docs/security/local-data.md`: what is stored where, how keys are protected (DPAPI, nv1), what leaves the machine (only user-chosen provider calls), how to back up/restore, how to purge (`purge-legacy-key.mjs`, `archive-imported-json.mjs`), and the known limits (same-Windows-user malware can call DPAPI; no password prompt by design).
**Full verification (W7):** hud verify typecheck exit 0 (baseline 196 → 0); root typecheck exit 0; `npm run smoke:local-db`, `npm run smoke:agent-tasks`, `smoke:audit`, job-ledger + scheduler + session + user-isolation + notes smokes all green; `next dev` boots and: create/update integrations config (masked GET), create a note, a task, a mission enqueue/claim, chat thread persisted, restart both servers → data intact; run the importer against a copy of the real `.user/` (with a scratch `NOVA_DATA_DIR`) and report counts; final report lists deviations/assumptions §0.9.

## 12. Ownership matrix & order
| Phase | WS | Exclusive ownership |
|---|---|---|
| 1 | W1 | `src/db/**` (except `src/db/import/{integrations,missions,local-data,chat}.js` bodies), `scripts/db/**`, `hud/next.config.ts`, root+hud `package.json` deps/scripts (W1's lines only), `electron-builder.yml`, `nova.js` bootstrap hook, `db-foundation-smoke`, `multiprocess-smoke`, `.gitignore` additions |
| 1 | W2 | `src/security/secrets/**`, `hud/lib/security/encryption*`, `scripts/security/**`, `encryption-smoke`, `.env.example` encryption vars |
| 2 | W3 | §4 list. Starts after W1+W2 accepted (needs `getDb/tx` + sync encryption) |
| 2 | W4 | §5 list. Starts after W1 accepted (W2 not needed except redaction) |
| 2 | W5 | §7 list. After W1 |
| 2 | W6 | §8 list. After W1 (+W2 for `redactSecrets`) |
| 3 | W7 | §11; after W3–W6 accepted |
Cross-workstream rules: a worker edits ONLY files it owns; needing a change elsewhere → message management (who relays). Migration files/importers are per-owner (see §2.1/§6) so no two workers touch the same file; `package.json` root scripts: W1 creates `smoke:local-db`, later owners append their command (sequential per phase order; management serializes concurrent appends by assigning append turns). Every worker: TS clean (§0.8) after each file group; no dead code; smokes in `scripts/smoke/local-db/`; do NOT commit; report files touched + gate results + deviations; management verifies independently before the next phase starts.
