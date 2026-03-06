import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  clearShortTermContextState,
  readShortTermContextState,
  upsertShortTermContextState,
} from "../../../src/runtime/modules/chat/core/short-term-context-engine/index.js";
import { USER_CONTEXT_ROOT } from "../../../src/runtime/core/constants/index.js";

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

await run("Calendar, voice, and tts short-term contexts persist to user-scoped state", async () => {
  const userContextId = "smoke-user-context-persist";
  const conversationId = "smoke-thread-persist";
  const domains = ["calendar", "voice", "tts"];

  for (const domainId of domains) {
    clearShortTermContextState({ userContextId, conversationId, domainId });
    const upserted = upsertShortTermContextState({
      userContextId,
      conversationId,
      domainId,
      topicAffinityId: `${domainId}_general`,
      slots: { smoke: `${domainId}-slot` },
    });
    assert.equal(String(upserted?.topicAffinityId || ""), `${domainId}_general`);
    const loaded = readShortTermContextState({ userContextId, conversationId, domainId });
    assert.equal(String(loaded?.slots?.smoke || ""), `${domainId}-slot`);
  }

  const storePath = path.join(
    USER_CONTEXT_ROOT,
    userContextId,
    "state",
    "short-term-context-state.json",
  );
  assert.equal(fs.existsSync(storePath), true, "expected short-term context state store file");
  const raw = fs.readFileSync(storePath, "utf8");
  assert.equal(raw.includes(`${conversationId}::calendar`), true);
  assert.equal(raw.includes(`${conversationId}::voice`), true);
  assert.equal(raw.includes(`${conversationId}::tts`), true);
});

await run("Persistent short-term context clearing is scoped by user and conversation", async () => {
  const domainId = "calendar";
  const sharedConversationId = "shared-thread";
  const userA = "smoke-user-a";
  const userB = "smoke-user-b";

  upsertShortTermContextState({
    userContextId: userA,
    conversationId: sharedConversationId,
    domainId,
    topicAffinityId: "calendar_general",
    slots: { marker: "user-a" },
  });
  upsertShortTermContextState({
    userContextId: userB,
    conversationId: sharedConversationId,
    domainId,
    topicAffinityId: "calendar_general",
    slots: { marker: "user-b" },
  });

  clearShortTermContextState({
    userContextId: userA,
    conversationId: sharedConversationId,
    domainId,
  });

  const aState = readShortTermContextState({
    userContextId: userA,
    conversationId: sharedConversationId,
    domainId,
  });
  const bState = readShortTermContextState({
    userContextId: userB,
    conversationId: sharedConversationId,
    domainId,
  });
  assert.equal(aState, null);
  assert.equal(String(bState?.slots?.marker || ""), "user-b");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
