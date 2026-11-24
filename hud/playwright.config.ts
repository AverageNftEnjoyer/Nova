import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

/**
 * The smoke specs run against a Next dev server that owns a fresh, throwaway data dir (NOVA_DATA_DIR under the OS
 * temp dir), so they never read or write the real nova.db (<repo>/.user or %APPDATA%\Nova).
 *
 * The config module is evaluated by the runner and again by every worker; the runner creates the dir once, exports
 * it through the environment (workers inherit it) and removes it when it exits, after the web server has stopped.
 *
 * The server always starts fresh on a dedicated port (never reuses a dev server the user already runs on :3000,
 * which would be pointed at real data).
 *
 * NOVA_PLAYWRIGHT_SERVER=start runs the specs against the last production build (`npm run build` first) instead of a
 * dev server. Use it while `npm run dev` is running: Next 16 locks `.next/dev`, so a second dev server in this
 * project exits at startup, while `next start` reads `.next` and takes no lock.
 */
const DATA_DIR_ENV = 'NOVA_PLAYWRIGHT_DATA_DIR'
if (!process.env[DATA_DIR_ENV]) {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-playwright-'))
  process.env[DATA_DIR_ENV] = created
  process.on('exit', () => {
    try {
      fs.rmSync(created, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // a straggling handle on Windows: leave it to the OS temp cleanup
    }
  })
}
const dataDir = process.env[DATA_DIR_ENV] as string
const port = Number(process.env.NOVA_PLAYWRIGHT_PORT || 3100)
const baseURL = `http://127.0.0.1:${port}`
const serverMode = process.env.NOVA_PLAYWRIGHT_SERVER === 'start' ? 'start' : 'dev'

export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // Bind to the same host as baseURL: Next's dev server refuses dev assets to a different origin (localhost vs
    // 127.0.0.1), and the page would then never hydrate.
    command: `npm run ${serverMode} -- --port ${port} --hostname 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120 * 1000,
    env: {
      NOVA_DATA_DIR: dataDir,
      NOVA_PACKAGED: '',
      // Every parallel worker is the same 127.0.0.1 client: lift the per-IP request cap (240/min) for this server only.
      NOVA_HTTP_IP_RATE_LIMIT_MAX: '10000',
    },
  },
})
