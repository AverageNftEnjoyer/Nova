# Local data, storage and secrets

Nova is local-first: your data lives on your own machine and nothing is stored in a hosted service. This page says
exactly where it lives, how secrets are protected, and where that protection stops. The audited list of network calls
is in [`outbound-calls.md`](outbound-calls.md).

## The "fresh-data" decision

This release moved everything into one SQLite database and re-did secret encryption. It is a **fresh-data release**:

- There is **no importer** for the previous JSON/JSONL stores. Old files (for example `.nova-data/`,
  `.user/user-context/<id>/state/*.json`, `integrations-config.json`) are ignored, not read, not migrated, not deleted.
- **Legacy encrypted values are not decrypted.** Only `nv1:` payloads (below) are understood. Anything encrypted by an
  older version (the `salt:iv:tag:ciphertext` format, `~/.nova-encryption-key`, `NOVA_ENCRYPTION_KEY`) is unreadable to
  this version. **Re-enter your API keys** and reconnect integrations (Gmail, Spotify, ...) after upgrading.
- `~/.nova-encryption-key` and `NOVA_ENCRYPTION_KEY` are no longer used by any code and can be deleted.

There is no `src/db/import/` module. If a migration is ever wanted it needs its own, explicit design; do not assume
one exists.

## Where data lives

One resolver decides, `resolveDataDir()` in `src/db/paths.js`, shared by the HUD (Next server), the agent runtime and
`nova.js`:

| Situation | Data directory |
|---|---|
| `NOVA_DATA_DIR` is set | that directory (relative values resolve against the process cwd) |
| `NOVA_PACKAGED=1` (installed app) | `%APPDATA%\Nova`, never inside the install directory |
| Development (default) | `<repo>/.user` (gitignored) |

`src/.user` is a forbidden location (enforced by `resolveDataDir()` and `enforceWorkspaceUserStateInvariant`).
A newly created data directory is locked down to the current Windows user, SYSTEM and Administrators (`icacls`,
best effort); an existing directory keeps its permissions.

Inside the data directory:

| Path | What | Sensitive? |
|---|---|---|
| `nova.db`, `nova.db-wal`, `nova.db-shm` | SQLite (WAL): integrations, missions, job ledger, agent tasks, notes, chat threads and messages, sessions, per-user state (`kv_state`), calendar overrides, `tool_runs` audit trail | Chat text, notes, mission definitions are **plain** (SQLite is not encrypted). Secret fields are `nv1:` ciphertext. |
| `keys/master.key.dpapi` | The DPAPI-wrapped master key | Useless outside this Windows account |
| `user-context/<userId>/` | Markdown workspace docs (`SOUL.md`, `USER.md`, `AGENTS.md`, `MEMORY.md`, `skills/*/SKILL.md`) and per-user logs | Plain text. Use `resolveUserContextRoot()` from `src/db/paths.js` to build this path. |
| `memory.db` | Shared agent memory index (separate SQLite file) | Plain |
| `user-context/<userId>/memory.db` | Per-user memory index used by the tool runtime | Plain |
| `agent-task-files/<userId>/<taskId>/` | Immutable, size-limited copies of files explicitly attached to Agent Tasks | Plain. Database rows store relative managed paths plus SHA-256 digests; original host paths are not exposed to models or clients. |
| `sessions.json`, `transcripts/` | Runtime session metadata and conversation transcript artifacts | Plain |
| `archive/logs/` | Coinbase/ChatKit observability JSONL | Plain; no secrets by design |

UI-only preferences (theme, orb color) stay in the browser's `localStorage`. Never secrets.

Schema is versioned with `PRAGMA user_version` plus a `migration:<n>` marker per applied migration in the `meta` table.
Migrations live in `src/db/migrations/` and are append-only once merged.

## Secrets

Every API key, token, OAuth secret and webhook URL a user enters is encrypted before it is written to `nova.db`.

- **Cipher and format**: AES-256-GCM. Stored values are versioned `nv1:` payloads. The data key is derived from the
  master key with HKDF.
- **Master key**: 32 random bytes generated on first use, wrapped with **Windows DPAPI, CurrentUser scope**, stored at
  `<dataDir>/keys/master.key.dpapi`. The plaintext master key exists only in process memory (zeroed on exit). The key
  bytes are handed to the DPAPI helper over stdin, never argv, env or a temp file.
- **Fail closed**: if DPAPI is unavailable (non-Windows, damaged or foreign key file), writing a secret throws
  `SecretsUnavailableError`. There is no plaintext or weaker fallback.
- **Never shown back**: API responses to the browser carry masked hints and `...Configured` flags
  (`toClientIntegrationsConfig`), never the secret. `tool_runs` rows and other audit output go through
  `redactSecrets()`.
- **Windows only**: DPAPI is Windows-specific.

### The honest limit

DPAPI ties the key to your Windows login. This protects against: a copied `nova.db`, a backup or cloud-synced copy of
the data folder, another Windows account on the same PC, and anyone who steals the disk without your login.

It does **not** protect against: malware or any program running as **your** Windows user (it can ask DPAPI to unwrap
the key exactly as Nova does), or someone who is logged in as you. The HUD rejects non-loopback hosts and cross-origin
state-changing API requests, but requests from local non-browser processes without `Origin`/`Sec-Fetch-Site` headers
remain allowed by design. Treat the running app as trusted-local, not as a boundary against programs running as the
same Windows user. See the fixed and residual findings in `outbound-calls.md`.

Also outside this protection: values you put in `.env` (for example `OPENAI_API_KEY`) are plain text on disk. Prefer
entering keys in the app.

## Backup and restore

- Stop Nova (so WAL is checkpointed), then copy **`nova.db` and `keys/` together**. A database without its
  `master.key.dpapi` keeps your chats but every stored secret becomes unreadable.
- Restore **only on the same Windows account** (same user, same PC profile). DPAPI cannot unwrap the key elsewhere.
- Moving to a new PC or Windows account: copy the data, then delete `keys/master.key.dpapi` and re-enter your API
  keys. Chats, notes and missions carry over; secrets do not (by design).
- Copy `user-context/` too if you want your markdown docs and skills, and `agent-task-files/` if queued tasks must retain attachments.

## Purging data

The in-app account-delete flow removes a user's rows (`purgeLocalUserData` in `src/db/index.js`), their
`user-context/<id>/` folder and managed `agent-task-files/<id>/` attachments. To wipe everything, close Nova and
delete the data directory.

## Native module and packaging

`better-sqlite3` is a native addon. In development, the database code lives in `src/db` and runs in **plain Node
processes** (the agent runtime and the Next.js server started by `nova.js`), so the binding must match **Node's** ABI,
not Electron's.

- Install with scripts enabled (`npm ci`), or run `npm run db:fix-native` (downloads the prebuilt binary once, falls back
  to `npm rebuild better-sqlite3`, which needs MSVC build tools). Do not install with `--ignore-scripts`.
- `npm run db:ensure-native` checks the binding without touching the network; `nova.js` runs the same check at startup and
  exits with the exact fix command if it fails.
- Both processes resolve `better-sqlite3` from the repo-root `node_modules`, so exactly one binding exists in development.
  `hud/next.config.js` lists it in `serverExternalPackages` so Next never bundles the `.node` file.
- `hud/electron-builder.yml`: `asarUnpack` includes `node_modules/better-sqlite3/**` (a `.node` file cannot load from an
  asar), and user-data patterns (`.user`, `.nova-data`, `data/`, `keys/`, `*.db*`) are excluded from `files` so a
  developer's data can never ship in an installer.
- If the database is ever moved into the Electron main process, rebuild for Electron 44's ABI with `@electron/rebuild`
  (`npmRebuild: true`). Do not do this while the DB still runs in Node child processes: one binary cannot serve both ABIs.

### Packaging (Closure 4)

The installed app now hosts one execution plane: Electron's main process starts the Next.js production server
(`next({ dev: false })`'s custom-server API, API routes included, not a static export) and the `src/` runtime
scheduler in-process — no spawned child processes, no separately started `npm run dev`. See
`hud/electron/production-server.js` (started from `hud/electron/main.js`'s production branch) and
`hud/scripts/prepare-runtime-resources.mjs` (the packaging step that stages the repo-root `src/`, `dist/` and
`node_modules` into `hud/runtime-resources/`, which `electron-builder.yml`'s `extraResources` then copies to
`<resourcesPath>/runtime`).

- `NOVA_PACKAGED=1` is now set at the top of `hud/electron/main.js` whenever `app.isPackaged` is true, before the
  in-process Next server or runtime scheduler start, so `resolveDataDir()` resolves to `%APPDATA%\Nova`.
- `electron-builder.yml` sets `asar: false` for this app: Next's custom server reads its own `.next` build output off
  disk at request time, and `better-sqlite3`'s native addon cannot load from inside an asar archive at all, so the
  whole packaged app ships unarchived rather than fighting either constraint. This is a deliberate, conservative
  choice made without the ability to install-test it; revisit once someone has verified a real install.
- Because the DB now runs inside Electron's main process in the packaged build, its `better-sqlite3` copy needs
  Electron's Node ABI, not plain Node's. `prepare-runtime-resources.mjs` rebuilds **only the staged copy** under
  `hud/runtime-resources/node_modules/better-sqlite3` for Electron's ABI (via `prebuild-install --runtime electron`,
  falling back to `@electron/rebuild`); the real repo-root `node_modules/better-sqlite3` used by `nova.js` and
  `npm run dev` (plain Node child processes) is never touched, and stays on Node's own ABI. One binary cannot serve
  both ABIs — do not merge these two copies.
- The supported product is Windows x64 because secrets require Windows DPAPI and the runtime uses PowerShell. The
  macOS/Linux targets left in `electron-builder.yml` were not part of this closure and remain unsupported: packaging
  for them would need a non-Windows secrets design first.
- Not yet done in any session: an actual install-and-launch test of the packaged app (no `npm run dev` running,
  create an Agent Task, confirm the runtime scheduler claims it, quit cleanly). The pieces above were built and
  typechecked, and the staging script was run end-to-end producing a real `better-sqlite3` rebuild for Electron's
  ABI, but that binary was never load-tested inside an actual Electron process.

## Tests must never touch real data

Every smoke and unit test runs against a throwaway data directory: `scripts/smoke/lib/isolated-data-dir.mjs` sets
`NOVA_DATA_DIR` to a fresh temp dir before anything can open `nova.db` (import it first in a new script), and
`npm run test:node` preloads it. `scripts/smoke/local-db/no-real-data-writes-smoke.mjs` (part of
`npm run smoke:local-db`) opens the real `nova.db` read-only, runs a representative set of smokes with
`NOVA_DATA_DIR` removed from their environment, and fails if any row count or new path under the real data directory
changed.
