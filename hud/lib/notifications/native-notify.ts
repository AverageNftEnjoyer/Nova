/**
 * Native Windows notification utility via Electron API
 */

export type NotificationOptions = {
  title: string
  body: string
  icon?: string
}

/**
 * Show a native Windows notification using Electron's Notification API.
 * Falls back to console.log if not running in Electron or if notifications are not supported.
 */
export async function showNativeNotification(options: NotificationOptions): Promise<void> {
  if (typeof window === 'undefined') {
    // Server-side: log instead
    console.log('[Notification]', options.title, '-', options.body)
    return
  }

  if (window.electronAPI?.showNotification) {
    try {
      const result = await window.electronAPI.showNotification(options)
      if (!result.success) {
        console.warn('[Notification] Failed:', result.error)
      }
    } catch (error) {
      console.error('[Notification] Error:', error)
    }
  } else {
    // Not in Electron: log to console
    console.log('[Notification]', options.title, '-', options.body)
  }
}

/**
 * Show a task completion notification
 */
export async function notifyTaskComplete(taskName: string, success: boolean): Promise<void> {
  await showNativeNotification({
    title: success ? 'Task Completed' : 'Task Failed',
    body: success
      ? `${taskName} completed successfully`
      : `${taskName} encountered an error`,
  })
}

/**
 * Show a mission execution notification
 */
export async function notifyMissionRun(missionName: string, success: boolean): Promise<void> {
  await showNativeNotification({
    title: success ? 'Mission Executed' : 'Mission Failed',
    body: success
      ? `${missionName} ran successfully`
      : `${missionName} encountered an error`,
  })
}

/**
 * Show a critical error notification
 */
export async function notifyError(message: string): Promise<void> {
  await showNativeNotification({
    title: 'Error',
    body: message,
  })
}
