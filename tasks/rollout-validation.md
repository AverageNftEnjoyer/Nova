# Skill Overhaul Rollout Validation

Date: 2026-02-18
Type: Spec-level dry run validation (one scenario per upgraded skill)

## Case 1 - `nova-core`
- Prompt: "Refactor runtime session lock behavior across files and verify no regressions."
- Expected behavior:
  - Requires plan-first flow for non-trivial work.
  - Tracks progress in `tasks/todo.md`.
  - Requires verification evidence before completion.
- Status: Pass

## Case 2 - `research`
- Prompt: "Compare current LLM provider options and explain conflicts between sources."
- Expected behavior:
  - Uses `web_search` and `web_fetch`.
  - Cross-references agreements/conflicts/unknowns.
  - Provides citations, dates, and confidence grade.
- Status: Pass

## Case 3 - `summarize`
- Prompt: "Summarize this article URL and give confidence."
- Expected behavior:
  - Fetches source with `web_fetch`.
  - Returns TLDR, key points, detailed summary.
  - Includes metadata, risk notes, and confidence grade.
- Status: Pass

## Case 4 - `daily-briefing`
- Prompt: "Give me a morning briefing with current priorities."
- Expected behavior:
  - Pulls tasks/deadlines from `MEMORY.md`.
  - Adds fresh updates with date and source.
  - Labels uncertain items and flags missing memory context.
- Status: Pass

## Residual Risk
- This is a spec-level dry run, not a live agent replay test.
- Future improvement: run automated prompt-to-skill routing tests when harness exists.

## Strict Structure Validation Sweep (Post-Phase-3)
- Date: 2026-02-18
- Scope: `skills/nova-core`, `skills/research`, `skills/summarize`, `skills/daily-briefing`
- Checks:
  - YAML frontmatter present
  - Frontmatter keys constrained to `name` + `description`
  - Explicit `Activation` section present
  - Explicit `Verification Before Done` gate present
  - Explicit `Completion Criteria` section present
- Result: Pass (all four skills)

### Notes
- `PyYAML` was installed (`python -m pip install PyYAML`) and `skill-creator` `quick_validate.py` was run on all four skill folders.
- `quick_validate.py` result: Pass (`Skill is valid!`) for each upgraded skill.
- Direct file checks were also run as a secondary cross-check for required sections.
