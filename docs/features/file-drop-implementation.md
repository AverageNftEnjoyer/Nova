# File Drag-and-Drop Implementation

## Overview

Added file drag-and-drop functionality to attach files as context when creating agent tasks. Users can drag files from Windows Explorer into the task creation modal, and the file paths are stored with the task for the agent to read.

## Changes Made

### 1. Type Definitions (`hud/lib/agents/types.ts`)

**Added `attachedFiles` field to interfaces:**

```typescript
export interface AgentTask {
  // ... existing fields
  attachedFiles?: string[]
  // ... rest of fields
}

export interface CreateAgentTaskInput {
  // ... existing fields
  attachedFiles?: string[]
}
```

### 2. Database Migration (`src/db/migrations/0006-agent-task-files.js`)

**New migration to add `attached_files` column:**

```javascript
export const migration = {
  version: 6,
  name: "agent-task-files",
  sql: `
ALTER TABLE agent_tasks ADD COLUMN attached_files TEXT;
`,
};
```

**Updated migrations index** (`src/db/migrations/index.js`) to include the new migration.

### 3. Task Store (`hud/lib/agents/task-store.ts`)

**Updated database operations:**

1. **AgentTaskRow interface:** Added `attached_files: string | null`

2. **rowToTask function:** Parse JSON-stored file paths
   ```typescript
   if (typeof row.attached_files === "string" && row.attached_files) {
     try {
       const parsed = JSON.parse(row.attached_files)
       if (Array.isArray(parsed) && parsed.length > 0) task.attachedFiles = parsed
     } catch {
       // Ignore malformed JSON
     }
   }
   ```

3. **upsertTask function:** Store files as JSON
   ```typescript
   task.attachedFiles ? JSON.stringify(task.attachedFiles) : null
   ```

4. **validateCreateInput function:** Validate and limit files
   ```typescript
   if (Array.isArray(input?.attachedFiles) && input.attachedFiles.length > 0) {
     result.attachedFiles = input.attachedFiles
       .filter((f) => typeof f === "string" && f.trim())
       .slice(0, 20) // Max 20 files
   }
   ```

### 4. Electron Main Process (`hud/electron/main.js`)

**Added file drop handler:**

```javascript
// Handle file drops - prevent navigation to file:// URLs
mainWindow.webContents.on('will-navigate', (event, url) => {
  if (url.startsWith('file://')) {
    event.preventDefault()
    const filePath = decodeURIComponent(url.replace('file:///', ''))
    mainWindow.webContents.send('file-dropped', { filePath })
  }
})

// Prevent opening new windows from file drops
mainWindow.webContents.setWindowOpenHandler(() => {
  return { action: 'deny' }
})
```

### 5. Electron Preload (`hud/electron/preload.js`)

**Exposed file drop event listener:**

```javascript
onFileDrop: (callback) => {
  ipcRenderer.on('file-dropped', (event, data) => callback(data))
}
```

### 6. Task Creation Modal (`hud/components/agents/create-task-modal.tsx`)

**Major UI updates:**

1. **New imports:**
   ```typescript
   import { File, Loader2, ShieldAlert, X } from "lucide-react"
   import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
   ```

2. **New state:**
   ```typescript
   const [attachedFiles, setAttachedFiles] = useState<string[]>([])
   const [isDragging, setIsDragging] = useState(false)
   ```

3. **File drop listener:**
   ```typescript
   useEffect(() => {
     if (!open) return
     if (typeof window !== "undefined" && window.electronAPI?.onFileDrop) {
       const handleFileDrop = (data: { filePath: string }) => {
         if (data.filePath && !attachedFiles.includes(data.filePath)) {
           setAttachedFiles((prev) => [...prev, data.filePath])
         }
       }
       window.electronAPI.onFileDrop(handleFileDrop)
     }
   }, [open, attachedFiles])
   ```

4. **Remove file handler:**
   ```typescript
   const removeFile = useCallback((filePath: string) => {
     setAttachedFiles((prev) => prev.filter((f) => f !== filePath))
   }, [])
   ```

5. **Dropzone UI:**
   - Drag-over visual feedback (accent border/background)
   - File icon and instructional text
   - File list with remove buttons
   - Shows only basename (not full path)

6. **Form submission:**
   - Includes `attachedFiles` in `onCreate` call
   - Clears files on successful task creation

7. **Helper function:**
   ```typescript
   function basename(filePath: string): string {
     const normalized = filePath.replace(/\\/g, "/")
     const parts = normalized.split("/")
     return parts[parts.length - 1] || filePath
   }
   ```

### 7. Smoke Test (`scripts/smoke/agent-tasks/file-drop-smoke.mjs`)

**Comprehensive checks:**
- Types include `attachedFiles` field
- Modal has dropzone UI and file management
- Electron handles file drops
- Database supports `attached_files` column
- Task store validates and persists files

## Features

### User Experience

1. **Drag files from Explorer:** Windows users can drag files directly into the modal
2. **Visual feedback:** Border and background change when dragging over
3. **File list:** Shows all attached files with remove buttons
4. **File limit:** Maximum 20 files per task
5. **Clean display:** Shows filename only, not full path

### Technical Features

1. **Cross-platform paths:** Stores full Windows paths (e.g., `C:\Users\...\file.txt`)
2. **JSON storage:** Files stored as JSON array in SQLite
3. **Validation:** Filters empty strings, limits to 20 files
4. **Optional field:** Tasks can be created with or without files
5. **Persistence:** Files survive app restarts (stored in database)

## Testing

### Automated Tests
```bash
node scripts/smoke/agent-tasks/file-drop-smoke.mjs
```

### Manual Testing
See `docs/features/file-drop-testing.md` for detailed manual test steps.

## Future Enhancements

### Phase 4 Agent Integration

When real agent processes are implemented (replacing the simulator in `task-runner.ts`), the agent spawn code should:

1. Read `task.attachedFiles` array
2. Pass file paths to the agent process (via env vars, CLI args, or stdin)
3. Agent reads file contents for context

**Example Electron spawn update:**

```javascript
ipcMain.handle('start-agent-task', async (event, taskConfig) => {
  const { taskId, agent, model, prompt, workingDirectory, attachedFiles } = taskConfig
  
  // Prepare file context
  let contextPrompt = prompt
  if (attachedFiles?.length > 0) {
    contextPrompt += "\n\nAttached files:\n"
    attachedFiles.forEach(file => {
      contextPrompt += `- ${file}\n`
    })
  }
  
  const agentProcess = spawn('claude', [
    '--output-format', 'stream-json',
    '--model', model || 'sonnet',
  ], {
    cwd: workingDirectory || process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  
  // Send prompt with file context
  agentProcess.stdin.write(JSON.stringify({ prompt: contextPrompt }) + '\n')
  
  // ... rest of process handling
})
```

### Potential Improvements

1. **File type filtering:** Only allow specific file types
2. **File size limit:** Prevent attaching very large files
3. **File preview:** Show file size, modified date
4. **Drag-and-drop from modal:** Allow dragging files out to remove
5. **Multiple drop zones:** Different areas for different context types
6. **File validation:** Check files exist before creating task
7. **Browse button:** Click to open file picker (in addition to drag-drop)

## Dependencies

No new npm dependencies added. Uses:
- Existing Electron IPC
- Built-in `lucide-react` icons
- Tailwind CSS for styling
- SQLite for storage

## Compatibility

- **Windows:** Full support (primary target)
- **macOS/Linux:** File drop handler should work, but paths may need normalization
- **Web-only mode:** Gracefully degrades (no file drop, no errors)

## Performance

- **File list rendering:** Efficient (small arrays, max 20)
- **Database storage:** JSON stringification is fast
- **UI updates:** React state updates are batched
- **IPC overhead:** Minimal (one event per file dropped)

## Security

- **Path validation:** Filters empty strings
- **JSON safety:** Try/catch around JSON.parse
- **No file contents stored:** Only paths (files remain on disk)
- **User-owned files:** Only files user explicitly drags
