/**
 * Auto-update guard. electron-updater decides whether an update exists by comparing the installed app's
 * version (hud/package.json) with the newest GitHub Release. If hud/package.json is not bumped with the
 * app's V.XX version, published updates are silently never offered. Also pins the wiring: feed config,
 * the updater module, and its use in the Electron main process.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), "utf8")

const versionSource = read("hud", "lib", "meta", "version", "index.ts")
const novaVersion = /export const NOVA_VERSION = "V\.(\d+) Alpha"/.exec(versionSource)
assert.ok(novaVersion, "could not read NOVA_VERSION from hud/lib/meta/version/index.ts")
const expected = `0.${Number.parseInt(novaVersion[1], 10)}.0`

const hudPackage = JSON.parse(read("hud", "package.json"))
assert.equal(
  hudPackage.version,
  expected,
  `hud/package.json version is ${hudPackage.version} but NOVA_VERSION V.${novaVersion[1]} requires ${expected}. Run "npm run version:sync" in hud/ (it also runs automatically before every electron build/publish).`,
)
const lock = JSON.parse(read("hud", "package-lock.json"))
assert.equal(lock.version, expected, `hud/package-lock.json version is ${lock.version}, expected ${expected}; run npm run version:sync in hud/`)
assert.equal(lock.packages?.[""]?.version, expected, "hud/package-lock.json root package version out of sync; run npm run version:sync in hud/")
assert.ok(hudPackage.scripts?.["electron:build:win"]?.startsWith("npm run version:sync"), "electron:build:win must run version:sync first")
assert.ok(hudPackage.scripts?.["electron:publish:win"]?.startsWith("npm run version:sync"), "electron:publish:win must run version:sync first")
const rootPackage = JSON.parse(read("package.json"))
assert.equal(rootPackage.version, expected, `root package.json version is ${rootPackage.version}, expected ${expected}; run "npm run version:sync" in hud/`)
const rootLock = JSON.parse(read("package-lock.json"))
assert.equal(rootLock.version, expected, "root package-lock.json version out of sync")
assert.equal(rootLock.packages?.[""]?.version, expected, "root package-lock.json root package version out of sync")
console.log(`PASS hud/package.json version ${hudPackage.version} matches NOVA_VERSION V.${novaVersion[1]}`)

assert.ok(hudPackage.dependencies?.["electron-updater"], "electron-updater must be a runtime dependency of hud")
assert.ok(hudPackage.scripts?.["electron:publish:win"]?.includes("--publish always"), "missing electron:publish:win script")
console.log("PASS electron-updater dependency and publish script present")

const builderYml = read("hud", "electron-builder.yml")
assert.match(builderYml, /^publish:\s*\n\s+provider: github\s*\n\s+owner: AverageNftEnjoyer\s*\n\s+repo: Nova/m, "electron-builder.yml needs the GitHub publish feed")
assert.match(builderYml, /perMachine: false/, "installer must stay per-user so updates need no admin prompt")
console.log("PASS electron-builder GitHub publish feed configured; installer is per-user")

const updaterJs = read("hud", "electron", "auto-updater.js")
assert.match(updaterJs, /if \(!app\.isPackaged\)/, "updater must be a no-op outside the packaged app")
assert.match(updaterJs, /autoInstallOnAppQuit = true/)
assert.match(updaterJs, /quitAndInstall/)
const mainJs = read("hud", "electron", "main.js")
assert.match(mainJs, /initAutoUpdater\(\{/, "main.js must start the updater")
assert.match(mainJs, /Check for Updates/, "tray needs a manual update check")
assert.match(mainJs, /updater\?\.stop\(\)/, "before-quit must stop the update timers")
console.log("PASS updater module and Electron wiring present")
