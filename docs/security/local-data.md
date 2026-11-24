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
| `user-context/<userId>/assets/background/` | Custom background video/image (`<assetId>.<ext>`: mp4, png, jpg, webp, gif). Metadata and the active asset id are in `nova.db` (`kv_state`, namespace `background-assets`). Uploaded through `/api/media/background` (chunked, magic-byte checked, 512 MB video / 25 MB image cap; SVG is rejected because it can carry script). Not stored in browser IndexedDB, so it survives origin/port changes and is included when you copy `user-context/`. | Plain (personal media) |
| `agent-task-files/<userId>/<taskId>/` | Immutable, size-limited copies of files explicitly attached to Agent Tasks | Plain. Database rows store relative managed paths plus SHA-256 digests; original host paths are not exposed to models or clients. |
| `sessions.json`, `transcripts/` | Runtime session metadata and conversation transcript artifacts | Plain |
| `archive/logs/` | Coinbase/ChatKit observability JSONL | Plain; no secrets by design |

User settings (profile, theme, notifications, personalization, calendar categories, home preferences) are mirrored into `nova.db` (`kv_state`, namespace `ui-storage`, allowlist in `hud/lib/settings/ui-storage/keys.ts`, via `/api/ui-storage`). Browser `localStorage` is only a fast cache of that mirror. Never secrets.

**Electron browser profile.** Separately from the data directory, Electron keeps its own Chromium profile (Local Storage, IndexedDB, caches) in `%APPDATA%\nova-hud`. It holds nothing that is not also in `nova.db` or on disk (settings are mirrored in `nova.db`, custom background media is in `user-context/<userId>/assets/background/`), so it is safe to delete; Nova rebuilds it and re-hydrates settings from `nova.db`. It is not part of a backup.

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
- Copy `user-context/` too if you want your markdown docs, skills and custom background media (`user-context/<userId>/assets/background/`), and `agent-task-files/` if queued tasks must retain attachments. Mirrored settings (`ui-storage`) and background-media metadata live in `nova.db`, so they come along with it. `%APPDATA%\nova-hud` does not need backing up.

## Purging data

The in-app account-delete flow removes a user's rows (`purgeLocalUserData` in `src/db/index.js`), their
`user-context/<id>/` folder (including its background media, purged explicitly via `purgeBackgroundAssets`) and managed `agent-task-files/<id>/` attachments. To wipe everything, close Nova and
delete the data directory.

## Native module and packaging

`better-sqlite3` is a native addon. In development, the database code lives in `src/db` and runs in **plain Node
processes** (the agent runtime and the Next.js server started by `nova.js`).

- Install with scripts enabled (`npm ci`), or run `npm run db:fix-native` (downloads the prebuilt binary once, falls back
  to `npm rebuild better-sqlite3`, which needs MSVC build tools). Do not install with `--ignore-scripts`.
- `npm run db:ensure-native` checks the binding without touching the network; `nova.js` runs the same check at startup and
  exits with the exact fix command if it fails.
- Both processes resolve `better-sqlite3` from the repo-root `node_modules`, so exactly one binding exists in development.
  `hud/next.config.js` lists it in `serverExternalPackages` so Next never bundles the `.node` file.

### Packaging

The installed app hosts one execution plane: Electron's main process starts the Next.js production server
(`next({ dev: false })`'s custom-server API, API routes included, not a static export) and the `src/` runtime
scheduler in-process, with no spawned child processes. See `hud/electron/production-server.js` (started from the
production branch of `hud/electron/main.js`) and `hud/scripts/prepare-runtime-resources.mjs` (stages the repo-root
`src/`, `dist/` and `node_modules` into `hud/runtime-resources/`, which `electron-builder.yml`'s `extraResources` copies
to `<resourcesPath>/runtime-resources`).

- `NOVA_PACKAGED=1` is set at the top of `hud/electron/main.js` whenever `app.isPackaged` is true, before the in-process
  Next server or runtime scheduler start, so `resolveDataDir()` resolves to `%APPDATA%\Nova`.
- `electron-builder.yml` sets `asar: false` (there is no `asarUnpack`): Next's custom server reads its own `.next` build
  output off disk at request time, and the app ships unarchived so the native addon loads from a real directory.
- **No Electron-ABI rebuild.** `better-sqlite3` ^13 is N-API and ships a bundled prebuild
  (`prebuilds/win32-x64.node`) that is not pinned to Node's or Electron's ABI, so the same binary serves both.
  `prepare-runtime-resources.mjs` detects this (`gypfile: false` plus the prebuild present) and skips any rebuild; the
  repo-root copy used by `nova.js` is never touched.
- User-data patterns (`.user`, `.nova-data`, `data/`, `keys/`, `*.db*`) are excluded from `files` so a developer's
  data can never ship in an installer.
- The supported product is Windows x64 only (secrets require Windows DPAPI and the runtime uses PowerShell).
  `electron-builder.yml` has only an NSIS (per-user, `perMachine: false`) Windows target.
- Installed apps update themselves from GitHub Releases; see [`../release/auto-update.md`](../release/auto-update.md).
  Updates never touch `%APPDATA%\Nova`.
- `npm run smoke:production-boot` boots the unpacked build (`hud/dist/win-unpacked`) and claims a queued agent task.

## Tests must never touch real data

Every smoke and unit test runs against a throwaway data directory: `scripts/smoke/lib/isolated-data-dir.mjs` sets
`NOVA_DATA_DIR` to a fresh temp dir before anything can open `nova.db` (import it first in a new script), and
`npm run test:node` preloads it. `scripts/smoke/local-db/no-real-data-writes-smoke.mjs` (part of
`npm run smoke:local-db`) opens the real `nova.db` read-only, runs a representative set of smokes with
`NOVA_DATA_DIR` removed from their environment, and fails if any row count or new path under the real data directory
changed.
