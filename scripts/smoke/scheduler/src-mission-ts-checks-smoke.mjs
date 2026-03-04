import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { createRequire } from "node:module";

const nativeRequire = createRequire(import.meta.url);
const workspaceRoot = process.cwd();
const results = [];
const moduleCache = new Map();

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

function transpileSource(absPath) {
  const source = fs.readFileSync(absPath, "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: path.basename(absPath),
  }).outputText;
}

function isTsLike(absPath) {
  return absPath.endsWith(".ts") || absPath.endsWith(".tsx");
}

function resolveLocalModule(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function resolveSpecifier(requesterAbsPath, specifier) {
  if (specifier.startsWith("@/")) {
    return resolveLocalModule(path.resolve(workspaceRoot, "hud", specifier.slice(2)));
  }
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return resolveLocalModule(path.resolve(path.dirname(requesterAbsPath), specifier));
  }
  return null;
}

function createSandbox(absPath, moduleRef, overrideMap) {
  function localRequire(specifier) {
    if (Object.prototype.hasOwnProperty.call(overrideMap, specifier)) {
      return overrideMap[specifier];
    }
    if (specifier === "server-only") return {};
    const resolved = resolveSpecifier(absPath, specifier);
    if (resolved) {
      if (isTsLike(resolved)) return loadTsModule(resolved, overrideMap);
      return nativeRequire(resolved);
    }
    return nativeRequire(specifier);
  }

  return {
    module: moduleRef,
    exports: moduleRef.exports,
    require: localRequire,
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    crypto,
    __filename: absPath,
    __dirname: path.dirname(absPath),
  };
}

function loadTsModule(absPath, overrideMap = {}) {
  const normalized = path.resolve(absPath);
  if (moduleCache.has(normalized)) {
    return moduleCache.get(normalized).exports;
  }
  const compiled = transpileSource(normalized);
  const moduleRef = { exports: {} };
  moduleCache.set(normalized, moduleRef);
  const sandbox = createSandbox(normalized, moduleRef, overrideMap);
  vm.runInNewContext(compiled, sandbox, { filename: `${normalized}.cjs` });
  return moduleRef.exports;
}

async function runTsCheck(entryRelativePath, overrideMap = {}) {
  moduleCache.clear();
  const entryAbsPath = path.resolve(workspaceRoot, entryRelativePath);
  try {
    const compiled = transpileSource(entryAbsPath);
    const moduleRef = { exports: {} };
    const sandbox = createSandbox(entryAbsPath, moduleRef, overrideMap);
    const wrapped = `(async () => {\n${compiled}\n})();`;
    const runPromise = vm.runInNewContext(wrapped, sandbox, { filename: `${entryRelativePath}.check.cjs` });
    if (runPromise && typeof runPromise.then === "function") {
      await runPromise;
    }
    record("PASS", entryRelativePath);
  } catch (error) {
    record("FAIL", entryRelativePath, error instanceof Error ? error.message : String(error));
  }
}

await runTsCheck("hud/app/missions/hooks/__tests__/mission-graph-shape.check.ts");
await runTsCheck(
  "hud/lib/missions/workflow/executors/__tests__/agent-executors.check.ts",
  {
    "../../store": { loadMissions: async () => [] },
  },
);
await runTsCheck("hud/lib/missions/workflow/versioning/__tests__/versioning.check.ts");

const passCount = results.filter((entry) => entry.status === "PASS").length;
const failCount = results.filter((entry) => entry.status === "FAIL").length;
const skipCount = results.filter((entry) => entry.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
