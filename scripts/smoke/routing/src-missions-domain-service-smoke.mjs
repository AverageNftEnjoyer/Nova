import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const results = [];

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

async function run(name, fn) {
  try {
    await fn();
    record("PASS", name);
  } catch (error) {
    record("FAIL", name, error instanceof Error ? error.message : String(error));
  }
}

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

const missionsServiceModulePath = pathToFileURL(path.join(
  process.cwd(),
  "src",
  "runtime",
  "modules",
  "services",
  "missions",
  "index.js",
)).href;

const { runMissionsDomainService } = await import(missionsServiceModulePath);

await run("P43-C1 missions service enforces scoped context", async () => {
  const out = await runMissionsDomainService({
    text: "build me a mission",
    userContextId: "",
    conversationId: "",
    sessionKey: "",
  });
  assert.equal(out?.ok, false);
  assert.equal(out?.code, "missions.context_missing");
  assert.equal(out?.route, "workflow_build");
});

await run("P43-C2 missions service maps pending build response", async () => {
  const out = await runMissionsDomainService(
    {
      text: "build me a mission",
      userContextId: "missions-user",
      conversationId: "missions-thread",
      sessionKey: "agent:nova:hud:user:missions-user:dm:missions-thread",
      deploy: true,
      engine: "src",
    },
    {
      async runMissionBuildViaProviderAdapter() {
        return {
          ok: true,
          status: 202,
          data: { pending: true, retryAfterMs: 2500 },
          error: "",
          code: "",
        };
      },
    },
  );
  assert.equal(out?.ok, true);
  assert.equal(out?.code, "missions.pending");
  assert.equal(out?.route, "workflow_build");
  assert.equal(String(out?.reply || "").includes("already building"), true);
});

await run("P43-C3 missions service maps successful build response", async () => {
  const out = await runMissionsDomainService(
    {
      text: "build me a mission",
      userContextId: "missions-user",
      conversationId: "missions-thread",
      sessionKey: "agent:nova:hud:user:missions-user:dm:missions-thread",
      deploy: true,
      engine: "src",
    },
    {
      async runMissionBuildViaProviderAdapter() {
        return {
          ok: true,
          status: 201,
          data: {
            ok: true,
            deployed: true,
            provider: "openai",
            model: "gpt-5-mini",
            missionSummary: {
              label: "Daily AI Digest",
              nodeCount: 4,
              schedule: { time: "09:00", timezone: "America/New_York" },
            },
          },
          error: "",
          code: "",
        };
      },
    },
  );
  assert.equal(out?.ok, true);
  assert.equal(out?.code, "missions.build_ok");
  assert.equal(out?.provider, "openai");
  assert.equal(out?.model, "gpt-5-mini");
  assert.equal(out?.deployed, true);
  assert.equal(out?.stepCount, 4);
});

await run("P43-C4 missions service keeps failures lane-owned", async () => {
  const out = await runMissionsDomainService(
    {
      text: "build me a mission",
      userContextId: "missions-user",
      conversationId: "missions-thread",
      sessionKey: "agent:nova:hud:user:missions-user:dm:missions-thread",
      deploy: true,
      engine: "src",
    },
    {
      async runMissionBuildViaProviderAdapter() {
        return {
          ok: false,
          status: 0,
          data: null,
          error: "timeout",
          code: "missions.timeout",
        };
      },
    },
  );
  assert.equal(out?.ok, false);
  assert.equal(out?.route, "workflow_build");
  assert.equal(out?.code, "missions.timeout");
  assert.equal(String(out?.reply || "").includes("couldn't build"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
