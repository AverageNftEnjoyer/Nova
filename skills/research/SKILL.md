# Research Skill

## Activation

Activate this skill when the user asks to:
- research
- investigate
- find out about
- compare
- answer a complex factual question

Use this skill for depth, not quick trivia.

## Workflow

### Step 1: Frame the question

Convert the user's request into three to five focused search queries. Queries should separate:
- background context
- current state
- decision-critical comparisons

If scope is broad, split by subtopic first.

### Step 2: Search broadly

Run `web_search` for each query.
Capture the strongest candidates, not just top rank.
Prioritize primary sources when possible.

### Step 3: Fetch selectively

Choose the three most promising sources and run `web_fetch` on each.
Prefer:
- official documentation
- company or org announcements
- standards bodies
- peer-reviewed or direct datasets

Avoid low-quality SEO mirrors unless they provide unique evidence.

### Step 4: Cross-reference

Compare facts across sources.
Mark:
- agreements
- conflicts
- unknowns

If conflicts remain unresolved, call them out explicitly with dates and source links.

### Step 5: Synthesize output

Return a structured response with:
1. TLDR (1-2 sentences)
2. Key findings grouped by subtopic
3. Sources (URL + one-line source description)
4. Confidence notes (well-established vs uncertain claims)

### Step 6: Extend when needed

If question coverage is incomplete, propose targeted follow-up searches and explain what each follow-up would resolve.

## Quality Bar

- Include citations for material claims.
- Include dates for time-sensitive facts.
- Keep conclusions proportional to evidence strength.
- If evidence is weak, say so directly.
