import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const executionModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "services", "missions", "build-execution", "index.js")).href,
);
const idempotencyModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "services", "missions", "build-idempotency", "index.js")).href,
);

const { runMissionBuildRequest } = executionModule;
const { resolveMissionBuildIdempotencyKey } = idempotencyModule;

function createDependencies(overrides = {}) {
  const state = {
    schedulerStarted: 0,
    telemetry: [],
    finalized: [],
    upserts: [],
    calendarSyncs: [],
    warnings: [],
    builtPrompts: [],
    validated: [],
  };
  const dependencies = {
    ensureMissionSchedulerStarted() {
      state.schedulerStarted += 1;
    },
    async reserveMissionBuildRequest() {
      return { status: "started", key: "mission-build:test:key" };
    },
    async finalizeMissionBuildRequest(input) {
      state.finalized.push(input);
    },
    async buildMissionFromPrompt(prompt) {
      state.builtPrompts.push(prompt);
      return {
        provider: "openai",
        model: "gpt-4.1-mini",
        mission: {
          id: "mission-1",
          label: "Daily Pulse",
          nodes: [
            { id: "trigger-1", type: "schedule-trigger", triggerTime: "07:30", triggerTimezone: "America/New_York" },
            { id: "step-1", type: "prompt-step" },
          ],
          settings: {},
        },
      };
    },
    validateMissionGraphForVersioning(mission) {
      state.validated.push(mission?.id || "");
      return [];
    },
    async upsertMission(mission, userContextId) {
      state.upserts.push({ mission, userContextId });
    },
    async syncMissionScheduleToGoogleCalendar(input) {
      state.calendarSyncs.push(input);
    },
    async emitTelemetry(payload) {
      state.telemetry.push(payload);
    },
    resolveTimezone(...candidates) {
      return candidates.find((entry) => typeof entry === "string" && entry.trim()) || "UTC";
    },
    warn(...args) {
      state.warnings.push(args.map((entry) => String(entry)).join(" "));
    },
    ...overrides,
  };
  return { state, dependencies };
}

{
  const { state, dependencies } = createDependencies();
  const result = await runMissionBuildRequest(
    {
      prompt: "Build a draft workflow",
      deploy: false,
      userContextId: "user-1",
      scope: { user: { id: "user-1" } },
    },
    dependencies,
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.deployed, false);
  assert.equal(result.body.mission.label, "Daily Pulse");
  assert.equal(state.schedulerStarted, 1);
  assert.equal(state.telemetry.some((entry) => entry.eventType === "mission.build.started"), true);
  assert.equal(state.telemetry.some((entry) => entry.eventType === "mission.build.completed"), true);
  assert.equal(state.upserts.length, 0);
  assert.equal(state.finalized.length, 1);
}

{
  const { state, dependencies } = createDependencies();
  const result = await runMissionBuildRequest(
    {
      prompt: "Build and deploy a workflow",
      deploy: true,
      timezone: "America/Chicago",
      userContextId: "user-2",
      scope: { user: { id: "user-2" } },
    },
    dependencies,
  );
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.deployed, true);
  assert.equal(result.body.mission.settings.timezone, "America/Chicago");
  assert.equal(state.telemetry.some((entry) => entry.eventType === "mission.validation.completed"), true);
  assert.equal(state.upserts.length, 1);
  assert.equal(state.calendarSyncs.length, 1);
}

{
  const { dependencies } = createDependencies({
    async reserveMissionBuildRequest() {
      return {
        status: "pending",
        key: "mission-build:test:pending",
        retryAfterMs: 1200,
      };
    },
  });
  const result = await runMissionBuildRequest(
    {
      prompt: "Build and deploy a workflow",
      deploy: true,
      userContextId: "user-3",
      scope: { user: { id: "user-3" } },
    },
    dependencies,
  );
  assert.equal(result.statusCode, 202);
  assert.equal(result.headers["Retry-After"], "2");
  assert.equal(result.body.code, "MISSION_BUILD_PENDING");
}

{
  const { dependencies } = createDependencies({
    async reserveMissionBuildRequest() {
      return {
        status: "completed",
        key: "mission-build:test:completed",
        result: { ok: true, deployed: true, missionSummary: { label: "Replay", nodeCount: 1, schedule: { time: "09:00", timezone: "UTC" } } },
      };
    },
  });
  const result = await runMissionBuildRequest(
    {
      prompt: "Build and deploy a workflow",
      deploy: true,
      userContextId: "user-4",
      scope: { user: { id: "user-4" } },
    },
    dependencies,
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.pending, false);
  assert.equal(result.body.idempotencyKey, "mission-build:test:completed");
}

{
  const { state, dependencies } = createDependencies({
    async buildMissionFromPrompt() {
      throw new Error("Invalid graph contract: missing node output.");
    },
  });
  const result = await runMissionBuildRequest(
    {
      prompt: "Build and deploy a workflow",
      deploy: true,
      userContextId: "user-5",
      scope: { user: { id: "user-5" } },
    },
    dependencies,
  );
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.validation?.blocked, true);
  assert.equal(state.telemetry.some((entry) => entry.eventType === "mission.build.failed"), true);
  assert.equal(state.finalized.length, 1);
}

const resolvedKey = resolveMissionBuildIdempotencyKey({
  prompt: "Build and deploy a workflow",
  deploy: true,
  timezone: "America/New_York",
  enabled: true,
  userContextId: "User-Alpha",
});
assert.equal(/^mission-build:user-alpha:[a-f0-9]{32}$/.test(resolvedKey), true);

console.log("[mission-build-execution:smoke] shared mission execution service is stable.");
