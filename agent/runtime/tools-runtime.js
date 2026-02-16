import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { pathToFileURL } from "url";

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
    memoryConfig,
    describeUnknownError,
  } = options;

  const state = {
    initialized: false,
    initPromise: null,
    tools: [],
    memoryManager: null,
    executeToolUse: null,
  };

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

  async function initToolRuntimeIfNeeded() {
    if (!enabled && !memoryEnabled) {
      return state;
    }
    if (state.initialized) {
      return state;
    }
    if (state.initPromise) {
      return state.initPromise;
    }

    state.initPromise = (async () => {
      const buildReady = ensureAgentCoreBuild();
      if (!buildReady) {
        return state;
      }

      const registryModuleUrl = pathToFileURL(path.join(rootDir, "dist", "tools", "registry.js")).href;
      const executorModuleUrl = pathToFileURL(path.join(rootDir, "dist", "tools", "executor.js")).href;
      const memoryModuleUrl = pathToFileURL(path.join(rootDir, "dist", "memory", "manager.js")).href;

      const [{ createToolRegistry }, { executeToolUse }, memoryModule] = await Promise.all([
        import(registryModuleUrl),
        import(executorModuleUrl),
        memoryEnabled ? import(memoryModuleUrl) : Promise.resolve({ MemoryIndexManager: null }),
      ]);

      let memoryManager = null;
      if (memoryEnabled && memoryModule?.MemoryIndexManager) {
        try {
          fs.mkdirSync(path.dirname(memoryDbPath), { recursive: true });
          fs.mkdirSync(memorySourceDir, { recursive: true });
          memoryManager = new memoryModule.MemoryIndexManager({
            enabled: true,
            dbPath: memoryDbPath,
            embeddingProvider: memoryConfig.embeddingProvider,
            embeddingModel: memoryConfig.embeddingModel,
            embeddingApiKey: memoryConfig.embeddingApiKey,
            chunkSize: memoryConfig.chunkSize,
            chunkOverlap: memoryConfig.chunkOverlap,
            hybridVectorWeight: memoryConfig.hybridVectorWeight,
            hybridBm25Weight: memoryConfig.hybridBm25Weight,
            topK: memoryConfig.topK,
            syncOnSessionStart: true,
            sourceDirs: [memorySourceDir],
          });
          memoryManager.warmSession();
        } catch (err) {
          memoryManager = null;
          console.warn(`[MemoryLoop] Disabled due to init error: ${describeUnknownError(err)}`);
        }
      }

      const tools = createToolRegistry(
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

      state.tools = Array.isArray(tools) ? tools : [];
      state.memoryManager = memoryManager;
      state.executeToolUse = executeToolUse;
      state.initialized = true;
      console.log(`[ToolLoop] Initialized tools=${state.tools.length} memory=${memoryManager ? "on" : "off"}`);
      return state;
    })().finally(() => {
      state.initPromise = null;
    });

    return state.initPromise;
  }

  function toOpenAiToolDefinitions(tools) {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters:
          tool.input_schema && typeof tool.input_schema === "object"
            ? tool.input_schema
            : { type: "object", properties: {} },
      },
    }));
  }

  function toOpenAiToolUseBlock(toolCall) {
    let parsedInput = {};
    const raw = String(toolCall?.function?.arguments || "").trim();
    if (raw) {
      try {
        parsedInput = JSON.parse(raw);
      } catch {
        parsedInput = { _raw: raw };
      }
    }
    return {
      id: String(toolCall?.id || randomUUID()),
      name: String(toolCall?.function?.name || ""),
      input: parsedInput,
      type: "tool_use",
    };
  }

  return {
    state,
    initToolRuntimeIfNeeded,
    toOpenAiToolDefinitions,
    toOpenAiToolUseBlock,
  };
}
