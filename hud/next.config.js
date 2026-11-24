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

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS config (see above)
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
  // Old deep links get real redirects (also in the packaged server, which runs with this config). First match wins.
  // Next appends the original query to the destination; no destination matches a source again, so nothing loops.
  async redirects() {
    return [...LEGACY_DEPLOYMENT_REDIRECTS, ...LEGACY_HOME_ROOM_REDIRECTS]
  }
}

/** The old `/deployments?mode=...` creation links open the matching tab of New deployment. Plain `/deployments` is the list. */
const LEGACY_DEPLOYMENT_REDIRECTS = [
  {
    source: "/deployments",
    has: [
      { type: "query", key: "mode", value: "advanced" },
      { type: "query", key: "kind", value: "automation" },
    ],
    destination: "/deployments/new?tab=automation",
    permanent: false,
  },
  { source: "/deployments", has: [{ type: "query", key: "mode", value: "advanced" }], destination: "/deployments/new?tab=task", permanent: false },
  { source: "/deployments", has: [{ type: "query", key: "mode" }], destination: "/deployments/new?tab=describe", permanent: false },
]

/** Integration each retired Home room set up (`/home?room=<room>`), opened on /integrations. */
const ROOM_INTEGRATIONS = {
  bank: "coinbase",
  cinema: "youtube",
  records: "spotify",
  arcade: "discord",
  cowork: "slack",
  lab: "openai",
  studio: "claude",
  observatory: "grok",
  "gemini-tower": "gemini",
  telegraph: "telegram",
  library: "brave",
  vault: "phantom",
}

const homeRoom = (room, destination, extra = []) => ({
  source: "/home",
  has: [{ type: "query", key: "room", value: room }, ...extra],
  destination,
  permanent: false,
})
const setupSection = [{ type: "query", key: "section", value: "setup" }]

/**
 * The retired Home rooms (`/home?room=<id>[&section=<id>][&tab=<id>]`) map to the pages that now hold their features.
 * `/home` without `room`, or with a room not listed here, stays on Home (Home drops an unknown `room` param itself).
 */
const LEGACY_HOME_ROOM_REDIRECTS = [
  homeRoom("depot", "/deployments/new?tab=:tab", [
    { type: "query", key: "section", value: "new-deployment" },
    { type: "query", key: "tab", value: "(?<tab>describe|task|automation)" },
  ]),
  homeRoom("depot", "/deployments/new", [{ type: "query", key: "section", value: "new-deployment" }]),
  homeRoom("depot", "/deployments", [{ type: "query", key: "section", value: "deployment-list" }]),
  homeRoom("depot", "/runs"),
  homeRoom("nova-hq", "/runs"),
  homeRoom("power-plant", "/analytics"),
  homeRoom("fountain-park", "/chat"),
  homeRoom("town-hall", "/integrations"),
  homeRoom("odds-parlour", "/integrations?setup=polymarket", setupSection),
  homeRoom("odds-parlour", "/polymarket"),
  homeRoom("post-office", "/integrations?setup=gmail", setupSection),
  homeRoom("post-office", "/missions/calendar"),
  homeRoom("clock-tower", "/integrations?setup=gmail-calendar", setupSection),
  homeRoom("clock-tower", "/missions/calendar"),
  ...Object.entries(ROOM_INTEGRATIONS).map(([room, setup]) => homeRoom(room, `/integrations?setup=${setup}`)),
]

module.exports = nextConfig
