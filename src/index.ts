import path from "node:path";
import { loadConfig } from "./config/index.js";
import { runAgentTurn } from "./agent/runner.js";
import { SessionStore } from "./session/store.js";
import { MemoryIndexManager } from "./memory/manager.js";
import { discoverSkills } from "./skills/discovery.js";
import { createToolRegistry } from "./tools/registry.js";

async function main() {
  const config = loadConfig();
  const sessionStore = new SessionStore(config.session);
  const memoryManager = config.memory.enabled ? new MemoryIndexManager(config.memory) : null;
  const skills = await discoverSkills([path.join(config.agent.workspace, "skills")]);
  const tools = createToolRegistry(config.tools, {
    workspaceDir: config.agent.workspace,
    memoryManager,
  });

  if (memoryManager) {
    await memoryManager.indexDirectory(path.join(config.agent.workspace, "memory"));
  }

  const result = await runAgentTurn(
    config,
    sessionStore,
    memoryManager,
    tools,
    skills,
    {
      text: "Hello, what can you help me with?",
      senderId: "user1",
      channel: "api",
      chatType: "direct",
      timestamp: Date.now(),
    },
  );

  console.log(result.response);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
