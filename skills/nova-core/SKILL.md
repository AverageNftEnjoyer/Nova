---
name: nova-core
description: Default execution policy for Nova runtime and cross-file implementation work. Use for planning, verification, bug fixing, and maintaining session/provider correctness.
metadata:
  read_when:
    - Work spans runtime behavior, multi-file refactors, or behavior-sensitive bug fixes.
---

# Nova Core Skill

## Activation
Use this skill when work involves:
- runtime/session/provider behavior
- cross-file implementation changes
- non-trivial bug fixing that needs plan + verification

Do not default to this skill for simple one-file edits that do not change behavior.

## Workflow Orchestration

### 1. Plan Mode Default
- Start with a written plan for any non-trivial task:
  - 3 or more meaningful steps
  - Architectural or data-flow decisions
  - Cross-file refactors
  - Behavior-sensitive fixes
- Record the plan in `tasks/todo.md` as checkboxes before implementation.
- If assumptions break mid-task, stop and re-plan in `tasks/todo.md` before continuing.

### 2. Task Management
Execute in this order for every non-trivial task:
1. Plan first in `tasks/todo.md`.
2. Verify plan before editing.
3. Track progress by checking items as they complete.
4. Explain behavior changes and why they are safe.
5. Document results and unresolved risk.
6. Capture lessons in `tasks/lessons.md` after corrections.

### 3. Autonomous Bug Fixing
- Reproduce first, then inspect logs and failing checks.
- Fix root cause, not only symptoms.
- Run relevant tests/checks before marking complete.
- Minimize user back-and-forth; carry fixes to completion unless blocked by missing context.

### 4. Verification Before Done
Never mark done without evidence:
1. Show the relevant diff is coherent and scoped.
2. Run the smallest relevant checks (lint/type/test/build as appropriate).
3. Confirm behavior at the touchpoint that broke.
4. State residual risk explicitly if full validation is not possible.

### 5. Demand Elegance (Balanced)
- For non-trivial fixes, pause once and ask: "Is there a simpler, safer path?"
- If current fix is fragile, rewrite to a cleaner structure.
- Skip heavy redesign for obvious simple fixes.

### 6. Self-Improvement Loop
- After any user correction, append one concise entry in `tasks/lessons.md`:
  - Correction
  - Preventive rule
  - Scope where the rule applies
- Review recent lessons at the start of related work.

## Completion Criteria
- `tasks/todo.md` reflects the executed plan for non-trivial work.
- Verification evidence is captured (diff coherence plus relevant checks).
- Any residual risk or unverified edge case is stated explicitly.
- `tasks/lessons.md` is updated after user-reported corrections.

## Core Principles
- Simplicity first: touch the minimum code needed.
- No laziness: identify and resolve root causes.
- Minimal impact: avoid changes outside the task boundary.
- Determinism: keep behavior and provider selection predictable.

## Runtime Guardrails
1. Prefer editing existing runtime files before introducing parallel logic.
2. Keep provider/model selection aligned with Integrations active settings.
3. Preserve session isolation and transcript integrity.
4. Add verification after each behavior change.
