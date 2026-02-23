import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function resolveSmokeUserContextId() {
  const explicit = String(
    process.env.NOVA_SMOKE_USER_CONTEXT_ID
    || process.env.NOVA_USER_CONTEXT_ID
    || process.env.USER_CONTEXT_ID
    || "",
  ).trim();
  if (explicit) return explicit;
  const root = path.join(process.cwd(), ".agent", "user-context");
  if (!fs.existsSync(root)) return "";
  const candidates = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .filter(Boolean);
  const withIntegrationsConfig = candidates.filter((name) =>
    fs.existsSync(path.join(root, name, "integrations-config.json")));
  if (withIntegrationsConfig.length > 0) return withIntegrationsConfig[0];
  return candidates[0] || "";
}

async function main() {
  const userA = resolveSmokeUserContextId();
  if (!userA) {
    throw new Error("Missing smoke user context id.");
  }
  const userB = `isolation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const chatHandlerModule = await import(
    pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/core/chat-handler.js")).href,
  );
  const { handleInput } = chatHandlerModule;
  const sender = "hud-user";
  const source = "hud";

  const t1Convo = `dedupe-explicit-${Date.now()}`;
  const t1Session = `agent:nova:hud:user:${userA}:dm:${t1Convo}`;
  const firstReport = await handleInput("daily report of crypto", {
    source,
    sender,
    voice: false,
    userContextId: userA,
    conversationId: t1Convo,
    sessionKeyHint: t1Session,
  });
  const secondReport = await handleInput("daily report of crypto", {
    source,
    sender,
    voice: false,
    userContextId: userA,
    conversationId: t1Convo,
    sessionKeyHint: t1Session,
  });
  assert.equal(String(firstReport?.reply || "").trim().length > 0, true, "first explicit report reply must be non-empty");
  assert.equal(String(secondReport?.reply || "").trim().length > 0, true, "repeated explicit report reply must be non-empty");
  assert.notEqual(String(secondReport?.route || secondReport?.responseRoute || ""), "duplicate_skipped");

  const t2Convo = `dedupe-spam-${Date.now()}`;
  const t2Session = `agent:nova:hud:user:${userA}:dm:${t2Convo}`;
  await handleInput("hello there", {
    source,
    sender,
    voice: false,
    userContextId: userA,
    conversationId: t2Convo,
    sessionKeyHint: t2Session,
  });
  const dupSpam = await handleInput("hello there", {
    source,
    sender,
    voice: false,
    userContextId: userA,
    conversationId: t2Convo,
    sessionKeyHint: t2Session,
  });
  assert.equal(String(dupSpam?.route || dupSpam?.responseRoute || ""), "duplicate_skipped");
  assert.equal(String(dupSpam?.reply || "").trim(), "");

  const t3Convo = `dedupe-fallback-${Date.now()}`;
  const t3Session = `agent:nova:hud:user:${userA}:dm:${t3Convo}`;
  const duplicateMessageId = `dup-msg-${Date.now()}`;
  await handleInput("hello", {
    source,
    sender,
    voice: false,
    userContextId: userA,
    conversationId: t3Convo,
    sessionKeyHint: t3Session,
    inboundMessageId: duplicateMessageId,
  });
  const fallbackReport = await handleInput("crypto daily status", {
    source,
    sender,
    voice: false,
    userContextId: userA,
    conversationId: t3Convo,
    sessionKeyHint: t3Session,
    inboundMessageId: duplicateMessageId,
  });
  assert.equal(String(fallbackReport?.reply || "").trim().length > 0, true, "duplicate report fallback must be non-empty");
  assert.notEqual(String(fallbackReport?.route || fallbackReport?.responseRoute || ""), "duplicate_skipped");

  const isoConvo = `dedupe-isolation-${Date.now()}`;
  const isoSessionA = `agent:nova:hud:user:${userA}:dm:${isoConvo}`;
  await handleInput("daily report of crypto", {
    source,
    sender,
    voice: false,
    userContextId: userA,
    conversationId: isoConvo,
    sessionKeyHint: isoSessionA,
  });
  const isoSessionB = `agent:nova:hud:user:${userB}:dm:${isoConvo}`;
  const isoMessageId = `iso-msg-${Date.now()}`;
  await handleInput("hello", {
    source,
    sender,
    voice: false,
    userContextId: userB,
    conversationId: isoConvo,
    sessionKeyHint: isoSessionB,
    inboundMessageId: isoMessageId,
  });
  const userBFallback = await handleInput("crypto daily status", {
    source,
    sender,
    voice: false,
    userContextId: userB,
    conversationId: isoConvo,
    sessionKeyHint: isoSessionB,
    inboundMessageId: isoMessageId,
  });
  assert.notEqual(String(userBFallback?.route || userBFallback?.responseRoute || ""), "duplicate_report_replayed");

  console.log("PASS src-coinbase-dedupe-report-guards-smoke");
  console.log(`firstRoute=${String(firstReport?.route || firstReport?.responseRoute || "")}`);
  console.log(`secondRoute=${String(secondReport?.route || secondReport?.responseRoute || "")}`);
  console.log(`fallbackRoute=${String(fallbackReport?.route || fallbackReport?.responseRoute || "")}`);
  console.log(`userBRoute=${String(userBFallback?.route || userBFallback?.responseRoute || "")}`);
}

main().catch((error) => {
  console.error(`FAIL src-coinbase-dedupe-report-guards-smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
