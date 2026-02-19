# OpenClaw Phase 20 - Release Notes

## Summary

- Completed Phase 19 memory relevance/compression lift and Phase 20 security regression net hardening.
- Expanded release gate coverage so `smoke:src-release` now validates security, memory, routing arbitration, and plugin isolation before HUD build.
- Added durable regression checks for locked runtime security defaults and multi-suite security continuity.

## Phase 19 Highlights

- Memory recall context now uses query-aware sentence compaction and deduped snippets to retain high-signal facts under tighter token budgets.
- Added long-thread benchmark coverage in `scripts/smoke/src-memory-convergence-smoke.mjs`:
  - confirms critical facts survive noisy memory corpora
  - enforces token-bounded recall output
- Added environment knobs for memory recall and ranking/decay tunables in `.env.example`.

## Phase 20 Highlights

- Added `scripts/smoke/src-security-regression-net-smoke.mjs` to verify:
  - SSRF/prompt-injection guards remain active
  - tool risk policy blocks dangerous operations by default
  - scheduler reliability regression checks remain intact
  - release smoke chain includes security/memory/routing/isolation gates
- Updated `smoke:src-release` to include:
  - `smoke:src-security`
  - `smoke:src-memory`
  - `smoke:src-routing`
  - `smoke:src-plugin-isolation`
  - `smoke:src-security-regression`
- Updated release-readiness checks to allow current-phase release note artifacts and expanded env hardening docs validation.

## Rollout Checklist

1. Run `npm run smoke:src-release`.
2. Confirm `logs/openclaw-phase19.log` and `logs/openclaw-phase20.log` are present and green.
3. Verify HUD production build success.
4. Verify no unresolved references to `.tmp/openclaw-upstream` in runtime production paths.
5. Tag release after smoke/log review.

## Rollback Plan

1. Revert commit range covering phase 19/20 changes.
2. Restore previous `package.json` release smoke chain.
3. Re-run `npm run smoke:src-release` on rollback branch.
4. Re-deploy last known stable tag.
