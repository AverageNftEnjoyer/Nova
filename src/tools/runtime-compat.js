import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { pathToFileURL } from "url";

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

  function ensureAgentCoreBuild() {
    const distMarker = path.join(rootDir, "dist", "tools", "registry.js");
    if (fs.existsSync(distMarker)) {
      return true;
    }
    try {
      execSync("npm run build:agent-core", {
        cwd: rootDir,
        stdio: "ignore",
      });
      return fs.existsSync(distMarker);
    } catch (err) {
      console.warn(`[ToolLoop] Failed building TypeScript core: ${describeUnknownError(err)}`);
      return false;
    }
  }

  async function loadRuntimeModules() {
    if (runtimeModules) return runtimeModules;
    if (runtimeModulesPromise) return runtimeModulesPromise;

    runtimeModulesPromise = (async () => {
      const buildReady = ensureAgentCoreBuild();
      if (!buildReady) return null;

      const registryModuleUrl = pathToFileURL(path.join(rootDir, "dist", "tools", "registry.js")).href;
      const executorModuleUrl = pathToFileURL(path.join(rootDir, "dist", "tools", "executor.js")).href;
      const protocolModuleUrl = pathToFileURL(path.join(rootDir, "dist", "tools", "protocol.js")).href;
      const memoryModuleUrl = pathToFileURL(path.join(rootDir, "dist", "memory", "manager.js")).href;

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
      sourceDirs: uniqueStrings([memorySourceDir, userContextDir]),
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
          workspaceDir: rootDir,
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
