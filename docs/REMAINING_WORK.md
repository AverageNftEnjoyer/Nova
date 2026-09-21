# 🎯 Remaining Work - NovaAIO Desktop

**Last Updated:** 2026-09-21  
**Overall Progress:** 85% Complete  
**Status:** 6 items remaining

---

## 🔥 P0 - Critical (Must Have)

### None - All P0 items complete! ✅
- ✅ Desktop build (Electron)
- ✅ Agent Tasks Module
- ✅ Responsive layout
- ✅ Task controls (play/pause/stop/delete)

---

## ⚡ P1 - High Priority (3 items)

### 1. Git Worktree Integration
**Status:** Not started  
**Effort:** 1-2 weeks  
**Location:** Create `hud/lib/git/worktree-manager.ts`

**What's Needed:**
- Create worktree per task: `.worktrees/<task-id>/`
- Auto-generate branch name from AI (e.g., `feat/add-auth-system`)
- Delete worktree on task completion/archive
- Warn if uncommitted changes

**Implementation:**
```typescript
// hud/lib/git/worktree-manager.ts
export async function createWorktree(taskId: string, branchName: string): Promise<string>
export async function deleteWorktree(taskId: string): Promise<void>
export async function getWorktreePath(taskId: string): Promise<string | null>
```

**References:**
- Phantom: `phantom-reference/src-tauri/src/worktree.rs`
- Git worktree docs: https://git-scm.com/docs/git-worktree

---

### 2. Native OS Notifications
**Status:** Not started  
**Effort:** 2-3 days  
**Location:** Update `hud/electron/main.js`

**What's Needed:**
- Replace web notifications with Electron `Notification` API
- Task completion alerts
- Mission status updates
- Error notifications

**Implementation:**
```javascript
// electron/main.js
const { Notification } = require('electron')

function showNotification(title, body) {
  new Notification({ title, body }).show()
}

ipcMain.handle('show-notification', async (event, { title, body }) => {
  showNotification(title, body)
  return { success: true }
})
```

**Test:** Task completes → native Windows notification appears

---

### 3. Analytics Dashboard Page
**Status:** Partial (stats computed, no UI)  
**Effort:** 1 week  
**Location:** Create `hud/app/analytics/page.tsx`

**What's Needed:**
- New route: `/analytics`
- Token usage by model (pie chart)
- Cost breakdown (daily/weekly/monthly)
- Agent comparison (Claude vs GPT vs Gemini)
- Task success rate over time
- Cache hit rate (if applicable)

**Data Sources:**
- `hud/lib/agents/task-store.ts` (tokens, cost per task)
- `hud/app/integrations/constants/pricing.ts` (model pricing)
- SQLite `agent_tasks` table (aggregations)

**UI Components:**
- Recharts library (already in dependencies)
- Date range picker
- Model filter dropdown
- Export to CSV button

---

## 💡 P2 - Medium Priority (2 items)

### 4. Shared Context Between Tasks
**Status:** Not started  
**Effort:** 1-2 weeks  
**Location:** Extend `hud/lib/agents/task-store.ts`

**What's Needed:**
- Database schema for task contexts
- UI to assign tasks to context groups
- Prompt injection: summarize sibling tasks when creating new task in same context
- Context sidebar showing related tasks

**Database Migration:**
```sql
-- Add to next migration
CREATE TABLE task_contexts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE task_context_assignments (
  task_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (context_id) REFERENCES task_contexts(id) ON DELETE CASCADE
);
```

**UI Changes:**
- Add "Context" dropdown to task creation modal
- Show 🔖 bookmark icon on task cards in a context
- Context filter in task list

---

### 5. File Drag & Drop
**Status:** Not started  
**Effort:** 3-5 days  
**Location:** `hud/electron/main.js` + `hud/app/home/components/`

**What's Needed:**
- Drag files into Nova window
- Attach files to agent prompts as context
- File list UI in task creation modal
- Pass file paths to agent CLI

**Implementation:**
```javascript
// electron/main.js
mainWindow.webContents.on('will-navigate', (event, url) => {
  if (url.startsWith('file://')) {
    event.preventDefault()
    // Handle dropped file
    mainWindow.webContents.send('file-dropped', { filePath: url })
  }
})
```

**UI:**
- Dropzone component in task creation modal
- List of attached files
- Remove file button

---

## 🌟 P3 - Nice to Have (1 item)

### 6. Auto-Launch on System Startup
**Status:** Not started  
**Effort:** 1 day  
**Location:** `hud/electron/main.js` + Settings UI

**What's Needed:**
- Set Windows registry entry for startup
- Toggle in Settings panel
- Store preference in localStorage

**Implementation:**
```javascript
// electron/main.js
const { app } = require('electron')

function setAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false
  })
}

ipcMain.handle('set-auto-launch', async (event, enabled) => {
  setAutoLaunch(enabled)
  return { success: true }
})
```

**Settings UI:**
- Add checkbox: "Launch Nova on system startup"
- Save to `localStorage.nova_auto_launch`

---

## 📅 Estimated Timeline

**If starting now, 1 developer:**

| Priority | Items | Effort | Total |
|----------|-------|--------|-------|
| P1 (High) | 3 | 1w + 3d + 1w | ~3 weeks |
| P2 (Medium) | 2 | 1.5w + 4d | ~2.5 weeks |
| P3 (Nice to have) | 1 | 1d | ~1 day |
| **Total** | **6 items** | | **~6 weeks** |

**Incremental approach:** 1-2 items per week over 2 months

---

## 🎯 Recommended Order

1. **Native OS Notifications** (3 days) - Quick win, high user value
2. **Analytics Dashboard** (1 week) - Visualize existing data
3. **Git Worktree Integration** (2 weeks) - Biggest feature, P1
4. **Auto-Launch** (1 day) - Easy polish
5. **File Drag & Drop** (4 days) - UX enhancement
6. **Shared Context** (2 weeks) - Advanced feature, can wait

---

## ✅ What's Already Complete (Don't Re-Do)

- ✅ Electron setup, packaging, .exe builds
- ✅ System tray (minimize, show, quit)
- ✅ Deep linking (nova:// protocol)
- ✅ Agent Tasks home module UI
- ✅ Task creation modal (agent/model/prompt/priority/permission)
- ✅ Task cards with play/pause/stop/delete controls
- ✅ Status indicators, progress bars, real-time updates
- ✅ Task queue with max 5 concurrent (SQLite-backed)
- ✅ Permission modes (default/accept-edits/plan-mode/don't-ask/bypass)
- ✅ Discord integration (webhooks, task notifications)
- ✅ Model pricing data (Claude/OpenAI/Gemini/Grok)
- ✅ Cost tracking per task (tokens + USD)
- ✅ SQLite indexes (agent_tasks status, created_at)
- ✅ SSE streaming endpoint (/api/agent-tasks/stream)
- ✅ Responsive layout (1024px to 4K)
- ✅ Task details page (/agents)

---

**Next Step:** Pick an item from P1 and start implementing!

**Document Owner:** Development Team  
**Last Audited:** 2026-09-21 (Agent scan vs codebase)  
**Source:** Condensed from 696-line PHANTOM_INTEGRATION_ROADMAP.md
