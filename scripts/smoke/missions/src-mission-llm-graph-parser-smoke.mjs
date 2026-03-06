import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const parserModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "services", "missions", "llm-graph-parser", "index.js")).href,
);

const {
  parseLlmNode,
  parseLlmNodes,
  parseLlmConnections,
} = parserModule;

const scheduleNode = parseLlmNode({
  id: "n1",
  type: "schedule-trigger",
  label: "Morning",
  triggerMode: "daily",
  triggerTime: "08:30",
  triggerTimezone: "America/New_York",
}, 0);
assert.equal(scheduleNode?.type, "schedule-trigger");
assert.equal(scheduleNode?.triggerTimezone, "America/New_York");

const invalidAgentWorker = parseLlmNode({
  id: "n2",
  type: "agent-worker",
  agentId: "worker-1",
  goal: "execute",
  role: "invalid-role",
}, 1);
assert.equal(invalidAgentWorker, null);

const parsedNodes = parseLlmNodes([
  { id: "n1", type: "manual-trigger", label: "Trigger" },
  { id: "n2", type: "ai-generate", label: "Generate", prompt: "Write a summary." },
  { id: "n3", type: "unknown-type", label: "Bad node" },
]);
assert.equal(parsedNodes.nodes.length, 2);
assert.equal(parsedNodes.rejected.length, 1);
assert.equal(parsedNodes.rejected[0].type, "unknown-type");

const nodeIds = new Set(parsedNodes.nodes.map((node) => node.id));
const connections = parseLlmConnections([
  { id: "c1", sourceNodeId: "n1", targetNodeId: "n2" },
  { id: "c1", sourceNodeId: "n1", targetNodeId: "n2" },
  { id: "c2", sourceNodeId: "n2", targetNodeId: "n9" },
], nodeIds);
assert.equal(connections.length, 1);
assert.equal(connections[0].id, "c1");

console.log("[mission-llm-graph-parser:smoke] shared mission graph parser is stable.");
