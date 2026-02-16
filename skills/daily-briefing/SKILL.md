# Daily Briefing Skill

## Activation

Activate when user requests:
- briefing
- what's new
- catch me up
- morning update
- daily summary

Use this skill for concise situational awareness.

## Workflow

### Step 1: Read persistent context

Check `MEMORY.md` first for:
- active projects
- current action items
- deadlines and reminders
- unresolved decisions

Extract only high-priority items for today's context.

### Step 2: Gather external updates

Run targeted web searches for topics relevant to the user's field from `USER.md`.
Prefer recent and credible sources.
Ignore low-quality trend noise unless user explicitly wants it.

### Step 3: Compose briefing

Deliver in three compact blocks:
1. Active tasks and action items from memory
2. Relevant news (2-3 items, one line each with source)
3. Upcoming deadlines/reminders inferred from memory notes

### Step 4: Keep it tight

Total length should stay under 300 words unless user asks for expansion.
Prioritize decisions and blockers over trivia.

### Step 5: Prompt follow-up

End with one useful follow-up option, for example:
- "Want deeper detail on any item?"
- "Want this transformed into a task checklist?"

## Quality Rules

- Include dates for time-sensitive updates.
- Label uncertain or unverified items.
- Do not invent reminders that don't exist in memory/context.
- If memory has gaps, say what's missing and suggest what to record.
