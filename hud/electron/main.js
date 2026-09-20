const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration()

let mainWindow = null
let tray = null

// Agent process management
const activeAgentProcesses = new Map()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    icon: path.join(__dirname, '../public/images/nova.svg'),
    show: false, // Don't show until ready
  })

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  const isDev = !app.isPackaged

  if (isDev) {
    // Development: load from Next.js dev server
    mainWindow.loadURL('http://localhost:3000')
    mainWindow.webContents.openDevTools()
  } else {
    // Production: load from built Next.js app
    mainWindow.loadFile(path.join(__dirname, '../out/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Handle minimize to tray
  mainWindow.on('minimize', (event) => {
    if (tray) {
      event.preventDefault()
      mainWindow.hide()
    }
  })
}

function createTray() {
  // Create tray icon
  const iconPath = path.join(__dirname, '../public/images/nova.svg')
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })

  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Nova',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    {
      label: 'Hide Nova',
      click: () => {
        if (mainWindow) {
          mainWindow.hide()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setToolTip('Nova - AI Agent Hub')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })
}

// IPC Handlers for agent management
ipcMain.handle('start-agent-task', async (event, taskConfig) => {
  try {
    const { taskId, agent, model, prompt, workingDirectory } = taskConfig

    // Spawn agent process (Claude Code example)
    const agentProcess = spawn('claude', [
      '--output-format', 'stream-json',
      '--model', model || 'sonnet',
    ], {
      cwd: workingDirectory || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // Store process reference
    activeAgentProcesses.set(taskId, agentProcess)

    // Handle stdout (agent messages)
    agentProcess.stdout.on('data', (data) => {
      try {
        const lines = data.toString().split('\n').filter(Boolean)
        lines.forEach(line => {
          const message = JSON.parse(line)
          // Send update to renderer
          mainWindow?.webContents.send('agent-task-update', {
            taskId,
            message
          })
        })
      } catch (err) {
        console.error('Failed to parse agent output:', err)
      }
    })

    // Handle stderr
    agentProcess.stderr.on('data', (data) => {
      mainWindow?.webContents.send('agent-task-error', {
        taskId,
        error: data.toString()
      })
    })

    // Handle process exit
    agentProcess.on('close', (code) => {
      activeAgentProcesses.delete(taskId)
      mainWindow?.webContents.send('agent-task-complete', {
        taskId,
        exitCode: code
      })
    })

    // Send prompt to agent
    agentProcess.stdin.write(JSON.stringify({ prompt }) + '\n')

    return { success: true, taskId }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('stop-agent-task', async (event, taskId) => {
  const process = activeAgentProcesses.get(taskId)
  if (process) {
    process.kill('SIGTERM')
    activeAgentProcesses.delete(taskId)
    return { success: true }
  }
  return { success: false, error: 'Task not found' }
})

ipcMain.handle('get-active-tasks', async () => {
  return {
    success: true,
    taskIds: Array.from(activeAgentProcesses.keys())
  }
})

// App lifecycle
app.whenReady().then(() => {
  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Keep app running in background on macOS
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // Clean up all agent processes
  for (const [taskId, process] of activeAgentProcesses.entries()) {
    process.kill('SIGTERM')
  }
  activeAgentProcesses.clear()
})

// Handle deep links (nova://)
app.setAsDefaultProtocolClient('nova')

app.on('open-url', (event, url) => {
  event.preventDefault()
  // Parse nova://task/123 or nova://home
  if (mainWindow) {
    mainWindow.webContents.send('deep-link', url)
  }
})
