# Git Worktree Integration - Testing Guide

## Overview

Git worktree integration enables isolated working directories for each agent task, allowing multiple agents to work simultaneously without conflicts.

## What Was Implemented

### Core Components

1. **Worktree Manager** (`hud/lib/git/worktree-manager.ts`)
   - `createWorktree(taskId, branchName)` - Creates isolated git worktree
   - `deleteWorktree(taskId)` - Cleans up worktree after task completion
   - `generateBranchName(prompt, taskId)` - AI-powered semantic branch naming
   - `getWorktreePath(taskId)` - Get path to existing worktree
   - `checkUncommittedChanges(worktreePath)` - Safety check before deletion
   - `listWorktrees()` - List all active worktrees
   - `pruneWorktrees()` - Clean up stale worktree metadata

2. **Database Schema** (Migration `0008-agent-task-worktree.js`)
   - Added `worktree_path` column to `agent_tasks` table
   - Added `branch_name` column to `agent_tasks` table

3. **Type Definitions** (`hud/lib/agents/types.ts`)
   - `AgentTask.worktreePath?: string`
   - `AgentTask.branchName?: string`
   - `CreateAgentTaskInput.useWorktree?: boolean`

4. **Task Store Integration** (`hud/lib/agents/task-store.ts`)
   - Automatic worktree creation when `useWorktree: true`
   - Automatic worktree cleanup on task deletion
   - Persists worktree path and branch name in database

5. **UI Components**
   - **Create Task Modal**: Checkbox to enable worktree isolation
   - **Task Card**: Displays branch name with git icon when worktree is active

### Branch Naming Strategy

The system generates semantic branch names based on prompt analysis:

- `feat/*` - For "add", "create", "build", "implement" prompts
- `fix/*` - For "fix", "repair", "resolve", "correct" prompts
- `refactor/*` - For "refactor", "clean", "reorganize" prompts
- `chore/*` - For "update", "modify", "change", "improve" prompts
- `test/*` - For "test", "verify" prompts
- `docs/*` - For "document", "doc", "write" prompts
- `task-<id>` - Fallback for unrecognized patterns

Examples:
- "add login system" → `feat/add-login-system`
- "fix auth bug in header" → `fix/auth-bug-header`
- "refactor database layer" → `refactor/database-layer`

## Testing

### 1. Smoke Tests

Run the worktree smoke tests:

```bash
npm run smoke:worktree
```

Expected output: `8/8 tests passed`

### 2. Manual UI Testing

1. **Start the development server**
   ```bash
   cd hud
   npm run dev
   ```

2. **Create a task with worktree enabled**
   - Open the Create Task modal
   - Enter a prompt (e.g., "add user authentication")
   - Check the "Use isolated git worktree" checkbox
   - Click "Create task"

3. **Verify worktree creation**
   ```bash
   # Check that worktree directory exists
   ls .worktrees/

   # List git worktrees
   git worktree list
   ```

4. **Verify task card display**
   - Task card should show the branch name with a git icon
   - Example: `claude · sonnet-4 · feat/add-user-authentication`

5. **Test task deletion**
   - Delete the task
   - Verify worktree is removed:
     ```bash
     git worktree list
     ls .worktrees/
     ```

### 3. Database Testing

Verify database schema:

```bash
node --experimental-strip-types -e "
import { getDb } from './src/db/index.js';
const db = getDb();
const info = db.pragma('table_info(agent_tasks)');
console.log(info.filter(c => c.name.includes('worktree') || c.name.includes('branch')));
"
```

Expected output: Two columns (`worktree_path`, `branch_name`)

### 4. Parallel Task Testing

1. Create multiple tasks with worktree enabled
2. Each should get its own isolated directory in `.worktrees/`
3. Each should have a unique branch name
4. Tasks can run simultaneously without git conflicts

## File Locations

### Modified Files
- `hud/lib/agents/types.ts` - Type definitions
- `hud/lib/agents/task-store.ts` - Database operations
- `hud/components/agents/create-task-modal.tsx` - UI for enabling worktrees
- `hud/components/agents/task-card.tsx` - Display branch name
- `.gitignore` - Added `.worktrees/`
- `src/db/migrations/index.js` - Added migration import

### New Files
- `hud/lib/git/worktree-manager.ts` - Core worktree management
- `src/db/migrations/0008-agent-task-worktree.js` - Database migration
- `scripts/smoke/worktree/worktree-smoke.mjs` - Smoke tests
- `WORKTREE_TESTING.md` - This file

## Known Limitations

1. **Phase 4 Dependency**: Real agent execution (Phase 4) needed for full end-to-end testing
2. **Branch Naming**: Currently uses heuristics; will be enhanced with LLM in Phase 4
3. **Worktree Cleanup**: Force deletes on task deletion (safe for simulation, review for production)

## Safety Features

- **Uncommitted Changes Detection**: Warns before deleting worktree with uncommitted changes
- **Force Delete on Task Deletion**: Prevents orphaned worktrees when tasks are removed
- **Error Handling**: Worktree creation failures don't prevent task creation
- **Automatic Cleanup**: Worktrees removed automatically when task is deleted

## Next Steps

When real agent execution is implemented (Phase 4):

1. Update task runner to change working directory to worktree path
2. Add environment variable to agent process: `NOVA_WORKTREE_PATH`
3. Implement worktree merge strategy after task completion
4. Add UI for reviewing/merging worktree changes
5. Consider adding worktree status indicators (ahead/behind main branch)
6. Enhance branch naming with actual LLM call for semantic names

## Troubleshooting

### Worktree already exists
If you see "Worktree path already exists":
```bash
# Remove stale worktree manually
git worktree remove .worktrees/<task-id>
# Or force remove
git worktree remove --force .worktrees/<task-id>
```

### Stale worktree metadata
If git shows worktrees that don't exist:
```bash
git worktree prune
```

### Branch name conflicts
The system checks if a branch exists before creating. If it does, it reuses the branch instead of creating a new one.
