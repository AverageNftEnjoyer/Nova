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

`src/db/import/` is intentionally empty. If a migration is ever wanted it needs its own, explicit design; do not assume
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
| `memory.db` | Agent memory index (separate SQLite file) | Plain |
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
the key exactly as Nova does), or someone who is logged in as you. Nova's HUD API also currently has no origin check
(see the findings in `outbound-calls.md`), so treat the running app as trusted-local, not as a security boundary.

Also outside this protection: values you put in `.env` (for example `OPENAI_API_KEY`) are plain text on disk. Prefer
entering keys in the app.

## Backup and restore

- Stop Nova (so WAL is checkpointed), then copy **`nova.db` and `keys/` together**. A database without its
  `master.key.dpapi` keeps your chats but every stored secret becomes unreadable.
- Restore **only on the same Windows account** (same user, same PC profile). DPAPI cannot unwrap the key elsewhere.
- Moving to a new PC or Windows account: copy the data, then delete `keys/master.key.dpapi` and re-enter your API
  keys. Chats, notes and missions carry over; secrets do not (by design).
- Copy `user-context/` too if you want your markdown docs and skills.

## Purging data

The in-app account-delete flow removes a user's rows (`purgeLocalUserData` in `src/db/index.js`) and their
`user-context/<id>/` folder. To wipe everything, close Nova and delete the data directory.

## Native module and packaging

`better-sqlite3` is a native addon. The database code lives in `src/db` and runs in **plain Node processes** (the agent
runtime and the Next.js server started by `nova.js`), so the binding must match **Node's** ABI, not Electron's.

- Install with scripts enabled (`npm ci`), or run `npm run db:fix-native` (downloads the prebuilt binary once, falls back
  to `npm rebuild better-sqlite3`, which needs MSVC build tools). Do not install with `--ignore-scripts`.
- `npm run db:ensure-native` checks the binding without touching the network; `nova.js` runs the same check at startup and
  exits with the exact fix command if it fails.
- Both processes resolve `better-sqlite3` from the repo-root `node_modules`, so exactly one binding exists in development.
  `hud/next.config.ts` lists it in `serverExternalPackages` so Next never bundles the `.node` file.
- `hud/electron-builder.yml`: `asarUnpack` includes `node_modules/better-sqlite3/**` (a `.node` file cannot load from an
  asar), and user-data patterns (`.user`, `.nova-data`, `data/`, `keys/`, `*.db*`) are excluded from `files` so a
  developer's data can never ship in an installer.
- If the database is ever moved into the Electron main process, rebuild for Electron 44's ABI with `@electron/rebuild`
  (`npmRebuild: true`). Do not do this while the DB still runs in Node child processes: one binary cannot serve both ABIs.

### Packaging requirements (open items)

- The installed app must run with `NOVA_PACKAGED=1` so data goes to `%APPDATA%\Nova` and not next to the install
  directory. **Nothing in the repo sets this today** (`hud/electron/main.js` and `nova.js` do not); whoever launches the
  Next server and agent runtime from the installed app must export it to both processes.
- The Electron build is **not** an offline bundle today: `electron/main.js` loads `http://127.0.0.1:3000` in dev and a
  static `out/` in production, which cannot serve the API routes. Full packaging of the Next and agent servers is still
  to do.
- Windows x64 only (DPAPI, PowerShell helper, NSIS target).

## Tests must never touch real data

Every smoke and unit test runs against a throwaway data directory: `scripts/smoke/lib/isolated-data-dir.mjs` sets
`NOVA_DATA_DIR` to a fresh temp dir before anything can open `nova.db` (import it first in a new script), and
`npm run test:node` preloads it. `scripts/smoke/local-db/no-real-data-writes-smoke.mjs` (part of
`npm run smoke:local-db`) opens the real `nova.db` read-only, runs a representative set of smokes with
`NOVA_DATA_DIR` removed from their environment, and fails if any row count or new path under the real data directory
changed.
