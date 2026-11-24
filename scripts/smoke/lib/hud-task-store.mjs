/**
 * Loads the HUD agent-task store (hud/lib/agents/task-store.ts) in plain Node for smoke tests.
 *
 * The store and every HUD module it imports (followed from its import graph, so a new dependency needs no edit
 * here) are transpiled to CommonJS inside `outDir`. Requires are then rewritten:
 *   - HUD modules (relative or `@/...`) point at their transpiled copies in `outDir`;
 *   - runtime modules under src/ point at their absolute repo paths, so the store shares the SAME src/db (and
 *     settings) module instances as any runtime module the smoke imports;
 *   - npm packages resolve from hud/ (outDir has no node_modules); `server-only` (a Next build-time guard that
 *     throws outside the react-server condition) is dropped.
 * NOVA_DATA_DIR must already point at a temp dir.
 *
 * By default `validateConfiguredLlmSelection` (does the user have this provider connected, and is the model one of
 * its models?) passes every selection through, so a store smoke can create tasks for any user with any model id
 * without seeding encrypted API keys. That check is covered by agent-task-provider-contract-smoke and the Playwright
 * agent-task API tests; pass `{ validateProviders: true }` to keep the real module.
 *
 *   const { store, taskAttachments } = loadHudTaskStore(tempDir)
 */
import fs from "node:fs"
import { builtinModules, createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

const hudRoot = path.join(repoRoot, "hud")
const hudRequire = createRequire(path.join(hudRoot, "package.json"))
const toPosix = (value) => value.replace(/\\/g, "/")
const BUILTINS = new Set(builtinModules)
const ENTRY_POINTS = ["hud/lib/agents/task-store.ts", "hud/lib/agents/task-attachments.ts"]
const SOURCE_EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"]

const PROVIDER_SELECTION = path.join(hudRoot, "lib", "integrations", "llm", "provider-selection.ts")
const PASSTHROUGH_PROVIDER_SELECTION = `"use strict"
// Smoke stub (scripts/smoke/lib/hud-task-store.mjs): every provider/model selection is accepted as given.
exports.validateConfiguredLlmSelection = (_config, provider, model) => ({ provider, model })
`

const insideHud = (absolute) => absolute === hudRoot || absolute.startsWith(hudRoot + path.sep)

/** Absolute path of a HUD source file for an import specifier, or null when it is not a HUD module. */
function resolveHudSource(specifier, fromFile) {
  let base
  if (specifier.startsWith("@/")) base = path.join(hudRoot, specifier.slice(2))
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier)
  else return null
  if (!insideHud(base)) return null
  for (const extension of ["", ...SOURCE_EXTENSIONS]) {
    const candidate = base + extension
    if (/\.tsx?$/.test(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  throw new Error(`hud-task-store: cannot resolve "${specifier}" imported by ${path.relative(repoRoot, fromFile)}`)
}

/** Runtime (non type-only) import specifiers of a TS source. Type-only imports are erased by the transpile. */
function runtimeSpecifiers(source) {
  const specifiers = []
  const statement = /^\s*(import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm
  for (const match of source.matchAll(statement)) if (!match[2]) specifiers.push(match[3])
  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specifiers.push(match[1])
  return specifiers
}

/** Every HUD source the entry points load at runtime, entry points first. */
function collectSources() {
  const queue = ENTRY_POINTS.map((relative) => path.join(repoRoot, relative))
  const seen = new Set()
  while (queue.length > 0) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of runtimeSpecifiers(fs.readFileSync(file, "utf8"))) {
      const resolved = resolveHudSource(specifier, file)
      if (resolved && !seen.has(resolved)) queue.push(resolved)
    }
  }
  return [...seen]
}

const outputPathFor = (outDir, sourceFile) =>
  path.join(outDir, path.relative(repoRoot, sourceFile)).replace(/\.tsx?$/, ".js")

function rewriteRequires(code, sourceFile, outDir) {
  return code
    .replace(/^\s*require\((["'])server-only\1\);?\s*$/gm, "")
    .replace(/require\((["'])([^"']+)\1\)/g, (match, quote, specifier) => {
      if (specifier.startsWith("node:") || BUILTINS.has(specifier)) return match
      const hudSource = resolveHudSource(specifier, sourceFile)
      if (hudSource) return `require(${quote}${toPosix(outputPathFor(outDir, hudSource))}${quote})`
      if (specifier.startsWith(".")) return `require(${quote}${toPosix(path.resolve(path.dirname(sourceFile), specifier))}${quote})`
      return `require(${quote}${toPosix(hudRequire.resolve(specifier))}${quote})`
    })
}

/** Transpile the store and its HUD dependencies into `outDir`; returns the loaded CommonJS modules. */
export function loadHudTaskStore(outDir, { validateProviders = false } = {}) {
  for (const sourceFile of collectSources()) {
    if (!validateProviders && sourceFile === PROVIDER_SELECTION) {
      const target = outputPathFor(outDir, sourceFile)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, PASSTHROUGH_PROVIDER_SELECTION, "utf8")
      continue
    }
    const output = ts.transpileModule(fs.readFileSync(sourceFile, "utf8"), {
      fileName: sourceFile,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    })
    const target = outputPathFor(outDir, sourceFile)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, rewriteRequires(output.outputText, sourceFile, outDir), "utf8")
  }
  const require = createRequire(path.join(outDir, "loader.cjs"))
  return {
    store: require("./hud/lib/agents/task-store.js"),
    taskAttachments: require("./hud/lib/agents/task-attachments.js"),
  }
}
