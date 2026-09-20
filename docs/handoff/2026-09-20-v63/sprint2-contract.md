# Sprint 2 Work Contract — Phase 2: Agent Tasks UI

Author: management agent. Workers implement EXACTLY this. Any deviation → report to management first.
Scope: Agent Tasks home module + create-task modal; Notes rename. Out of scope: Active Agents Monitor, /tasks/[id] page, real agent processes (Phase 4), git worktrees, shared context.

## 0. Ground truth discovered (read first)

1. **A concurrent draft already exists** (created 2026-09-20 ~16:05–16:07, not by this sprint's workers; provenance unknown). Files: `hud/lib/agents/{types,task-store,model-pricing}.ts`, `hud/components/agents/task-card.tsx`, `hud/app/home/components/agent-tasks-home-module.tsx`, `hud/app/api/tasks/{route.ts,[id]/route.ts,[id]/actions/route.ts}`, `hud/playwright.config.ts`, `hud/tests/smoke/*`, and `home-main-screen.tsx` already imports `AgentTasksHomeModule`. Also staged in git index: `hud/test-results/**`, `hud/playwright-report/**` (now gitignored → junk in index; NOT our scope, do not touch the index).
   Its gaps vs. the user's decisions: in-memory only (no persistence), polling every 2s (no push), hardcoded `userId="local-user"` (bypasses auth helper), `app/api/tasks/**` is **git-ignored** (`.gitignore:66 tasks/`), duplicates pricing (`lib/agents/model-pricing.ts` vs existing `resolveModelPricing`), hardcoded model union.
   **Rule:** treat the draft as a starting point. Reuse what fits (card layout/icons, module shell), replace what doesn't. Before editing ANY file listed above, check its mtime vs. this contract; if it changed after 16:10 on 2026-09-20, another author is active → STOP and report to management.
2. **Baseline typecheck**: `cd /c/Nova/hud && npx tsc --noEmit -p tsconfig.json` fails at baseline with `TS5103 Invalid value for '--ignoreDeprecations'` (hud/tsconfig.json has `"6.0"`, hud's installed tsc is 5.9.3). Pre-existing, committed, not Sprint 2. **Use this instead (verified clean on the draft):**
   `cd /c/Nova/hud && ./node_modules/.bin/tsc -p "C:/Nova/docs/handoff/2026-09-20-v63/tsconfig.hud-verify.json"`
   (extends hud/tsconfig.json, overrides ignoreDeprecations→"5.0", noEmit). Must exit 0 after every workstream step.
3. **Auth**: hud routes use `requireSupabaseApiUser(req)` from `@/lib/supabase/server` (now a local-user shim returning `verified.user.id = "local-user"`) + `checkUserRateLimit`/`rateLimitExceededResponse` from `@/lib/security/rate-limit` (see `app/api/home/notes/route.ts`). New routes MUST use the same helpers (no hardcoded ids) so auth returns when re-enabled.
4. **Persistence**: hud has no `better-sqlite3` dependency; root's native binding is not built (`npm ci --ignore-scripts`), and Next bundling a native module is a risk. Existing hud-side user data (notes, calendar overrides, missions) uses **per-user JSON files, atomic write** under `.user/user-context/<userId>/…` (pattern: `hud/lib/calendar/reschedule-store/index.ts`). **Decision: JSON file store behind a store interface** (SQLite swap possible later without touching routes/UI). ⚠ This deviates from the user's "SQLite" answer — MUST be surfaced to the user in the final report.
5. **Pricing**: reuse `resolveModelPricing(model): ModelPricing | null` from `hud/app/integrations/constants/pricing.ts` ($/1M tokens, `{input, output, cachedInput?}`). Model option lists: `CLAUDE_MODEL_OPTIONS`, `OPENAI_MODEL_OPTIONS`, `GEMINI_MODEL_OPTIONS`, `GROK_MODEL_OPTIONS` (`ModelOption[]`, from `app/integrations/constants`). `hud/lib/agents/model-pricing.ts` is deleted.
6. **Realtime**: agent WebSocket `ws://localhost:8765` belongs to the separate agent runtime process; the stub runner lives in the Next server process, so routing updates through 8765 would need cross-process plumbing. **Decision: SSE** from a Next route (precedent: `app/api/missions/trigger/stream/route.ts`, `text/event-stream`, `data: <json>\n\n`) fed by an in-process `globalThis` event bus. Hook falls back to 6s polling (notes pattern) if EventSource errors.
7. Smoke tests live in root `scripts/smoke/<area>/`; hud TS can't be imported by plain node → smoke transpiles needed `hud/lib/agents/**` (+ pricing constants closure) with `typescript`'s `ts.transpileModule` to CommonJS in an OS temp dir and `createRequire`s them. **Therefore `hud/lib/agents/**` core files must not import `server-only` or use the `@/` alias**; use relative imports only (pricing: `../../app/integrations/constants/pricing`, whose imports are all relative).

## 1. Files (exact paths, all under `C:/Nova/hud` unless noted)

| Path | Action | Owner |
|---|---|---|
| `app/home/components/placeholder-2-home-module.tsx` → `app/home/components/notes-home-module.tsx` | `git mv`; rename `PlaceholderTwoHomeModule`→`NotesHomeModule`, `PlaceholderTwoHomeModuleProps`→`NotesHomeModuleProps` | A |
| `app/home/components/home-main-screen.tsx` | import (line ~42) + JSX (line ~672) → `NotesHomeModule` from `./notes-home-module` | A (rename only); C (wiring of AgentTasks props if changed) |
| `app/home/components/placeholder-1-home-module.tsx` | DELETE (dead: home-main-screen no longer imports it; confirm with grep first) | A |
| `lib/agents/types.ts` | REWRITE per §2 | A |
| `lib/agents/task-store.ts` | REPLACE (in-memory class → file-backed async functions, §3) | A |
| `lib/agents/model-pricing.ts` | DELETE; `formatCost` moves into `task-card.tsx` (UI-only), cost math uses `resolveModelPricing` | A |
| `lib/agents/task-events.ts` | NEW: in-process bus (§5) | A |
| `app/api/agent-tasks/route.ts` | NEW GET/POST/PATCH/DELETE (§4) | A |
| `app/api/agent-tasks/stream/route.ts` | NEW SSE (§5) | B |
| `app/api/tasks/**` (3 files, git-ignored draft) | DELETE from disk after `/api/agent-tasks` lands; grep confirms zero refs to `/api/tasks` in hud code + `hud/tests/smoke` (update those specs to new routes or report) | A |
| `lib/security/rate-limit/index.ts` | ADD policies `agentTasksRead` (120/min), `agentTasksWrite` (60/min) mirroring `homeNotes*` incl. env overrides `NOVA_RATE_LIMIT_AGENT_TASKS_{READ,WRITE}_PER_MIN` | A |
| `lib/agents/task-runner.ts` | NEW SIMULATED runner (§6) | B |
| `app/home/hooks/use-agent-tasks.ts` | NEW hook (§7) | B |
| `scripts/smoke/agent-tasks/agent-tasks-smoke.mjs` | NEW behavior smoke (store+runner+events) | B |
| `package.json` (root) | ADD `"smoke:agent-tasks"` script (B creates; C appends its command with `&&`) | B, then C |
| `components/agents/task-card.tsx` | REWORK (§8) | C |
| `components/agents/task-list.tsx` | NEW (§8) | C |
| `components/agents/create-task-modal.tsx` | NEW (§8) | C |
| `app/home/components/agent-tasks-home-module.tsx` | REWORK onto `useAgentTasks`, header "+" button, stats strip | C |
| `scripts/smoke/agent-tasks/agent-tasks-ui-smoke.mjs` | NEW source-guard smoke for UI/wiring | C |

## 2. Types — `lib/agents/types.ts` (final; no other type files)

```ts
export type AgentTaskStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled"
// "cancelled" = user Stop (terminal). Added beyond the 5 requested statuses so Stop is distinguishable from a failure.
export type AgentTaskPriority = "low" | "normal" | "high"
export type AgentProvider = "claude" | "openai" | "gemini" | "grok"
export type AgentPermissionMode = "default" | "accept-edits" | "plan-mode" | "dont-ask" | "bypass"
export type AgentTaskAction = "play" | "pause" | "stop"          // PATCH actions
export type AgentTaskUiAction = AgentTaskAction | "delete"        // card callback

export interface AgentTask {
  id: string                  // crypto.randomUUID()
  userId: string
  name: string                // ≤ 80 chars; defaults to first 48 chars of prompt
  prompt: string              // 1–4000 chars
  agent: AgentProvider
  model: string               // model id, ≤ 80 chars, e.g. "claude-sonnet-4-5"
  status: AgentTaskStatus
  priority: AgentTaskPriority
  permissionMode: AgentPermissionMode   // data/UI only this sprint; runner ignores it
  progress: number            // integer 0–100
  tokensIn: number            // integer ≥ 0
  tokensOut: number
  costUsd: number             // ≥ 0, from resolveModelPricing; 0 if model unpriced
  error?: string              // set when failed
  createdAt: string           // ISO
  updatedAt: string           // ISO
  startedAt?: string          // first time it entered running
  pausedAt?: string           // set on pause, cleared on resume
  completedAt?: string        // set on completed/failed/cancelled
}

export interface CreateAgentTaskInput {
  name?: string
  prompt: string
  agent: AgentProvider
  model: string
  priority?: AgentTaskPriority          // default "normal"
  permissionMode?: AgentPermissionMode  // default "default"
}

export interface AgentTaskStats {
  queued: number; running: number; paused: number
  completed: number; failed: number; cancelled: number
  totalCostTodayUsd: number      // sum costUsd of tasks whose updatedAt is today (local server date)
  totalTokensToday: number       // tokensIn+tokensOut, same filter
}

export type AgentTaskEvent =
  | { type: "task.upserted"; task: AgentTask }
  | { type: "task.deleted"; id: string }

export const AGENT_TASK_MAX_CONCURRENT = 5
export const AGENT_TASK_TERMINAL: readonly AgentTaskStatus[] = ["completed", "failed", "cancelled"]
```
(Constants live in types.ts so UI + runner share them. Drop the draft's `AgentModel` union, `contextId`, `worktreePath`, `branchName`, `output`, `filesModified`, `workingDirectory` — no consumer this sprint; no dead fields.)

## 3. Store — `lib/agents/task-store.ts` (async, per-user, no `server-only`)

File: `<workspaceRoot>/.user/user-context/<sanitizedUserId>/agent-tasks/agent-tasks.json` = `{ version: 1, updatedAt, tasks: AgentTask[] }`. Workspace root resolved as in `reschedule-store` (cwd basename `hud` → parent). Sanitize userId as `[a-z0-9_-]`. Atomic write (tmp + rename), per-user promise-chain mutex serializing read-modify-write, corrupt file → copy to `.corrupt-<ts>` and start empty. Cap 300 tasks (oldest terminal dropped on create). Sort: `createdAt` desc.

```ts
export function listTasks(userId: string): Promise<AgentTask[]>
export function getTask(userId: string, id: string): Promise<AgentTask | null>
export function createTask(userId: string, input: CreateAgentTaskInput): Promise<AgentTask>   // throws AgentTaskValidationError(message) on bad input
export function applyTaskAction(userId: string, id: string, action: AgentTaskAction): Promise<AgentTask>  // throws AgentTaskNotFoundError | AgentTaskTransitionError
export function deleteTask(userId: string, id: string): Promise<boolean>
export function getTaskStats(userId: string): Promise<AgentTaskStats>
export function mutateTasks(userId: string, mutator: (tasks: AgentTask[]) => void): Promise<AgentTask[]>  // runner-only; returns tasks whose JSON changed
export function recoverInterruptedTasks(userId: string): Promise<number>   // running→queued (process died); returns count
export class AgentTaskValidationError extends Error {}
export class AgentTaskNotFoundError extends Error {}
export class AgentTaskTransitionError extends Error {}
```
**Single publisher rule:** every write path (`createTask`, `applyTaskAction`, `deleteTask`, `mutateTasks`, `recoverInterruptedTasks`) publishes `task.upserted`/`task.deleted` via `task-events` for each changed/removed task — after the file write succeeds. Routes and runner never publish directly.

Transition table (`applyTaskAction`):
- `play`: `paused`→`queued` (clears pausedAt; runner promotes to running when a slot is free); `queued`→no-op (returns task); `failed`|`cancelled`→`queued` with progress/tokens/cost/error/completedAt/startedAt reset; `running`→no-op; `completed`→`AgentTaskTransitionError`.
- `pause`: `running`|`queued`→`paused` (sets pausedAt; **paused does not occupy a concurrency slot**); others → TransitionError.
- `stop`: `running`|`queued`|`paused`→`cancelled` (sets completedAt); terminal → TransitionError.
- `deleteTask`: any status allowed (delete of an active task cancels implicitly by removal).
Validation: prompt trimmed non-empty ≤4000; agent ∈ AgentProvider; model non-empty ≤80; priority/permissionMode ∈ unions else default; name trimmed ≤80 (default from prompt).
Cost helper (in store or a tiny exported `computeTaskCostUsd(model, tokensIn, tokensOut)`): `(in*p.input + out*p.output)/1_000_000` using `resolveModelPricing`; 0 if null.

## 4. API — `app/api/agent-tasks/route.ts` (`runtime="nodejs"`, `dynamic="force-dynamic"`)

All handlers: `requireSupabaseApiUser` → 401 `{ok:false,error:"Unauthorized."}`; `checkUserRateLimit` (read policy for GET, write for others) → `rateLimitExceededResponse`; call `ensureTaskRunnerStarted(userId)` (GET and POST); errors → `{ok:false,error:string}`.
- `GET` → 200 `{ ok: true, tasks: AgentTask[], stats: AgentTaskStats }`
- `POST` body `CreateAgentTaskInput` → 200 `{ ok: true, task: AgentTask }` (status "queued"); validation error → 400.
- `PATCH` body `{ id: string, action: "play"|"pause"|"stop" }` → 200 `{ ok: true, task }`; bad action/missing id → 400; not found → 404; illegal transition → 409.
- `DELETE` body `{ id: string }` → 200 `{ ok: true }`; missing id → 400; not found → 404.
Id sanitization like notes route (`[a-z0-9-]`, ≤40) — UUIDs pass.

## 5. Realtime

`lib/agents/task-events.ts`: `globalThis.__novaAgentTaskBus` singleton (survives Next module duplication; same idiom as `__novaMissionSchedulerHolderId`).
```ts
export function publishTaskEvent(userId: string, event: AgentTaskEvent): void
export function subscribeTaskEvents(userId: string, listener: (e: AgentTaskEvent) => void): () => void
```
`app/api/agent-tasks/stream/route.ts` (GET, same auth+read-limit): `ReadableStream`, headers `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache, no-transform`, `connection: keep-alive`. First message `data: {"type":"snapshot","tasks":[…],"stats":{…}}`; then each bus event as `data: <AgentTaskEvent json>`; comment heartbeat `: ping` every 25s; cleanup (unsubscribe + clearInterval) on `req.signal` abort. Also calls `ensureTaskRunnerStarted(userId)`.

## 6. Stub runner — `lib/agents/task-runner.ts` (**SIMULATED — file header must say so in caps; Phase 4 replaces it with real agent processes**)

```ts
export function ensureTaskRunnerStarted(userId: string): void       // idempotent; registers userId, starts globalThis.__novaAgentTaskRunner interval (1000 ms, unref'd); first registration per user calls recoverInterruptedTasks
export function stopTaskRunner(): void                              // clears interval + users (tests/shutdown)
export function tickTaskRunner(userId: string, nowMs?: number): Promise<void>   // one deterministic tick; exported for smoke
export const SIM_FAIL_MARKER = "[sim:fail]"
```
`tickTaskRunner` does ONE `mutateTasks` per user: (1) promote `queued`→`running` while `running < AGENT_TASK_MAX_CONCURRENT`, order priority (high>normal>low) then `createdAt` asc, set `startedAt` if unset; (2) each `running` task: `progress += 5` (20 ticks ≈ 20 s), `tokensIn += 120`, `tokensOut += 60` (+ deterministic jitter derived from id hash so cards don't move in lockstep), `costUsd = computeTaskCostUsd(...)`; (3) if prompt contains `SIM_FAIL_MARKER` and progress ≥ 50 → `failed`, `error: "Simulated failure"`, completedAt; else progress ≥ 100 → `completed`, progress 100, completedAt. `paused`/terminal tasks untouched. No permission-mode behavior. Skip write (and events) when nothing changed.

## 7. Hook — `app/home/hooks/use-agent-tasks.ts` ("use client")

```ts
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }
export function useAgentTasks(): {
  tasks: AgentTask[]
  stats: AgentTaskStats | null
  loading: boolean
  error: string | null
  connection: "live" | "polling"
  refresh: () => Promise<void>
  createTask: (input: CreateAgentTaskInput) => Promise<Result<{ task: AgentTask }>>
  runAction: (id: string, action: AgentTaskUiAction) => Promise<Result>   // delete → DELETE, others → PATCH
}
```
Behavior: initial GET; open `EventSource("/api/agent-tasks/stream")`; on `snapshot` replace state; on `task.upserted` upsert by id (keep createdAt-desc order); on `task.deleted` remove; recompute stats client-side from `tasks` OR refetch stats (implementer's choice; must stay consistent). `onerror` → `connection="polling"`, poll GET every 6 s (pause when `document.visibilityState !== "visible"`), and retry EventSource every 30 s. Re-init on `ACTIVE_USER_CHANGED_EVENT` (`@/lib/auth/active-user`). `credentials: "include"`. Same normalize/parse defensiveness as `use-home-notes.ts`. Cleanup closes EventSource/timers.

## 8. Components (all `"use client"`, theme via `isLight`, existing Tailwind/`cn` conventions, icon-only minimal controls)

```ts
// components/agents/task-card.tsx
interface TaskCardProps {
  task: AgentTask
  isLight: boolean
  onAction: (taskId: string, action: AgentTaskUiAction) => Promise<void>
}
// components/agents/task-list.tsx — groups: Running, Queued (queued+paused), Completed, Failed (failed+cancelled); empty groups hidden; scroll container overflow-y-auto min-h-0
interface TaskListProps {
  tasks: AgentTask[]
  isLight: boolean
  subPanelClass: string
  onAction: (taskId: string, action: AgentTaskUiAction) => Promise<void>
}
// components/agents/create-task-modal.tsx
interface CreateTaskModalProps {
  open: boolean
  isLight: boolean
  onClose: () => void
  onCreate: (input: CreateAgentTaskInput) => Promise<{ ok: true } | { ok: false; error: string }>
}
```
Card content: name, agent+model, status badge (running=green pulse, queued=yellow, paused=blue, completed=green check, failed=red, cancelled=gray), progress bar (animated when running), cost (`$0.42`; `<$0.01` when 0<cost<0.01), tokens compact (`15.2K`), relative started time, permission-mode badge (only when ≠ default; `bypass` styled as warning). Buttons by status: running→pause+stop+delete; queued→pause+stop+delete; paused→play+stop+delete; failed/cancelled→play(retry)+delete; completed→delete. Disabled while an action is in flight.
Modal: agent selector (claude/openai/gemini/grok) → model dropdown from the matching `*_MODEL_OPTIONS` (default = first option); prompt textarea (required, 4000 max, counter); name (optional); priority (segmented low/normal/high); permission-mode select with red warning text when `bypass`. Use `FluidSelect` (requires `isLight: boolean`) for selects; render via portal like existing modals; Esc/backdrop closes; shows `error` from `onCreate`; submit disabled while pending. **Permission mode is stored/displayed only.**
Module (`AgentTasksHomeModule`, existing props `isLight, panelClass, subPanelClass, panelStyle, className`): header title "Agent Tasks" + "+" button (opens modal) + small `live`/`polling` dot; stats strip (running/queued/done/cost today); body = `TaskList`; loading + error + empty states; must not overflow its `col-span-2` cell (`min-h-0`, inner scroll).

## 9. Workstreams & order

**A — Renames + data layer** (first; blocks B, C-wiring): rename Notes; delete placeholder-1; `types.ts` → `task-events.ts` → `task-store.ts` → rate-limit policies → `/api/agent-tasks` route; delete `model-pricing.ts` + `app/api/tasks/**` + fix stale references (incl. `hud/tests/smoke` specs, or report if they can't be updated). Publish types.ts FIRST and notify management so C can start.
**B — Runner + realtime + hook** (after A's store): `task-runner.ts`, `stream/route.ts`, `use-agent-tasks.ts`, `scripts/smoke/agent-tasks/agent-tasks-smoke.mjs`, root `smoke:agent-tasks` script.
**C — UI** (components may start after A's types.ts; module wiring after B's hook): `task-card`, `task-list`, `create-task-modal`, rework module, `agent-tasks-ui-smoke.mjs`, append to `smoke:agent-tasks`.
Non-overlap: A owns `lib/agents/{types,task-store,task-events}.ts`, `app/api/agent-tasks/route.ts`, rate-limit, renames. B owns `task-runner.ts`, `stream/route.ts`, hook, behavior smoke. C owns `components/agents/**`, `agent-tasks-home-module.tsx`, UI smoke. `home-main-screen.tsx`: A edits the Notes import/JSX only; C touches it only if module props change (they shouldn't).

## 10. Acceptance criteria

**A**
- verify-tsc exit 0 (see §0.2); `grep -rn "PlaceholderTwo\|placeholder-2\|placeholder-1\|PlaceholderOne" hud --include=*.ts --include=*.tsx` (excl. node_modules/.next) → none; Notes UI behavior unchanged (same file content aside from names).
- `hud/lib/agents/model-pricing.ts` and `hud/app/api/tasks/**` gone; no refs to `@/lib/agents/model-pricing`, `/api/tasks` remain.
- Store: CRUD round-trips to disk; two userIds isolated; concurrent 20 `createTask` calls lose no writes; every transition in §3 correct incl. illegal → typed errors; corrupt file recovery; stats correct.
- Route returns exactly the shapes/status codes in §4 (manually curl-verified against `next dev` if feasible, else via smoke on store + source guard).
- No `server-only` / `@/` imports in `lib/agents/**`. No dead exports.
**B**
- Smoke `agent-tasks-smoke.mjs` passes: promotion order (priority then FIFO), cap of 5 running with 7 queued, pause frees a slot and next queued is promoted, resume→queued→running, stop→cancelled, completion at progress 100 with `costUsd > 0` for a priced model and `0` for an unpriced one, `[sim:fail]` → failed at ≥50, `recoverInterruptedTasks` running→queued, events published exactly once per changed task (bus subscriber counts), unchanged tick emits nothing, `stopTaskRunner` clears interval (process can exit).
- SSE route: snapshot first, events forwarded, heartbeat, cleanup on abort (verified by reading code + a small in-smoke test of bus subscribe/unsubscribe).
- Hook typed exactly as §7; verify-tsc exit 0. Runner file header says SIMULATED.
**C**
- verify-tsc exit 0; `agent-tasks-ui-smoke.mjs` (source guards: home-main-screen imports `AgentTasksHomeModule` + `NotesHomeModule`; module uses `useAgentTasks`; card renders all 6 statuses; modal wires all 5 permission modes + bypass warning; no `/api/tasks` string; no `console.log`) passes.
- Visual/behavioral check via `npm run dev` in hud if runnable (create a task → appears queued → runs → completes; pause/resume/stop/delete work; light + dark theme; layout at 1024×768 and 1920×1080 with no horizontal overflow). If the dev server can't be run, state that explicitly in the report.
- No unused imports/props/dead code left from the draft.

## 11. Global rules for workers
- TS clean (§0.2) after EACH file group; fix before moving on. Match surrounding comment density; no speculative abstractions; no dead code (delete stubs).
- Don't modify hud/tsconfig.json, the git index, or unrelated files. Don't commit (management/parent decides).
- Report to the main agent with: files touched (paths), verify-tsc exit code, smoke result, deviations from contract. Management verifies independently before the next workstream starts.
