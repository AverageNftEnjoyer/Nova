# File Drag-and-Drop Testing Guide

## Manual Testing Steps

### 1. Start the Electron App

```bash
cd hud
npm run electron:dev
```

### 2. Open Task Creation Modal

- Navigate to Home screen
- Click the "+" button in the Agent Tasks module
- Or open the Mission Hub and create a task

### 3. Test File Drop

1. **Drag a single file:**
   - Open Windows Explorer
   - Drag a file (e.g., `.txt`, `.pdf`, `.js`) from Explorer
   - Drop it onto the "Drag files here to attach as context" area
   - Verify the file appears in the list below with its filename

2. **Drag multiple files:**
   - Drag 3-5 files at once
   - Verify all files appear in the list

3. **Remove files:**
   - Click the "×" button next to any file
   - Verify it's removed from the list

4. **Test file limit:**
   - Try to add more than 20 files
   - Verify only the first 20 are stored

5. **Create task with files:**
   - Add 2-3 files
   - Fill in the prompt: "Analyze these files and summarize their contents"
   - Click "Create task"
   - Verify task is created successfully

### 4. Verify Database Storage

The attached files should be stored in the SQLite database at:
- `C:\Users\<YourUser>\.nova\nova.db`

Query to check:
```sql
SELECT id, name, attached_files FROM agent_tasks WHERE attached_files IS NOT NULL;
```

## Expected Behavior

### Dropzone UI
- Border should turn accent color when dragging over
- Background should have subtle tint when dragging
- File icon and text should be visible

### File List
- Each file shows only the basename (not full path)
- File icon appears on the left
- Remove button (×) appears on the right
- List is scrollable if many files

### Task Creation
- Files are included in the task payload
- Files persist after task creation
- Files are cleared from modal after successful creation

## Technical Details

### File Path Format
- Full Windows paths stored: `C:\Users\...\file.txt`
- Displayed as basename only: `file.txt`

### Storage
- Files stored as JSON array in `attached_files` column
- Max 20 files per task
- Empty array or null for tasks without files

### Electron IPC
- `will-navigate` event catches file drops
- `file-dropped` channel sends path to renderer
- `onFileDrop` exposed via preload script

## Troubleshooting

### Files not appearing when dropped
- Check DevTools console for errors
- Verify `electronAPI.onFileDrop` is available
- Check that Electron main process is handling `will-navigate`

### Files not persisting
- Check database migration ran (version should be 6)
- Verify `attached_files` column exists in `agent_tasks` table
- Check console for any task creation errors

### TypeScript errors
- Run `npm run type-check` in `hud/` directory
- All files should compile without errors
