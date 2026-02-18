---
name: pickup
description: Rapid context rehydration workflow that checks current state, active processes, and immediate next actions before execution.
metadata:
  read_when:
    - Starting a new task in an existing workspace.
    - Resuming work after interruption or context loss.
---

# Pickup Skill

## Activation
Use this skill when you need to quickly rehydrate working context before coding.

Use this before substantial edits when state is unclear.

## Workflow
### 1. Baseline Context
- Read local agent instructions and any task-local docs relevant to the current request.
- Capture current branch and workspace status.

### 2. Runtime and Process State
- Check for live sessions, background processes, or local servers that affect execution.
- Note CI/test status if available.

### 3. Verification Before Done
- Confirm your summary reflects actual current state (not assumptions).
- Call out blockers, unknowns, and what evidence is missing.

### 4. Immediate Execution Plan
- Produce the next 2 to 3 concrete actions in order.
- Start with the smallest high-confidence action.

## Completion Criteria
- Current repo/process/test state is summarized with concrete evidence.
- Blockers and unknowns are explicit.
- Next 2 to 3 actions are actionable and ordered.
