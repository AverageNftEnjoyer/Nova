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
- `runtime/`: runtime integration and user-context isolation smoke tests.
- `verification/`: one-off verification scripts tied to release phases.
- `packaging/`: packaged production-server boot (Next plus the runtime scheduler) against `hud/dist/win-unpacked`.
- `lib/`: shared helpers. `isolated-data-dir.mjs` points `NOVA_DATA_DIR` at a throwaway temp dir.
- `local-db/`: SQLite foundation, encryption, persistence and data-path smokes, plus the guard that proves no smoke writes to the real data dir.

## Naming conventions

- Keep filenames explicit and stable.
- Prefer `*-smoke.mjs` suffix for smoke tests.
- Use domain prefixes when useful (for example `src-`, `hud-`, `verify-`).

## Test isolation (mandatory)

Every smoke that can reach `src/db`, the runtime stores or the per-user file area must run against a temporary data
directory, never the repo's `.user/` folder. Make this the FIRST import of the script (ES imports run in source order):

```js
import "../lib/isolated-data-dir.mjs" // adjust the relative path
```

`npm run smoke:local-db` includes `no-real-data-writes-smoke.mjs`, which fails if a representative set of smokes changes
the real `nova.db` or creates paths in the real data dir.

## Contribution rule

Before adding a new smoke test:

1. Pick the best matching domain folder above.
2. Add/update `package.json` script paths if needed.
3. If no folder fits, create a new domain folder and document it here in the same PR.
