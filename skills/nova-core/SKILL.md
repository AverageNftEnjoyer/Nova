# Nova Core Skill

## Purpose
Default behavior for Nova runtime work (agent loop, sessions, tools, memory).

## Rules
1. Prefer editing existing runtime files before creating parallel logic.
2. Keep provider/model selection aligned with Integrations active settings.
3. Preserve session isolation and transcript integrity.
4. Add verification steps after each behavior change.

## Execution Pattern
1. Inspect current behavior.
2. Apply minimal patch.
3. Run syntax/type checks.
4. Report done/pending items clearly.
