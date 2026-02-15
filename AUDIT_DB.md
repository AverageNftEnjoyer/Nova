# Persistence Audit (DB-like State, Chat History, Memory, Tool Runs)

## Current State: No central relational DB
- There is no current Postgres/SQL DAL in `hud/`.
- Persistent state is spread across localStorage + JSON files.

## Chat/Thread/Message Persistence (legacy)
- `hud/lib/conversations.ts`
  - `loadConversations()`, `saveConversations()`, `getActiveId()`, `setActiveId()`.
  - Uses browser `localStorage` keys:
    - `nova-conversations`
    - `nova-active-conversation`
- `hud/components/chat-shell.tsx`
  - Uses `loadConversations/saveConversations` for runtime chat persistence.

## Notifications / Mission Schedules Persistence
- `hud/lib/notifications/store.ts`
  - JSON-file-backed schedule store in `data/notification-schedules.json`.
  - Includes counters and timestamps (`runCount`, `successCount`, `failureCount`, `lastRunAt`).
- `hud/app/api/notifications/schedules/route.ts`
  - CRUD API over schedule store.
- `hud/app/api/notifications/trigger/route.ts`
  - Reads schedule state and writes run outcomes.
- `hud/lib/notifications/scheduler.ts`
  - Runtime scheduler reading/writing persistent schedule state.

## Integration/Provider Config Persistence
- `hud/lib/integrations/server-store.ts`
  - JSON-file-backed integration config in `data/integrations-config.json`.
  - Stores provider config and encrypted-at-rest secrets.
- `hud/app/api/integrations/config/route.ts`
  - Read/update path over integration config state.

## Memory Persistence
- `agent/memory.js`
  - Persistent assistant memory in `nova_memory.json`.
  - Fact extraction and memory updates saved to file.
- `agent/agent.js`
  - Reads from `hud/data/integrations-config.json` + memory module.

## Tool Run / Trace Persistence
- No dedicated relational tool-run table currently.
- Mission runtime traces are mostly in-memory with API response payloads:
  - `hud/lib/missions/runtime.ts`
  - `hud/app/api/notifications/trigger/route.ts` (trigger/run responses)

## Migration Targets Required
- Replace above local persistence with Supabase Postgres tables:
  - `threads`, `messages`, `memories`, `thread_summaries`, `tool_runs`.
- Add DAL functions and route-level auth-scoped access using Supabase JWT identity (`auth.uid()`).
