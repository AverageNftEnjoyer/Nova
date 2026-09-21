# Task Context Groups - Implementation Summary

## Overview

Task context groups allow related agent tasks to share context. When creating a new task within a context group, the task automatically receives a summary of all sibling tasks, enabling better coordination and context-aware execution.

## Database Schema

### Migration: `0007-task-contexts.js`

Created two new tables:

**`task_contexts`**
- `user_id` (TEXT, NOT NULL)
- `id` (TEXT, NOT NULL) - UUID
- `name` (TEXT, NOT NULL) - User-defined context name
- `created_at` (TEXT, NOT NULL) - ISO timestamp
- Primary Key: `(user_id, id)`
- Index: `idx_task_contexts_name` on `(user_id, name)`

**`task_context_assignments`**
- `user_id` (TEXT, NOT NULL)
- `task_id` (TEXT, NOT NULL) - References `agent_tasks.id`
- `context_id` (TEXT, NOT NULL) - References `task_contexts.id`
- `assigned_at` (TEXT, NOT NULL) - ISO timestamp
- Primary Key: `(user_id, task_id)`
- Index: `idx_assignments_context` on `(user_id, context_id)`
- Foreign Keys: CASCADE on delete

## Core Library

### `hud/lib/agents/context-manager.ts`

Main functions:
- `createContext(userId, name)` - Create new context group
- `listContexts(userId)` - List all user's contexts
- `getContext(userId, contextId)` - Get specific context
- `assignTaskToContext(userId, taskId, contextId)` - Assign task to context
- `getContextTaskIds(userId, contextId)` - Get all tasks in context
- `getTaskContextId(userId, taskId)` - Get task's context ID
- `removeTaskFromContext(userId, taskId)` - Remove task from context
- `deleteContext(userId, contextId)` - Delete context group
- `generateContextSummary(userId, contextId, tasks)` - Generate prompt summary

Validation:
- Max 100 contexts per user
- Max 60 chars for context name
- Unique context names per user
- Foreign key constraints enforced

## API Routes

### `GET /api/task-contexts`
Returns all contexts for the current user.

Response:
```json
{
  "ok": true,
  "contexts": [
    { "id": "uuid", "name": "auth-feature", "createdAt": "2026-09-21T..." }
  ]
}
```

### `POST /api/task-contexts`
Create a new context group.

Request:
```json
{ "name": "auth-feature" }
```

Response:
```json
{
  "ok": true,
  "context": { "id": "uuid", "name": "auth-feature", "createdAt": "2026-09-21T..." }
}
```

### `GET /api/task-contexts/[id]`
Get context details and all tasks in that context.

Response:
```json
{
  "ok": true,
  "context": { "id": "uuid", "name": "auth-feature", ... },
  "tasks": [
    { "id": "...", "name": "Add login form", "status": "completed", ... }
  ]
}
```

### `POST /api/task-contexts/assign`
Assign a task to a context.

Request:
```json
{ "taskId": "uuid", "contextId": "uuid" }
```

### `DELETE /api/task-contexts/assign`
Remove a task from its context.

Request:
```json
{ "taskId": "uuid" }
```

### `DELETE /api/task-contexts`
Delete a context group (removes all assignments).

Request:
```json
{ "id": "uuid" }
```

## UI Changes

### Task Creation Modal (`create-task-modal.tsx`)

Added context selection:
- Dropdown showing existing contexts + "None"
- "+ New" button to create context inline
- Input field for new context name
- Helper text: "Group related tasks to share context"

Flow:
1. User selects existing context OR clicks "+ New"
2. If new context: inline input field appears
3. On submit:
   - Create new context if needed
   - Fetch all tasks in selected context
   - Generate summary of sibling tasks
   - Prepend summary to user prompt
   - Create task with contextId

### Task Card (`task-card.tsx`)

Visual indicator:
- 🔖 Bookmark icon (filled, amber color) appears next to agent/model info
- Only shown when task has a contextId
- Tooltip: "In a context group"

### Updated Types (`types.ts`)

Added to `AgentTask`:
```typescript
contextId?: string
```

Added to `CreateAgentTaskInput`:
```typescript
contextId?: string
```

## Task Store Integration

### `task-store.ts` Changes

**Loading tasks:**
- Modified `loadTasks()` to LEFT JOIN with `task_context_assignments`
- Populates `task.contextId` from join result

**Creating tasks:**
- After task creation, if `input.contextId` provided:
  - Insert into `task_context_assignments`
  - Set `task.contextId` for return value

## Context Summary Format

When a task is created in a context with existing tasks, the prompt is prepended with:

```
Context: Related tasks in "auth-feature":
- [claude sonnet-4.5] "Add login form" → Completed (100% done)
- [openai gpt-5] "JWT middleware" → Running (45% done)
- [claude sonnet-4.5] "Password reset flow" → Failed: Invalid API key

Your task: <original user prompt>
```

Format:
- Each task: `[agent model] "name" → outcome`
- Outcome: status + progress OR error message (truncated to 100 chars)
- Summary injected before user prompt with clear delimiter

## Usage Example

1. **Create context:**
   ```
   POST /api/task-contexts
   { "name": "auth-feature" }
   → contextId = "abc123"
   ```

2. **Create first task:**
   ```
   POST /api/agent-tasks
   {
     "prompt": "Add login form component",
     "agent": "claude",
     "model": "sonnet-4.5",
     "contextId": "abc123"
   }
   ```

3. **Create second task (gets context):**
   ```
   POST /api/agent-tasks
   {
     "prompt": "Add JWT validation middleware",
     "agent": "openai",
     "model": "gpt-5",
     "contextId": "abc123"
   }
   ```
   
   Actual prompt sent to agent:
   ```
   Context: Related tasks in "auth-feature":
   - [claude sonnet-4.5] "Add login form component" → Completed (100% done)
   
   Your task: Add JWT validation middleware
   ```

4. **UI shows:**
   - Both tasks display 🔖 bookmark icon
   - Context dropdown shows "auth-feature"

## Testing Checklist

- [x] Migration file syntax valid
- [x] Context manager module loads
- [x] TypeScript compilation (no new errors)
- [x] Database schema created correctly
- [x] API routes handle errors properly
- [x] UI components compile
- [ ] Create context via UI
- [ ] Create task in context via UI
- [ ] Verify second task receives context summary
- [ ] Check bookmark icon appears on task cards
- [ ] Delete context removes assignments
- [ ] Task deletion removes from context

## Implementation Status

**Completed:**
- ✅ Database migration (v7)
- ✅ Context manager library
- ✅ API routes (list, create, get, assign, delete)
- ✅ Type definitions
- ✅ Task store integration
- ✅ UI: Context selector in create modal
- ✅ UI: Bookmark icon in task cards
- ✅ Prompt injection with context summary

**Left unstaged for user review:**
- All changes remain unstaged as per CLAUDE.md policy
- Ready for user testing and commit

## Files Modified

**New files:**
- `src/db/migrations/0007-task-contexts.js`
- `hud/lib/agents/context-manager.ts`
- `hud/app/api/task-contexts/route.ts`
- `hud/app/api/task-contexts/[id]/route.ts`
- `hud/app/api/task-contexts/assign/route.ts`
- `docs/features/task-contexts.md` (this file)

**Modified files:**
- `src/db/migrations/index.js` (added migration import)
- `hud/lib/agents/types.ts` (added contextId fields)
- `hud/lib/agents/task-store.ts` (context loading & assignment)
- `hud/components/agents/create-task-modal.tsx` (context UI)
- `hud/components/agents/task-card.tsx` (bookmark icon)

## Notes

- Migration version 7 (follows after v6: agent-task-files)
- User v8 (agent-task-worktree) was added concurrently - migrations index updated to include both
- Context assignments cascade delete with tasks
- Context summary generated client-side before task creation
- No AI summarization yet - uses simple status formatting
- Future enhancement: LLM-generated summaries of task outcomes
