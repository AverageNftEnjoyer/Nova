# Local data, storage and packaging

> Status: **partial.** W1 (DB foundation) wrote the "Where data lives" and "Native module and packaging" sections.
> W7 completes this file: what is stored where per table, key protection details, what leaves the machine, backup/restore,
> purge procedures, and the signed-off security checklist (see `docs/handoff/2026-09-20-v63/sqlite-contract.md` §11).

## Where data lives

All user data lives in one SQLite database, `nova.db`, on the user's own machine. Nothing is stored remotely.

| Situation | Data directory |
|---|---|
| `NOVA_DATA_DIR` is set | that directory (relative values resolve against the process cwd) |
| `NOVA_PACKAGED=1` (installed app) | `%APPDATA%\Nova` — never inside the install directory |
| Development (default) | `<repo>/.user` (gitignored) |

Inside the data directory:

- `nova.db`, `nova.db-wal`, `nova.db-shm` — the database (WAL mode; multiple Nova processes share it safely).
- `keys/` — the DPAPI-wrapped master key (written by the encryption module, W2).
- `imported-backup/` — only created if the user explicitly archives legacy JSON after a successful import.

`src/.user` is a forbidden location (enforced by `enforceWorkspaceUserStateInvariant` and by `resolveDataDir()`).

Schema is versioned with `PRAGMA user_version` plus a `migration:<n>` marker per applied migration in the `meta` table.
Migrations live in `src/db/migrations/` and are append-only once merged.

## Legacy JSON import

`runImport()` (`src/db/import/`) copies legacy per-user JSON/JSONL state into `nova.db`. It is idempotent (a
`import:<importer>:<userId>:done` marker per importer per user), transactional per user, and **never modifies or deletes
the original files**. `nova.js` runs it at startup. Importers whose workstream has not landed yet are skipped
(no marker), so nothing is ever recorded as imported prematurely.

## Native module and packaging

`better-sqlite3` is a native addon. The database code lives in `src/db` and runs in **plain Node processes** (the agent
runtime and the Next.js server started by `nova.js`), so the binding must match **Node's** ABI, not Electron's.

- Install with scripts enabled (`npm ci`), or run `npm run db:fix-native` (downloads the prebuilt binary once, falls back
  to `npm rebuild better-sqlite3`, which needs MSVC build tools). Do not install with `--ignore-scripts`.
- `npm run db:ensure-native` checks the binding without touching the network; `nova.js` runs the same check at startup and
  exits with the exact fix command if it fails.
- Both processes resolve `better-sqlite3` from the repo-root `node_modules`, so exactly one binding exists in development.
  `hud/next.config.ts` lists it in `serverExternalPackages` so Next never bundles the `.node` file.
- `hud/electron-builder.yml`: `asarUnpack` includes `node_modules/better-sqlite3/**` (a `.node` file cannot load from an asar),
  and user-data patterns (`.user`, `.nova-data`, `data/`, `keys/`, `*.db*`) are excluded from `files`.
- If the database is ever moved into the Electron main process, rebuild for Electron 44's ABI with `@electron/rebuild`
  (`npmRebuild: true`). Do not do this while the DB still runs in Node child processes: one binary cannot serve both ABIs.
- The Electron build is **not** an offline bundle today (`electron/main.js` loads `http://localhost:3000` in dev and a
  static `out/` in production, which cannot serve API routes). Full packaging of the Next + agent servers is out of scope
  for the SQLite migration.
