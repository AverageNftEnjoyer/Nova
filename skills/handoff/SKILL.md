---
name: handoff
description: Structured handoff workflow that packages status, checks, risks, and ordered next steps for seamless continuation.
user-invokable: false
metadata:
  read_when:
    - Wrapping up work for another agent or future session.
    - Pausing with uncommitted changes or unfinished validation.
---

# Handoff Skill

## Activation
Use this skill when ending a work block and preparing continuation by another agent or a later session.

## Workflow
### 1. Scope and Status Snapshot
- Summarize what was being done, what is complete, and what remains pending.
- Include blockers and unresolved decisions.

### 2. Working State
- Record branch, modified files, and whether commits were made.
- Record active processes or sessions and how to reattach.

### 3. Verification Before Done
- List checks run and their outcomes.
- Explicitly state what verification is still missing.

### 4. Ordered Next Steps
- Provide the first 3 actions the next session should perform.
- Include any risk notes (flags, credentials, flaky paths, brittle assumptions).

## Completion Criteria
- Handoff includes status, workspace state, validation status, and risks.
- Next steps are explicit, ordered, and immediately executable.
- Continuation can start without re-discovery work.
