# 🎯 PHANTOM INTEGRATION ROADMAP - NOVA DESKTOP BUILD

> **Goal:** Transform Nova into a desktop-first .exe application incorporating Phantom's multi-agent orchestration UI and patterns

**Last Updated:** 2026-09-19
**Status:** Planning Phase
**Target:** Desktop executable (Electron or Tauri)

---

## 📋 TABLE OF CONTENTS

1. [Desktop Build Infrastructure](#1-desktop-build-infrastructure)
2. [Agent Task Management UI](#2-agent-task-management-ui-phantom-style)
3. [Responsive Layout Fixes](#3-responsive-layout-fixes-desktop-first)
4. [Multi-Agent Orchestration](#4-multi-agent-orchestration-enhancements)
5. [Integration Improvements](#5-integration-improvements)
6. [Performance & Optimization](#6-performance--optimization)
7. [Testing & QA](#7-testing--qa)

---

## 🎨 DESIGN VISION

**Aesthetic:** Phantom's "sneaker bot" task management interface
**Format:** Play/pause/delete controls, status indicators, running tasks view
**Location:** Placeholder modules on home screen
**Screen Sizes:** All desktop resolutions (1024px to 4K)

---

## 1. DESKTOP BUILD INFRASTRUCTURE

### 1.1 Technology Decision

**Choose Desktop Framework:**
- [ ] **Option A: Electron** (Recommended - easier Next.js integration)
  - Pros: Next.js works out-of-box, large community, easy packaging
  - Cons: Larger bundle size (~150MB), higher memory usage
  - Stack: electron + electron-builder

- [ ] **Option B: Tauri** (Phantom's choice - smaller bundles)
  - Pros: Smaller bundles (~10MB), Rust backend, better performance
  - Cons: Requires Rust setup, more complex Next.js integration
  - Stack: Tauri v2 + Rust

**Decision:** _____________________ (Fill in after discussion)

### 1.2 Electron Setup (If Chosen)

- [ ] Install dependencies
  ```bash
  cd C:/Nova/hud
  npm install --save-dev electron electron-builder
  npm install --save-dev concurrently wait-on
  ```

- [ ] Create `electron/` directory structure
  ```
  hud/
  ├── electron/
  │   ├── main.js          # Electron main process
  │   ├── preload.js       # Preload scripts for IPC
  │   └── utils.js         # Helper functions
  ├── electron-builder.yml # Build configuration
  └── package.json         # Update with electron scripts
  ```

- [ ] Add Electron main process (`electron/main.js`)
  - Window management (min size 1024x768)
  - Menu bar setup
  - Auto-updater integration
  - Deep link handling (nova://)
  - System tray icon

- [ ] Configure `package.json` scripts
  ```json
  {
    "scripts": {
      "electron:dev": "concurrently \"npm run dev\" \"wait-on http://localhost:3000 && electron .\"",
      "electron:build": "npm run build && electron-builder",
      "electron:build:win": "npm run build && electron-builder --win --x64"
    },
    "main": "electron/main.js"
  }
  ```

- [ ] Create `electron-builder.yml`
  - App name: "Nova"
  - Icon: Use existing Nova icon (convert to .ico)
  - Output: `dist/Nova-Setup-${version}.exe`
  - Auto-update URL configuration
  - Code signing (optional)

### 1.3 Tauri Setup (If Chosen)

- [ ] Initialize Tauri project
  ```bash
  cd C:/Nova/hud
  npm install --save-dev @tauri-apps/cli
  npx tauri init
  ```

- [ ] Configure `tauri.conf.json`
  - Window title: "Nova"
  - Min dimensions: 1024x768
  - Disable file drop (security)
  - Enable devtools in dev mode

- [ ] Set up Rust backend (`src-tauri/src/`)
  - Tauri commands for IPC
  - File system access
  - Process management (for agent CLIs)

- [ ] Update build scripts
  ```json
  {
    "scripts": {
      "tauri:dev": "tauri dev",
      "tauri:build": "tauri build"
    }
  }
  ```

### 1.4 Desktop-Specific Features

- [ ] **System Tray Integration**
  - Minimize to tray option
  - Quick actions menu
  - Show/hide window toggle
  - Quit option

- [ ] **Native Notifications**
  - Replace web notifications with native OS notifications
  - Agent task completion alerts
  - Mission status updates

- [ ] **Auto-Launch on Startup** (Optional)
  - Registry entry for Windows startup
  - User configurable in settings

- [ ] **Deep Linking**
  - Register `nova://` protocol
  - Handle `nova://task/123` URIs
  - Open specific views from external links

- [ ] **File Drag & Drop**
  - Drag files into Nova for context
  - Attach files to agent prompts

---

## 2. AGENT TASK MANAGEMENT UI (PHANTOM-STYLE)

### 2.1 Replace Placeholder Modules

**Location:** `/hud/app/home/components/`

- [ ] **Rename Placeholder 1 → Agent Tasks Module**
  - File: `placeholder-1-home-module.tsx` → `agent-tasks-home-module.tsx`
  - Component: `PlaceholderOneHomeModule` → `AgentTasksHomeModule`

- [ ] **Rename Placeholder 2 → Active Agents Monitor**
  - File: `placeholder-2-home-module.tsx` → `active-agents-home-module.tsx`
  - Component: `PlaceholderTwoHomeModule` → `ActiveAgentsHomeModule`

### 2.2 Agent Tasks Module Design

**Phantom Reference:** `phantom-reference/gui/js/application.js` (task list rendering)

#### UI Components to Build:

- [ ] **Task List Container**
  - Scrollable list of all agent tasks
  - Max height: fit within home panel
  - Grouped by status (Running, Queued, Completed, Failed)

- [ ] **Task Card Component** (`components/agents/task-card.tsx`)
  ```tsx
  interface TaskCardProps {
    task: AgentTask
    onPlay: (taskId: string) => void
    onPause: (taskId: string) => void
    onStop: (taskId: string) => void
    onDelete: (taskId: string) => void
    onViewDetails: (taskId: string) => void
  }
  ```

  **Card Layout:**
  ```
  ┌──────────────────────────────────────────────────┐
  │ [Icon] Task Name               [⏸] [⏹] [🗑️]    │
  │ Agent: Claude Sonnet 4.5       Status: Running  │
  │ Progress: ████████░░░░ 67%     Cost: $0.42     │
  │ Started: 2m ago                Tokens: 15.2K    │
  └──────────────────────────────────────────────────┘
  ```

- [ ] **Control Buttons**
  - ▶️ Play (start/resume task)
  - ⏸️ Pause (pause task)
  - ⏹️ Stop (stop task)
  - 🗑️ Delete (remove task)
  - Style: Phantom's minimal icon-only buttons

- [ ] **Status Indicators**
  - 🟢 Running (green pulse animation)
  - 🟡 Queued (yellow)
  - 🔵 Paused (blue)
  - ✅ Completed (green checkmark)
  - ❌ Failed (red X)
  - Use color-coded badges

- [ ] **Progress Bars**
  - Linear progress bar (0-100%)
  - Animated on active tasks
  - Tailwind CSS animations
  - Shows token usage progress toward context limit

- [ ] **Real-Time Updates**
  - WebSocket connection to backend
  - Live token count updates
  - Cost tracking per task
  - Status changes reflected instantly

### 2.3 Active Agents Monitor

**Phantom Reference:** `phantom-reference/gui/js/command-center.js` (agent statistics)

- [ ] **Active Agents Display**
  - Show all running agent instances
  - Agent avatar/icon
  - Current activity (e.g., "Reading file...", "Writing code...")
  - Time elapsed

- [ ] **Resource Usage**
  - CPU % (if measurable)
  - Memory usage
  - Token rate (tokens/sec)

- [ ] **Quick Stats**
  - Total tasks today
  - Success rate %
  - Total cost (daily/weekly)

### 2.4 Create Task Button

- [ ] **"+" Create Task Button**
  - Fixed position in Agent Tasks Module header
  - Opens modal/drawer for task creation
  - Quick-create workflow

- [ ] **Task Creation Modal**
  - Agent selector (Claude, GPT, Gemini, etc.)
  - Model dropdown (dynamic based on agent)
  - Prompt textarea (multi-line)
  - Context selector (files, folders, URLs)
  - Priority level (Low, Normal, High)
  - Advanced options (temperature, max tokens, etc.)
  - Permission mode selector (from Phantom)

### 2.5 Task Details View

- [ ] **Task Details Page** (`/app/tasks/[id]/page.tsx`)
  - Full task timeline
  - Message history (user ↔ agent)
  - Tool calls executed
  - Files modified (git diff view)
  - Cost breakdown
  - Edit task prompt (if pending/queued)

---

## 3. RESPONSIVE LAYOUT FIXES (DESKTOP-FIRST)

### 3.1 Home Screen Layout Issues

**Current Problem:** Layout is crunched on small screens

**Target Screen Sizes:**
- Minimum: 1024x768 (13" laptop)
- Standard: 1920x1080 (desktop)
- Large: 2560x1440 (QHD monitor)
- Ultra: 3840x2160 (4K monitor)

### 3.2 Grid System Refactor

- [ ] **Update Home Main Screen Grid**
  - File: `/hud/app/home/components/home-main-screen.tsx`
  - Current: Likely `grid-cols-1` or fixed columns
  - New: Responsive grid with breakpoints

  ```tsx
  <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
    {/* Modules */}
  </div>
  ```

- [ ] **Module Sizing**
  - Min width: 320px (prevent crushing)
  - Max width: 600px (prevent stretching on ultrawide)
  - Use `min-w-[320px] max-w-[600px]`

- [ ] **Responsive Font Sizes**
  - Base: `text-sm` (14px)
  - Large screens: `xl:text-base` (16px)
  - Ultra large: `2xl:text-lg` (18px)

### 3.3 Scrollable Containers

- [ ] **Fix Module Overflow**
  - Add `overflow-y-auto` to module content areas
  - Set max-height based on viewport
  - Custom scrollbar styling (thin, minimal)

- [ ] **Prevent Horizontal Scroll**
  - Ensure no element exceeds viewport width
  - Use `overflow-x-hidden` on main container

### 3.4 Sidebar Responsiveness

- [ ] **Sidebar Collapsible on Small Screens**
  - Auto-collapse below 1280px width
  - Hamburger menu toggle
  - Slide-out animation (Framer Motion)

### 3.5 Test on All Screen Sizes

- [ ] 1024x768 (minimum)
- [ ] 1280x720 (720p)
- [ ] 1366x768 (common laptop)
- [ ] 1920x1080 (1080p desktop)
- [ ] 2560x1440 (QHD)
- [ ] 3840x2160 (4K)

---

## 4. MULTI-AGENT ORCHESTRATION ENHANCEMENTS

### 4.1 Concurrent Task Execution

**Phantom Reference:** `phantom-reference/backend/config/agents.toml` (max_parallel = 5)

- [ ] **Task Queue System** (`/lib/agents/task-queue.ts`)
  - Max concurrent tasks: 5 (configurable)
  - Priority queue (high > normal > low)
  - FIFO within same priority
  - Queued task visualization in UI

- [ ] **Task Scheduler** (`/lib/agents/task-scheduler.ts`)
  - Spawn new task when slot available
  - Monitor active tasks
  - Auto-resume paused tasks (if slots free)
  - Rate limiting (requests/min per agent)

### 4.2 Agent Process Management

**Phantom Reference:** `phantom-reference/backend/src/cli.rs` (AgentProcessClient)

- [ ] **Process Spawning** (`/lib/agents/process-manager.ts`)
  - Spawn agent CLI as child process
  - Node.js `child_process` module
  - Capture stdout/stderr
  - Handle process crashes (auto-restart?)

- [ ] **Protocol Handling**
  - Claude Code: `--output-format stream-json`
  - OpenAI: API calls (no CLI)
  - Support for future agents (Codex, Amp, etc.)

- [ ] **Message Streaming**
  - Parse NDJSON stdout from agents
  - Emit events to frontend via Server-Sent Events (SSE)
  - Handle tool calls (approve/deny)

### 4.3 Git Worktree Integration

**Phantom Reference:** `phantom-reference/src-tauri/src/worktree.rs`

- [ ] **Worktree Manager** (`/lib/git/worktree-manager.ts`)
  - Create worktree per task: `.worktrees/<task-id>/`
  - Auto-generate branch name: `feat/add-auth-system`
  - Sanitize branch names (kebab-case, git-safe)
  - Delete worktree on task completion

- [ ] **Branch Naming**
  - Use AI to generate branch name from prompt
  - Fallback: `task-<timestamp>`
  - Prefix: `feat/`, `fix/`, `chore/`, etc.

- [ ] **Worktree Cleanup**
  - Delete worktree after task archived
  - Option to keep worktree (user choice)
  - Warn if uncommitted changes

### 4.4 Shared Context Between Tasks

**Phantom Reference:** `phantom-reference/docs/README.md` (Shared Context section)

- [ ] **Context Groups** (Database schema)
  ```sql
  CREATE TABLE task_contexts (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE task_context_assignments (
    task_id UUID REFERENCES tasks(id),
    context_id UUID REFERENCES task_contexts(id),
    assigned_at TIMESTAMP DEFAULT NOW()
  );
  ```

- [ ] **Context UI**
  - Dropdown to assign task to context
  - Bookmark icon (🔖) to show context status
  - Context sidebar showing all related tasks

- [ ] **Prompt Injection**
  - When creating task in context, fetch sibling tasks
  - Generate summary of each sibling
  - Prepend to user prompt:
    ```
    Context: Related tasks in "auth-feature":
    - [Claude Sonnet] "Add login form" → Completed, added LoginForm.tsx
    - [GPT-5.2] "Create auth middleware" → In progress, adding JWT validation

    Your task: Add logout button to navbar
    ```

### 4.5 Permission Modes

**Phantom Reference:** `phantom-reference/gui/js/application.js` (permission mode selector)

- [ ] **Permission Mode Setting** (per task)
  - **Default**: Prompt for dangerous operations
  - **Accept Edits**: Auto-approve file changes
  - **Plan Mode**: Dry-run only (no execution)
  - **Don't Ask**: Deny if not pre-approved
  - **Bypass**: Allow all (dangerous)

- [ ] **UI Selector**
  - Dropdown in task creation modal
  - Badge showing current mode on task card
  - Warning if "Bypass" selected

---

## 5. INTEGRATION IMPROVEMENTS

### 5.1 Discord Integration (Already Exists)

**Current:** `/lib/notifications/discord.ts`

- [ ] **Review existing implementation**
  - Check webhook URLs configuration
  - Test message sending
  - Verify error handling

- [ ] **Add Task-Specific Notifications**
  - Send message when task starts
  - Send message when task completes
  - Include cost + token count in embed
  - Link to task details page

- [ ] **Thread Creation** (Optional - Phantom feature)
  - Create Discord thread per task
  - Post agent messages to thread
  - Allow user to reply in thread → send to agent

### 5.2 Command Center Analytics (Already Exists)

**Current:** Unknown location - need to verify

- [ ] **Locate existing analytics code**
- [ ] **Add Phantom-style metrics**
  - Token usage by model (pie chart)
  - Cost breakdown (daily/weekly)
  - Agent comparison (Claude vs GPT)
  - Cache hit rate
  - Task success rate

### 5.3 Auth System Review

**Current:** Integration configs in `/lib/integrations/store/server-store.ts`

- [ ] **Document auth flow**
  - How are API keys stored?
  - Where is encryption handled?
  - How are keys injected into agent processes?

- [ ] **OAuth Support** (from Phantom)
  - Phantom has OAuth for Claude Code + ChatGPT
  - Consider adding OAuth to Nova (future)
  - Store refresh tokens securely

### 5.4 Pricing Data for Cost Tracking

**Phantom Reference:** `phantom-reference/src-tauri/src/main.rs` (MODEL_PRICING const)

- [ ] **Create Pricing Table** (`/lib/agents/model-pricing.ts`)
  ```typescript
  export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
    'claude-opus-4-5-20251101': { input: 15.00, output: 75.00 },
    'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
    'gpt-5.2': { input: 10.00, output: 30.00 },
    'gpt-5.1': { input: 5.00, output: 15.00 },
    'gemini-2.5-pro': { input: 1.25, output: 5.00 },
    // ... 40+ models
  }

  export function calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const pricing = MODEL_PRICING[model] || { input: 0, output: 0 }
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
  }
  ```

- [ ] **Display Cost in UI**
  - Task card: "$0.42"
  - Task details: Breakdown by message
  - Analytics: Total daily/weekly cost

---

## 6. PERFORMANCE & OPTIMIZATION

### 6.1 Database Indexing

- [ ] **Add indexes for task queries**
  ```sql
  CREATE INDEX idx_tasks_status ON tasks(status);
  CREATE INDEX idx_tasks_user_id ON tasks(user_id);
  CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);
  ```

### 6.2 Real-Time Updates Optimization

- [ ] **Use SSE instead of polling**
  - Create `/api/tasks/stream` endpoint
  - Emit events on task status changes
  - Frontend subscribes via EventSource

- [ ] **Debounce token count updates**
  - Only update UI every 500ms
  - Prevent excessive re-renders

### 6.3 Lazy Loading

- [ ] **Lazy load task history**
  - Only load last 20 tasks on home screen
  - "Load more" button
  - Infinite scroll (optional)

### 6.4 Caching

- [ ] **Cache agent model lists**
  - Store in localStorage
  - Refresh every 24 hours
  - Reduces API calls to Claude/OpenAI

---

## 7. TESTING & QA

### 7.1 Desktop Build Testing

- [ ] Test .exe on Windows 10
- [ ] Test .exe on Windows 11
- [ ] Verify auto-update mechanism
- [ ] Test system tray functionality
- [ ] Test deep linking (nova://)

### 7.2 UI Testing

- [ ] Test responsive layout on all screen sizes
- [ ] Test dark/light theme compatibility
- [ ] Test task card interactions (play/pause/delete)
- [ ] Test task creation modal
- [ ] Test task details page

### 7.3 Agent Orchestration Testing

- [ ] Test concurrent task execution (5 tasks)
- [ ] Test task queuing (6+ tasks)
- [ ] Test git worktree creation/deletion
- [ ] Test shared context injection
- [ ] Test permission modes

### 7.4 Integration Testing

- [ ] Test Discord notifications
- [ ] Test analytics dashboard
- [ ] Test cost calculation accuracy
- [ ] Test API key encryption/decryption

### 7.5 Performance Testing

- [ ] Test with 100+ completed tasks
- [ ] Test real-time updates with 5 active tasks
- [ ] Measure memory usage (Electron)
- [ ] Check for memory leaks

---

## 📅 ESTIMATED TIMELINE

**Assuming 1 developer, full-time:**

| Phase | Duration | Tasks |
|-------|----------|-------|
| **Phase 1: Desktop Build Setup** | 1 week | Electron/Tauri setup, packaging, testing |
| **Phase 2: Agent Tasks UI** | 2 weeks | Task cards, controls, status indicators, real-time updates |
| **Phase 3: Layout Fixes** | 3 days | Responsive grid, scrolling, font sizes |
| **Phase 4: Multi-Agent Orchestration** | 2 weeks | Task queue, process manager, worktrees, shared context |
| **Phase 5: Integration Improvements** | 1 week | Discord, analytics, pricing, auth review |
| **Phase 6: Testing & QA** | 1 week | All tests, bug fixes, polish |

**Total: ~7 weeks** (or incremental over 2-3 months)

---

## 🎯 PRIORITY TIERS

### 🔥 P0 - Critical (Must Have)
- Desktop build (Electron/Tauri)
- Agent Tasks Module (replace Placeholder 1)
- Responsive layout fixes
- Basic task controls (play/pause/stop/delete)

### ⚡ P1 - High Priority
- Concurrent task execution
- Git worktree integration
- Real-time cost tracking
- Task creation modal

### 💡 P2 - Medium Priority
- Shared context between tasks
- Active Agents Monitor (replace Placeholder 2)
- Permission modes
- Discord task notifications

### 🌟 P3 - Nice to Have
- System tray integration
- Auto-launch on startup
- Task details page enhancements
- Advanced analytics

---

## 📝 NEXT STEPS

1. **Choose desktop framework** (Electron vs Tauri)
2. **Set up basic desktop build**
3. **Create mockup of Agent Tasks Module** (Figma/sketch)
4. **Start with P0 tasks**
5. **Iterate weekly with user feedback**

---

## 🔗 REFERENCE LINKS

- **Phantom Repo:** `C:/Nova/phantom-reference/`
- **Phantom README:** `C:/Nova/phantom-reference/README.md`
- **Phantom UI (main):** `C:/Nova/phantom-reference/gui/menu.html`
- **Phantom Task List JS:** `C:/Nova/phantom-reference/gui/js/application.js`
- **Phantom Worktree Logic:** `C:/Nova/phantom-reference/src-tauri/src/worktree.rs`
- **Phantom Agent Registry:** `C:/Nova/phantom-reference/backend/config/agents.toml`

---

## ✅ COMPLETION CHECKLIST

Use this checklist to track overall progress:

- [ ] Desktop build working (.exe launches)
- [ ] Agent Tasks Module complete
- [ ] Layout responsive on all screen sizes
- [ ] Multi-agent orchestration functional
- [ ] Cost tracking accurate
- [ ] All integrations tested
- [ ] Performance optimized
- [ ] QA completed
- [ ] Documentation updated
- [ ] Ready for beta release

---

**Document Owner:** Development Team
**Last Updated:** 2026-09-19
**Version:** 1.0 - Initial Draft
