import "server-only"

import fs from "node:fs"
import path from "node:path"

function hasWorkspaceMarkers(dir: string): boolean {
  return fs.existsSync(path.join(dir, "hud")) && fs.existsSync(path.join(dir, "src"))
}

export function resolveWorkspaceRoot(workspaceRootInput?: string): string {
  const provided = String(workspaceRootInput || "").trim()
  if (provided) return path.resolve(provided)

  const cwd = path.resolve(process.cwd())
  if (hasWorkspaceMarkers(cwd)) return cwd

  if (path.basename(cwd).toLowerCase() === "hud") return path.resolve(cwd, "..")

  const parent = path.resolve(cwd, "..")
  if (hasWorkspaceMarkers(parent)) return parent

  return cwd
}
