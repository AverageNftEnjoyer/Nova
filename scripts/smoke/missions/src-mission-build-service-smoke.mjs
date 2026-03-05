import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const serviceModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "services", "missions", "build-service", "index.js")).href,
);

const {
  normalizeMissionBuildInput,
  buildMissionBuildIdempotencyKey,
  summarizeMissionBuildPayload,
  buildMissionBuildAssistantReply,
  buildMissionBuildResponseBase,
} = serviceModule;

const normalized = normalizeMissionBuildInput({
  prompt: "  Build me a daily market mission  ",
  deploy: "true",
  engine: " SRC ",
  timezone: " America/New_York ",
  enabled: undefined,
  userContextId: "User-42",
  conversationId: "Thread 9",
});

assert.equal(normalized.prompt, "Build me a daily market mission");
assert.equal(normalized.deploy, true);
assert.equal(normalized.engine, "src");
assert.equal(normalized.timezone, "America/New_York");
assert.equal(normalized.enabled, true);
assert.equal(normalized.userContextId, "user-42");
assert.equal(normalized.conversationId, "thread-9");

const keyA = buildMissionBuildIdempotencyKey({
  userContextId: "User-42",
  conversationId: "Thread 9",
  prompt: "Build me a daily market mission",
  deploy: true,
  engine: "src",
});
const keyB = buildMissionBuildIdempotencyKey({
  userContextId: "user-42",
  conversationId: "thread-9",
  prompt: " Build   me a daily market mission ",
  deploy: true,
  engine: "SRC",
});
assert.equal(keyA, keyB);

const payload = {
  deployed: true,
  provider: "openai",
  model: "gpt-4.1-mini",
  missionSummary: {
    label: "Daily Market Pulse",
    nodeCount: 7,
    schedule: {
      time: "07:30",
      timezone: "America/New_York",
    },
  },
  mission: {
    label: "Daily Market Pulse",
    nodes: Array.from({ length: 7 }, (_, index) => ({ id: `n${index}` })),
  },
};

const summary = summarizeMissionBuildPayload(payload);
assert.equal(summary.deployed, true);
assert.equal(summary.label, "Daily Market Pulse");
assert.equal(summary.stepCount, 7);
assert.equal(summary.scheduleTime, "07:30");
assert.equal(summary.scheduleTimezone, "America/New_York");

const reply = buildMissionBuildAssistantReply(payload);
assert.equal(reply.includes('Built and deployed "Daily Market Pulse"'), true);
assert.equal(reply.includes("07:30 America/New_York"), true);

const responseBase = buildMissionBuildResponseBase({
  mission: {
    label: "Daily Market Pulse",
    description: "Morning market digest",
    integration: "telegram",
    nodes: Array.from({ length: 7 }, (_, index) => ({ id: `n${index}` })),
  },
  provider: "openai",
  model: "gpt-4.1-mini",
  debug: "server_llm=openai model=gpt-4.1-mini",
  scheduleTime: "07:30",
  scheduleTimezone: "America/New_York",
});
assert.equal(responseBase.ok, true);
assert.equal(responseBase.missionSummary.label, "Daily Market Pulse");
assert.equal(responseBase.missionSummary.nodeCount, 7);
assert.equal(responseBase.missionSummary.schedule.time, "07:30");

console.log("[mission-build-service:smoke] shared mission build contract is stable.");
