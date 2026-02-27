import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HUD_ROOT = path.resolve(process.cwd(), "hud");
const SERVER_ONLY_STUB = path.resolve(process.cwd(), "scripts/utils/server-only-stub.mjs");
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"];

function resolveExisting(basePath) {
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) return basePath;
  for (const ext of EXTENSIONS) {
    const withExt = `${basePath}${ext}`;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) return withExt;
  }
  for (const ext of EXTENSIONS) {
    const indexPath = path.join(basePath, `index${ext}`);
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) return indexPath;
  }
  return "";
}

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === "server-only") {
    return { url: pathToFileURL(SERVER_ONLY_STUB).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const absBase = path.resolve(HUD_ROOT, rel);
    const resolved = resolveExisting(absBase);
    if (!resolved) {
      throw new Error(`Unable to resolve HUD alias import: ${specifier}`);
    }
    return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const isNodeBuiltin = specifier.startsWith("node:");
    if (!isRelative && !isNodeBuiltin && !specifier.endsWith(".js")) {
      try {
        return await defaultResolve(`${specifier}.js`, context, defaultResolve);
      } catch {}
    }
    if (!isRelative || !context?.parentURL) throw error;
    const parentPath = fileURLToPath(context.parentURL);
    const parentDir = path.dirname(parentPath);
    const absBase = path.resolve(parentDir, specifier);
    const resolved = resolveExisting(absBase);
    if (!resolved) throw error;
    return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }
}
