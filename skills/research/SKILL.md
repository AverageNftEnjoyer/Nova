---
name: research
description: Deep factual research workflow for multi-source analysis, comparison tasks, and time-sensitive questions using web_search and web_fetch.
metadata:
  read_when:
    - User asks for deep research, option comparison, or fact verification with sources.
---

# Research Skill

## Activation
Use this skill when the user asks to:
- research or investigate a topic
- compare options with evidence
- answer a complex factual question
- verify current or rapidly changing information

Use this for depth and evidence synthesis, not quick trivia.

## Workflow

### 1. Plan mode for non-trivial scope
Create a short plan before execution when any of these apply:
- 3+ distinct subtopics
- decision-impacting comparisons
- ambiguous scope that needs decomposition

Track plan items in `tasks/todo.md` for non-trivial runs.

### 2. Frame precise queries
Convert the request into 3 to 5 focused queries spanning:
- background context
- current state
- decision-critical comparisons

If the prompt is broad, split by subtopic first.

### 3. Search and gather candidates
Run `web_search` per query.
- Keep the strongest candidates, not only top rank.
- Prefer primary sources: official docs, original announcements, standards bodies, direct data.
- Use recency-aware queries for fast-changing topics.

### 4. Fetch and evaluate evidence
Fetch the best sources with `web_fetch`.
- Prioritize source quality over volume.
- Reject low-signal mirrors unless they contain unique evidence.

### 5. Cross-reference and resolve conflicts
For major claims, classify into:
- agreements
- conflicts
- unknowns

If conflicts remain unresolved, call them out explicitly with source links and dates.

### 6. Synthesize with confidence grading
Return:
1. TLDR (1 to 2 sentences)
2. Key findings by subtopic
3. Sources (URL plus one-line relevance note)
4. Confidence grade:
   - High: multiple high-quality sources agree
   - Medium: partial agreement or weaker source mix
   - Low: unresolved conflict or sparse evidence

### 7. Verification Before Done
Before final output:
- Cite every material claim.
- Include concrete dates for time-sensitive facts.
- Ensure conclusions are proportional to evidence strength.
- If evidence is weak or incomplete, say so directly.

### 8. Follow-up path
If coverage is incomplete, propose targeted follow-up queries and what uncertainty each would resolve.

## Completion Criteria
- Final response includes TLDR, findings, sources, and confidence grade.
- Material claims are date-anchored and source-cited.
- Unresolved conflicts/unknowns are explicitly labeled.
- Next-step queries are provided when uncertainty remains.
