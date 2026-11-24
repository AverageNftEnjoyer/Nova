// Auto-update for the installed (packaged) app, via GitHub Releases (electron-updater).
//
// How it works: `npm run electron:publish:win` uploads the NSIS installer plus `latest.yml` to a GitHub
// Release on this repo. The installed app checks that release feed, downloads a newer installer in the
// background, and offers "Restart now / Later". If the user picks Later, the update installs silently the
// next time the app quits. Nova installs per-user, so updating needs no admin prompt.
//
// The app is NOT code-signed, so no publisher-name verification is configured; updates are fetched over
// HTTPS from the public repo's release assets and checked against the SHA-512 in latest.yml.
//
// Versions: electron-updater compares hud/package.json `version` with the release. That version MUST be
// bumped on every release (see docs/release/auto-update.md); smoke:version-sync enforces it matches NOVA_VERSION.
'use strict'

const FIRST_CHECK_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * @param {{ app: import('electron').App, dialog: import('electron').Dialog, getMainWindow: () => import('electron').BrowserWindow | null }} deps
 * @returns {{ checkNow: (opts?: { manual?: boolean }) => Promise<void>, stop: () => void }}
 */
function initAutoUpdater({ app, dialog, getMainWindow }) {
  // `electron:dev` has no update feed; a `--dir` build has no app-update.yml. Both are simply not updatable.
  if (!app.isPackaged) {
    return { checkNow: async () => {}, stop: () => {} }
  }

  const { autoUpdater } = require('electron-updater')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.logger = {
    info: (message) => console.log('[AutoUpdate]', message),
    warn: (message) => console.warn('[AutoUpdate]', message),
    error: (message) => console.error('[AutoUpdate]', message),
    debug: () => {},
  }

  let checking = false
  let manualCheck = false
  let promptedVersion = ''
  let timers = []

  const showBox = (options) => {
    const win = getMainWindow()
    return win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
  }

  autoUpdater.on('update-available', (info) => {
    console.log(`[AutoUpdate] Update ${info.version} found; downloading in the background.`)
  })

  autoUpdater.on('update-not-available', () => {
    if (!manualCheck) return
    void showBox({
      type: 'info',
      title: 'Nova',
      message: 'Nova is up to date.',
      detail: `You are running version ${app.getVersion()}.`,
      buttons: ['OK'],
    })
  })

  autoUpdater.on('error', (error) => {
    console.error('[AutoUpdate] Check failed:', error?.message || error)
    if (!manualCheck) return
    void showBox({
      type: 'warning',
      title: 'Nova',
      message: 'Could not check for updates.',
      detail: 'Check your internet connection and try again. If this keeps happening, download the latest installer from the Nova releases page.',
      buttons: ['OK'],
    })
  })

  autoUpdater.on('update-downloaded', async (info) => {
    if (promptedVersion === info.version) return
    promptedVersion = info.version
    const { response } = await showBox({
      type: 'info',
      title: 'Nova update ready',
      message: `Nova ${info.version} has been downloaded.`,
      detail: 'Restart now to finish updating. If you choose Later, the update installs the next time you close Nova.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) {
      // quitAndInstall runs our normal quit path (before-quit stops the in-process server and runtime first).
      autoUpdater.quitAndInstall(true, true)
    }
  })

  async function checkNow({ manual = false } = {}) {
    if (checking) return
    checking = true
    manualCheck = manual
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      // 'error' listener already reported it; this keeps the rejection from becoming unhandled.
      console.error('[AutoUpdate] checkForUpdates threw:', error?.message || error)
    } finally {
      checking = false
      manualCheck = false
    }
  }

  const first = setTimeout(() => void checkNow(), FIRST_CHECK_DELAY_MS)
  const interval = setInterval(() => void checkNow(), CHECK_INTERVAL_MS)
  first.unref?.()
  interval.unref?.()
  timers = [first, interval]

  return {
    checkNow,
    stop: () => {
      for (const timer of timers) {
        clearTimeout(timer)
        clearInterval(timer)
      }
      timers = []
    },
  }
}

module.exports = { initAutoUpdater }
