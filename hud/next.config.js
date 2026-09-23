// Plain JS (not .ts): Next's production server (`next({ dev: false })`, used by
// hud/electron/production-server.js in the packaged Electron app) transpiles a `next.config.ts` at
// `prepare()` time via its own bundled TypeScript, which needs `tsconfig.json` to sit next to it
// (`ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json')` in Next's next-config-ts transpiler).
// electron-builder's `files` list ships `package.json` and `node_modules/**` but not `tsconfig.json`
// (a dev/build-time file, not something a packaged app should need), so a packaged install crashed
// on launch with "Failed to transpile next.config.ts" / "Cannot read properties of undefined
// (reading 'fileExists')". A plain `.js` config needs no transpile step and no tsconfig.json at all,
// which is what `next start`/a custom production server actually needs. Keep this as .js; do not
// reintroduce a next.config.ts alongside it.
//
// @type {import('next').NextConfig}

const path = require("node:path")

process.env.BROWSERSLIST_IGNORE_OLD_DATA = "true"
process.env.BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA = "true"

const workspaceRoot = path.resolve(__dirname, "..")

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native addon used by src/db (imported via ../src, resolved from the repo-root node_modules). Never bundle the .node binary.
  serverExternalPackages: ["better-sqlite3"],
  // The dev-mode "N" indicator overlaps card content on the home screen at small
  // window sizes no matter which corner it's pinned to (five bottom-row cards span
  // the full width). Disable it rather than trade one overlap for another.
  devIndicators: false,
  turbopack: {
    root: workspaceRoot,
  },
}

module.exports = nextConfig
