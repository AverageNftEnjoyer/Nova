---
name: weather
description: Weather and forecast workflow for quick current-condition answers and short planning guidance.
user-invokable: false
metadata: { "read_when": ["User asks for weather, temperature, rain, forecast, or travel weather checks."], "novaos": { "requires": { "bins": ["curl"] } } }
---

# Weather Skill

## Activation
- Use this skill when the request is about current weather, near-term forecast, temperature, rain chance, or wind for a location.
- Ask for location if it is missing.

## Workflow
### 1. Scope
- Extract location, date horizon, and desired level of detail.

### 2. Execute
- Use a strict fallback chain:
  - `wttr.in` quick status for immediate current conditions.
  - Open-Meteo geocoding + forecast for accurate day-specific and weekly answers.
  - `web_search` snippets only as final fallback when direct weather endpoints fail.
- Retry transient network failures once before failing over.
- Keep response concise first, then add details only if asked.

### 3. Verification Before Done
- Confirm location explicitly in the response.
- Include concrete day labels (for example "Friday") for forecast rows.
- Flag uncertainty if the source lacks a clear timestamp.
- Include freshness + confidence in every answer.
- Never expose raw internal fetch/tool errors to the user.

## Completion Criteria
- Response includes location, current summary, and relevant forecast window.
- Ambiguous location or weak freshness is clearly called out.
- For next-week requests, provide a 7-day city forecast with day labels.
