// electron-builder `afterPack` hook (registered in hud/electron-builder.yml).
//
// Trims the two packaged copies of better-sqlite3 (13.x, N-API) down to what a Windows x64 install can
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

exports.default = async function afterPack(context) {
  const dirs = findBetterSqlite3Dirs(context.appOutDir);
  if (dirs.length === 0) {
    throw new Error(`[after-pack] no better-sqlite3 copy found under ${context.appOutDir}; packaging layout changed.`);
  }
  for (const dir of dirs) {
    trimBetterSqlite3(dir);
    console.log(`[after-pack] trimmed ${path.relative(context.appOutDir, dir)} to ${KEEP_PREBUILD}`);
  }
};
