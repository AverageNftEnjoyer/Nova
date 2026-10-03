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

// Packaging builds only (`npm run build:package`, used by every electron:build* script): emit Next's
// output file trace for the server itself. With `output: "standalone"` Next also traces
// `next/dist/server/next` + `lib/start-server` (the entry hud/electron/production-server.js loads via
// `require('next')`) into `.next/next-server.js.nft.json` and copies the traced files to
// `.next/standalone`. hud/scripts/after-pack.js uses that copy as the allowlist for the packaged
// `node_modules/next` and `node_modules/react-dom` (~120 MB of dev/experimental/webpack runtimes, ESM
// builds and maps otherwise ship). The app still runs through the custom in-process server with the
// regular `.next` layout; `.next/standalone` itself never ships (see electron-builder.yml).
//
// Off for `npm run dev` / `npm run build` / `npm run start`: at runtime Next only warns
// ('"next start" does not work with "output: standalone"') when this is set, and the packaged app
// loads this file with the env var unset, so it never sees the flag either.
const packagingTrace = process.env.NOVA_NEXT_STANDALONE_TRACE === "1"
  ? {
      output: "standalone",
      // Several API routes read files under dynamic repo-root paths, so Turbopack traces the whole
      // project into their route traces, and standalone would copy hud/dist (every previous
      // installer + win-unpacked, 600+ MB) and the staged runtime into .next/standalone on each
      // build. Neither is loaded by the Next server. Patterns are resolved from the hud/ project root.
      outputFileTracingExcludes: {
        "/*": ["dist/**/*", "runtime-resources/**/*"],
      },
    }
  : {}

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...packagingTrace,
  // Native addon used by src/db (imported via ../src, resolved from the repo-root node_modules). Never bundle the .node binary.
  serverExternalPackages: ["better-sqlite3"],
  // The dev-mode "N" indicator overlaps card content on the home screen at small
  // window sizes no matter which corner it's pinned to (five bottom-row cards span
  // the full width). Disable it rather than trade one overlap for another.
  devIndicators: false,
  // The packaged app ships without sharp (~35 MB of native binaries), and every next/image in this
  // app is a local static asset or data URL, so the /_next/image optimizer adds nothing. Serve the
  // originals directly.
  images: { unoptimized: true },
  turbopack: {
    root: workspaceRoot,
  },
  // The legacy /deployments page is retired: the Depot room on Home does everything it did. Old links and bookmarks
  // get a real redirect (also in the packaged server, which runs with this config). The old `?mode=` / `&kind=` deep
  // links open the Depot's creation section on the matching tab; Home reads `room`, `section` and `tab` once and
  // cleans the URL. First match wins.
  async redirects() {
    const creation = (tab) => `/home?room=depot&section=new-deployment&tab=${tab}`
    return [
      {
        source: "/deployments",
        has: [
          { type: "query", key: "mode", value: "advanced" },
          { type: "query", key: "kind", value: "automation" },
        ],
        destination: creation("automation"),
        permanent: false,
      },
      { source: "/deployments", has: [{ type: "query", key: "mode", value: "advanced" }], destination: creation("task"), permanent: false },
      { source: "/deployments", has: [{ type: "query", key: "mode" }], destination: creation("describe"), permanent: false },
      { source: "/deployments", destination: "/home?room=depot", permanent: false },
    ]
  },
}

module.exports = nextConfig
