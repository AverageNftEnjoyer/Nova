# Nova handoff — remaining backend closures

Written 2026-09-22 for a new session. The previous session was interrupted while finishing Closure 3. Nothing in this working tree has been committed. The user commits. Do not run `git commit`, `git push`, or any hook-skipping git command.

Delete this file when the remaining closures are done. It is a transition note, not project documentation.

**2026-09-22 session update:** Closure 3 re-verified green. Closure 4 packaging choice stays "Electron's main process hosts both". `better-sqlite3` stays `^13.0.3` (N-API prebuild, no Electron-ABI rebuild). Closure 4 boot is now proven by `node scripts/smoke/packaging/production-boot-smoke.mjs` against `hud/dist/win-unpacked` (see Closure 4 status). That run is Node loading the packaged `startProductionServices` entry, not a GUI click-through of `Nova.exe` and not an NSIS install. Closure 5 is done. Closure 6 is not started.

## Rules for the next session

- Read this file, then read the current code. Do not trust older chat summaries over the files.
- Do not redo Closures 1 or 2 unless a test proves a regression.
- Do not commit.
- Windows only. Secrets use DPAPI. There is no plaintext encryption fallback.
- Agent Tasks execute in the Node runtime (`src/`), not inside Next.js. `hud/lib/agents/task-runner.ts` is an intentional no-op. The scheduler is `src/runtime/modules/agent-tasks/index.js`, started from `src/runtime/core/entrypoint/index.js`.
- Ask the user when a product choice is real. Packaging has one real choice, called out under Closure 4.

## What is already done

### Closure 1 — real Agent Task execution

Simulated HUD task ticking is gone. Queued rows in `agent_tasks` are claimed by the runtime scheduler and run through `handleInput` with the task’s provider and model (`preferredProvider` / `preferredModel`). Results, tool names, token counts, and estimated cost are persisted.

### Closure 2 — execution context and safety

This passed its follow-up review. Do not reopen it except to fix a regression found by a test.

Already in the tree:

- Managed attachment copies under `<dataDir>/agent-task-files/<userId>/<taskId>/`. Rows store a relative path plus SHA-256. Original host paths are not given to the model. See `hud/lib/agents/task-attachments.ts` and `src/runtime/modules/agent-tasks/execution-context/index.js`.
- Sibling task context is built on the server, quoted, and size-bounded. The create modal no longer pastes a client-side context summary into the prompt.
- Permission modes are enforced for OpenAI and Claude tool loops and for direct workers (files, Gmail send/draft, Spotify, Telegram, Discord, Calendar, Reminders, voice, TTS, YouTube, shutdown, local memory/notes/mission mutations). `plan-mode` is read-only. Dangerous tools are denied. `default` pauses for approval. `accept-edits` allows file edits. `dont-ask` denies elevated work. `bypass` allows elevated work and still denies dangerous tools.
- Approvals are bound to a canonical argument hash, expire, and are consumed once inside a SQLite transaction (`consumeTaskApproval` in `src/runtime/modules/agent-tasks/index.js`).
- File, exec, and browser tools run in the validated worktree when one was requested. Worktree creation fails closed. Branch names include the task id. Windows path checks reject null bytes, UNC/device paths, alternate data streams, reserved device names, symlinks, and junctions.
- Stop and delete abort the task. `exec` kills the process tree. Provider calls for OpenAI, Claude, Spotify, Telegram, Discord, Calendar, Gmail send/draft, and YouTube receive the abort signal. Account delete cancels every task for the user, waits for an unexpired lease, removes managed worktrees, then purges rows and attachment files.
- Side effects are reserved once in `agent_task_effects` (migration 12).
- Results and errors are redacted and size-capped before they are stored.
- Passing checks from the last completed verification, before Closure 3 edits: `npm run typecheck`, `npm run smoke:agent-tasks`, `npm run smoke:local-db`, `npm run smoke:src-tools`, `npm run smoke:src-tool-loop-guardrails`, `npm run smoke:src-providers`, `npm run smoke:src-files-domain`, `npm run smoke:src-voice-tts-domain`, `git diff --check`.

Those commands have not been re-run after the Closure 3 edits below.

## Closure 3 — file drop. Code is written. Verification was interrupted.

This is the next thing to finish. It is small. Do not redesign it.

### The bug

The create-task drop zone called `preventDefault()` and then did nothing. That cancels Chromium’s `file://` navigation, so `will-navigate` in Electron main never delivered a path. `preload.js` also called `ipcRenderer.on('file-dropped')` and returned no unsubscribe. The modal effect depended on `attachedFiles`, so every attached file added another listener.

### What is already edited

- `hud/electron/preload.js`
  - `onFileDrop` registers one listener and returns `() => ipcRenderer.removeListener('file-dropped', listener)`.
  - `getPathForFile` exposes `webUtils.getPathForFile` (Electron 44).
- `hud/global.d.ts` — `onFileDrop` returns an unsubscribe function. `getPathForFile(file: File): string` is declared.
- `hud/components/agents/create-task-modal.tsx`
  - Subscribes only while the modal is open. Cleanup calls the unsubscribe function. The effect depends on `open` only.
  - `onDrop` reads `dataTransfer.files` and resolves each path with `getPathForFile`. Duplicate paths are ignored.
- `hud/electron/file-url-path.js` — decodes a `file://` URL. On Windows, `/C:/...` becomes `C:/...`.
- `hud/electron/main.js` — `will-navigate` still blocks `file://` navigation and sends `file-dropped` only as a fallback, using `fileUrlToPath`.
- `scripts/smoke/agent-tasks/file-drop-smoke.mjs` — asserts the unsubscribe, `getPathForFile`, and a real decode of `file:///C:/Users/Jack/My%20File.txt`.

### Finish Closure 3

1. Read those files and confirm the edits above are intact.
2. Run, from `C:\Nova`:
   - `node scripts/smoke/agent-tasks/file-drop-smoke.mjs`
   - `npm run typecheck`
3. If both pass, Closure 3 is code-complete.
4. Browser-only verification cannot prove an OS file path. `getPathForFile` only works inside Electron. If the Electron app is already running, drop a real file onto the create-task drop zone and confirm the filename appears once, then close and reopen the modal and confirm a second drop does not duplicate the attachment from a leaked listener. If Electron is not running, say that the desktop drop was not exercised.
5. Do not “fix” this by removing `preventDefault()`. The drop zone must keep the event and read the path itself.

### Still leaky, and in scope if you touch preload

These preload subscriptions still add a listener and never return an unsubscribe:

- `onAgentTaskUpdate`
- `onAgentTaskError`
- `onAgentTaskComplete`
- `onDeepLink`

`removeAgentTaskUpdateListener` and its siblings call `removeAllListeners`, which removes every subscriber. File drop was the reported bug. Give the others the same return-unsubscribe shape only if a caller needs it. Do not switch them to `removeAllListeners` as the per-callback cleanup.

## Closure 4 — packaged Electron must launch the real app

User choice, unchanged: Electron's main process hosts both the Next production server and the `src` runtime. Dev still loads `http://127.0.0.1:3000`. `better-sqlite3` stays on the N-API prebuild. Do not reintroduce an Electron-ABI rebuild.

### Status (verified 2026-09-22)

Proven, by `node scripts/smoke/packaging/production-boot-smoke.mjs` against `hud/dist/win-unpacked` produced with `npm run build`, `npm run electron:prepare-runtime`, and `npx electron-builder --win --x64 --dir` from `hud/`:

- The packaged `electron/production-server.js` boots Next (`GET /` → 200) and the staged runtime scheduler in one process. No `npm run dev`.
- A queued `agent_tasks` row in that process's throwaway SQLite database was claimed and completed (`status=completed`, fake `handleInput`, no model API key).
- `stop()` returned in a few milliseconds and the process exited. Port 8765 was free afterward.
- `NOVA_PACKAGED=1` with `NOVA_DATA_DIR` unset resolved to `<fake APPDATA>\Nova`, not the install tree. The smoke's own `nova.db` stayed in an `os.tmpdir()` data dir. Repo `.user/nova.db` and the real `%APPDATA%\Nova\nova.db` were not modified.
- Packaged `electron/main.js` has no `start-agent-task` handler and does not `loadFile` a static `out/index.html`.
- `.next/standalone` is not shipped. A previous `--dir` output had been traced into that folder, including a nested `Nova.exe`.

Not proven:

- Launching `Nova.exe` or an NSIS-installed app, clicking through the window, or quitting from the tray. Electron `before-quit` calls the same `stop()`, but that path was not click-tested.
- A live model call. The smoke passes an in-process fake `handleInput`. Electron main does not.
- File drop inside the packaged window.
- Closure 6 (`npm run verify:release-readiness`).

Next still prints `next start does not work with output: standalone` while this custom server is booting. `GET /` returned 200 anyway. `output: "standalone"` stays, because that build is what produces the external-package trace the symlink dereference step repairs. The installer excludes the standalone directory itself.

## Closure 5 — stale harnesses. Done.

`scripts/test-task-contexts.mjs` was deleted. Server-side sibling context is already asserted by `scripts/smoke/agent-tasks/agent-task-execution-context-smoke.mjs`, and context assignment without a client-injected summary is asserted by `scripts/smoke/agent-tasks/agent-task-store-smoke.mjs`.

`scripts/smoke/perf/server-idle-cost-smoke.mjs` no longer drives the deleted HUD task runner. Its voice, metrics, secrets, and job-ledger checks remain. Agent Task execution coverage is `npm run smoke:agent-tasks`.

`scripts/smoke/agent-tasks/file-drop-smoke.mjs` stays as the Closure 3 source-text smoke. Do not add more source-only tests for packaging.

## Closure 6 — release gate

Run this only after Closures 3, 4, and 5 are green:

```bash
npm run verify:release-readiness
```

That runs `npm run smoke:src-release` (`scripts/smoke/verification/verify-release-readiness.mjs`). It is a long gate: eval, prompt, missions, scheduler, delivery, transport, tools, security, memory, routing, Coinbase, latency, isolation, HUD build, and `smoke:src-release-readiness`.

Also run `npm run smoke:agent-tasks` if the release script does not include it. As of this handoff, `smoke:src-release` does not call `smoke:agent-tasks`.

Fix failures in the areas those tests cover. Do not weaken a test to go green. Do not mark the app release-ready from Closure 4 alone: the `--dir` boot smoke is green, and the NSIS install plus a GUI launch are still unproven.

## Order

1. Verify and close Closure 3.
2. Closure 4 boot smoke is green. Do not redo the packaging choice. NSIS and a GUI launch are still unproven.
3. Closure 5 is done.
4. Closure 6. Run the release gate and `smoke:agent-tasks`.

## Files a new session should open first

- `hud/components/agents/create-task-modal.tsx`
- `hud/electron/preload.js`
- `hud/electron/main.js`
- `hud/electron/file-url-path.js`
- `hud/electron-builder.yml`
- `src/runtime/modules/agent-tasks/index.js`
- `src/runtime/core/entrypoint/index.js`
- `docs/security/local-data.md`
