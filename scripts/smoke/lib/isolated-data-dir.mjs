/**
 * Test isolation for smoke scripts. Import this module FIRST (before anything that can reach src/db or a runtime
 * store) so `process.env.NOVA_DATA_DIR` points at a fresh throwaway directory under os.tmpdir():
 *
 *   import "../lib/isolated-data-dir.mjs"
 *
 * ES module imports evaluate in source order, so a bare side-effect import placed first runs before the modules
 * that would otherwise resolve `<repo>/.user` (the real nova.db) at load time.
 *
 * - A NOVA_DATA_DIR that is already set AND lives under os.tmpdir() (a parent test harness chose it) is kept and
 *   never deleted by this module.
 * - Any other value (unset, or pointing at a real location) is replaced with a fresh temp dir.
 * - NOVA_PACKAGED is cleared so the packaged-app (%APPDATA%\Nova) branch can never be taken by accident.
 * - The dir is removed on exit; open SQLite handles are closed first (Windows cannot delete an open file).
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

function isUnder(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
}

function closeSingletonDb() {
  try {
    const current = globalThis.__novaDb
    globalThis.__novaDb = undefined
    if (current?.db?.open) current.db.close()
  } catch {
    // best effort
  }
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch {
    // Something still holds a handle: let a detached helper retry after this process is gone.
    try {
      const script = `const fs=require("fs");let n=0;(function t(){try{fs.rmSync(${JSON.stringify(dir)},{recursive:true,force:true});}catch{if(++n<20)return setTimeout(t,500);}})()`
      spawn(process.execPath, ["-e", script], { detached: true, stdio: "ignore", windowsHide: true }).unref()
    } catch {
      // leave it in the OS temp dir
    }
  }
}

/**
 * Create a fresh isolated data dir and point NOVA_DATA_DIR at it. Returns { dataDir, cleanup }.
 * `cleanup()` is also registered on process exit and is idempotent.
 */
export function createIsolatedDataDir(prefix = "nova-smoke-") {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  process.env.NOVA_DATA_DIR = dataDir
  delete process.env.NOVA_PACKAGED
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    closeSingletonDb()
    removeDir(dataDir)
  }
  process.on("exit", cleanup)
  return { dataDir, cleanup }
}

const existing = String(process.env.NOVA_DATA_DIR || "").trim()
const inherited = existing && isUnder(existing, os.tmpdir())
export const isolated = inherited ? { dataDir: path.resolve(existing), cleanup() {} } : createIsolatedDataDir()
if (inherited) delete process.env.NOVA_PACKAGED
export const isolatedDataDir = isolated.dataDir
