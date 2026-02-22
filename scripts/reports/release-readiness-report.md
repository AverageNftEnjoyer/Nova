# NovaOS Release Readiness Report

## Rollout Checklist
- [x] Agent core build passes.
- [x] HUD typecheck passes.
- [x] Security and isolation smoke gates wired in release chain.
- [x] Coinbase CI + readiness gates wired in release chain.
- [x] ChatKit phase release chain passes with evidence output.

## Validation Commands
- `npm.cmd run smoke:src-release-readiness`
- `npm.cmd run smoke:src-chatkit-release`
- `npm.cmd run smoke:src-release`

## Gate Evidence
- ChatKit gate report:
  - `archive/logs/chatkit-phase5-gate-report.json`
- ChatKit event stream:
  - `archive/logs/chatkit-events.jsonl`

## Rollback Plan
1. Set ChatKit toggles off:
   - `NOVA_CHATKIT_ENABLED=0`
   - `NOVA_CHATKIT_SERVE_MODE=0`
   - `NOVA_CHATKIT_SHADOW_MODE=0`
2. Re-run:
   - `npm.cmd run build:agent-core`
   - `npm.cmd run smoke:src-release-readiness`
3. If any critical gate still fails, revert to last known-good release commit/tag.


