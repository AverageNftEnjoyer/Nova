// electron-builder `afterPack` hook (registered in hud/electron-builder.yml). Two trims:
//
// 1. Next.js server files. `npm run build:package` builds with `output: "standalone"` (see
// hud/next.config.js), so Next's own output file tracing copies exactly the files its production server
// can load into `.next/standalone/<app>/node_modules`. The packaged `node_modules/next` and
// `node_modules/react-dom` are pruned to that file set: `next` goes from ~130 MB to ~14 MB (gone:
// `*.dev.js` / experimental / webpack runtimes the Turbopack production server never picks, the ESM
// build, bundled build tools such as webpack/babel/terser, maps). The trace includes
// `next/dist/server/next` + `lib/start-server`, the path hud/electron/production-server.js uses via
// `require('next')`. Guarded: the build fails if the trace is missing, came from a non-standalone
// build, or is for a different package version than the one packaged.
// Only these two packages are pruned. They are loaded by the Next server alone. Packages the Electron
// main process also loads (electron-updater and its dependencies) are never touched, because the Next
// trace says nothing about what main needs.
//
// 2. better-sqlite3. Trims the two packaged copies of better-sqlite3 (13.x, N-API) down to what a Windows x64 install can
// load: the JS loader (`lib/`, `package.json`, LICENSE) and `prebuilds/win32-x64.node`. Everything else
// is dead weight on an end-user machine: other-platform prebuilds (~14 MB), the SQLite amalgamation
// source in `deps/` (~10 MB), the C++ `src/` and `binding.gyp` (only used to compile from source).
//
// Copies handled, wherever they are packaged:
//   resources/runtime-resources/node_modules/better-sqlite3      (agent runtime, src/db)
//   resources/app/.next/node_modules/better-sqlite3-<hash>        (Next server externals; see
//                                                                 prepare-runtime-resources.mjs)
// The loader (lib/binding.js) picks `prebuilds/<platform>-<arch>.node`; the win32-x64 file it needs is
// preserved, and the hook fails the build if it is missing so a broken trim can never ship silently.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const KEEP_PREBUILD = "win32-x64.node";
const REMOVE_ENTRIES = ["deps", "src", "binding.gyp", "README.md"];

function findBetterSqlite3Dirs(appOutDir) {
  const found = [];
  const runtimeCopy = path.join(appOutDir, "resources", "runtime-resources", "node_modules", "better-sqlite3");
  if (fs.existsSync(runtimeCopy)) found.push(runtimeCopy);
  const nextModules = path.join(appOutDir, "resources", "app", ".next", "node_modules");
  if (fs.existsSync(nextModules)) {
    for (const name of fs.readdirSync(nextModules)) {
      if (name === "better-sqlite3" || name.startsWith("better-sqlite3-")) {
        found.push(path.join(nextModules, name));
      }
    }
  }
  return found;
}

function trimBetterSqlite3(dir) {
  const prebuilds = path.join(dir, "prebuilds");
  const keep = path.join(prebuilds, KEEP_PREBUILD);
  if (!fs.existsSync(keep)) {
    throw new Error(`[after-pack] ${keep} is missing; refusing to trim better-sqlite3 (it would not load).`);
  }
  for (const name of fs.readdirSync(prebuilds)) {
    if (name !== KEEP_PREBUILD) fs.rmSync(path.join(prebuilds, name), { recursive: true, force: true });
  }
  for (const name of REMOVE_ENTRIES) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  if (!fs.existsSync(path.join(dir, "lib", "index.js"))) {
    throw new Error(`[after-pack] ${dir}/lib/index.js is missing after trim.`);
  }
}

const TRACE_PRUNED_PACKAGES = ["next", "react-dom"];
// Files the in-process production server cannot start without; checked after the prune.
const REQUIRED_NEXT_FILES = [
  "package.json",
  "dist/server/next.js",
  "dist/server/next-server.js",
  "dist/server/lib/start-server.js",
  "dist/server/lib/router-server.js",
];

function listFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(path.relative(root, full));
    }
  }
  return out;
}

function removeEmptyDirs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name));
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

function readVersion(pkgDir) {
  return JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
}

function resolveStandaloneAppDir(hudDir) {
  const manifestPath = path.join(hudDir, ".next", "required-server-files.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`[after-pack] ${manifestPath} is missing; run \`npm run build:package\` before electron-builder.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest?.config?.output !== "standalone") {
    throw new Error(
      "[after-pack] .next was not built with the packaging trace (output: standalone). " +
        "Run `npm run build:package` (the electron:build* scripts do), not `npm run build`.",
    );
  }
  const standaloneAppDir = path.join(hudDir, ".next", "standalone", manifest.relativeAppDir || "");
  if (!fs.existsSync(path.join(standaloneAppDir, "node_modules"))) {
    throw new Error(`[after-pack] ${standaloneAppDir}/node_modules is missing; the standalone trace did not run.`);
  }
  return standaloneAppDir;
}

function pruneToStandaloneTrace(appOutDir, hudDir) {
  const standaloneAppDir = resolveStandaloneAppDir(hudDir);
  for (const pkg of TRACE_PRUNED_PACKAGES) {
    const packaged = path.join(appOutDir, "resources", "app", "node_modules", pkg);
    const traced = path.join(standaloneAppDir, "node_modules", pkg);
    if (!fs.existsSync(packaged)) throw new Error(`[after-pack] ${packaged} is missing; packaging layout changed.`);
    if (!fs.existsSync(traced)) throw new Error(`[after-pack] no traced copy of ${pkg} at ${traced}.`);
    const packagedVersion = readVersion(packaged);
    const tracedVersion = readVersion(traced);
    if (packagedVersion !== tracedVersion) {
      throw new Error(`[after-pack] ${pkg} ${packagedVersion} is packaged but the trace is for ${tracedVersion}; rebuild.`);
    }
    const keep = new Set(listFiles(traced).map((rel) => rel.toLowerCase()));
    let removed = 0;
    for (const rel of listFiles(packaged)) {
      if (keep.has(rel.toLowerCase())) continue;
      fs.rmSync(path.join(packaged, rel), { force: true });
      removed += 1;
    }
    removeEmptyDirs(packaged);
    console.log(`[after-pack] pruned ${removed} untraced files from node_modules/${pkg} (kept ${keep.size})`);
  }
  const nextDir = path.join(appOutDir, "resources", "app", "node_modules", "next");
  for (const rel of REQUIRED_NEXT_FILES) {
    if (!fs.existsSync(path.join(nextDir, rel))) {
      throw new Error(`[after-pack] node_modules/next/${rel} is missing after the trace prune.`);
    }
  }
}

// electron-builder.yml drops the top-level `node_modules/jsdom` because the compiled server requires the
// hashed `.next/node_modules/jsdom-<hash>` copy instead. If a future Next/Turbopack build requires plain
// `jsdom`, that route would 500 in the installed app, so refuse to package instead.
function assertNoPlainJsdomRequire(appOutDir) {
  const serverDir = path.join(appOutDir, "resources", "app", ".next", "server");
  const plain = /\b(?:require|import)\(\s*["']jsdom(?:\/[^"']*)?["']\s*\)/;
  for (const rel of listFiles(serverDir)) {
    if (!rel.endsWith(".js")) continue;
    if (plain.test(fs.readFileSync(path.join(serverDir, rel), "utf8"))) {
      throw new Error(`[after-pack] .next/server/${rel} requires plain "jsdom", which is excluded from the package.`);
    }
  }
}

exports.default = async function afterPack(context) {
  pruneToStandaloneTrace(context.appOutDir, context.packager.projectDir);
  assertNoPlainJsdomRequire(context.appOutDir);
  const dirs = findBetterSqlite3Dirs(context.appOutDir);
  if (dirs.length === 0) {
    throw new Error(`[after-pack] no better-sqlite3 copy found under ${context.appOutDir}; packaging layout changed.`);
  }
  for (const dir of dirs) {
    trimBetterSqlite3(dir);
    console.log(`[after-pack] trimmed ${path.relative(context.appOutDir, dir)} to ${KEEP_PREBUILD}`);
  }
};
