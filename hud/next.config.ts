import path from "node:path"
import type { NextConfig } from "next"

process.env.BROWSERSLIST_IGNORE_OLD_DATA = "true"
process.env.BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA = "true"

const workspaceRoot = path.resolve(__dirname, "..")

const nextConfig: NextConfig = {
  // Native addon used by src/db (imported via ../src, resolved from the repo-root node_modules). Never bundle the .node binary.
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: workspaceRoot,
  },
}

export default nextConfig
