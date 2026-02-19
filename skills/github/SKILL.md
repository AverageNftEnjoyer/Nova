---
name: github
description: GitHub operations workflow for issues, pull requests, CI status, and repo investigation.
metadata: { "read_when": ["User asks about GitHub issues, PRs, workflows, CI failures, or repository status."], "openclaw": { "requires": { "bins": ["gh"] } } }
---

# GitHub Skill

## Activation
- Use this skill when the user needs GitHub issue/PR/CI information or repo-level triage.
- If owner/repo is missing, derive from current git remote when possible.

## Workflow
### 1. Scope
- Identify whether the user needs: issue triage, PR review, CI diagnosis, or release status.

### 2. Execute
- Use `gh` CLI commands for authoritative repo data (`gh issue`, `gh pr`, `gh run`, `gh api`).
- Summarize high-signal findings first: failing checks, blocked reviewers, or merge conflicts.
- Provide command outputs as concise facts, not raw dumps.

### 3. Verification Before Done
- Confirm repository and branch references are correct.
- Include PR/issue numbers and workflow names in the final summary.
- Distinguish between observed facts and inferred causes.

## Completion Criteria
- Output is actionable and references concrete GitHub objects (issue/PR/run IDs).
- Any unknowns are clearly listed with next command to resolve them.
