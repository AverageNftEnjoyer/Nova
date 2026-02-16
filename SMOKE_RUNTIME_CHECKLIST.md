# Nova Runtime Smoke Checklist (Internal)

Date: 2026-02-16
Build under test: current local workspace (`c:\Nova`)
Validation script: `scripts/smoke/runtime-smoke.mjs`

## Scope
- [x] Provider routing logic validates for `openai`, `claude`, `grok`, `gemini`
- [x] Strict provider mode rejects disabled/missing-key providers
- [x] Fallback mode selects first ready provider in expected order
- [x] OpenAI live ping succeeds (if configured)
- [x] Claude/Grok/Gemini branch paths are exercised (live or expected-auth-fail)
- [x] Session/account isolation behaves correctly per session key hints
- [x] Transcript append/read stays isolated between sessions
- [x] Tool runtime initializes from `dist/tools/*`
- [x] Tool execution works for at least one file tool
- [x] Memory manager initializes from `src/memory/*` path
- [x] Voice wake detection/strip logic works
- [x] Brave-only search provider remains enforced in tool/runtime scan

## Result Snapshot
- Script exit: pass (`11/11` checks passed).
- Live provider call: OpenAI passed.
- Disabled providers in current config: Claude, Grok, Gemini.
  - Their runtime branches were exercised via expected auth-fail paths and passed guard behavior.

## Notes
- This checklist is validated by `scripts/smoke/runtime-smoke.mjs`.
- For full live-provider verification, enable Claude/Grok/Gemini in Integrations and rerun the script.
