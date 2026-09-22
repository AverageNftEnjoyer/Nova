/**
 * Global type definitions for Electron API
 */

interface ElectronAPI {
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
  onDeepLink: (callback: (url: string) => void) => void
  onFileDrop: (callback: (data: { filePath: string }) => void) => () => void
  getPathForFile: (file: File) => string

  // Environment info
  isElectron: boolean
  platform: string
}

interface Window {
  electronAPI?: ElectronAPI
}
