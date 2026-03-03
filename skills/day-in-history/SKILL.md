---
name: day-in-history
description: Shows notable historical events that happened on today's date
metadata:
  read_when:
    - today in history
    - this day in history
    - what happened today in history
    - on this day
    - historical events today
---

# Day in History

## Activation
- User asks about what happened on this day in history
- User requests "today in history" or "on this day" facts

## Workflow
### 1. Detect
Trigger on requests about historical events for today's date.

### 2. Fetch
Call the Day in History API to retrieve notable events.

### 3. Present
Format events chronologically with year and description.

## Completion Criteria
- Events displayed with year and short description
- Source: API Ninjas Day in History
