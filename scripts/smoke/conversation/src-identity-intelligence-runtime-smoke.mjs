import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
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
  if (candidates.length === 1) return candidates[0];
  return "";
}

function parseJsonLines(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const userContextId = resolveSmokeUserContextId();
if (!userContextId) {
  record(
    "SKIP",
    "Identity runtime smoke requires NOVA_SMOKE_USER_CONTEXT_ID",
    "Set NOVA_SMOKE_USER_CONTEXT_ID to run real user-context conversation validation.",
  );
  const result = results[0];
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
  process.exit(0);
}

const { handleInput } = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/core/chat-handler.js")).href,
);

const nowMs = Date.now();
const conversationId = `identity-intel-${nowMs}-thread`;
const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;
const alias = `smokealias${nowMs}`;

await run("Runtime memory update writes identity snapshot and audit trail under scoped user context", async () => {
  const memoryUpdateResult = await handleInput(
    `remember that my preferred name is ${alias}`,
    {
      source: "hud",
      sender: "hud-user",
      voice: false,
      userContextId,
      conversationId,
      sessionKeyHint,
    },
  );

  assert.equal(String(memoryUpdateResult?.route || ""), "memory_update");
  assert.equal(String(memoryUpdateResult?.reply || "").trim().length > 0, true);

  const profilePath = path.join(
    process.cwd(),
    ".agent",
    "user-context",
    userContextId,
    "profile",
    "identity-intelligence.json",
  );
  const auditPath = path.join(
    process.cwd(),
    ".agent",
    "user-context",
    userContextId,
    "logs",
    "identity-intelligence.jsonl",
  );
  const profile = JSON.parse(await fsp.readFile(profilePath, "utf8"));
  const auditLines = parseJsonLines(await fsp.readFile(auditPath, "utf8"));
  const relevantAudit = auditLines.filter(
    (entry) =>
      String(entry.conversationId || "") === conversationId
      && String(entry.sessionKey || "") === sessionKeyHint,
  );

  assert.equal(profile.schemaVersion, 1);
  assert.equal(String(profile.userContextId || ""), userContextId);
  const preferredNameCandidates = Object.values(profile.stableTraits?.preferredName?.candidates || {})
    .map((candidate) => String(candidate?.value || "").toLowerCase().replace(/\s+/g, ""));
  assert.equal(
    preferredNameCandidates.some((value) => value.includes(alias.toLowerCase())),
    true,
  );
  assert.equal(relevantAudit.some((entry) => String(entry.eventType || "") === "identity_memory_update"), true);
});

await run("Runtime chat turn keeps stable scoped session and logs identity prompt hint", async () => {
  const chatResult = await handleInput(
    "Reply with one short sentence confirming identity profile is active.",
    {
      source: "hud",
      sender: "hud-user",
      voice: false,
      userContextId,
      conversationId,
      sessionKeyHint,
    },
  );

  assert.equal(String(chatResult?.sessionKey || ""), sessionKeyHint);
  assert.equal(String(chatResult?.reply || "").trim().length > 0, true);

  const sessionsPath = path.join(
    process.cwd(),
    ".agent",
    "user-context",
    userContextId,
    "state",
    "sessions.json",
  );
  const sessions = JSON.parse(await fsp.readFile(sessionsPath, "utf8"));
  const scopedEntry = sessions[sessionKeyHint];
  assert.equal(Boolean(scopedEntry?.sessionId), true);

  const transcriptPath = path.join(
    process.cwd(),
    ".agent",
    "user-context",
    userContextId,
    "transcripts",
    `${scopedEntry.sessionId}.jsonl`,
  );
  const transcriptLines = parseJsonLines(await fsp.readFile(transcriptPath, "utf8"));
  const conversationTranscript = transcriptLines.filter(
    (line) => String(line?.meta?.sessionKey || "") === sessionKeyHint,
  );
  assert.equal(conversationTranscript.length >= 2, true);

  const conversationLogPath = path.join(
    process.cwd(),
    ".agent",
    "user-context",
    userContextId,
    "logs",
    "conversation-dev.jsonl",
  );
  const conversationLog = parseJsonLines(await fsp.readFile(conversationLogPath, "utf8"));
  const scopedLogEntries = conversationLog.filter(
    (entry) =>
      String(entry.conversationId || "") === conversationId
      && String(entry.sessionKey || "") === sessionKeyHint,
  );
  assert.equal(scopedLogEntries.length > 0, true);
  assert.equal(
    scopedLogEntries.some((entry) => entry?.routing?.requestHints?.identityProfileActive === true),
    true,
  );
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
const skipCount = results.filter((result) => result.status === "SKIP").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
