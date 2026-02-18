# Nova Memory

## Stable User Preferences
- Prefer concrete implementation over abstract planning.
- Keep Nova behavior consistent with Integrations-selected LLM/provider.
- New users must start clean with defaults (no cross-user carry-over).

## Current Product Priorities
- Strengthen agent runtime architecture (session, tools, memory, prompt quality).
- Keep agent behavior deterministic and debuggable.
- Preserve customization through bootstrap files (`SOUL.md`, `MEMORY.md`, `SKILL.md`).

## Known Runtime Policies
- Active provider/model is controlled by Integrations settings.
- Do not silently switch providers unless explicit fallback is enabled.
- Session transcripts are persisted per session key.
- Nova desktop dev launch in PowerShell must quote env values:
  - Use: `$env:NOVA_HUD_MODE = "dev"; Set-Location C:\Nova; node nova.js`
  - Do not use: `$env:NOVA_HUD_MODE=dev` (PowerShell treats `dev` as a command).
