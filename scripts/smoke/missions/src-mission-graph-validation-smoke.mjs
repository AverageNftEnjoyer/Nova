import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const validatorModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "services", "missions", "graph-validation", "index.js")).href,
);

const { validateMissionGraphForVersioning } = validatorModule;

const validNonAgentMission = {
  nodes: [
    { id: "trigger", type: "manual-trigger", label: "Trigger" },
    { id: "step", type: "ai-generate", label: "Generate" },
    { id: "output", type: "telegram-output", label: "Output" },
  ],
  connections: [
    { id: "c1", sourceNodeId: "trigger", targetNodeId: "step" },
    { id: "c2", sourceNodeId: "step", targetNodeId: "output" },
  ],
};

assert.deepEqual(validateMissionGraphForVersioning(validNonAgentMission), []);

const agentMission = {
  nodes: [
    { id: "trigger", type: "schedule-trigger", label: "Trigger" },
    { id: "operator", type: "agent-supervisor", label: "Operator", agentId: "operator", role: "operator", goal: "Route work" },
    { id: "council", type: "agent-worker", label: "Routing Council", agentId: "routing-council", role: "routing-council", goal: "Classify work" },
    { id: "manager", type: "agent-worker", label: "Finance Manager", agentId: "finance-manager", role: "finance-manager", goal: "Delegate work" },
    { id: "worker", type: "agent-worker", label: "Worker", agentId: "worker-1", role: "worker-agent", goal: "Execute work" },
    { id: "provider", type: "provider-selector", label: "Provider", allowedProviders: ["openai"], defaultProvider: "openai", strategy: "cost" },
    { id: "audit", type: "agent-audit", label: "Audit", agentId: "audit-council", goal: "Review output" },
    { id: "output", type: "telegram-output", label: "Output" },
    { id: "handoff-1", type: "agent-handoff", label: "Op to Council", fromAgentId: "operator", toAgentId: "routing-council", reason: "delegate" },
    { id: "handoff-2", type: "agent-handoff", label: "Council to Manager", fromAgentId: "routing-council", toAgentId: "finance-manager", reason: "route" },
    { id: "handoff-3", type: "agent-handoff", label: "Manager to Worker", fromAgentId: "finance-manager", toAgentId: "worker-1", reason: "assign" },
    { id: "handoff-4", type: "agent-handoff", label: "Worker to Audit", fromAgentId: "worker-1", toAgentId: "audit-council", reason: "review" },
    { id: "handoff-5", type: "agent-handoff", label: "Audit to Op", fromAgentId: "audit-council", toAgentId: "operator", reason: "finalize" },
  ],
  connections: [
    { id: "c1", sourceNodeId: "trigger", targetNodeId: "operator" },
    { id: "c2", sourceNodeId: "operator", targetNodeId: "handoff-1" },
    { id: "c3", sourceNodeId: "handoff-1", targetNodeId: "council" },
    { id: "c4", sourceNodeId: "council", targetNodeId: "handoff-2" },
    { id: "c5", sourceNodeId: "handoff-2", targetNodeId: "manager" },
    { id: "c6", sourceNodeId: "manager", targetNodeId: "handoff-3" },
    { id: "c7", sourceNodeId: "handoff-3", targetNodeId: "worker" },
    { id: "c8", sourceNodeId: "worker", targetNodeId: "provider" },
    { id: "c9", sourceNodeId: "provider", targetNodeId: "handoff-4" },
    { id: "c10", sourceNodeId: "handoff-4", targetNodeId: "audit" },
    { id: "c11", sourceNodeId: "operator", targetNodeId: "output" },
  ],
};

const agentIssues = validateMissionGraphForVersioning(agentMission);
assert.equal(agentIssues.some((issue) => issue.code === "mission.agent.handoff_cycle_detected"), true);

const cyclicMission = {
  nodes: [
    { id: "a", type: "manual-trigger", label: "A" },
    { id: "b", type: "ai-generate", label: "B" },
  ],
  connections: [
    { id: "c1", sourceNodeId: "a", targetNodeId: "b" },
    { id: "c2", sourceNodeId: "b", targetNodeId: "a" },
  ],
};

const cyclicIssues = validateMissionGraphForVersioning(cyclicMission);
assert.equal(cyclicIssues.some((issue) => issue.code === "mission.graph_cycle_detected"), true);

const invalidAgentMission = {
  nodes: [
    { id: "operator", type: "agent-supervisor", label: "Operator", agentId: "operator", role: "operator", goal: "Route work" },
    { id: "worker", type: "agent-worker", label: "Worker", agentId: "worker-1", role: "worker-agent", goal: "Execute work" },
    { id: "audit", type: "agent-audit", label: "Audit", agentId: "audit-council", goal: "Review output" },
    { id: "provider", type: "provider-selector", label: "Provider", allowedProviders: ["openai"], defaultProvider: "openai", strategy: "cost" },
    { id: "handoff", type: "agent-handoff", label: "Bad Handoff", fromAgentId: "operator", toAgentId: "worker-1", reason: "skip" },
  ],
  connections: [],
};

const invalidIssues = validateMissionGraphForVersioning(invalidAgentMission);
assert.equal(invalidIssues.some((issue) => issue.code === "mission.agent.council_required"), true);
assert.equal(invalidIssues.some((issue) => issue.code === "mission.agent.domain_manager_required"), true);
assert.equal(invalidIssues.some((issue) => issue.code === "mission.agent.handoff_stage_violation"), true);

console.log("[mission-graph-validation:smoke] shared mission graph validation is stable.");
