# Native Windows Notifications

NovaAIO uses native Windows notifications via Electron's Notification API.

## Architecture

### Electron IPC Layer
- **main.js**: Handles `show-notification` IPC calls using Electron's `Notification` class
- **preload.js**: Exposes `showNotification` method to renderer process
- **global.d.ts**: TypeScript definitions for `window.electronAPI`

### Client Layer
- **native-notify.ts**: Utility functions for showing notifications
  - `showNativeNotification()` - Core notification function
  - `notifyTaskComplete()` - Task completion notifications
  - `notifyMissionRun()` - Mission execution notifications
  - `notifyError()` - Critical error notifications

### Integration Points

#### 1. Agent Tasks (`use-agent-tasks.ts`)
Monitors task status changes and sends notifications when tasks complete or fail.

```typescript
useEffect(() => {
  tasks.forEach((task) => {
    const previousStatus = taskStatusRef.current.get(task.id)
    if (previousStatus && previousStatus !== task.status) {
      if (task.status === "completed" || task.status === "failed") {
        notifyTaskComplete(task.name, task.status === "completed")
      }
    }
  })
}, [tasks])
```

#### 2. Mission Execution (`use-missions-page-state.ts`)
Sends notifications when scheduled missions complete or fail.

```typescript
if (runStatus === "succeeded") {
  const missionName = schedules.find(m => m.id === entry.missionId)?.label || "Mission"
  notifyMissionRun(missionName, true)
}
```

## Features

- **Click to Focus**: Clicking a notification brings Nova window to front
- **Platform Detection**: Falls back to console.log if not in Electron
- **Non-blocking**: All notifications are async and don't interrupt UI
- **Supported Platforms**: Windows 10+, Windows 11

## Testing

### Development Console
In development mode, test functions are available globally:

```javascript
// Test basic notification
window.novaTestNotifications.test()

// Test task notifications
window.novaTestNotifications.testTaskSuccess()
window.novaTestNotifications.testTaskFailure()

// Test mission notifications
window.novaTestNotifications.testMissionSuccess()
window.novaTestNotifications.testMissionFailure()

// Test error notification
window.novaTestNotifications.testError()

// Run all tests
window.novaTestNotifications.testAll()
```

### Manual Testing
1. Start Electron app: `npm run electron:dev`
2. Complete a task → verify notification appears
3. Run a mission → verify notification appears
4. Click notification → verify Nova window focuses

## Windows Permissions

Windows 10/11 may require notification permissions:
- Settings → System → Notifications
- Find "Nova" in the list
- Ensure notifications are enabled

## Implementation Details

### Notification Handler (main.js)
```javascript
ipcMain.handle('show-notification', async (event, { title, body, icon }) => {
  if (!Notification.isSupported()) {
    return { success: false, error: 'Notifications not supported' }
  }
  
  const notification = new Notification({ title, body, icon })
  notification.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  notification.show()
  return { success: true }
})
```

### Status Change Detection
Uses `useRef` to track previous task/mission status and only notifies on actual transitions (not initial loads).

## Future Enhancements

Potential improvements:
- [ ] Notification sound preferences
- [ ] Notification style/priority levels
- [ ] Grouping multiple notifications
- [ ] Persistent notification history
- [ ] macOS/Linux support
- [ ] Custom notification icons per event type
