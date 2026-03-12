import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { pathToFileURL } from "url";

const NPM_BIN = "npm";

function normalizeUserContextId(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 96);
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseCsvList(values) {
  return uniqueStrings(
    String(values || "")
      .split(",")
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean),
  );
}

function resolveToolRuntimeRootDir(rootDir) {
  const fallback = path.resolve(String(rootDir || process.cwd() || "."));
  let current = fallback;
  for (let depth = 0; depth < 8; depth += 1) {
    const hasPackageJson = fs.existsSync(path.join(current, "package.json"));
    const hasTsConfig = fs.existsSync(path.join(current, "tsconfig.json"));
    if (hasPackageJson && hasTsConfig) return current;
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return fallback;
}

export function createToolRuntime(options) {
  const {
    enabled,
    memoryEnabled,
    rootDir,
    memoryDbPath,
    memorySourceDir,
    enabledTools,
    execApprovalMode,
    safeBinaries,
    webSearchProvider,
    webSearchApiKey,
    allowElevatedTools,
    allowDangerousTools,
    elevatedToolAllowlist,
    dangerousToolAllowlist,
    enforceCapabilities,
    capabilityAllowlist,
    capabilityDenylist,
    memoryConfig,
    describeUnknownError,
  } = options;

  const runtimeRootDir = resolveToolRuntimeRootDir(rootDir);
  const configuredRootDir = path.resolve(String(rootDir || process.cwd() || "."));
  if (runtimeRootDir !== configuredRootDir) {
    console.log(`[ToolLoop] Adjusted runtime root from ${configuredRootDir} to ${runtimeRootDir}`);
  }

  const sharedState = {
    initialized: false,
    initPromise: null,
    tools: [],
    memoryManager: null,
    executeToolUse: null,
    scopeId: "global",
    memoryDbPath,
    memorySourceDirs: [memorySourceDir],
  };
  const scopedStates = new Map();
  let runtimeModules = null;
  let runtimeModulesPromise = null;
  let buildBootstrapAttempted = false;
  let buildBootstrapReady = false;
  const includeSharedMemorySourceForScopedUsers =
    String(process.env.NOVA_MEMORY_INCLUDE_SHARED_SOURCE || "").trim() === "1";

  function tryBuildAgentCoreWithNpm() {
    try {
      const result = spawnSync(NPM_BIN, ["run", "build:agent-core"], {
        cwd: runtimeRootDir,
        stdio: "ignore",
        shell: false,
        windowsHide: true,
        timeout: 180000,
      });
      if (result.error || result.status !== 0) {
        const detail = result.error?.message || `exit=${String(result.status)}`;
        console.warn(`[ToolLoop] Failed building TypeScript core via npm: ${detail}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[ToolLoop] Failed building TypeScript core via npm: ${describeUnknownError(err)}`);
      return false;
    }
  }

  async function tryBuildAgentCoreInProcess() {
    try {
      const ts = await import("typescript");
      const tsconfigPath = path.join(runtimeRootDir, "tsconfig.json");
      if (!fs.existsSync(tsconfigPath)) {
        console.warn(`[ToolLoop] Missing tsconfig for in-process build at ${tsconfigPath}`);
        return false;
      }

      const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (readResult?.error) {
        const detail = ts.flattenDiagnosticMessageText(readResult.error.messageText, "\n");
        console.warn(`[ToolLoop] Failed reading tsconfig for in-process build: ${detail}`);
        return false;
      }

      const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, runtimeRootDir);
      if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
        const first = parsed.errors[0];
        const detail = ts.flattenDiagnosticMessageText(first.messageText, "\n");
        console.warn(`[ToolLoop] Failed parsing tsconfig for in-process build: ${detail}`);
        return false;
      }

      const program = ts.createProgram({
        rootNames: Array.isArray(parsed.fileNames) ? parsed.fileNames : [],
        options: parsed.options || {},
      });
      const emitResult = program.emit();
      if (emitResult.emitSkipped) {
        const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics || []);
        const first = diagnostics[0];
        const detail = first
          ? ts.flattenDiagnosticMessageText(first.messageText, "\n")
          : "emit skipped";
        console.warn(`[ToolLoop] Failed in-process TypeScript build: ${detail}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[ToolLoop] Failed in-process TypeScript build: ${describeUnknownError(err)}`);
      return false;
    }
  }

  async function ensureAgentCoreBuild() {
    const distMarker = path.join(runtimeRootDir, "dist", "tools", "core", "registry.js");
    if (fs.existsSync(distMarker)) {
      buildBootstrapAttempted = true;
      buildBootstrapReady = true;
      return true;
    }
    if (buildBootstrapAttempted && !buildBootstrapReady) return false;

    buildBootstrapAttempted = true;
    const npmBuilt = tryBuildAgentCoreWithNpm();
    if (npmBuilt && fs.existsSync(distMarker)) {
      buildBootstrapReady = true;
      return true;
    }

    const inProcessBuilt = await tryBuildAgentCoreInProcess();
    buildBootstrapReady = inProcessBuilt && fs.existsSync(distMarker);
    if (!buildBootstrapReady) {
      console.warn("[ToolLoop] Agent core build bootstrap unavailable; tool-loop runtime remains disabled until dist exists.");
    }
    return buildBootstrapReady;
  }

  function resolveBuiltModuleUrl(preferredPathSegments, fallbackPathSegments) {
    const preferred = path.join(runtimeRootDir, ...preferredPathSegments);
    if (fs.existsSync(preferred)) {
      return pathToFileURL(preferred).href;
    }
    const fallback = path.join(runtimeRootDir, ...fallbackPathSegments);
    return pathToFileURL(fallback).href;
  }

  async function loadRuntimeModules() {
    if (runtimeModules) return runtimeModules;
    if (runtimeModulesPromise) return runtimeModulesPromise;

    runtimeModulesPromise = (async () => {
      const buildReady = await ensureAgentCoreBuild();
      if (!buildReady) return null;

      const registryModuleUrl = resolveBuiltModuleUrl(
        ["dist", "tools", "core", "registry", "index.js"],
        ["dist", "tools", "core", "registry.js"],
      );
      const executorModuleUrl = resolveBuiltModuleUrl(
        ["dist", "tools", "core", "executor", "index.js"],
        ["dist", "tools", "core", "executor.js"],
      );
      const protocolModuleUrl = resolveBuiltModuleUrl(
        ["dist", "tools", "core", "protocol", "index.js"],
        ["dist", "tools", "core", "protocol.js"],
      );
      const memoryModuleUrl = resolveBuiltModuleUrl(
        ["dist", "memory", "manager", "index.js"],
        ["dist", "memory", "manager.js"],
      );

      const [{ createToolRegistry }, { executeToolUse }, protocolModule, memoryModule] = await Promise.all([
        import(registryModuleUrl),
        import(executorModuleUrl),
        import(protocolModuleUrl),
        memoryEnabled ? import(memoryModuleUrl) : Promise.resolve({ MemoryIndexManager: null }),
      ]);

      runtimeModules = {
        createToolRegistry,
        executeToolUse,
        toOpenAiToolDefinitions: protocolModule?.toOpenAiToolDefinitions,
        openAiToolCallToAnthropicToolUse: protocolModule?.openAiToolCallToAnthropicToolUse,
        MemoryIndexManager: memoryModule?.MemoryIndexManager || null,
      };
      return runtimeModules;
    })().finally(() => {
      runtimeModulesPromise = null;
    });

    return runtimeModulesPromise;
  }

  function resolveScopeId(opts = {}) {
    return normalizeUserContextId(opts.userContextId || "");
  }

  function resolveMemoryScope(scopeId) {
    if (!scopeId) {
      return {
        scopeId: "global",
        dbPath: memoryDbPath,
        sourceDirs: uniqueStrings([memorySourceDir]),
      };
    }

    const memoryRoot = path.dirname(path.resolve(memoryDbPath));
    const userContextDir = path.join(memoryRoot, "user-context", scopeId);
    return {
      scopeId,
      dbPath: path.join(userContextDir, "memory.db"),
      sourceDirs: includeSharedMemorySourceForScopedUsers
        ? uniqueStrings([memorySourceDir, userContextDir])
        : uniqueStrings([userContextDir]),
    };
  }

  async function initStateForScope(runtimeState, scope) {
    if (runtimeState.initialized) {
      return runtimeState;
    }
    if (runtimeState.initPromise) {
      return runtimeState.initPromise;
    }

    runtimeState.initPromise = (async () => {
      const modules = await loadRuntimeModules();
      if (!modules) {
        return runtimeState;
      }

      let memoryManager = null;
      if (memoryEnabled && modules.MemoryIndexManager) {
        try {
          fs.mkdirSync(path.dirname(scope.dbPath), { recursive: true });
          for (const sourceDir of scope.sourceDirs) {
            fs.mkdirSync(sourceDir, { recursive: true });
          }
          memoryManager = new modules.MemoryIndexManager({
            enabled: true,
            dbPath: scope.dbPath,
            embeddingProvider: memoryConfig.embeddingProvider,
            embeddingModel: memoryConfig.embeddingModel,
            embeddingApiKey: memoryConfig.embeddingApiKey,
            chunkSize: memoryConfig.chunkSize,
            chunkOverlap: memoryConfig.chunkOverlap,
            hybridVectorWeight: memoryConfig.hybridVectorWeight,
            hybridBm25Weight: memoryConfig.hybridBm25Weight,
            topK: memoryConfig.topK,
            syncOnSessionStart: true,
            sourceDirs: scope.sourceDirs,
          });
          memoryManager.warmSession();
        } catch (err) {
          memoryManager = null;
          console.warn(
            `[MemoryLoop] Disabled for scope=${scope.scopeId} due to init error: ${describeUnknownError(err)}`,
          );
        }
      }

      const tools = modules.createToolRegistry(
        {
          enabledTools,
          execApprovalMode,
          safeBinaries,
          webSearchProvider,
          webSearchApiKey,
        },
        {
          workspaceDir: runtimeRootDir,
          memoryManager,
        },
      );

      runtimeState.tools = Array.isArray(tools) ? tools : [];
      runtimeState.memoryManager = memoryManager;
      runtimeState.executeToolUse = (toolUse, availableTools, overridePolicy = {}) =>
        modules.executeToolUse(toolUse, availableTools, {
          source: "runtime-tool-loop",
          allowElevatedTools:
            typeof allowElevatedTools === "boolean" ? allowElevatedTools : undefined,
          allowDangerousTools:
            typeof allowDangerousTools === "boolean" ? allowDangerousTools : undefined,
          enforceCapabilities:
            typeof enforceCapabilities === "boolean" ? enforceCapabilities : undefined,
          elevatedAllowlist: parseCsvList(elevatedToolAllowlist).concat(
            parseCsvList(overridePolicy.elevatedAllowlist),
          ),
          dangerousAllowlist: parseCsvList(dangerousToolAllowlist).concat(
            parseCsvList(overridePolicy.dangerousAllowlist),
          ),
          capabilityAllowlist: parseCsvList(capabilityAllowlist).concat(
            parseCsvList(overridePolicy.capabilityAllowlist),
          ),
          capabilityDenylist: parseCsvList(capabilityDenylist).concat(
            parseCsvList(overridePolicy.capabilityDenylist),
          ),
          ...overridePolicy,
        });
      runtimeState.scopeId = scope.scopeId;
      runtimeState.memoryDbPath = scope.dbPath;
      runtimeState.memorySourceDirs = scope.sourceDirs;
      runtimeState.initialized = true;
      console.log(
        `[ToolLoop] Initialized tools=${runtimeState.tools.length}` +
        ` memory=${memoryManager ? "on" : "off"} scope=${scope.scopeId}`,
      );
      return runtimeState;
    })().finally(() => {
      runtimeState.initPromise = null;
    });

    return runtimeState.initPromise;
  }

  async function initToolRuntimeIfNeeded(opts = {}) {
    if (!enabled && !memoryEnabled) {
      return sharedState;
    }

    const scopeId = resolveScopeId(opts);
    if (!scopeId) {
      const globalScope = resolveMemoryScope("");
      return initStateForScope(sharedState, globalScope);
    }

    let scopedState = scopedStates.get(scopeId);
    if (!scopedState) {
      scopedState = {
        initialized: false,
        initPromise: null,
        tools: [],
        memoryManager: null,
        executeToolUse: null,
        scopeId,
        memoryDbPath: "",
        memorySourceDirs: [],
      };
      scopedStates.set(scopeId, scopedState);
    }
    const scope = resolveMemoryScope(scopeId);
    return initStateForScope(scopedState, scope);
  }

  function toOpenAiToolDefinitions(tools) {
    if (runtimeModules?.toOpenAiToolDefinitions) {
      return runtimeModules.toOpenAiToolDefinitions(tools);
    }
    return [];
  }

  function toOpenAiToolUseBlock(toolCall) {
    if (runtimeModules?.openAiToolCallToAnthropicToolUse) {
      return runtimeModules.openAiToolCallToAnthropicToolUse(toolCall, randomUUID());
    }
    return {
      id: String(toolCall?.id || randomUUID()),
      name: String(toolCall?.function?.name || ""),
      input: {},
      type: "tool_use",
    };
  }

  return {
    state: sharedState,
    initToolRuntimeIfNeeded,
    toOpenAiToolDefinitions,
    toOpenAiToolUseBlock,
  };
}
