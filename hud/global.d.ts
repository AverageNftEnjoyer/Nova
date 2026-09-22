/**
 * Global type definitions for Electron API
 */

interface ElectronAPI {
  // Agent task management
  startAgentTask: (taskConfig: unknown) => Promise<{ success: boolean; taskId?: string; error?: string }>
  stopAgentTask: (taskId: string) => Promise<{ success: boolean; error?: string }>
  getActiveTasks: () => Promise<{ success: boolean; taskIds?: string[] }>

  // Notifications
  showNotification: (options: {
    title: string
    body: string
    icon?: string
  }) => Promise<{ success: boolean; error?: string }>

  // Auto-launch
  setAutoLaunch: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  getAutoLaunch: () => Promise<{ success: boolean; enabled?: boolean; error?: string }>

  // Window controls (frameless window)
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>

  // Event listeners
  onAgentTaskUpdate: (callback: (data: unknown) => void) => void
  onAgentTaskError: (callback: (data: unknown) => void) => void
  onAgentTaskComplete: (callback: (data: unknown) => void) => void
  onDeepLink: (callback: (url: string) => void) => void
  onFileDrop: (callback: (data: { filePath: string }) => void) => () => void
  getPathForFile: (file: File) => string

  // Remove event listeners
  removeAgentTaskUpdateListener: () => void
  removeAgentTaskErrorListener: () => void
  removeAgentTaskCompleteListener: () => void

  // Environment info
  isElectron: boolean
  platform: string
}

interface Window {
  electronAPI?: ElectronAPI
}
