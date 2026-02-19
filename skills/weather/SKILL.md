---
name: weather
description: Weather and forecast workflow for quick current-condition answers and short planning guidance.
metadata: { "read_when": ["User asks for weather, temperature, rain, forecast, or travel weather checks."], "openclaw": { "requires": { "bins": ["curl"] } } }
---

# Weather Skill

## Activation
- Use this skill when the request is about current weather, near-term forecast, temperature, rain chance, or wind for a location.
- Ask for location if it is missing.

## Workflow
### 1. Scope
- Extract location, date horizon, and desired level of detail.

### 2. Execute
- Prefer runtime tools (`web_search`, `web_fetch`) for city + forecast context.
- If shell execution is available, use `curl wttr.in/<location>?format=3` for quick status.
- Keep response concise first, then add details only if asked.

### 3. Verification Before Done
- Confirm location explicitly in the response.
- Include concrete day labels (for example "Friday") for forecast rows.
- Flag uncertainty if the source lacks a clear timestamp.

## Completion Criteria
- Response includes location, current summary, and relevant forecast window.
- Ambiguous location or weak freshness is clearly called out.
