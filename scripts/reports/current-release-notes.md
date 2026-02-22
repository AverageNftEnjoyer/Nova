# NovaOS Current Release Notes

## Version
- `V.22 Alpha`

## Scope Included
- ChatKit integration phases 1-5:
  - Config-safe foundation with feature flags and validation
  - Shadow evaluation path (non-user-visible)
  - Controlled serving for low-risk intents with hard fallback
  - Structured workflow orchestration (`research -> summarize -> display`)
  - Release gate with reliability/latency/quality checks and evidence artifact

## Key Improvements
- Higher response structure consistency for complex prompts.
- Safer rollout controls for new model orchestration paths.
- Better operational observability via structured ChatKit events.

## Evidence Artifacts
- `archive/logs/chatkit-events.jsonl`
- `archive/logs/chatkit-phase5-gate-report.json`

## Known Constraints
- Live-gate quality confidence is strongest when shadow comparison volume is non-zero.
- Latency/reliability assertions should use a scoped recent lookback window for clean adjudication.


