const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Agent task management
  startAgentTask: (taskConfig) => ipcRenderer.invoke('start-agent-task', taskConfig),
  stopAgentTask: (taskId) => ipcRenderer.invoke('stop-agent-task', taskId),
  getActiveTasks: () => ipcRenderer.invoke('get-active-tasks'),

  // Event listeners
  onAgentTaskUpdate: (callback) => {
    ipcRenderer.on('agent-task-update', (event, data) => callback(data))
  },
  onAgentTaskError: (callback) => {
    ipcRenderer.on('agent-task-error', (event, data) => callback(data))
  },
  onAgentTaskComplete: (callback) => {
    ipcRenderer.on('agent-task-complete', (event, data) => callback(data))
  },
  onDeepLink: (callback) => {
    ipcRenderer.on('deep-link', (event, url) => callback(url))
  },
  onFileDrop: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('file-dropped', listener)
    return () => ipcRenderer.removeListener('file-dropped', listener)
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Remove event listeners
  removeAgentTaskUpdateListener: () => {
    ipcRenderer.removeAllListeners('agent-task-update')
  },
  removeAgentTaskErrorListener: () => {
    ipcRenderer.removeAllListeners('agent-task-error')
  },
  removeAgentTaskCompleteListener: () => {
    ipcRenderer.removeAllListeners('agent-task-complete')
  },

  // Notifications
  showNotification: (options) => ipcRenderer.invoke('show-notification', options),

  // Auto-launch
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),

  // Window controls (for frameless window)
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Environment info
  isElectron: true,
  platform: process.platform,
})
