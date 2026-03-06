import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleUnderTest = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "services", "missions", "build-from-prompt", "index.js")).href,
);

const { runBuildMissionFromPrompt } = moduleUnderTest;

const missionFactoryCalls = [];
const llmCalls = [];

const result = await runBuildMissionFromPrompt(
  "Build a daily BTC digest for Telegram at 7:30am ET",
  {
    userId: "user-alpha",
    scope: { user: { id: "user-alpha" } },
    chatIds: ["chat-1"],
  },
  {
    async loadIntegrationsConfig() {
      return { activeLlmProvider: "openai" };
    },
    async loadIntegrationCatalog() {
      return [
        { id: "openai", kind: "llm", connected: true },
        { id: "telegram", kind: "channel", connected: true },
      ];
    },
    parseJsonObject() {
      return {
        label: "BTC Digest",
        description: "Track BTC headlines and summarize.",
        nodes: [
          { id: "n1", type: "schedule-trigger", triggerMode: "daily", triggerTime: "07:30", triggerTimezone: "America/New_York" },
          { id: "n2", type: "web-search", query: "BTC news today" },
          { id: "n3", type: "ai-summarize", prompt: "Summarize the latest BTC news.", integration: "openai", detailLevel: "standard" },
          { id: "n4", type: "telegram-output", messageTemplate: "{{$nodes.n3.output.text}}" },
        ],
        connections: [
          { id: "c1", sourceNodeId: "n1", targetNodeId: "n2" },
          { id: "c2", sourceNodeId: "n2", targetNodeId: "n3" },
          { id: "c3", sourceNodeId: "n3", targetNodeId: "n4" },
        ],
      };
    },
    async completeWithConfiguredLlm(systemText, userText) {
      llmCalls.push({ systemText, userText });
      return {
        provider: "openai",
        model: "gpt-4.1-mini",
        text: "{\"ok\":true}",
      };
    },
    isMissionAgentGraphEnabled() {
      return true;
    },
    missionUsesAgentGraph(mission) {
      return Array.isArray(mission?.nodes) && mission.nodes.some((node) => String(node.type || "").startsWith("agent-"));
    },
    validateMissionGraphForVersioning() {
      return [];
    },
    buildMission(input) {
      missionFactoryCalls.push(input);
      return {
        id: "mission-1",
        userId: input.userId,
        label: input.label,
        description: input.description,
        nodes: input.nodes,
        connections: input.connections,
        integration: input.integration,
        chatIds: input.chatIds,
        settings: {},
        status: "draft",
      };
    },
    warn() {},
  },
);

assert.equal(result.provider, "openai");
assert.equal(result.model, "gpt-4.1-mini");
assert.equal(result.mission.label, "BTC Digest");
assert.equal(result.mission.status, "draft");
assert.equal(result.mission.integration, "telegram");
assert.equal(result.mission.userId, "user-alpha");
assert.equal(Array.isArray(result.mission.nodes), true);
assert.equal(result.mission.nodes.length, 4);
assert.equal(missionFactoryCalls.length, 1);
assert.equal(llmCalls.length, 1);

console.log("[mission-build-from-prompt:smoke] shared mission prompt builder is stable.");
