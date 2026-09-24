/**
 * Loads the HUD agent-task store (hud/lib/agents/task-store.ts) in plain Node for smoke tests.
 *
 * The TypeScript sources the store needs are transpiled to CommonJS inside `outDir`, and their relative imports of
 * runtime modules under src/ are rewritten to absolute paths, so the store shares the SAME src/db (and settings)
 * module instances as any runtime module the smoke imports. NOVA_DATA_DIR must already point at a temp dir.
 *
 *   const { store, taskAttachments } = loadHudTaskStore(tempDir)
 */
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

const toPosix = (value) => value.replace(/\\/g, "/")

/** Absolute paths of the src/ modules the HUD store imports, keyed by the relative specifier used in the TS source. */
export const HUD_TASK_STORE_SRC_REWRITES = Object.freeze({
  "../../../src/db/index.js": toPosix(path.join(repoRoot, "src", "db", "index.js")),
  "../../../src/db/agent-task-budget-events.js": toPosix(path.join(repoRoot, "src", "db", "agent-task-budget-events.js")),
  "../../../src/db/paths.js": toPosix(path.join(repoRoot, "src", "db", "paths.js")),
  "../../../../src/providers/pricing/index.js": toPosix(path.join(repoRoot, "src", "providers", "pricing", "index.js")),
  "../../../src/runtime/modules/agent-tasks/budget-settings/index.js": toPosix(
    path.join(repoRoot, "src", "runtime", "modules", "agent-tasks", "budget-settings", "index.js"),
  ),
})

const HUD_TASK_STORE_SOURCES = [
  "hud/lib/agents/types.ts",
  "hud/lib/agents/task-events.ts",
  "hud/lib/agents/task-stats.ts",
  "hud/lib/agents/task-attachments.ts",
  "hud/lib/git/worktree-manager.ts",
  "hud/lib/agents/task-store.ts",
  "hud/app/integrations/constants/types.ts",
  "hud/app/integrations/constants/pricing.ts",
  "hud/app/integrations/constants/openai-models.ts",
  "hud/app/integrations/constants/claude-models.ts",
  "hud/app/integrations/constants/grok-models.ts",
  "hud/app/integrations/constants/gemini-models.ts",
]

/** Transpile the store and its HUD dependencies into `outDir`; returns the loaded CommonJS modules. */
export function loadHudTaskStore(outDir) {
  for (const relativePath of HUD_TASK_STORE_SOURCES) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    })
    let rewritten = output.outputText
    for (const [specifier, absolute] of Object.entries(HUD_TASK_STORE_SRC_REWRITES)) {
      rewritten = rewritten.split(specifier).join(absolute)
    }
    const target = path.join(outDir, relativePath.replace(/\.ts$/, ".js"))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, rewritten, "utf8")
  }
  const require = createRequire(path.join(outDir, "loader.cjs"))
  return {
    store: require("./hud/lib/agents/task-store.js"),
    taskAttachments: require("./hud/lib/agents/task-attachments.js"),
  }
}
