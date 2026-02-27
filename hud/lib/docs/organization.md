# hud/lib Organization Guide

Keep `hud/lib` domain-organized. Avoid adding operational source files directly under `hud/lib`.

## Folder map

- `auth/`: active user identity, login/session helpers.
- `chat/`: chat state, conversation data, chat-specific hooks.
- `context/`: React context providers/hooks (theme, accent, etc.).
- `hooks/`: app-wide generic hooks not tied to one domain.
- `integrations/`: provider catalogs, model labels, integration stores, integration hooks.
- `media/`: media persistence/playback helpers.
- `meta/`: version/release metadata.
- `missions/`: mission runtime, parsing, generation, workflows.
- `notifications/`: dispatch/schedule/logging for notification channels.
- `telegram/`: Nova chat runtime support modules.
- `security/`: auth hardening, encryption, rate limiting.
- `settings/`: persistent user/UI settings and caches.
- `shared/`: small cross-domain utilities.
- `supabase/`: Supabase clients/env utilities.
- `workspace/`: workspace-scoped sync/state modules.
- `docs/`: internal structure/maintenance documentation.

## Placement rules

1. Put new files in an existing domain folder first.
2. If no folder matches, create a new domain folder instead of a root file.
3. Keep UI code out of `lib` unless it is shared logic (`context/*`, `hooks/*`).
4. Use explicit domain imports (example: `@/lib/settings/userSettings`).
5. When moving files, update aliases and run `npm run lint --prefix hud` and `npm run build --prefix hud`.
