import assert from "node:assert/strict";
import fs from "node:fs";
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

const { appendDevConversationLog } = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/telemetry/dev-conversation-log/index.js")).href,
);
const { USER_CONTEXT_ROOT } = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/core/constants/index.js")).href,
);

function walkFiles(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolved = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(resolved));
      continue;
    }
    files.push(resolved);
  }
  return files;
}

function findGlobalUserLogsReferences() {
  const roots = ["src", "hud"].map((segment) => path.join(process.cwd(), segment));
  const offenders = [];
  const userLogsPattern = /\.user[\\/]+logs/i;
  for (const rootDir of roots) {
    for (const filePath of walkFiles(rootDir)) {
      if (!/\.(js|mjs|cjs|ts|tsx)$/.test(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf8");
      if (!userLogsPattern.test(content)) continue;
      offenders.push(path.relative(process.cwd(), filePath));
    }
  }
  return offenders;
}

function withMockedFs(runWithCalls) {
  const calls = {
    append: [],
    mkdir: [],
    log: [],
    warn: [],
  };
  const originalAppendFileSync = fs.appendFileSync;
  const originalMkdirSync = fs.mkdirSync;
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;

  fs.appendFileSync = (targetPath) => {
    calls.append.push(String(targetPath));
  };
  fs.mkdirSync = (targetPath) => {
    calls.mkdir.push(String(targetPath));
    return undefined;
  };
  console.log = (...args) => {
    calls.log.push(args.map((value) => String(value)).join(" "));
  };
  console.warn = (...args) => {
    calls.warn.push(args.map((value) => String(value)).join(" "));
  };

  try {
    runWithCalls(calls);
  } finally {
    fs.appendFileSync = originalAppendFileSync;
    fs.mkdirSync = originalMkdirSync;
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  }
}

await run("DCLR-1 Dev conversation log writes only to scoped user path", async () => {
  withMockedFs((calls) => {
    appendDevConversationLog({
      userContextId: "Test-User-01",
      conversationId: "test-thread",
      sessionKey: "agent:nova:hud:user:test-user-01:dm:test-thread",
      source: "hud",
      sender: "hud-user",
      route: "chat",
      userInputText: "hello nova",
      cleanedInputText: "hello nova",
      assistantReplyText: "hello",
      ok: true,
    });

    const expectedLogPath = path.join(USER_CONTEXT_ROOT, "test-user-01", "logs", "conversation-dev.jsonl");
    assert.deepEqual(calls.append, [expectedLogPath]);
    assert.deepEqual(calls.mkdir, [path.dirname(expectedLogPath)]);
    assert.equal(calls.append.some((targetPath) => targetPath.includes(path.join(".user", "logs"))), false);
    assert.equal(calls.append.some((targetPath) => targetPath.includes(path.join("archive", "logs"))), false);
  });
});

await run("DCLR-2 Dev conversation log skips writes without user context", async () => {
  withMockedFs((calls) => {
    appendDevConversationLog({
      conversationId: "missing-user-thread",
      source: "hud",
      sender: "hud-user",
      route: "chat",
      userInputText: "hello nova",
      cleanedInputText: "hello nova",
      assistantReplyText: "hello",
      ok: true,
    });

    assert.deepEqual(calls.append, []);
    assert.deepEqual(calls.mkdir, []);
  });
});

await run("DCLR-3 runtime and HUD code contain no global .user/logs paths", async () => {
  const offenders = findGlobalUserLogsReferences();
  assert.deepEqual(offenders, []);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
