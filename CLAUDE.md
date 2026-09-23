# CLAUDE.md - NovaAIO

## Project Overview

NovaAIO is a local-first desktop AI agent orchestration platform. Fully local, open-source, user-owned data.

## CRITICAL RULES

**🚨 NEVER COMMIT CODE** - Only user commits. Build, test, prepare - leave unstaged.

**API Integration** - Read official docs first. Never guess formats or parameters.

## Tech Stack

- **Frontend Framework**: Next.js 16 (App Router)
- **UI**: React 19, TypeScript, Tailwind CSS 4
- **Desktop**: Electron 44 (packaging for .exe distribution). The packaged main process hosts the Next production server + `src/` runtime in-process (`hud/electron/production-server.js`)
- **Storage**: One local SQLite database (`nova.db`, `better-sqlite3`, WAL) + user settings mirrored into it (`kv_state` namespace `ui-storage`; `localStorage` is only a cache of that mirror); markdown workspace docs (SOUL/USER/AGENTS/MEMORY/SKILL.md) stay files
- **State Management**: React hooks, WebSocket for real-time updates
- **Agent Orchestration**: In-memory task queue, SQLite persistence (`agent_tasks`)
- **Integrations**: Local-only configs stored in `nova.db` (`integration_configs` / `integration_state`); secret fields are encrypted (see Security)

## Build & Run Commands

```bash
# Development (web only)
cd hud
npm run dev

# Development (Electron desktop)
cd hud
npm run electron:dev

# Production build
cd hud
npm run build

# Build Windows executable (build + electron:prepare-runtime + electron-builder)
cd hud
npm run electron:build:win

# Publish an installer + auto-update release to GitHub (needs GH_TOKEN; see docs/release/auto-update.md)
cd hud
npm run electron:publish:win

# Verify the packaged build boots and every route loads (repo root, after a build)
npm run smoke:production-boot
npm run smoke:production-routes

# Where the installed megabytes go (hud/, after a build)
npm run package:size

# Compile the TS agent core into dist/ plus re-export shims for JS-only modules
# (scripts/build/link-src-js-modules.mjs); repo root, needed by most src smokes and by packaging
npm run build:agent-core

# Offline token/caching harness (no API keys) and usage/cost smokes (repo root)
npm run smoke:token-baseline
npm run smoke:token-usage

# Smoke tests
cd hud
npm run test:smoke
```

## Directory Structure

```
hud/                    # Next.js frontend
  app/                  # Routes (home, chat, missions, integrations, agents)
    api/                # API routes (tasks, missions, integrations)
  components/           # React components (agents, chat, settings, ui)
  lib/                  # Libraries (agents, integrations, missions, settings)
  electron/             # Electron (main.js, preload.js, production-server.js, icons/nova.ico)
  tests/smoke/          # Playwright tests
src/                    # Backend runtime
.user/                  # Dev-mode data directory (gitignored): nova.db, keys/, user-context/ (see Storage Locations)
```

## Key Configuration Files

- `hud/package.json` - Dependencies, scripts, Electron config
- `hud/electron-builder.yml` - Electron build configuration (`asar: false`; runtime staged to `resources/runtime-resources` by `hud/scripts/prepare-runtime-resources.mjs`)
- `hud/next.config.js` - Next.js config (JS, not TS: the packaged server cannot transpile a `.ts` config)
- `hud/tsconfig.json` - TypeScript configuration
- `hud/tailwind.config.ts` - Tailwind CSS configuration
- `hud/playwright.config.ts` - Smoke test configuration
- `.gitignore` - Excludes `.user/`, test results, builds

## Storage Locations

All user data lives in the **data directory**, resolved by `src/db/paths.js` (`resolveDataDir()`) - the single resolver for the HUD, the agent runtime and `nova.js`:

1. `NOVA_DATA_DIR` if set (relative values resolve against cwd)
2. `NOVA_PACKAGED=1` -> `%APPDATA%\Nova` (never inside the install dir)
3. otherwise `<repo>/.user` (dev; gitignored). `src/.user` is a forbidden location.

Inside the data directory:

- `nova.db` (+ `-wal`, `-shm`) - the SQLite database: integrations, missions, job ledger, agent tasks, notes, chat threads/messages, sessions, `kv_state` (per-user preferences and small state), `tool_runs` (redacted tool-call audit trail), `llm_usage` (one row per LLM call: source chat/agent-task/mission, provider, model, input/output/cached/cache-write tokens, cost; migration 13; pruned after `NOVA_LLM_USAGE_RETENTION_DAYS`, default 90)
- `keys/master.key.dpapi` - the DPAPI-wrapped master key (see Security)
- `user-context/{userId}/` - markdown workspace docs (SOUL/USER/AGENTS/MEMORY.md, skills/*/SKILL.md) and per-user logs. `resolveUserContextRoot()` in `src/db/paths.js` is the only way to build this path.
- `memory.db` - agent memory index (separate SQLite file)
- `kv_state` namespace `ui-storage` - mirrored user settings (theme, orb color, profile, ...); browser `localStorage` is just a fast cache of this. Never secrets. Electron's own browser profile (`%APPDATA%\nova-hud`) is disposable.

Fresh-data release: there is no importer for the old JSON stores and no `.nova-data/` directory; old files are ignored.

## Security (API Keys & Secrets)

**Encryption**: AES-256-GCM. Stored ciphertext is a versioned `nv1:` payload; the data key is derived with HKDF from the master key.

**Master key**: random 32 bytes generated on first use, wrapped with **Windows DPAPI (CurrentUser scope)** and stored at `<dataDir>/keys/master.key.dpapi`. The plaintext key exists only in process memory. Nothing to configure: `NOVA_ENCRYPTION_KEY` and `~/.nova-encryption-key` are no longer used.

**Fail closed**: if DPAPI is unavailable (non-Windows, broken key file) writing a secret throws `SecretsUnavailableError`. There is no plaintext or weaker fallback.

**Storage**: every API key/token/webhook URL is encrypted before it is written to `nova.db`. Secrets are never returned unmasked to the browser (`toClientIntegrationsConfig` returns masked hints and `...Configured` flags). Tool-call audit rows (`tool_runs`) go through `redactSecrets()` and are capped at 2 KB per field.

**Legacy formats are not decrypted**: only `nv1:` payloads are understood. Users re-enter their keys after moving to this release.

**Platform**: Windows only (DPAPI).

**Honest limit**: this protects against a copied `nova.db`, a backup, or another Windows account. It does **not** protect against malware or a person running as the same Windows user. Backup/restore only works on the same Windows account (copy `nova.db` and `keys/` together). Details: `docs/security/local-data.md`; network egress audit: `docs/security/outbound-calls.md`.

## Code Conventions

**Files**: `kebab-case.tsx`, hooks: `use-{name}.ts`, API routes: `route.ts`

**TypeScript**: Strict mode, no `any`, interfaces for objects, types for unions

**Next.js 16**: Must `await params` in dynamic routes `const { id } = await params`

**Styling**: Tailwind CSS 4, `cn()` for conditionals, responsive `lg:` `xl:` `2xl:`

## Key Architecture

**Agent Tasks**: Max 5 concurrent, priority queue, cost tracking (incl. cached/cache-write tokens), SQLite persistence

**Prompt & caching**: `prompt-context-builder` returns a static system prompt (never depends on the user's message; keep it byte-stable) and a per-turn context block sent as a `<nova_turn_context>` prefix of the final user turn. Order for every provider: [static system][history][per-turn context + user message]. Claude requests carry `cache_control` breakpoints (`src/providers/anthropic-cache`); OpenAI/Gemini/Grok cache automatically. Every LLM call records usage through `src/providers/usage` into `llm_usage`; pricing lives in `src/providers/pricing`. Default models: gpt-5.6-terra, claude-sonnet-5, gemini-3.8-flash, grok-4.3. Measurements and plan: `docs/token-efficiency/`

**Storage**: One SQLite `nova.db` in the data directory (`src/db/paths.js`), DPAPI-protected encrypted secrets, markdown workspace docs as files

**Missions**: DAG workflow engine, ReactFlow canvas, durable job ledger with SQLite backing
**Electron**: Window mgmt (min 1024x768), single-instance lock. X quits the app (stops the in-process server + runtime); minimize goes to the taskbar and everything keeps running. System tray: Show/Hide/Check for Updates/Quit. Installed builds auto-update from GitHub Releases (`electron/auto-updater.js`, see `docs/release/auto-update.md`). Icons use `electron/icons/nova.ico` (nativeImage cannot decode SVG). Packaged mode sets `NOVA_PACKAGED=1` and `NOVA_WORKSPACE_ROOT`; agent tasks run in the `src/` runtime scheduler, not via Electron IPC

## Development Guidelines

**Before changes**: Read files, check patterns, verify types, test locally

**When adding features**: Types first → API → UI → tests → leave unstaged

**Releases**: only bump `NOVA_VERSION`; `hud/package.json`, the root `package.json` and both lockfiles follow it automatically (V.XX -> `0.XX.0`) via `npm run version:sync`, which every electron build/publish script runs first; `npm run smoke:version-sync` enforces it. Installed apps auto-update from GitHub Releases (`hud/electron/auto-updater.js`, `docs/release/auto-update.md`)

**Every change**: update `hud/lib/meta/version/index.ts` (history entry + `NOVA_VERSION`), `README.md` and this `CLAUDE.md` wherever the change affects them

**Responsive**: Min 1024x768, target 1920x1080, support 4K

**Error handling**: Proper status codes, user-friendly messages, log for debugging

## Version Management

Format: `V.XX Alpha (YYYY-MM-DD)` in `lib/meta/version/index.ts`

Current: **V.72 Alpha**

**Every new version updates all three files together — never just one:**

1. `hud/lib/meta/version/index.ts` — add a dated history entry at the top of Version History and bump `NOVA_VERSION`
2. `README.md` — bump the `**Status:** Alpha (V.XX)` line and update any setup, build, requirement or architecture text the release changed
3. `CLAUDE.md` — bump `Current:` above and update any stack, build, config or architecture notes the release changed

## Philosophy

This codebase will outlive you. Every shortcut becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down.

You are not just writing code. You are shaping the future of this project. The patterns you establish will be copied. The corners you cut will be cut again.

Fight entropy. Leave the codebase better than you found it.

**Remember: Build, test, prepare. User commits. Always.**
