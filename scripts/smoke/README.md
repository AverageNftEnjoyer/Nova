# Smoke Test Organization

All smoke tests under `scripts/smoke/` must live in a subfolder.
Do not add smoke test files directly in `scripts/smoke/`.

## Folder taxonomy

- `core/`: runtime and baseline parity checks.
- `scripts/coinbase/smoke/`: Coinbase integration and phase-specific smoke suites.
- `scheduler/`: scheduler stability, delivery, store, and skills snapshots.
- `security/`: isolation and security regression/hardening checks.
- `quality/`: eval, mission quality, prompt budget, and release readiness.
- `workstreams/`: workstream-specific live/latency/session-key smokes.
- `conversation/`: conversation behavior, memory, persona, and output constraints.
- `routing/`: routing, plugin isolation, transport, and tool-loop smokes.
- `hud/`: HUD/UI-bound smoke tests.
- `verification/`: one-off verification scripts tied to release phases.

## Naming conventions

- Keep filenames explicit and stable.
- Prefer `*-smoke.mjs` suffix for smoke tests.
- Use domain prefixes when useful (for example `src-`, `hud-`, `verify-`).

## Contribution rule

Before adding a new smoke test:

1. Pick the best matching domain folder above.
2. Add/update `package.json` script paths if needed.
3. If no folder fits, create a new domain folder and document it here in the same PR.