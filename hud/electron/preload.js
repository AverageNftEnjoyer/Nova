const { contextBridge, ipcRenderer } = require('electron')

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
    ipcRenderer.on('file-dropped', (event, data) => callback(data))
  },

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

  // Environment info
  isElectron: true,
  platform: process.platform,
})
