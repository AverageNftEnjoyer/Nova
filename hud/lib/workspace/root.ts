import "server-only"

import fs from "node:fs"
import path from "node:path"

function hasWorkspaceMarkers(dir: string): boolean {
  return fs.existsSync(path.join(dir, "hud")) && fs.existsSync(path.join(dir, "src"))
}

function findWorkspaceRoot(startDir: string): string {
  let cursor = path.resolve(startDir)
  for (;;) {
    if (hasWorkspaceMarkers(cursor)) return cursor
    const parent = path.dirname(cursor)
    if (parent === cursor) return startDir
    cursor = parent
  }
}

export function resolveWorkspaceRoot(workspaceRootInput?: string): string {
  const provided = String(workspaceRootInput || "").trim()
  if (provided) return findWorkspaceRoot(path.resolve(provided))

  const cwd = path.resolve(process.cwd())
  return findWorkspaceRoot(cwd)
}
