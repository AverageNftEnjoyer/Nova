// Packaged-app execution plane (Closure 4).
//
// The Electron main process hosts both the Next.js production server (API routes, not a static
// export) and the `src/` runtime scheduler in-process — no spawned child processes, no separately
// started `npm run dev`. This mirrors what `nova.js` does for the dev "boot-right" launcher (two
// processes talking over a shared HTTP token), except both halves now share one Node process.
//
// Layout this module expects on disk (see hud/electron-builder.yml + hud/scripts/prepare-runtime-resources.mjs):
//   <hud app dir>/.next (including .next/node_modules/<pkg>-<hash> real copies of serverExternalPackages),
//     public, node_modules, package.json   -- the Next production build (this file's `..`)
//   <resourcesPath>/runtime-resources/{src,dist,node_modules,package.json} -- the repo-root runtime.
//     better-sqlite3 >=13 ships an N-API prebuild that loads in this process without an Electron-ABI rebuild.
'use strict'

const path = require('path')
const http = require('http')
const crypto = require('crypto')
const { pathToFileURL } = require('url')

/**
 * @param {{ hudDir: string, runtimeRoot: string, handleInput?: Function }} opts
 * `handleInput` is optional and in-process only. Electron main omits it, so the packaged app uses the
 * real chat handler. The production boot smoke passes a fake so a queued task can be claimed without API keys.
 * @returns {Promise<{ port: number, stop: () => Promise<void> }>}
 */
async function startProductionServices({ hudDir, runtimeRoot, handleInput } = {}) {
  process.env.NEXT_TELEMETRY_DISABLED = '1'
  process.env.NODE_ENV = 'production'

  // A shared bearer token authenticates the in-process runtime's HTTP calls back into the Next API
  // (see hud/lib/security/runtime-auth). It never needs to leave this process.
  process.env.NOVA_RUNTIME_SHARED_TOKEN = crypto.randomBytes(32).toString('base64url')
  process.env.NOVA_RUNTIME_REQUIRE_SHARED_TOKEN = '1'

  // src/runtime/core/workspace-user-root's directory walk-up (skills/, templates/, dotenv, ...) has
  // no `hud/` sibling to find inside the staged runtimeRoot (see that module's comment) — point it
  // there directly instead of letting it walk off into nowhere and crash trying to write its dev-only
  // safety-sentinel file under a path that doesn't exist.
  process.env.NOVA_WORKSPACE_ROOT = runtimeRoot

  const { server, port, closeNext } = await startNextServer(hudDir)
  process.env.NOVA_HUD_API_BASE_URL = `http://127.0.0.1:${port}`

  const runtimeHandle = await startRuntimeScheduler(runtimeRoot, handleInput)

  let stopped = false
  async function stop() {
    if (stopped) return
    stopped = true
    try {
      runtimeHandle?.stop?.()
    } catch (err) {
      console.error('[ProductionServer] Runtime stop failed:', err?.message || err)
    }
    if (runtimeHandle?.done) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000)
        runtimeHandle.done.finally(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    try {
      await closeNext?.()
    } catch (err) {
      console.error('[ProductionServer] Next close failed:', err?.message || err)
    }
    await new Promise((resolve) => {
      server.close(() => resolve())
      // http.Server#close() only stops accepting NEW connections; it waits indefinitely for
      // already-open ones (e.g. the BrowserWindow's own live connection to this server, or any
      // keep-alive socket) to close on their own, which they may never do promptly on quit. Force
      // them closed immediately instead of hoping — confirmed necessary: a smoke test of this exact
      // shutdown path left real Socket handles open afterward without this call.
      server.closeAllConnections?.()
      // Belt-and-suspenders in case some handle still doesn't let go: don't block app quit forever.
      setTimeout(resolve, 2000).unref?.()
    })
  }

  return { port, stop }
}

function startNextServer(hudDir) {
  return new Promise((resolve, reject) => {
    let next
    try {
      // Resolves hud's own `next` install via normal Node resolution (hudDir/node_modules/next).
      next = require('next')
    } catch (err) {
      reject(new Error(`[ProductionServer] Could not load the Next.js package from ${hudDir}: ${err?.message || err}`))
      return
    }

    const nextApp = next({ dev: false, dir: hudDir })
    const handler = nextApp.getRequestHandler()

    nextApp
      .prepare()
      .then(() => {
        const server = http.createServer((req, res) => handler(req, res))
        server.on('error', reject)
        // Port 0 = OS-assigned free loopback port; avoids colliding with a dev server on 3000 or
        // anything else already listening. The window is only pointed at the URL once this resolves.
        server.listen(0, '127.0.0.1', () => {
          const address = server.address()
          const port = typeof address === 'object' && address ? address.port : null
          if (!port) {
            reject(new Error('[ProductionServer] Next server did not report a listening port.'))
            return
          }
          console.log(`[ProductionServer] Next.js production server listening on 127.0.0.1:${port}`)
          resolve({
            server,
            port,
            closeNext: () => nextApp.close(),
          })
        })
      })
      .catch(reject)
  })
}

async function startRuntimeScheduler(runtimeRoot, handleInput) {
  const entrypointPath = path.join(runtimeRoot, 'src', 'runtime', 'core', 'entrypoint', 'index.js')
  const entrypointUrl = pathToFileURL(entrypointPath).href

  let runtimeModule
  try {
    runtimeModule = await import(entrypointUrl)
  } catch (err) {
    throw new Error(`[ProductionServer] Failed to load runtime entrypoint at ${entrypointPath}: ${err?.message || err}`)
  }

  if (typeof runtimeModule?.startNovaRuntime !== 'function') {
    throw new Error('[ProductionServer] Runtime entrypoint does not export startNovaRuntime().')
  }

  // startNovaRuntime() never resolves under normal operation (it ends in an infinite voice loop),
  // so it must not be awaited here — only the onReady() callback, fired once the gateway and the
  // agent-task scheduler are up, is used to get a stop handle.
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('[ProductionServer] Runtime did not signal ready within 30s.'))
    }, 30_000)

    const runtimeOptions = {
      onReady: (handle) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve({
          stop: typeof handle?.stop === 'function' ? handle.stop : () => {},
          done: runtimeDone,
        })
      },
    }
    if (typeof handleInput === 'function') runtimeOptions.handleInput = handleInput

    const runtimeDone = runtimeModule
      .startNovaRuntime(runtimeOptions)
      .catch((err) => {
        console.error('[ProductionServer] Runtime exited unexpectedly:', err?.message || err)
      })
  })
}

module.exports = { startProductionServices }
