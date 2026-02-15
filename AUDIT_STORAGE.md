# Storage Audit (Files, Uploads, Blob Stores)

## Server-Side File Storage (legacy/local)
- `hud/lib/integrations/server-store.ts`
  - Reads/writes `data/integrations-config.json`.
- `hud/lib/notifications/store.ts`
  - Reads/writes `data/notification-schedules.json`.
- `hud/lib/security/auth.ts`
  - Reads/writes `data/auth-config.json`.
- `hud/lib/security/encryption.ts`
  - Reads/writes encryption key file under `data/`.
- `agent/memory.js`
  - Reads/writes `nova_memory.json` in repo root.
- `agent/agent.js`
  - Reads integration config and encryption key files.
  - Writes transient TTS output mp3 files under `agent/`.

## Client-Side Local Blob Storage (browser IndexedDB/local)
- `hud/lib/backgroundVideoStorage.ts`
  - Stores background video blobs in IndexedDB.
- `hud/lib/bootMusicStorage.ts`
  - Stores boot music blobs in IndexedDB.
- `hud/components/settings-modal.tsx`
  - Upload handlers for profile/avatar/background video/boot music (client-side persisted artifacts).

## Browser Local Persistence (non-file but persistent state)
- `hud/lib/conversations.ts`
  - Stores chat thread/message history in `localStorage`.
- `hud/lib/userSettings.ts`
  - Stores user settings in `localStorage`.
- `hud/lib/integrations.ts`
  - Stores integration state in browser storage (without raw secrets).

## Output/Log Files in Repo Root
- `memory.json`
- `nova_memory.json`
- `telegram_history.json`
- `nova-runtime.log`
- `_nova_repro.log`

## Migration Impact
- All production attachment and artifact writes should move to Supabase Storage private buckets.
- All server JSON persistence under `data/` for app state should move to Supabase Postgres.
- Client-side media blobs can remain optional local personalization storage if explicitly not part of protected user workspace data; otherwise migrate to Storage.
