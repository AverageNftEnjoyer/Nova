---
name: session-logs
description: Session history analysis workflow for recovering prior context and decisions from transcript logs.
user-invokable: false
metadata: { "read_when": ["User asks what happened in earlier chats, prior sessions, or previous decisions."], "novaos": { "requires": { "anyBins": ["jq", "rg"] } } }
---

# Session Logs Skill

## Activation
- Use this skill when a request references earlier conversations or missing historical context.
- Use it for timeline reconstruction, not for live message handling.

## Workflow
### 1. Scope
- Determine what period or topic must be recovered from logs.

### 2. Execute
- Locate session transcript files and extract relevant user/assistant text with `jq` when available.
- If `jq` is unavailable, use `rg`-based filtering directly on transcript JSONL lines.
- Filter by keywords or dates with `rg` for fast narrowing.
- Summarize only relevant turns, decisions, and unresolved actions.

### 3. Verification Before Done
- Include exact session IDs or timestamps used.
- Separate quoted transcript facts from your interpretation.
- If matching evidence is sparse, state that explicitly.

## Completion Criteria
- Response provides a reliable summary of prior context with traceable references.
- Open questions are listed when logs do not fully answer the request.
