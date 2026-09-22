const electron = require('electron')
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } = electron
const path = require('path')
const { fileUrlToPath } = require('./file-url-path')

process.env.NEXT_TELEMETRY_DISABLED = '1'

// Whether this is a real (packaged) install, not `electron:dev`. Computed once, at module load,
// before anything reads it.
const isPackagedRuntime = app.isPackaged
if (isPackagedRuntime) {
  // Must be set before the in-process Next server / runtime scheduler start: resolveDataDir()
  // (src/db/paths.js) reads this to resolve nova.db and keys/ to %APPDATA%\Nova instead of a path
  // inside the install directory. See docs/security/local-data.md.
  process.env.NOVA_PACKAGED = '1'
}

// A real ICO, not the SVG under public/images: see the icon: usages below for why.
const NOVA_ICON_PATH = path.join(__dirname, 'icons', 'nova.ico')

let mainWindow = null
let tray = null
// { port, stop } once the in-process Next server + runtime scheduler are up (packaged mode only).
let productionServices = null
let shuttingDown = false

// Shows the real underlying error, not just the top-level message: production startup failures
// (Next config/prepare errors especially) are often a wrapper with the actually useful detail in
// `.cause` (see hud/electron/production-server.js callers) — swallowing that down to `.message`
// alone is what made the earlier "Failed to transpile next.config.ts" dialog unhelpfully vague.
function formatStartupFailure(err) {
  const lines = ['Nova failed to start.', '']
  lines.push(String(err?.message || err))
  let cause = err?.cause
  let depth = 0
  while (cause && depth < 5) {
    lines.push('', `Caused by: ${cause?.message || cause}`)
    cause = cause?.cause
    depth += 1
  }
  if (err?.stack) {
    lines.push('', String(err.stack))
  }
  return lines.join('\n')
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    backgroundColor: '#0a0a0f',
    frame: false, // Remove native title bar and window chrome
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      // Throttle timers/animations when the window is hidden or minimized to tray.
      backgroundThrottling: true,
    },
    // nativeImage (used for this, the tray icon, and notification icons) cannot decode SVG in
    // Electron — an SVG path here silently produces a blank/empty image, not an error. Use a real
    // ICO instead, and keep it under electron/ so it ships in both dev and the packaged app (only
    // electron/**/*, not app/**/*, is in electron-builder.yml's `files`).
    icon: NOVA_ICON_PATH,
    show: false, // Don't show until ready
  })

  // Remove application menu entirely
  Menu.setApplicationMenu(null)

  // Dev-only keyboard shortcuts (since menu is removed)
  if (!isPackagedRuntime) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      // Ctrl+R or F5: Reload
      if ((input.control && input.key === 'r') || input.key === 'F5') {
        mainWindow.webContents.reload()
      }
      // Ctrl+Shift+I or F12: DevTools
      if ((input.control && input.shift && input.key === 'i') || input.key === 'F12') {
        mainWindow.webContents.toggleDevTools()
      }
    })
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })

  // A file drop must never navigate the app to a file:// URL. The drop zone reads
  // the path directly; this is the fallback when the page does not handle the drop.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) return
    event.preventDefault()
    const filePath = fileUrlToPath(url)
    if (filePath) mainWindow.webContents.send('file-dropped', { filePath })
  })

  // Prevent opening new windows from file drops
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  if (!isPackagedRuntime) {
    // Development: load from the Next.js dev server started by `npm run electron:dev`.
    mainWindow.loadURL('http://127.0.0.1:3000')
    // DevTools are opt-in (they add continuous CPU/GPU overhead): NOVA_DEVTOOLS=1
    if (process.env.NOVA_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools()
    }
  } else {
    // Production: Electron's own main process hosts the Next.js production server (API routes,
    // not a static export) and the src/ runtime scheduler in-process, then loads the loopback URL
    // once the server is confirmed listening. See hud/electron/production-server.js.
    try {
      const { startProductionServices } = require('./production-server')
      // app.getAppPath() is the real on-disk app directory (this build ships with asar: false —
      // see electron-builder.yml — so Next's custom server and the native SQLite addon never have
      // to load out of an asar archive).
      const hudDir = app.getAppPath()
      // See hud/electron-builder.yml's extraResources comment: staged at resources/runtime-resources,
      // not resources/runtime, to dodge electron-builder's hardcoded root-level node_modules drop.
      const runtimeRoot = path.join(process.resourcesPath, 'runtime-resources')
      productionServices = await startProductionServices({ hudDir, runtimeRoot })
      await mainWindow.loadURL(`http://127.0.0.1:${productionServices.port}`)
    } catch (err) {
      console.error('[Electron] Failed to start production services:', err)
      mainWindow.loadURL(
        `data:text/plain,${encodeURIComponent(formatStartupFailure(err))}`,
      )
    }
  }

  // Handle close button - hide to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!app.isQuitting && tray) {
      event.preventDefault()
      mainWindow.hide()
      return false
    }
  })

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
  const trayIcon = nativeImage.createFromPath(NOVA_ICON_PATH).resize({ width: 16, height: 16 })
  if (trayIcon.isEmpty()) {
    console.error(`[Electron] Tray icon failed to decode from ${NOVA_ICON_PATH}; tray will show a blank icon.`)
  }

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
        app.isQuitting = true
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

function setupIpcHandlers() {
  // Auto-launch handlers
  ipcMain.handle('set-auto-launch', async (event, enabled) => {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: false
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-auto-launch', async () => {
    try {
      const settings = app.getLoginItemSettings()
      return { success: true, enabled: settings.openAtLogin }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // Native Windows notifications
  ipcMain.handle('show-notification', async (event, { title, body, icon }) => {
    try {
      if (!Notification.isSupported()) {
        return { success: false, error: 'Notifications not supported on this platform' }
      }

      const notification = new Notification({
        title,
        body,
        icon: icon || NOVA_ICON_PATH,
        timeoutType: 'default'
      })

      notification.on('click', () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      })

      notification.show()
      return { success: true }
    } catch (error) {
      console.error('[Electron] Notification error:', error)
      return { success: false, error: error.message }
    }
  })

  // Window control handlers (for frameless window)
  ipcMain.handle('window-minimize', () => {
    if (mainWindow) {
      mainWindow.minimize()
    }
  })

  ipcMain.handle('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
    }
  })

  ipcMain.handle('window-close', () => {
    if (mainWindow) {
      mainWindow.close()
    }
  })

  ipcMain.handle('window-is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false
  })
}

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit()
} else {
  // Second instance attempted to launch - focus the existing window
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  })
}

// App lifecycle
app.whenReady().then(() => {
  createWindow()
  createTray()
  setupIpcHandlers()

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

// Quitting must stop the in-process Next server and runtime scheduler cleanly: close the HTTP
// server and let the runtime's onReady() stop handle clear the agent-task scheduler's interval,
// abort in-flight task runs, and close the WS gateway (see production-server.js / src/runtime/core
// /entrypoint/index.js). preventDefault + re-quit lets that finish before the process actually exits.
app.on('before-quit', (event) => {
  app.isQuitting = true

  if (tray) {
    tray.destroy()
    tray = null
  }

  if (productionServices && !shuttingDown) {
    shuttingDown = true
    event.preventDefault()
    const services = productionServices
    productionServices = null
    services
      .stop()
      .catch((err) => console.error('[Electron] Shutdown error:', err))
      .finally(() => app.quit())
  }
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
