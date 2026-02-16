# Persistent Memory

This file is loaded into every conversation. Add important facts, decisions, and context here that should be remembered across sessions.

The AI can also write to this file when significant decisions are made. Review periodically and clean up stale entries.

## Key Decisions

- YYYY-MM-DD: [Decision and why it was made]
- YYYY-MM-DD: [Architecture or tooling decision]
- YYYY-MM-DD: [Policy decision affecting future work]

## Project Status

- YYYY-MM-DD: [Project name] — [Current state], [Next milestone], [Blockers]
- YYYY-MM-DD: [Project name] — [Done], [In progress], [Target date]

## Important Facts

- YYYY-MM-DD: [Infrastructure fact, endpoint, constraint, or limit]
- YYYY-MM-DD: [Service dependency and known caveat]
- YYYY-MM-DD: [Operational detail that is frequently needed]

## Preferences Learned

- YYYY-MM-DD: [User communication preference]
- YYYY-MM-DD: [Coding style or tooling preference]
- YYYY-MM-DD: [Workflow preference discovered in conversation]

## Meeting Notes / Action Items

- YYYY-MM-DD: [Meeting summary in one line]
- YYYY-MM-DD: [Action item] — owner: [name], due: [date]
- YYYY-MM-DD: [Follow-up needed and context]

## Memory Hygiene

- YYYY-MM-DD: [Removed stale entry category]
- YYYY-MM-DD: [Archived resolved items to memory/archive.md]

Guidance:
- Keep this file under 4000 words. Long entries bloat every conversation's token usage. Move old/resolved items to `memory/archive.md`.
- Prefer short, factual entries.
- Avoid duplicating temporary chat details that won't matter next week.
- For each major decision, include one sentence about impact so future sessions understand why it matters.
- If an entry is resolved, mark it clearly and move it to archive during weekly cleanup.

Example high-signal entry:
- YYYY-MM-DD: [Migrated auth callbacks to new route guard to stop cross-user state leakage; impact: onboarding now isolated per account.]
