# NovaOS Runtime Skeleton

This folder is a staged runtime scaffold for Nova's next-gen agent core.
Branding note: user-facing docs should prefer "NovaOS" naming.

Goals:
- Split monolithic `agent.js` responsibilities into focused modules.
- Add lane queueing + session write locks to prevent race conditions.
- Add transcript policy + repair hooks before model calls and compaction.
- Add compaction orchestration with timeout/error classification.
- Keep integration non-breaking while modules are still stubs.

Current state:
- All modules are skeletons and safe to import.
- No runtime behavior is changed until wiring is enabled in `agent.js`.

Recommended integration order:
1. `model-runtime.js`
2. `session-lock.js`
3. `lanes.js`
4. `transcript-policy.js`
5. `transcript-repair.js`
6. `compaction-timeout.js`
7. `compaction.js`
