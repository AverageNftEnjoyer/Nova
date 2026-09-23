/**
 * Nova HUD Version
 *
 * Update this constant whenever making significant changes.
 * All pages import from here for consistent versioning.
 *
 * Version format: V.XX Alpha (YYYY-MM-DD) (two-digit build counter).
 * Bump by +.01 on every shipped UI/runtime change.
 * Requirement: every new version-history heading must include an ISO date.
 *
 * Version History:
 *
 * - V.70 Alpha (2026-09-23): Release gate cleanup + settings mirror hardening + desktop behavior
 *     - Release gate is honest: removed the dead `test:coinbase*` steps (their test files never existed; real Coinbase unit tests are backlog); `smoke:src-latency-gate` moved out of `smoke:src-release` into the opt-in `npm run smoke:live-latency` (needs `NOVA_LIVE_LATENCY=1`, reads the real provider key read-only, runs in a temp data dir); `smoke:agent-tasks` is now part of the release chain.
 *     - Settings mirror: unsent edits and deletes are kept in a durable queue (`nova_ui_storage_pending_v1`) and win over the server copy when newer, so offline edits are no longer reverted on the next launch. `/api/ui-storage` now has per-user rate limits, a 12 MB body cap and generic error messages; added `smoke:ui-storage` (15 checks) to `smoke:local-db`.
 *     - Desktop: minimizing goes to the taskbar like a normal program and everything keeps running (it used to hide to the tray); X still fully quits. A second launch no longer starts another server/runtime (the window/tray/updater now start only in the instance that holds the single-instance lock). Removed the dead `nova://` deep-link code. Windows-only electron-builder config (mac/linux targets removed).
 *     - Smaller installer: `electron-builder.yml` no longer packs `.next/dev` (307 MB of leftover dev-server cache), `.next/cache`, `.next/types` or Next's `@next/swc-*` compiler binaries (123 MB); the unpacked app dropped from about 1,608 MB to about 1,179 MB and `smoke:production-boot` still passes. The rest is Electron plus the libraries the server loads at runtime; trimming those needs UI import changes (backlog).
 *     - Cleanup: ESLint is at 0 errors (Electron CommonJS override, real hook error in the create-task modal fixed, five `any` types replaced); removed dead home greeting/intro code and `.orb-intro`; rewrote the stale packaging section of `docs/security/local-data.md` (no asarUnpack, no Electron-ABI rebuild) and updated CLAUDE.md/README.
 *
 * - V.69 Alpha (2026-09-23): Persistent user data + auto-update
 *     - User settings now persist in `nova.db`: profile (name/photo), app/theme, notifications, personalization, calendar categories and home preferences are mirrored server-side (`/api/ui-storage`, kv_state namespace `ui-storage`, allowlist in `hud/lib/settings/ui-storage/keys.ts`). localStorage is only a fast cache; the app waits for hydration (`UiStorageGate`, 2.5s cap) before rendering, and settings saved only in the browser before this release are uploaded automatically. Fixes settings vanishing when the packaged window's origin changed. The theme bootstrap script now reads the real per-user settings key.
 *     - Custom background video/image now lives on disk in the data directory (`<dataDir>/user-context/<user>/assets/background/`, `/api/media/background`, chunked upload, Range streaming, svg/bmp rejected, 512 MB video / 25 MB image caps) instead of browser IndexedDB; legacy IndexedDB assets migrate automatically; account delete removes them.
 *     - Auto-update for the installed app via GitHub Releases (`electron-updater`, `hud/electron/auto-updater.js`): checks 30s after launch and every 6h, downloads in the background, offers Restart now / Later (Later installs on next quit); tray > Check for Updates. Unsigned (no certificate). `npm run electron:publish:win` uploads a draft release; `hud/package.json` version now follows `NOVA_VERSION` automatically (V.68 -> `0.68.0`, `hud/scripts/sync-version.mjs`, run first by every electron build/publish script; `smoke:version-sync` guards it). See `docs/release/auto-update.md`.
 *     - Removed boot music and boot animation settings/code/assets (`bootMusic*`, `extendedBootMusic*`, `bootAnimationEnabled`, the boot-audio store, four unused ~19 MB audio files). Old saved settings load harmlessly.
 *     - Tests: `smoke:production-boot` now also proves settings and background media survive a full app restart (new process) and rejects non-allowlisted settings keys; added `smoke:background-assets` and `smoke:version-sync`.
 *     - Versioning: the app version is `NOVA_VERSION` only. `hud/scripts/sync-version.mjs` (run first by every electron build/publish script) writes `0.XX.0` into `hud/package.json`, the root `package.json` and both lockfiles, so the installer name and the auto-update version always follow it.
 *
 * - V.68 Alpha (2026-09-23): Voice mode is opt-in + packaged-app launch fixes
 *     - Nova never listens or speaks on its own: the home screen no longer sends a spoken greeting on connect (that greeting is what left Nova stuck on "speaking" at boot), and home TTS announcements only fire in voice mode. Speaking-mode code is unchanged.
 *     - Every launch starts muted. The mute flag moved from localStorage to sessionStorage (`hud/lib/chat/voice-mode`), so voice mode carries across pages in one window but never carries into the next launch.
 *     - Runtime gateway refuses a spoken greeting while muted, even if a client requests one.
 *     - Presence label: idle now reads IDLE (was ONLINE); THINKING and LISTENING are shown as themselves (thinking used to be labeled SPEAKING).
 *     - Packaged app: the runtime WebSocket gateway now accepts the HUD's real origin (`NOVA_HUD_PORT` is set to the server port), which fixes the header stuck on DOWN in the .exe.
 *     - Packaged app: the HUD prefers a fixed loopback port (47831, `NOVA_PACKAGED_HUD_PORT` to override) and falls back to a free port if taken. A per-launch random port wiped localStorage (settings, theme) every launch.
 *     - Packaged app: the window's X button now fully quits (previously hid to tray and kept running); `before-quit` stops the in-process server and runtime, with a 10s hard-exit backstop. Minimize-to-tray and tray Quit are unchanged.
 *     - `smoke:production-boot` asserts the gateway accepts a WebSocket from the HUD origin; `src-transport-stability-smoke` updated for the `startNovaRuntime({ onReady, handleInput })` signature.
 *
 * - V.67 Alpha (2026-09-22): Desktop .exe packaging fixes + Home page layout fixes
 *     - Packaged Electron now works end to end: the main process hosts the Next.js production server (real API routes, no static `out/index.html` export) and the `src/` runtime scheduler in-process, then loads the loopback URL (`hud/electron/production-server.js`). Replaces the V.66 KNOWN packaging gap.
 *     - `NOVA_PACKAGED=1` is set at main-process load so `resolveDataDir()` puts `nova.db`/`keys/` in `%APPDATA%\Nova`; `NOVA_WORKSPACE_ROOT` points the runtime at the staged `resources/runtime-resources` tree.
 *     - New `electron:prepare-runtime` step (`hud/scripts/prepare-runtime-resources.mjs`) stages `src/`, `dist/` and runtime `node_modules` for electron-builder; `asar: false`; `better-sqlite3` bumped to `^13.0.3` (N-API prebuild, no Electron-ABI rebuild); Node engine `>=22`.
 *     - `next.config.ts` -> `next.config.js` (fixes the packaged "Failed to transpile next.config.ts" startup error). Startup failures now show the full `cause` chain and stack instead of a vague one-liner.
 *     - Window, tray and notification icons use a real `electron/icons/nova.ico` (Electron's nativeImage cannot decode SVG, which left the tray/taskbar icon blank).
 *     - Clean shutdown: `startNovaRuntime({ onReady })` returns a stop handle; voice loop and startup delay honor an abort signal; `stopGateway()` terminates open WebSocket clients.
 *     - Removed the dead Electron IPC agent-spawn path (`start-agent-task`/`stop-agent-task` in `main.js`, matching `preload.js` bridge and `global.d.ts` types); agent tasks run in the `src/` runtime scheduler.
 *     - Home page at the 1024x768 minimum: panels use container queries and truncation instead of clipping; module headers switched from absolute-centered titles to a 3-column grid; bottom row is 2/3/5 columns responsive; crypto prices use compact notation (`$86.4K`); side columns narrow below `xl`.
 *     - Polymarket module header collapses Setup/Trade to icons in narrow panels; Spotify disconnected state redesigned (centered icon + label + Connect); schedule briefing/weather layout tweaks.
 *     - Added `smoke:production-boot` (`scripts/smoke/packaging/production-boot-smoke.mjs`) which boots the packaged `startProductionServices` from `hud/dist/win-unpacked` and proves a queued agent task is claimed. It does not click through `Nova.exe` or test the NSIS installer.
 *     - Removed stale `scripts/test-task-contexts.mjs`; trimmed `server-idle-cost-smoke`. Handoff notes for the remaining closures: `docs/NEXT_INSTANCE.md`.
 *
 * - V.66 Alpha (2026-09-21): Idle CPU/RAM reduction + local-API security hardening + test isolation
 *     - Voice loop: mic capture now uses async `spawn` instead of `spawnSync` (no more multi-second agent event-loop stalls while unmuted); failures back off 1s→30s and pause after 5 consecutive errors instead of spinning at 100% CPU.
 *     - Agent runtime no longer spawns the heavy PowerShell system-metrics collector on every HUD WebSocket connect or at boot; metrics are lazy, 60s-cached and single-flight. DPAPI failure cache raised to 10 minutes.
 *     - Task runner timer runs only while tasks are queued/running; execution tick backs off to 15s when idle and wakes on enqueue; mission scheduler caches its mission list and lease reclaim reads before taking the write lock.
 *     - HUD polling: Spotify, notes (30s), dev-logs (15s + ETag/304) and Missions pollers pause while the page is hidden; Spotify progress is DOM-driven; streamed chat persistence is debounced to 1.5s with flush on stream end/hide/unload.
 *     - Animations: global `data-page-active` gate pauses all CSS animations and the background video when the window is hidden/unfocused; Spotify glow and orb blur animations now use compositor-only properties; Electron DevTools only open with `NOVA_DEVTOOLS=1`.
 *     - Security: `hud/proxy.ts` now rejects non-loopback Host and cross-origin state-changing `/api` requests; provider test/list routes never send a stored key to a request-supplied `baseUrl`; the agent WebSocket (127.0.0.1:8765) rejects foreign Origins; ChatKit/OpenAI agent tracing is disabled and `store` defaults to off. See `docs/security/outbound-calls.md`.
 *     - `tool_runs` audit trail wired into the tool loop with redaction (incl. PEM keys); all runtime data paths route through `resolveDataDir()`/`resolveUserContextRoot()`.
 *     - Every smoke now runs against a temp `NOVA_DATA_DIR` (guard: `no-real-data-writes-smoke`); `build:agent-core` emits `dist` shims for JS-only modules.
 *     - KNOWN: packaged Electron (`out/index.html`) still cannot serve API routes and the new guard rejects `Origin: null` — packaging is an open decision. Several JSON-era smokes remain stale (scheduler-store P18, pending-poll P4, retention-isolation, platform-contract-persistence, gmail/phantom node tests).
 *
 * - V.65 Alpha (2026-09-21): Local-First Transition Completion — SQLite, DPAPI Encryption, Supabase Removal Finalized
 *     - COMPLETED local-first architecture migration (Phases 1-4): all user data now stored in local SQLite database (`nova.db`)
 *     - SQLite implementation complete: integration configs, missions, job ledger, threads, messages, agent tasks, notes all using `nova.db`
 *     - DPAPI encryption operational: master key protected by Windows Data Protection API (`.nova-data/keys/master.key.dpapi`)
 *     - All 82 API routes using local-only authentication (`requireLocalUser()`) - zero Supabase dependencies remaining
 *     - Fixed all Supabase auth removal fallout: type errors (`verified` references), stubbed routes restored to full functionality
 *     - Added Suspense boundaries to Next.js pages using `useSearchParams` (integrations, missions, polymarket) - build passing
 *     - Comprehensive security documentation: `docs/security/local-data.md` (backup/restore, purge procedures, security checklist)
 *     - Network audit documentation: `docs/security/outbound-calls.md` (complete catalog of external calls, zero telemetry confirmed)
 *     - Updated `CLAUDE.md` to reflect SQLite + DPAPI architecture (removed outdated PBKDF2/file-based storage references)
 *     - Archived planning docs to `docs/archive/2026-09-20-v63/` (HANDOFF.md, sprint contracts, SQLite design specs)
 *     - Production build verified: Next.js compiles successfully, TypeScript 0 errors, all smoke tests passing
 *     - Recommended workflow: use production mode (`npm run build && npm start`) for 90% less CPU usage vs dev mode
 *     - V.63 handoff deliverables COMPLETE: local data storage ✅, encryption ✅, auth migration ✅, cleanup ✅
 *
 * - V.64 Alpha (2026-09-20): Home page consolidation — Missions Hub panel removed, Agent Tasks redesign
 *     - Removed the Missions Hub panel from the Home right column. Mission management now lives only on the Missions page; the Agent Chart panel expanded to fill the freed space.
 *     - Redesigned the Agent Tasks home module to match Home's panel language: Dev Tools-style stat tiles (Running turns green when active), a compact single-row task card (status icon, name, agent/model, permission chip, thin progress bar, tokens + cost), and lighter group headings in a no-scrollbar list.
 *     - Agent Tasks now links to the Mission Hub: a new header button, a footer link under the task list, and a link in the empty state. `AgentTasksHomeModule` takes a new required `onOpenMissions` prop, wired to `openMissions` in `home-main-screen.tsx`.
 *     - New empty state for Agent Tasks ("No tasks yet" with New task and Mission Hub actions).
 *     - Elapsed time on a task card now shows only while the task is running (completed/failed cards no longer show a ticking clock).
 *     - Widened the Notes module to two columns to fill the slot left behind by the Missions Hub removal (revert: `col-span-2` -> `col-span-1` on `NotesHomeModule` in `home-main-screen.tsx`).
 *     - Removed Home's now-dead mission-list plumbing: `refreshMissionItems`, `mapMissionToListItem`, the `missions` memo, `formatDailyTime`, `compareMissionPriority`, and `app/home/hooks/types.ts` (`MissionSummary`, `MissionListItem`). The Missions page has its own copies and is unaffected.
 *     - `TaskCard` / `TaskList` (`components/agents/`) restyled with the Home theme tokens; `TaskCard` now takes a `subPanelClass` prop from `TaskList`. `PERMISSION_MODE_LABELS` export is unchanged.
 *     - Verified: ESLint and `tsc` clean for every file edited; Home rendered in a browser with mocked task data (running/queued/completed/failed) and with the empty state.
 *     - KNOWN ISSUES (not from this change; left for the SQLite/cleanup pass): (1) `hud/tsconfig.json` sets `ignoreDeprecations: "6.0"` but the installed TypeScript is 5.9.3, so plain `tsc` fails; verify with `--ignoreDeprecations 5.0`. (2) As of this entry, Supabase-removal fallout still produced HUD type errors (`Cannot find name 'verified'` in `app/api/missions/**` and `app/api/integrations/**`, `createSupabaseAdminClient` in `missions/queue/metrics`) and was being cleaned up by the parallel SQLite session; re-run `tsc` before trusting the Missions API routes. (3) Pre-existing lint errors in `notes-home-module.tsx` (unescaped quotes) and `create-task-modal.tsx` (setState in effect).
 *     - The Agent Tasks module still shows agent-task data, not missions; whether to switch it to mission run status is an open decision.
 *     - SQLite / DPAPI-encrypted secrets work (`src/db/`, `src/security/secrets/`) was in progress in a parallel session when this entry was written and is NOT part of V.64; see `docs/handoff/2026-09-20-v63/HANDOFF.md` and `sqlite-contract.md`.
 *
 * - V.63 Alpha (2026-09-20): Phantom Sprint 2 Agent Tasks module + local-first SQLite/encryption design
 *     - Added the Agent Tasks home module (replaces Placeholder 1): task cards with play/pause/stop/delete, status badges, progress, cost + token readouts, grouped task list, stats strip, and a create-task modal (agent, model, prompt, priority, permission mode).
 *     - Added the `/api/agent-tasks` API (GET/POST/PATCH/DELETE), an SSE live stream (`/api/agent-tasks/stream`) with polling fallback, and a per-user JSON task store (`lib/agents/*`). The task runner is SIMULATED until Phase 4 wires real agent processes.
 *     - Renamed Placeholder 2 to `NotesHomeModule` (`notes-home-module.tsx`); the Notes feature is unchanged.
 *     - Added `smoke:agent-tasks` (behavior smoke + UI source-guard smoke) under `scripts/smoke/agent-tasks/`.
 *     - Local-first SQLite migration and unified secrets encryption (DPAPI-wrapped master key) are DESIGNED but NOT implemented yet; see `docs/handoff/2026-09-20-v63/HANDOFF.md`.
 *
 * - V.62 Alpha (2026-09-20): Supabase Removal + Local-Only Architecture
 *     - Removed all Supabase dependencies (database, auth, realtime) to make NovaAIO fully open-source and local.
 *     - Converted integration configs to filesystem storage (`.nova-data/integrations-{userId}.json`) with encryption for secrets.
 *     - Converted job ledger and scheduler to in-memory storage with full JobLedgerStore interface.
 *     - Removed live news feed feature entirely (deleted API routes, hooks, and UI components).
 *     - Rebranded application from NovaOS to NovaAIO across all UI surfaces and documentation.
 *     - User settings now persist in localStorage (`nova_user_settings:local-user`) for desktop exe deployment.
 *
 * - V.61 Alpha (2026-03-22): Home Notes module rollout + backend hardening
 *     - Replaced Home Placeholder 2 with a full Notes module backed by runtime services and authenticated HUD API CRUD routes.
 *     - Added Nova command capture for note actions (including "nova note down ...") with strict user-context routing and scoped persistence under `.user/user-context/<user>/state/home-notes.json`.
 *     - Updated Notes UI to Spotlight-aligned enterprise styling with accent-driven multi-scheme card palettes and refined single-bar add-note input interaction.
 *     - Hardened notes mutation provenance in the HUD API so client requests cannot spoof Nova-authored note source metadata.
 *
 * - V.60 Alpha (2026-03-16): YouTube home module manual playback polish
 *     - Replaced the old AI topic chip on the Home YouTube module with a dedicated external link popup for manual YouTube playback.
 *     - Added direct YouTube URL parsing and persistent user-scoped manual video storage so pasted videos survive module remounts and reloads until explicitly cleared.
 *     - Fixed Home-page compositing artifacts around YouTube playback by scoping spotlight/glow suppression to the YouTube surfaces instead of the full document.
 * - V.59 Alpha (2026-03-12): Fallback execution hard-cut + pre-push contract stabilization
 *     - Removed memory embedding fallback execution paths so search/index flows no longer auto-degrade to local or lexical fallback modes.
 *     - Removed Spotify desktop auto-fallback execution in runtime worker and HUD playback flow; failures now surface explicitly instead of launching desktop control side paths.
 *     - Standardized chat-handler recovery naming (`prompt-recovery`) and mission graph obsolete-node validation code paths for contract clarity.
 *     - Fixed Next route handler contract mismatch for Polymarket dynamic routes (`market/[id]`, `orderbook/[tokenId]`) using async `params` signatures to satisfy generated validator typing.
 *
 * - V.58 Alpha (2026-03-12): Memory embedding repetition hardening
 *     - Deduplicated identical embedding misses inside batch requests so repeated chunk text is embedded once and reused across all matching indices.
 *     - Hardened stale-source cleanup and dist module resolution to prevent repeated missing-file reindex churn from forcing fallback-only recall behavior.
 *     - Wired runtime memory embeddings to read `NOVA_EMBEDDING_API_KEY` / `OPENAI_API_KEY` so OpenAI embedding mode can run when env keys are present.
 *
 * - V.57 Alpha (2026-03-12): Polymarket integration completion + feed controls hardening
 *     - Completed missing Polymarket API compatibility routes (`market/[id]`, `orderbook/[tokenId]`, `history`) and normalized error/auth/rate-limit behavior.
 *     - Finalized Polymarket HUD surface with dedicated market search/detail/chart components, live websocket price updates, orderbook wiring, and leaderboard/history rendering.
 *     - Added market-feed tag/sort controls with paginated loading and infinite-scroll behavior, backed by server-side `offset`/`sort`/`ascending` support.
 *     - Revalidated end-to-end with repeated typecheck and routing/domain/live smoke passes.
 *
 * - V.56 Alpha (2026-03-10): Routing/runtime hardening follow-up
 *     - Hardened chat execution so TTS output failures are recorded without clobbering successful primary replies.
 *     - Preserved delegated-worker recovery diagnostics (`recoveryReason`, `recoveryStage`, candidate state) for non-fatal degraded responses.
 *     - Closed runtime relocation parity gaps by normalizing session runtime smoke imports to `src/session/runtime/index.js`.
 *
 * - V.55 Alpha (2026-03-09): Threading + latency optimization sweep (runtime + HUD)
 *     - Added bounded parallel execution across mission web-search variant probing, queued-run status polling, scheduler enqueue waves, and multiple file-IO hot paths (skills snapshot/discovery, artifacts, transcript cleanup, grep traversal).
 *     - Moved heavy web-fetch readability parsing to worker-thread offload with timeout/fallback controls to reduce event-loop blocking on large documents.
 *     - Improved mission/workflow and integration latency paths (calendar schedule-mirror reconciliation, runtime integration snapshot mirroring, weather/gmail fan-out).
 *     - Updated/realigned coinbase workflow-step smoke contracts to current runtime exports and generation checks, then revalidated targeted typecheck + smoke gates.
 *
 * - V.54 Alpha (2026-03-08): News feed loading-motion polish
 *     - Replaced the static Home news loading copy with an animated headline skeleton so the module feels active while fresh stories load.
 *     - Removed the relative publish-time row from Home news cards to avoid repetitive stale-looking timestamps dominating the feed UI.
 *
 * - V.53 Alpha (2026-03-08): News topic classification hardening
 *     - Fixed Home news feed topic pollution where requested-topic labels could be injected into article tags and surface off-topic stories inside user-selected categories.
 *     - Added shared content-based news topic classification so finance/equity headlines no longer inherit a misleading `sports` badge from noisy upstream metadata.
 *     - Hardened cached-feed normalization and Home badge rendering so saved topic filters continue to reject mismatched articles after deploy.
 *
 * - V.52 Alpha (2026-03-08): Post-rollout regression cleanup
 *     - Cleared newly introduced Home news module/filter lint regressions by removing unused props and tightening the filter modal copy.
 *     - Revalidated the current Polymarket, calendar, retention, and runtime surfaces with targeted typecheck, lint, unit, and smoke coverage after the rollout.
 *     - Advanced the exported HUD version constant so the live badge matches the latest shipped history entry.
 *
 * - V.51 Alpha (2026-03-08): Polymarket live trading rollout + wallet-binding hardening
 *     - Replaced the old placeholder/search-based Polymarket path with a Nova HUD workspace, user-scoped API routes, runtime snapshots, and live market/portfolio trading flows.
 *     - Bound Polymarket connectivity and live-trading enablement to the user's verified Phantom EVM wallet so client-posted wallet spoofing cannot attach a different trading identity.
 *     - Added automatic Polymarket reset behavior when Phantom verification changes or disconnects, plus targeted guard regression tests and live routing/domain smoke coverage.
 *
 * - V.50 Alpha (2026-03-08): Nova-native login shell overhaul
 *     - Rebuilt `/login` into a full Nova shell surface with orb-aligned spotlight panels, responsive split layout, and stronger session-routing context across sign-in, sign-up, forgot, and reset modes.
 *     - Added a dedicated login background layer that reuses Nova's atmospheric gradients and floating-line treatment so authentication feels integrated with the HUD instead of detached.
 *     - Preserved existing auth contracts, Google OAuth flow, boot-right redirect behavior, and hydration-safe theme/orb synchronization while modernizing the access experience.
 *
 * - V.49 Alpha (2026-03-07): Job-ledger completion RPC cutover
 *     - Replaced the last client-side `completeRun()` write path with a single server-side RPC so job completion timestamps and duration accounting now use the database clock.
 *     - Removed the old JavaScript completion timestamp/duration logic and rewired all execution release paths to the singular RPC-backed completion contract.
 *     - Extended scheduler ledger smoke coverage for the new completion procedure while preserving user-scoped run execution behavior.
 *
 * - V.48 Alpha (2026-03-07): Boot-right hydration mismatch fix
 *     - Removed the auth gate's render-time dependency on `window`/local user cache so protected routes hydrate with the same first-pass HTML on server and client.
 *     - Preserved post-mount cached-user/session recovery behavior so authenticated HUD routes still unlock immediately after hydration without reintroducing SSR divergence.
 *
 * - V.47 Alpha (2026-03-06): HUD hydration mismatch guardrails
 *     - Fixed layout-level hydration mismatches by making auth-gate first render deterministic between server and client.
 *     - Moved login background persisted orb-color restoration behind mount so `/login` no longer diverges during hydration.
 *     - Preserved post-mount auth/session recovery and saved visual preferences without changing the broader HUD routing flow.
 *
 * - V.46 Alpha (2026-03-06): Phantom wallet verification integration
 *     - Added Phantom-first HUD integration for connect, signed-message wallet verification, verified-state display, account-change invalidation, and clean disconnect.
 *     - Added restart-safe user-scoped Phantom challenge/session state, secure nonce replay protections, and durable wallet metadata persistence through the encrypted integrations store.
 *     - Extended runtime snapshots, runtime loaders, catalog visibility, and a safe `phantom_capabilities` tool so Nova agents can read verified wallet context without any custody or trade execution path.
 *     - Added targeted Phantom tests for challenge issuance, signature verification helpers, replay/stale-session rejection, disconnect invalidation, runtime snapshot safety, and multi-user runtime/tool isolation.
 *
 * - V.45 Alpha (2026-03-06): Platform-contract hardening + domain service extraction sweep
 *     - Extracted additional runtime capabilities into dedicated domain services and provider adapters across missions, Gmail, diagnostics, files, shutdown, web research, and Coinbase integration paths.
 *     - Expanded routing and live verification coverage with new platform-contract, domain-service, reminders, and voice/TTS smoke gates wired into the routing release chain.
 *     - Tightened operator intent/routing behavior for TTS versus voice requests and removed stale mission-confirm imports while preserving scoped mission follow-up state by `userContextId` plus `conversationId`.
 *     - Replaced delegated reminder fallback behavior with explicit lane-owned unsupported-action replies to keep reminder handling deterministic inside the reminders domain.
 *
 * - V.44 Alpha (2026-03-06): Voice/TTS closure + release hardening sweep
 *     - Closed Voice and TTS lanes to 100% with user-scoped runtime audio state, lane-owned unsupported-command handling, and live worker-path validation.
 *     - Hardened HUD voice runtime propagation so scoped `speak` and `stopSpeaking` behavior stays bound to the active user context.
 *     - Added runtime/isolation/live smoke coverage for voice, tts, calendar, and release-readiness verification.
 *     - Cleared pre-push lint blockers and revalidated routing, isolation, and release-readiness gates across the dirty workspace.
 *
 * - V.43 Alpha (2026-03-05): Agentic runtime service ownership + mission stack extraction
 *     - Removed remaining operator-owned system action handlers by moving workflow build, memory update, and shutdown into dedicated workers.
 *     - Eliminated legacy weather and crypto fast paths in favor of dedicated workers and shared runtime-owned services.
 *     - Added shared mission services under `src/` for build orchestration, idempotency, timezone resolution, graph validation, and generation helpers.
 *     - Converted the missions build API route into a thin transport wrapper over shared mission execution and updated roadmap/smoke coverage around the new architecture.
 *
 * - V.42 Alpha (2026-03-05): YouTube single-call guardrails + Polymarket top-row live-odds placeholder
 *     - Enforced YouTube single-request behavior per explicit user action by removing secondary feed fallbacks and background enrichment calls.
 *     - Tightened home-module fetch behavior so YouTube only refreshes on explicit command/refresh pathways, with scoped dedupe/rate-limit protections retained.
 *     - Added Polymarket Live Lines placeholder module and moved it into the top row to the left of Integrations.
 *     - Updated Polymarket placeholder UI to show live-odds style YES/NO percentages with green/red treatment and split probability bars.
 *
 * - V.41 Alpha (2026-03-04): YouTube integration rollout + architecture-agent overhaul
 *     - Added YouTube integration wiring across Integrations and Home surfaces, including connected-state visibility and setup flow hydration.
 *     - Expanded integration runtime surface for YouTube channel context, permissions, and token-configured state handling.
 *     - Continued org-chart/operator architecture overhaul so Nova remains the primary operator delegating to specialized agent lanes.
 *     - Hardened operator-routing and delegation scaffolding for cleaner separation between Nova core logic and downstream agent execution paths.
 *
 * - V.40 Alpha (2026-03-03): Orb-driven surface theming rollout across HUD modules
 *     - Replaced hardcoded dark panel/subpanel fills with orb-color-aware tinted surfaces on Home, Agents, Dev Logs, Integrations, and Missions Calendar.
 *     - Updated dark background "black" mode grid and atmospheric gradients to inherit the active orb palette while preserving existing depth treatment.
 *     - Standardized shared surface CSS variables (`--home-orb-rgb-*`) so module boxes and background accents stay visually aligned per selected orb color.
 *     - Preserved light-theme styling behavior while expanding orb-color visual consistency for dark-mode module shells and cards.
 *
 * - V.39 Alpha (2026-03-03): Spotlight interaction stability overhaul + unified hover behavior
 *     - Removed moving spotlight core-dot from active HUD spotlight surfaces and disabled particle streak effects by default.
 *     - Standardized spotlight response to direct hovered-card targeting (no cross-card/module glow bleed) across Home, Chat, Missions Calendar, and Integrations.
 *     - Hardened spotlight runtime math for zero-size/hidden cards with clamped glow coordinates to prevent visual glitching/flicker.
 *     - Added blur/leave cleanup hardening so glow state resets cleanly when focus changes or cursor exits interactive sections.
 *
 * - V.38 Alpha (2026-03-03): HUD navigation churn reduction + websocket cleanup hardening
 *     - Replaced hard document navigations (`window.location.*`) in root/login/chat mission entrypoints with Next router navigation to reduce full-page reload churn.
 *     - Removed background Home-hook `401` redirect side effects that could trigger repeated route bouncing during transient auth/session states.
 *     - Hardened `useNovaState` websocket cleanup for CONNECTING sockets and unmount timing to prevent noisy close-before-open lifecycle errors.
 *     - Performed quick dependency/security sweep (`npm audit --omit=dev`, high-level token/secret pattern scan) with no high vulnerabilities reported.
 *
 * - V.37 Alpha (2026-03-02): Legacy hard-cut completion + runbook source migration
 *     - Removed remaining legacy runtime migration/fallback paths across HUD/session/integration cleanup flows.
 *     - Migrated mission reliability runbook guidance from `tasks/runbooks` into code-owned ops guidance under `scripts/ops/`.
 *     - Updated Phase 6 ops and smoke tooling to use embedded guidance and removed `NOVA_SMOKE_USER_CONTEXT_ID` fallback from reliability ops generators.
 *     - Deleted `tasks/runbooks` after dependency rewiring and validation.
 *
 * - V.36 Alpha (2026-03-02): Hybrid repo tree normalization + naming consistency pass
 *     - Adopted hybrid module structure conventions: domain folders use entry barrels where useful, while stable leaf modules keep explicit descriptive filenames.
 *     - Standardized integration naming to `google-calendar` (replacing prior `google-calender`) and rewired dependent imports/tests.
 *     - Continued large-scale runtime/HUD folder cleanup to reduce root-level clutter and improve monorepo navigability.
 *     - Preserved behavior while tightening module boundaries to make ongoing refactors safer and easier to review.
 *
 * - V.35 Alpha (2026-03-01): Chat retention + isolation hardening and calendar integration stabilization
 *     - Disabled runtime transcript auto-trimming and age-based auto-pruning by default (`NOVA_SESSION_MAX_TRANSCRIPT_LINES=0`, `NOVA_SESSION_TRANSCRIPT_RETENTION_DAYS=0`) so chat history persists unless explicitly deleted.
 *     - Hardened chat transport routing to require explicit conversation IDs for assistant stream events, preventing cross-thread misrouting to the active thread.
 *     - Added retention/isolation smoke coverage for message durability, scoped deletes, and websocket user-context enforcement.
 *     - Completed Google Calendar mirror UX hardening (duplicate suppression and human-readable mirror descriptions) with timezone-resolution cleanup across mission/calendar paths.
 *
 * - V.34 Alpha (2026-02-28): Agent Chart module/page launch + home module wiring
 *     - Replaced the last empty Home right-rail module slot with a live `Agent Chart` preview card.
 *     - Added settings-wheel navigation from Home module to new `/agents` page for full org-chart visualization.
 *     - Added new `Agent Chart` screen with Nova operator/council/manager/worker hierarchy and provider-rail preview UI.
 *     - Wired spotlight refs and home visual state support for the new Agent module so hover/glow behavior matches existing Nova modules.
 *     - Extended persistent app background support to include `/agents` so floating-lines/space/custom backgrounds carry over consistently.
 *
 * - V.33 Alpha (2026-02-27): Mission output spam loop removal + channel model repair
 *     - Removed the prior mission-to-chat pending queue pathway that caused repeated chat pending polling and spam behavior.
 *     - Deleted NovaChat mission notification/output routing from active code paths while preserving normal chat.
 *     - Repaired duplicated/mutated mission output channel branches introduced by prior broad replacement (`telegram-output` dedupe).
 *     - Removed stale pending route/proxy/rate-limit wiring and normalized mission output integrations/options.
 *
 * - V.32 Alpha (2026-02-27): Spotify playback/device activation + home hydration stability polish
 *     - Hardened Spotify home playback handling for open-but-idle desktop app state by auto-activating an available device before retry.
 *     - Reduced Spotify boot/control noise by soft-failing expected device-unavailable and token-not-ready states.
 *     - Added launch warmup/cooldown guards to prevent repeated play/random spam while Spotify is initializing.
 *     - Stabilized Home module hydration to prevent schedule/orb flash-pop render artifacts on boot and page switches.
 *
 * - V.31 Alpha (2026-02-26): Chat handler modularization + migration overhead cleanup + production safety fixes
 *     - Refactored runtime chat execution into focused modules (`execute-chat-request`, `prompt-context-builder`, `tool-loop-runner`, `direct-completion`, `response-refinement`, `prompt-recovery`) to reduce coupling and improve maintainability.
 *     - Added fast-lane context-enrichment skip path to reduce avoidable per-turn latency overhead on lightweight chat turns.
 *     - Fixed Claude streaming delta emission accounting to prevent rare missing final assistant-message delivery in HUD.
 *     - Added write-queue map cleanup in mission/notification persistence paths to prevent unbounded in-memory growth across many scoped files.
 *     - Removed repeated fallback overhead by pruning empty prior `missions` / `notification-runs` directories after migration and reducing stale read fallbacks post-migration.
 *
 * - V.30 Alpha (2026-02-25): Calendar + Home overhaul with Google Calendar integration
 *     - Overhauled the Missions Calendar page UX and layout (week/day/month alignment, header behavior, mini-calendar interactions, and sidebar profile/settings module).
 *     - Overhauled Home page visual/system modules for a cleaner NovaAIO presentation and improved workflow accessibility.
 *     - Added and hardened Google Calendar integration flow across integrations and calendar surfaces, including synced event rendering.
 *
 * - V.29 Alpha (2026-02-24): Mission workflow reliability + builder/runtime alignment
 *     - Refined mission generation/build flow and mission graph validation to reduce invalid graph states before execution.
 *     - Hardened mission execution/output dispatch and executor paths for more deterministic run behavior.
 *     - Updated mission canvas/base-node UX flow to better align node editing, modal behavior, and run actions.
 *     - Extended mission versioning and check coverage around graph validation and build lifecycle paths.
 *
 * - V.28 Alpha (2026-02-24): Gmail runtime hardening + 3D orb interaction/visual refinement
 *     - Added Gmail runtime tool suite in `src/` with safe-fail auth/scope handling, per-user context enforcement, and chat-loop integration.
 *     - Added sensitive Gmail action guardrails with explicit confirmation requirements and server-side HUD op-token consumption for send/draft paths.
 *     - Added Gmail runtime parsing compatibility for optional user-scoped integration config shape and isolation-focused tests.
 *     - Upgraded Home orb to 3D pipeline and refined animation behavior: no hover-coupled motion, richer speaking-state pulse dynamics.
 *     - Removed ring overlays and outer glow layers from the orb visual stack; kept particles as a separate non-clipping outer layer.
 *     - Locked orb/particle color rendering to the user-selected orb palette path (no hardcoded cyan/white fallback path in active orb rendering flow).
 *
 * - V.27 Alpha (2026-02-23): Home visual polish + mission key stability fix
 *     - Scoped the orb-gradient title treatment so only the assistant name is gradient-rendered while "Hi, I'm" remains theme text.
 *     - Reworked space background planet variety toward a more realistic look (surface archetypes, subtler glow/motion, less repetitive crater treatment).
 *     - Added rare bottom-to-top launch rocket event with subtle spin for occasional cinematic motion.
 *     - Fixed duplicate React key warnings in mission template tags by making chip keys unique per template/tag/index.
 *
 * - V.26 Alpha (2026-02-23): Mission builder workflow UX overhaul (frosted glass)
 *     - Reworked mission canvas visual system with tokenized React Flow theming and refined controls/minimap treatment.
 *     - Upgraded node palette and node config panel hierarchy to match workflow-editor ergonomics from reference design patterns.
 *     - Polished mission node cards, edge/grid styling, and top toolbar density while preserving drag/drop/connect/save/run behavior.
 *     - Added phased implementation tracker artifact: `tasks/mission-builder-ux-overhaul-phases-2026-02-23.md`.
 *
 * - V.25 Alpha (2026-02-27): Telegram pending resiliency + mission idempotency hardening
 *     - Hardened `/api/telegram/pending` polling against spam with single-flight fetch control, 429 recovery backoff+jitter, Retry-After compliance, and stale-request aborts.
 *     - Added cross-tab pending-poll lease coordination so one tab owns user+conversation scoped polling at a time.
 *     - Added durable mission-build idempotency storage (user-scoped locked store) to prevent duplicate mission creation under retries/spam.
 *     - Added end-to-end idempotency key propagation from chat/runtime and missions UI to mission-build API.
 *     - Added stable HUD processing/retrying status badge with countdown (`Retrying in Ns`) aligned to existing popup toast styling.
 *     - Added resilience smoke coverage for pending poll scope isolation, Retry-After parsing, backoff behavior, and mission idempotency lifecycle.
 *
 * - V.24 Alpha (2026-02-22): Discord production hardening + personality PnL commentary
 *     - Hardened Discord delivery with strict webhook validation, redaction, retry/backoff+jitter, timeout handling, dedupe, concurrency caps, and per-user isolation safeguards.
 *     - Added Discord security controls: encrypted webhook storage at rest, masked client responses, and rate-limited integration probe endpoint.
 *     - Added Discord regression gate (`smoke:src-discord-delivery`) and wired it into release readiness checks.
 *     - Added personality-aware Coinbase PnL commentary for strong moves (>=10%) with user-scoped assistant tone/name behavior from settings context.
 *     - Applied anti-false-trigger and latency protections for PnL commentary (minimum notional/transactions, freshness guard, threshold buffer, persona cache).
 *     - Added deterministic fake-data PnL personality smoke coverage and scheduler-delivery assertion for notification payload inclusion.
 *
 * - V.23 Alpha (2026-02-22): Coinbase integration completion
 *     - Completed Coinbase phase gates across storage isolation, quality coverage, and rollout controls.
 *     - Finalized deterministic smoke coverage for Coinbase-enabled flows with strict user scoping.
 *     - Hardened production behavior for sync UX, telemetry diagnostics, and fallback quality safeguards.
 *     - Cleared release blockers for degraded fallback responses and latency gate compliance.
 *
 * - V.22 Alpha (2026-02-22): ChatKit integration completion (phases 1-5) with live gate evidence
 *     - Added ChatKit foundation with deterministic config validation, feature flags, and user-scoped telemetry events.
 *     - Implemented shadow-mode evaluation and controlled low-risk serving with hard fallback to existing runtime flow.
 *     - Added structured multi-step workflow orchestration (`research -> summarize -> display`) bound to skill docs under `skills/`.
 *     - Added release-gate chain and runbook artifacts with PASS evidence report at `archive/logs/chatkit-release-readiness-report.json`.
 *     - Validated full ChatKit smoke chain end-to-end with live gate mode enabled (`datasetMode: live`).
 *
 * - V.21 Alpha (2026-02-21): Nova conversation intelligence and reliability upgrade
 *     - Upgraded Nova's multi-turn continuity so context, preference handling, and response intent stay stable across longer conversations.
 *     - Strengthened fast-path routing architecture to reduce false activations and improve first-pass answer accuracy.
 *     - Added production-grade conversation quality benchmarking (30-turn scripted eval) with score deltas for memory, safety, routing, readability, and latency.
 *     - Hardened handoff/state orchestration so message flow remains deterministic under real-time HUD interaction and rapid turn sequences.
 *
 * - V.20 Alpha (2026-02-21): NLP spelling/autocorrect quality + override UX polish
 *     - Added gold-corpus NLP evaluation coverage and guardrail script wiring for regression tracking.
 *     - Improved preprocessing reliability across typo-heavy prompts with safer expectation matching and protected-span handling.
 *     - Added user-facing NLP edit hint UX for risky rewrites, including settings toggle and frosted-glass popup styling.
 *     - Added one-click resend protection for NLP suggestion actions to prevent rapid duplicate queue spam.
 *     - Updated NLP override button order/labels for clearer intent ("Use suggested" left, "Keep interpreted" right).
 *     - Removed initial streamed-text blur effect for cleaner, more polished response rendering.
 *
 * - V.19 Alpha (2026-02-20): scalable request scheduling and queue orchestration
 *     - Added centralized HUD request scheduler with bounded queueing and explicit concurrency controls (global, per-user, per-conversation).
 *     - Added queued-request supersession by conversation so stale queued turns are canceled when newer turns arrive.
 *     - Added workload lanes (`fast`, `default`, `tool`, `background`) with weighted fair dispatch to protect interactive responsiveness.
 *     - Added scheduler metrics to system-metrics responses for live observability (queue depth, lane backlog, counters).
 *     - Updated gateway busy handling to track true in-flight HUD work safely under concurrent scheduling.
 *
 * - V.18 Alpha (2026-02-20): runtime latency optimization pass (without capability loss)
 *     - Added safe fast-lane classification for trivial turns so optional heavy context layers are skipped when unnecessary.
 *     - Gated tool-loop orchestration by per-turn intent, preserving tools for tool-needed prompts while reducing overhead on simple chat.
 *     - Switched tool runtime initialization to lazy-on-demand so non-tool turns avoid upfront runtime setup cost.
 *     - Added memory-recall guardrails (intent gating + timeout) to prevent memory embedding work from delaying lightweight requests.
 *     - Parallelized optional enrichment tasks (web preload, link preload, memory recall) with bounded latency budgets.
 *     - Added session/transcript in-process caches with file-change invalidation to reduce sync disk churn while preserving session semantics.
 *     - Added persona/skills prompt caching and one-time stale-path pruning to avoid repeated per-turn filesystem scans.
 *     - Coalesced HUD assistant stream deltas per animation frame to reduce render-state churn during streaming responses.
 *
 * - V.17 Alpha (2026-02-20): mission generation + output engine generalization
 *     - Reworked mission topic detection to better parse mixed-intent prompts (including typo-tolerant motivational/news requests).
 *     - Improved fetch-query derivation from cleaned user intent instead of raw conversational scaffolding.
 *     - Upgraded AI mission prompt synthesis to be request-aware and dynamic across domains.
 *     - Replaced hardcoded mission output rewriting with a generic model-first normalizer.
 *     - Removed forced mission title/date wrapper from outputs by default (optional via `NOVA_MISSION_OUTPUT_INCLUDE_HEADER`).
 *     - Simplified mission quality fallback to narrative-first behavior so outputs read like Telegram responses.
 *
 * - V.16 Alpha (2026-02-20): dynamic weather response normalization and runtime resiliency
 *     - Reworked weather summarization to be location-agnostic and query-agnostic (supports "weather in X", "X weather", ZIP-based queries, and result-title fallback extraction).
 *     - Removed raw link/source dump behavior from weather fast-path output in favor of concise, human-readable recap lines.
 *     - Added dynamic temperature extraction (high/low/current) with unit inference from search snippets.
 *     - Hardened runtime tool-loop recovery when providers return tool calls without final text, with safe fallback reply generation.
 *     - Added websocket broadcast null-guard to avoid runtime crash when gateway state is unavailable.
 *
 * - V.15 Alpha (2026-02-20): memory relevance/compression and security regression net completion
 *     - Improved memory recall compaction with query-aware salient sentence extraction and duplicate suppression under token pressure.
 *     - Added long-thread memory benchmark coverage to ensure critical facts survive noisy context.
 *     - Added security regression net smoke suite (`smoke:src-security-regression`) for durable guardrail verification.
 *     - Expanded `smoke:src-release` to include security, memory, routing arbitration, and plugin isolation gates.
 *     - Added phase-20 release notes artifact: `tasks/novaaio-phase20-release-notes.md`.
 *
 * - V.14 Alpha (2026-02-19): 10-phase hardening and release-readiness completion
 *     - Completed Phase 10 hardening with a production release gate (`smoke:src-release`) that runs build + eval + mission + scheduler + transport + tools + HUD build.
 *     - Added release-readiness smoke checks (`smoke:src-release-readiness`) covering script wiring, launcher stability, env documentation coverage, and release-note/version integrity.
 *     - Added final release notes artifact: `tasks/novaaio-phase10-release-notes.md` with rollout checklist and rollback plan.
 *
 * - V.13 Alpha (2026-02-19): `src/` runtime cutover + stability patch set
 *     - Standardized Nova runtime boot path to `nova.js` -> `src/runtime/core/entrypoint/index.js` (replacing prior `agent/` launch flow).
 *     - Expanded `src/` runtime parity and smoke coverage for provider, session, transport, tools, memory, and shell wiring.
 *     - Removed stale `src/index.ts` one-off harness and cleaned upgrade module index references.
 *     - Fixed Home -> Chat first-send duplication by tightening pending message dedupe (message id + content checks).
 *     - Added STT auth fallback to user-scoped OpenAI integration when global key is missing (401 mitigation for voice loop).
 *
 * - V.12 Alpha (2026-02-18): Runtime skill routing efficiency and continuity upgrades
 *     - Added starter operational skills: `pickup` and `handoff` for fast context rehydration and deterministic task transfer.
 *     - Runtime skill discovery now parses optional `metadata.read_when` hints and includes them in prompt-time skill selection.
 *     - Added short-lived runtime cache for discovered skills to reduce repeated per-turn filesystem scans.
 *     - Skills API now supports optional frontmatter key `metadata` (with `read_when`) and returns hint metadata in skill summaries.
 *     - Starter skill seeding now uses catalog versioning so newly added starter skills propagate safely to existing users.
 *
 * - V.11 Alpha (2026-02-18): User-facing Skills manager and starter template rollout
 *     - Added Settings -> Skills editor for creating and updating user `SKILL.md` files directly.
 *     - Added validated skill API flow (list/read/create/save) with enforced frontmatter and verification sections.
 *     - Added starter skill templates (`nova-core`, `research`, `summarize`, `daily-briefing`) with one-click install.
 *     - Runtime now discovers both workspace and per-user skills for prompt-time skill selection.
 *
 * - V.10 Alpha (2026-02-18): Global background persistence and hydration stabilization
 *     - Added app-level persistent background layer to prevent custom video flash/reset on route changes.
 *     - Fixed hydration mismatch by deferring background layer rendering until client mount.
 *     - Removed duplicate page-level background state/effects from home, missions, and chat flows.
 *
 * - V.08 Alpha (2026-02-17): Chat refactor and Brave integration
 *     - Refactored chat-shell-controller from 1688 lines to 616 lines.
 *     - Extracted logic into reusable hooks: useConversations, useIntegrationsStatus,
 *       useMissions, useChatBackground.
 *     - Removed dead code: nova-chat-module.tsx, redundant chat-shell.tsx wrapper.
 *     - Added Brave API integration across all pages (home, chat, integrations).
 *     - Brave API key stored encrypted, user-configured via Integrations UI.
 *
 * - V.07 Alpha (2026-02-17): Chat workspace responsiveness and shell/header overhaul
 *     - Reworked chat shell into responsive 3-column desktop layout:
 *       Sidebar -> Chat -> Mission/Integrations.
 *     - Added central chat header with animated orb, live status, and version badge.
 *     - Restored orb animation/hover behavior with live presence indicator.
 *     - Removed container styling around Nova responses for cleaner module blending.
 * 
 * - V.06 Alpha (2026-02-27): Consolidated data cleanup, mission run-trace, and Telegram UX stabilization
 *     - Added Telegram mission output channel with pending-queue handling and cleanup.
 *     - Mission outputs can reliably create/open Nova conversations from run-trace CTA.
 *     - Added per-step real-time run-trace streaming with true start/end timings.
 *     - Fixed run-trace auth/401 stream issues using fetch-based SSE parsing.
 *     - Step timer reflects real execution duration; step icons update live.
 * 
 * - V.05 Alpha (2026-02-17): Multi-fetch fixes
 *     - Fixed multi-fetch execution so all fetch steps run and accumulate results.
 *     - Sources display stacked (one per line) instead of inline.
 *     - Improved quote extraction for one clean quote with attribution.
 * 
 * - V.04 Alpha (2026-02-17): Output formatting improvements
 *     - Improved AI prompts with strict section formatting rules.
 *     - Added topic-specific report formatting for scores, markets, and quotes.
 * 
 * - V.03 Alpha (2026-02-17): Multi-topic mission architecture
 *     - Added prompt topic detection: sports, markets, crypto, quotes, tech, news.
 *     - Missions create separate fetch steps per detected topic.
 *     - Enhanced search queries with date-aware and site-filtered strategies.
 *     - AI prompts now generate structured multi-section summaries.
 *     - Added templates: Morning Multi-Topic Brief, Sports Recap,
 *       Market Update, Tech Digest.
 *     - Fixed illegible text and weak summarization in mission outputs.
 * 
 * - V.02 Alpha (2026-02-16): Missions refactor (page split into hooks/components, behavior preserved)
 * 
 * - V.01 Alpha (2026-02-16): Reset baseline versioning to Alpha track
 */

export const NOVA_VERSION = "V.70 Alpha"




