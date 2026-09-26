// Packaging smokes load the packaged app from hud/dist/win-unpacked, which sits INSIDE the repo. Node's
// resolver (require and import alike) keeps walking up parent directories when a package or file is not
// found, so a module that packaging dropped or pruned would silently resolve from the repo's own
// hud/node_modules or root node_modules, and the smoke would pass against a build that fails once
// installed. (Seen for real: a pruned next/dist/compiled/webpack file resolved from hud/node_modules.)
//
// This guard makes those resolutions fail with the same "module not found" error an installed app gets,
// so the smoke exercises exactly the installed behaviour: optional requires take their fallback
// (e.g. Next's `@opentelemetry/api` probe falls back to its compiled copy) and required modules fail the
// smoke. Blocked specifiers are reported for information.
// Two hooks, because neither covers everything: module.registerHooks (Node >= 22.15 / 23.5) sees
// import and require(), but not require.resolve(), which Next uses to probe for build-time files; the
// CommonJS resolver (Module._resolveFilename) backs both require() and require.resolve(). Next's own
// require-hook wraps _resolveFilename later and still calls through this one.
// Child processes the smokes spawn are not covered.
import Module, { registerHooks } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * @param {{ repoRoot: string }} opts
 * @returns {{ blocked: () => string[] }}
 */
export function installPackageResolutionGuard({ repoRoot }) {
  if (typeof registerHooks !== "function") {
    throw new Error("module.registerHooks is unavailable; the packaging smokes need Node >= 22.15.")
  }
  const forbidden = [
    path.join(repoRoot, "hud", "node_modules"),
    path.join(repoRoot, "node_modules"),
  ].map((dir) => dir.toLowerCase() + path.sep)
  const blocked = new Set()
  const isForbidden = (file) => forbidden.some((dir) => file.toLowerCase().startsWith(dir))
  const notFound = (specifier, parent, file, code) => {
    blocked.add(`${specifier} (from ${parent})`)
    const err = new Error(
      `Cannot find module '${specifier}' inside the packaged app (it only resolved from the repo at ${file}; imported from ${parent}).`,
    )
    err.code = code
    return err
  }

  const originalResolveFilename = Module._resolveFilename
  if (typeof originalResolveFilename !== "function") {
    throw new Error("Module._resolveFilename is unavailable; cannot confine require.resolve().")
  }
  Module._resolveFilename = function confinedResolveFilename(request, parent, ...rest) {
    const file = originalResolveFilename.call(this, request, parent, ...rest)
    if (typeof file === "string" && path.isAbsolute(file) && isForbidden(file)) {
      throw notFound(request, parent?.filename || "(entry)", file, "MODULE_NOT_FOUND")
    }
    return file
  }

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context)
      if (!result?.url?.startsWith("file:")) return result
      const file = fileURLToPath(result.url)
      if (!isForbidden(file)) return result
      const parent = context?.parentURL ? fileURLToPath(context.parentURL) : "(entry)"
      const isRequire = Array.isArray(context?.conditions) && context.conditions.includes("require")
      throw notFound(specifier, parent, file, isRequire ? "MODULE_NOT_FOUND" : "ERR_MODULE_NOT_FOUND")
    },
  })
  return { blocked: () => [...blocked] }
}
