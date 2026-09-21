# Outbound network calls (audit)

Audited 2026-09-21 against commit `c69f234` plus the working tree of that day (static review; nothing was run against
live services). Scope: `src/`, `hud/lib`, `hud/app` (API routes and client code), `hud/components`, `hud/electron`,
`hud/scripts`, `nova.js`, `hud/next.config.ts`, `hud/proxy.ts` and both `package.json` dependency lists.

Method: grep for `fetch(`, `axios`, `http(s).request/get`, `WebSocket`/`WebSocketServer`, `EventSource`, `sendBeacon`,
SDK clients (`openai`, `@anthropic-ai/sdk`, `@openai/agents`, `fish-audio`, `viem`, `@polymarket/clob-client`), every
hard-coded `https://` host, telemetry/analytics/crash/update keywords, `<iframe>`/`<script>`/`<link>`/`next/font`, then
reading each call site for what it sends and which credential it attaches.

## Summary

- **No telemetry, analytics, crash reporting or update checks were found**: no analytics/crash SDK in either
  `package.json`, no `electron-updater`/`autoUpdater`/`crashReporter`, no `publish` block in `electron-builder.yml`.
  Next.js telemetry is disabled in `nova.js:23`, `hud/electron/main.js:6` and `hud/scripts/next-runner.mjs:64` (and the
  `electron:dev` npm script). Nothing phones home to the project author.
- Every call below goes to a service the user configured or asked for, except Finding 3 (fixed) and the residual items in
  **Findings**. Credentials are attached only to their own provider; Finding 1 (fixed) was the exception.
- The HUD server binds `127.0.0.1:3000` and the agent WebSocket gateway binds `127.0.0.1:8765`; neither is reachable from
  the LAN. Runtime-to-HUD calls (`NOVA_HUD_API_BASE_URL`, default `http://127.0.0.1:3000`) and `nova.js` health checks stay
  on the loopback interface and are not listed again.

## Findings (read these first)

Severity is my judgement for a single-user desktop app. Findings 1-3 were fixed on 2026-09-21 (details in each entry).

1. **HIGH - saved LLM keys could be redirected by any local web page. FIXED (2026-09-21).** The HUD `/api` routes had no
   Origin/Sec-Fetch-Site/Host check, and six routes (`hud/app/api/integrations/list-claude-models`, `list-gemini-models`,
   `test-claude-model`, `test-gemini-model`, `test-grok-model`, `test-openai-model`) sent the **stored, decrypted key** to a
   request-supplied `baseUrl`; `PATCH /api/integrations/config` could persist an attacker `baseUrl`. What changed:
   - `hud/proxy.ts` (the Next 16 `proxy` convention, already active for `/api/:path*` and confirmed running on 16.1.6)
     now calls `evaluateLocalRequest()` from `hud/lib/security/local-request-guard.ts` before the rate limiter. All methods:
     the `Host` header must be `localhost`, `127.0.0.1` or `[::1]` (DNS-rebinding defense). POST/PUT/PATCH/DELETE: a present
     `Origin` must be a loopback origin on the same port as `Host`, and a present `Sec-Fetch-Site` must be `same-origin` or
     `none`. Failures return `403 {"ok":false,"code":"LOCAL_REQUEST_REQUIRED"}` with no secret content. Requests with neither
     `Origin` nor `Sec-Fetch-Site` (the agent runtime's server-side fetches, Electron main, curl) are still allowed, so the
     runtime bridges (which also carry the per-launch `x-nova-runtime-token`) and Electron (loads `http://127.0.0.1:3000`) are
     unaffected. GET/HEAD/OPTIONS skip the Origin check so OAuth provider redirects to `/api/**/callback` keep working.
   - The six routes now go through `resolveProviderProbeTarget()` (`hud/lib/security/provider-base-url.ts`): a stored key is
     only ever used with the stored/provider-default base URL (a differing request `baseUrl` without a typed key gets a 400);
     a request `baseUrl` is honoured only together with a key typed in the same request, and must be https, without
     userinfo/query/fragment, and not a localhost/private/link-local/CGNAT/`.local`/`.internal` host. The probes also use
     `redirect: "error"` so a redirect cannot carry the key header elsewhere. No route returns a decrypted key
     (`GET`/`PATCH /api/integrations/config` already return only `apiKeyConfigured`/`apiKeyMasked`).
   - `PATCH /api/integrations/config` runs the same `validateProviderBaseUrl()` on any changed OpenAI/Claude/Grok/Gemini
     `baseUrl` (400 on failure). Unchanged stored values are not re-validated, so existing setups keep working.
   - There is no local-model (Ollama / LM Studio) provider in the codebase, so no local exemption exists by default. Users of
     a local gateway can set the server-side env `NOVA_ALLOW_LOCAL_PROVIDER_BASE_URL=1` to allow http and private hosts.
   - Verified: `scripts/smoke/security/local-api-guard-smoke.mjs` (`npm run smoke:security-guard`), plus a throwaway
     `next dev` on a free port with a temp `NOVA_DATA_DIR`: foreign `Host`, foreign `Origin` and `Sec-Fetch-Site: cross-site`
     requests got 403; a normal local request still returned 200; with a stored key, a no-Origin request naming an attacker
     `baseUrl` got 400 and a local listener standing in for the attacker host received no connection; a same-origin PATCH of an
     `http://169.254.169.254` base URL got 400. Not verified: a run through the packaged Electron app, and a browser-driven
     cross-origin request (curl set the headers a browser would send). Still open by design: external-agent `endpoint`
     entries (`agents` in the config) accept any URL the user (or a same-origin request) sets, and the agent runtime's own
     LLM calls use the stored base URL as saved, including values saved before this fix.
2. **HIGH - the agent WebSocket had no origin check or auth. FIXED (2026-09-21).** `src/runtime/infrastructure/hud-gateway/index.js`
   now passes `verifyClient: createGatewayVerifyClient()` (`hud-gateway/origin-guard/index.js`: pure helpers plus the `ws`
   callback). Upgrades are refused with 403 when the `Host` is not loopback, or when an `Origin` header is present and is not
   `http://localhost|127.0.0.1|[::1]` on the HUD port (3000, plus `NOVA_HUD_PORT` / `PORT` and any full origins listed in
   `NOVA_WS_ALLOWED_ORIGINS`). `Origin: null` and `file://` are refused. Clients with no Origin (runtime tools, smokes) stay
   allowed; the HUD browser and Electron origin is `http://127.0.0.1:3000`. Each rejection logs one line
   (`[Gateway] Rejected WebSocket upgrade: disallowed origin|host.`) without header values or payloads. Verified by the smoke
   (helper unit tests, plus a real `ws` server using the same `verifyClient` that accepts no-Origin and local Origin and returns
   403 for foreign Origin / Origin `null` / foreign Host). Not verified: the full agent process was not started, so the wiring in
   `startGateway()` is checked only by a static source check and `node --check`, and no browser was used. There is still no
   per-launch token on the socket: a local process (not a web page) can connect.
3. **MEDIUM - ChatKit path enabled OpenAI Agents SDK tracing and `store: true`. FIXED (2026-09-21).**
   `src/integrations/chatkit/runner/index.ts` now calls `setTracingDisabled(true)` when loading `@openai/agents` (API confirmed in
   the installed `@openai/agents-core` 0.5.1 typings), builds the `Runner` with `tracingDisabled: true` and
   `traceIncludeSensitiveData: false`, and no longer attaches user/conversation ids as trace metadata; `nova.js` also exports
   `OPENAI_AGENTS_DISABLE_TRACING=1` to the processes it launches. `NOVA_CHATKIT_STORE` now defaults to off (`config/index.ts`,
   `.env.example`); setting it to `1` opts in to OpenAI retaining responses. `@openai/agents` is imported only in that runner;
   the other SDK clients (`openai` in `src/providers/runtime/runtime.js`, `@anthropic-ai/sdk` in `src/agent/*`) have no tracing
   or telemetry switch to disable. Verified by the static check in the smoke and `tsc`; a live ChatKit call was not made.
4. **MEDIUM - unattended, user/LLM-defined egress.** Mission `http-request` nodes
   (`hud/lib/missions/workflow/executors/data-executors.ts`), `webhook` output (`hud/lib/missions/output/dispatch.ts`)
   and the `web_fetch` tool can POST/GET mission or conversation text to any public URL. They pass through an SSRF guard
   (private/loopback/link-local blocked, redirects bounded) but a mission generated from a prompt, or a prompt-injected
   agent, can still choose the destination. I did not verify whether mission templating (`resolveExpr`) can reach stored
   secrets; treat that as unverified.
5. **LOW - plaintext keys in `.env`.** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `FISH_API_KEY`, etc. read from `.env`
   are plain text on disk and used by the runtime (LLM, embeddings, TTS). They are not covered by the DPAPI encryption.
6. **LOW - direct browser-to-third-party requests.** The user's browser (not the Nova server) contacts Open-Meteo
   (city name, then coordinates), Polymarket public APIs/WebSocket, `www.youtube.com` (embedded player) and
   `i.ytimg.com` (thumbnails). No Nova credentials are involved, but those services see the user's IP.
7. **INFO - build/install-time downloads.** `npm install`, `npm run db:fix-native` (better-sqlite3 prebuilt from GitHub),
   Playwright browsers, and `next/font/google` (Geist fonts fetched at `next build`/`next dev` and then self-hosted, so
   the running app does not contact Google Fonts). Electron/Chromium's own background traffic was not audited.
8. **INFO - Telegram token in the URL.** The Bot API requires `https://api.telegram.org/bot<token>/...`. The token is only
   sent to Telegram, but any URL logging would expose it. `redactSecrets()` has a pattern for it; new logging should use it.

## LLM providers (user-configured)

| Purpose | Code | Destination | Sent | Credential |
|---|---|---|---|---|
| Chat completions and streaming (OpenAI-compatible) | `src/providers/clients/index.ts`, `src/providers/runtime/runtime.js` (`new OpenAI({apiKey, baseURL})`) | provider base URL from the user's integration config; defaults `api.openai.com`, `api.x.ai`, `generativelanguage.googleapis.com` | conversation messages, system prompt, tool definitions/results | that provider's API key, `Authorization: Bearer` |
| Claude messages | `src/providers/runtime/runtime.js`, `src/agent/runner`, `src/agent/compact` (`@anthropic-ai/sdk`) | `api.anthropic.com` or the configured base URL | messages, system prompt | Anthropic key, `x-api-key` |
| Mission LLM steps, mission suggestions | `hud/lib/missions/llm/providers.ts`, `hud/app/api/missions/nova-suggest/route.ts` | the configured provider base URL | mission prompt text and context | that provider's key |
| Model list / model probe (Integrations page) | `hud/app/api/integrations/{list,test}-*-model/route.ts` | provider base URL | key check, model id | that provider's key (base URL restricted, **Finding 1 fixed**) |
| ChatKit workflow | `src/integrations/chatkit/runner/index.ts` | `api.openai.com` (tracing now disabled, **Finding 3 fixed**) | prompt (no trace export; `store` off by default) | `OPENAI_API_KEY` from env |
| Embeddings (only if `NOVA_EMBEDDING_PROVIDER=openai`; default is local) | `src/memory/embeddings/index.ts` | `api.openai.com/v1/embeddings` | memory chunk text | OpenAI key |
| Speech-to-text | `src/runtime/modules/audio/voice/index.js` (`openai.audio.transcriptions`) | OpenAI | recorded audio | OpenAI key |
| Text-to-speech | same file, `fish-audio` SDK | `api.fish.audio` | text to speak | `FISH_API_KEY` |

If the user sets a custom base URL, that host receives the key by design.

## Notifications the user configured

| Purpose | Code | Destination | Sent | Credential |
|---|---|---|---|---|
| Telegram | `hud/lib/notifications/telegram`, `src/runtime/modules/services/telegram`, `hud/scripts/send-telegram-notification.mjs` | `api.telegram.org` | message text, chat id | bot token (in URL path), Telegram only |
| Discord | `hud/lib/notifications/discord`, `discord-webhook`, `src/runtime/.../discord/adapters/webhook`, `hud/scripts/send-notification.mjs` | webhook URL, validated to Discord hosts over HTTPS, private hosts refused | message text | the webhook URL itself (it is the secret) |
| Slack | `hud/lib/notifications/slack` | `hooks.slack.com` webhook, validated | message text | the webhook URL |
| Generic webhook output | `hud/lib/missions/output/dispatch.ts` | any public URL the mission lists (SSRF-guarded) | mission output text, mission id/label, timestamp | none |

## Google, Spotify, YouTube, Coinbase, Polymarket (user-connected)

| Purpose | Code | Destination | Sent | Credential |
|---|---|---|---|---|
| Gmail read/send | `src/tools/builtin/gmail-tools/index.ts`, `hud/lib/integrations/gmail/*` | `gmail.googleapis.com` (fixed host) | mailbox queries, message bodies the user asks to send | Google OAuth access/refresh token |
| Google OAuth (Gmail, Calendar, YouTube) | `hud/lib/integrations/{gmail,google-calendar,youtube}/tokens`, callbacks | `accounts.google.com` (browser redirect), `oauth2.googleapis.com` (token, revoke), `openidconnect.googleapis.com` (userinfo) | auth code, refresh token, OAuth client id/secret | Google only |
| Google Calendar | `hud/lib/integrations/google-calendar/*` | `www.googleapis.com/calendar` | event data | Google token |
| YouTube data | `hud/lib/integrations/youtube/*` | `www.googleapis.com/youtube/v3` | search terms, channel/video ids | Google token |
| Spotify | `hud/lib/integrations/spotify/*` | `accounts.spotify.com` (token), `api.spotify.com` | playback commands, search terms | Spotify token / client credentials |
| Coinbase (private) | `src/integrations/coinbase/*` (host allowlist), `hud/app/api/integrations/test-coinbase`, `hud/lib/missions/coinbase/fetch.ts` | `api.coinbase.com`, `api.exchange.coinbase.com` (fixed hosts) | account/portfolio reads | signed JWT built from the Coinbase API key/secret, Coinbase only |
| Coinbase (public spot price) | `hud/app/api/coinbase/market/route.ts`, `hud/lib/missions/coinbase/fetch.ts` | `api.coinbase.com/v2/prices` | ticker symbol | none |
| Polymarket market data | `hud/lib/integrations/polymarket/*`, `src/runtime/modules/services/polymarket` | `gamma-api.`, `clob.`, `data-api.polymarket.com`, `wss://ws-subscriptions-clob.polymarket.com` | market ids, wallet address for profile lookups | none (public); wallet signing stays in the user's wallet (`viem` `custom` provider, wallet-managed `polygon-rpc.com`) |
| Phantom | `hud/app/integrations`, `hud/lib/integrations/phantom` | `phantom.app` (links/deep links in the browser) | wallet address for challenge/verification | none stored |

## Web research (user-requested)

| Purpose | Code | Destination | Sent | Credential |
|---|---|---|---|---|
| Web search | `src/tools/web/web-search`, `hud/lib/missions/web/search.ts` | `api.search.brave.com` (hostname allowlist); fallback HTML search via `search.brave.com` and `duckduckgo.com/html` | search query | Brave API key, only to `api.search.brave.com` |
| Page fetch / link understanding | `src/tools/web/web-fetch`, `src/tools/web/net-guard`, `hud/lib/missions/web/*` | the URL the user or agent chose | the URL, generic headers | none (SSRF-guarded) |
| RSS / mission HTTP nodes | `hud/lib/missions/workflow/executors/data-executors.ts` | URL in the mission | node body/headers the mission defines | only what the mission author put in (**Finding 4**) |
| Weather | `src/runtime/modules/chat/workers/market/weather-service`, `hud/app/home/hooks/use-home-weather.ts` | `geocoding-api.open-meteo.com`, `api.open-meteo.com` | city name, coordinates | none |

## Local-only sockets and processes (not egress)

- HUD to agent: `ws://localhost:8765` (`hud/lib/chat/hooks/useNovaState.ts`); server bound to `127.0.0.1`, browser Origin/Host checked at upgrade (**Finding 2 fixed**).
- Agent to HUD API: `http://127.0.0.1:3000` (Spotify, YouTube, calendar, missions bridges).
- Electron main starts local Node processes for agent tasks (`hud/electron/main.js`); it makes no network calls itself.
- PowerShell is spawned for DPAPI wrapping and system metrics; no network use.

## Secrets vs. destinations, in short

Each stored secret is attached only to requests to its own provider's endpoint, and the fixed-host integrations (Gmail,
Coinbase, Brave, Google/Spotify OAuth) enforce the host in code. The exceptions are the user-configurable LLM base URLs
(the key goes to whatever base URL is configured, by design). Finding 1 (that configuration could be changed or
overridden by a cross-origin request) is fixed by the local request guard and base URL validation.
