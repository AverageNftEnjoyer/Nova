# Auth Audit (Legacy + Current)

## Scope
- Repo root: `C:\Nova`
- App runtime: Next.js app under `hud/`
- Current auth model: custom local password + signed session token (`nova_session` cookie and `x-nova-session` header)

## Core Legacy Auth Implementation
- `hud/lib/security/auth.ts`
  - Local password config file under `data/auth-config.json`
  - Session signing/verification with HMAC
  - Cookie/header session parsing
  - API guard: `requireApiSession(...)`
  - Login rate limiting and same-origin mutation checks

## Auth Routes (to be replaced by Supabase Auth)
- `hud/app/api/auth/setup/route.ts`
  - Setup flow for local password hash and immediate session issue.
- `hud/app/api/auth/login/route.ts`
  - Legacy password login; issues `sessionToken` and sets cookie.
- `hud/app/api/auth/session/route.ts`
  - Session introspection/refresh using legacy token model.
- `hud/app/api/auth/logout/route.ts`
  - Clears legacy session cookie.

## Client Auth Gate / Session Bridge
- `hud/components/auth-gate.tsx`
  - Calls `/api/auth/session`, redirects to `/login` if unauthenticated.
  - Persists fallback token in `localStorage` key `nova_session_fallback`.
- `hud/components/auth-fetch-bridge.tsx`
  - Monkey patches `window.fetch` to inject `x-nova-session`.
- `hud/app/layout.tsx`
  - Mounts `AuthFetchBridge` + `AuthGate`.
- `hud/app/login/page.tsx`
  - Uses legacy setup/login session routes.
- `hud/components/settings-modal.tsx`
  - Uses legacy `/api/auth/session` and `/api/auth/logout`.

## API Routes Protected by Legacy Guard (`requireApiSession`)
- `hud/app/api/chat/route.ts`
- `hud/app/api/notifications/scheduler/route.ts`
- `hud/app/api/notifications/schedules/route.ts`
- `hud/app/api/notifications/trigger/route.ts`
- `hud/app/api/missions/nova-suggest/route.ts`
- `hud/app/api/integrations/catalog/route.ts`
- `hud/app/api/integrations/config/route.ts`
- `hud/app/api/integrations/list-claude-models/route.ts`
- `hud/app/api/integrations/list-gemini-models/route.ts`
- `hud/app/api/integrations/test-claude-model/route.ts`
- `hud/app/api/integrations/test-discord/route.ts`
- `hud/app/api/integrations/test-gemini-model/route.ts`
- `hud/app/api/integrations/test-grok-model/route.ts`
- `hud/app/api/integrations/test-openai-model/route.ts`
- `hud/app/api/integrations/test-telegram/route.ts`
- `hud/app/api/integrations/gmail/accounts/route.ts`
- `hud/app/api/integrations/gmail/connect/route.ts`
- `hud/app/api/integrations/gmail/disconnect/route.ts`
- `hud/app/api/integrations/gmail/summary/route.ts`

## Adjacent Auth/Session-Sensitive Flows
- `hud/app/api/integrations/gmail/callback/route.ts`
  - OAuth callback path, currently tied to current integration config and session model.
- `hud/scripts/generate-auth-hash.mjs`
  - Legacy local-auth utility; remove after Supabase Auth migration.

## Reachable Legacy Paths To Purge
- All imports from `@/lib/security/auth` in API routes and UI session flows.
- `/api/auth/*` endpoints once Supabase auth/session is live.
- `AuthGate`/`AuthFetchBridge` logic based on `x-nova-session`.
