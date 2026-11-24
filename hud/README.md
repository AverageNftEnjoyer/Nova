# Nova HUD

The Next.js 16 (App Router) front end of Nova, the local-first LLM agentic framework platform. In development it talks to the agent runtime over `ws://localhost:8765`; in the packaged Electron app the main process hosts this server and the runtime in-process (`electron/production-server.js`).

## Run

```bash
npm run dev            # HUD only, http://localhost:3000 (from the repo root, `npm run dev` starts the runtime too)
npm run electron:dev   # desktop window
npm run build          # production build
npm run test:smoke     # Playwright smoke tests (tests/smoke/)
```

## Layout

- `app/` - routes: `/home` (command center), `/chat`, `/runs`, `/deployments` and `/deployments/new`, `/missions` and `/missions/calendar`, `/integrations` (`?setup=<key>&tab=`), `/analytics`, `/history`, `/polymarket`, `/dev-logs`, and the internal `/dev/design` preview. `app/api/` holds the API routes.
- `components/shell/` - the app shell: sidebar, top bar, Ctrl+K command palette, `openSettings(section)`.
- `components/ui/` - design system primitives (import from `@/components/ui`); tokens in `app/styles/theme.css`. Rules: `../docs/frontend/design-system.md`.
- `components/settings/` - the Settings dialog (profile, personalization, appearance, audio, notifications, agent-budgets, model-routing, skills, local-data).
- `lib/` - client and server libraries (deployments, missions, integrations, analytics, settings).
- `electron/` - Electron main process, preload, production server, auto-updater.

Old `/home?room=...` and `/deployments?mode=...` links redirect in `next.config.js`.

## Telegram Notifications (Desktop + Phone)

Telegram delivery reaches both desktop and phone automatically if both are logged in to the same account/chat.

### Environment

Set these in your environment:

- `TELEGRAM_BOT_TOKEN` (required)
- `TELEGRAM_CHAT_IDS` (optional comma-separated default recipients)

### API

- `POST /api/missions/trigger`
  - body: `{ "message": "Hello from Nova", "chatIds": ["123456"] }`
- `GET /api/missions`
- `POST /api/missions`
  - body: `{ "mission": { ...nativeMissionGraph } }`
- `DELETE /api/missions?id=mission-id`
- `POST /api/missions/scheduler` to start scheduler loop
- `DELETE /api/missions/scheduler` to stop scheduler loop

Scheduler checks every 30 seconds and sends once per local day per schedule.

## Local Auth

Nova HUD is local-first. API routes use `requireLocalUser()` and a fixed local identity.
There is no hosted auth provider and no cloud database.

### Scriptable CLI

Use:

```bash
npm run notify:send -- --message "Nova check-in"
```

Optional recipients override:

```bash
npm run notify:send -- --message "Nova check-in" --chatIds "123456,789012"
```

## Mission Web Search Behavior

- Mission web research uses Tavily as the primary data provider.
- Mission output now humanizes structured search payloads into readable bullet summaries.
- If AI returns structured JSON-like web results, runtime converts it to plain-language bullets plus source links before delivery.
