---
name: daily-briefing
description: Concise situational briefing workflow that blends local memory with date-fresh external updates and explicit verification labels.
metadata:
  read_when:
    - User asks for a daily recap, morning briefing, or "catch me up" summary.
---

# Daily Briefing Skill

## Activation
Use this skill when the user asks for:
- a morning or daily briefing
- "what's new" or "catch me up"
- a compact status snapshot of tasks plus relevant external updates

Do not use this skill for deep single-topic research. Route that to `research`.

## Workflow

### 1. Scope and planning
If the request spans multiple domains or decisions, create a short plan before drafting:
- memory/state items to extract
- external topics to check
- output structure and limits

Track non-trivial plans in `tasks/todo.md`.

### 2. Read persistent context
Check `MEMORY.md` first for:
- active projects
- current action items
- deadlines and reminders
- unresolved decisions

Extract high-priority items only.

### 3. Gather fresh external updates
Use targeted `web_search` plus `web_fetch` for relevant updates from `USER.md` interests.
- Prefer high-quality sources.
- Default freshness window: latest available, with explicit dates in output.
- Ignore low-signal trend noise unless requested.

### 4. Compose briefing
Deliver in 3 compact blocks:
1. Active tasks and action items from memory
2. Relevant updates (2 to 3 items, each with source and date)
3. Upcoming deadlines/reminders from memory

### 5. Verification Before Done
Before finalizing:
- Include concrete dates for time-sensitive items.
- Label each external item as `verified` or `uncertain`.
- Do not invent reminders not present in memory/context.
- If memory is incomplete, call out the gap and what should be added.

### 6. Completion criteria and risk notes
- Keep default length under 300 words unless user asks for expansion.
- Prioritize decisions/blockers over trivia.
- End with one follow-up option.
- Add a brief risk note if source quality or freshness is weak.

## Completion Criteria
- Briefing stays concise and decision-focused by default.
- External updates include source, date, and `verified`/`uncertain` label.
- Memory-derived reminders are not invented or extrapolated.
- One follow-up option and any freshness risk note are included.
