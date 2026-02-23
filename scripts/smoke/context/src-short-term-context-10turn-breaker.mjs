import "dotenv/config";
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

function contains(text, part) {
  return String(text || "").toLowerCase().includes(String(part || "").toLowerCase());
}

async function main() {
  const userContextId = resolveSmokeUserContextId();
  if (!userContextId) throw new Error("Missing smoke user context id.");
  const modulePath = pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/core/chat-handler.js")).href;
  const { handleInput } = await import(modulePath);

  const runId = `stc-breaker10-${Date.now()}`;
  const conversationId = `${runId}-thread`;
  const sessionKeyHint = `agent:nova:hud:user:${userContextId}:dm:${conversationId}`;
  const turns = [
    "daily report of crypto",
    "remove the recent net cash-flow pnl proxy line from my daily report",
    "what did i just ask you to remove from the report",
    "oh wait, more detail",
    "new topic: create a mission to remind me every weekday at 8am to check sui",
    "also add discord delivery",
    "never mind",
    "oh wait, more detail",
    "refactor this js function for readability and tests",
    "oh wait, add edge cases too",
  ];

  const results = [];
  for (let i = 0; i < turns.length; i += 1) {
    const prompt = turns[i];
    const started = Date.now();
    const response = await handleInput(prompt, {
      source: "hud",
      sender: "hud-user",
      voice: false,
      userContextId,
      conversationId,
      sessionKeyHint,
    });
    results.push({
      turn: i + 1,
      prompt,
      route: String(response?.responseRoute || response?.route || "unknown"),
      ok: response?.ok !== false,
      latencyMs: Number(response?.latencyMs || Date.now() - started),
      reply: String(response?.reply || ""),
    });
  }

  const checks = [
    {
      name: "crypto removal recall works",
      pass: contains(results[2]?.reply, "remove") && contains(results[2]?.reply, "net cash-flow"),
    },
    {
      name: "crypto non-critical follow-up returns detailed report",
      pass: contains(results[3]?.reply, "detailed") || contains(results[3]?.reply, "holdings:"),
    },
    {
      name: "mission refine keeps context",
      pass: contains(results[5]?.route, "mission_confirm_refine") || contains(results[5]?.reply, "I can turn that into a mission"),
    },
    {
      name: "mission cancel resets context",
      pass:
        contains(results[6]?.route, "mission_confirm_declined")
        || contains(results[6]?.route, "mission_context_canceled")
        || contains(results[6]?.reply, "will not create a mission")
        || contains(results[6]?.reply, "canceled the mission follow-up context"),
    },
    {
      name: "post-cancel follow-up does not continue mission context",
      pass: !contains(results[7]?.route, "mission_confirm_refine"),
    },
    {
      name: "assistant follow-up keeps coding topic",
      pass: contains(results[9]?.reply, "edge") || contains(results[9]?.reply, "tests") || contains(results[9]?.reply, "cases"),
    },
  ];

  const failed = checks.filter((check) => !check.pass);
  const out = {
    runId,
    ts: new Date().toISOString(),
    userContextId,
    conversationId,
    sessionKeyHint,
    checks,
    failedChecks: failed.map((item) => item.name),
    turns: results,
  };

  const jsonPath = path.join(process.cwd(), "archive", "documents", `${runId}.json`);
  const mdPath = path.join(process.cwd(), "archive", "documents", `${runId}.md`);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");

  const md = [
    `# Short-Term Context 10-Turn Breaker`,
    ``,
    `- Run ID: \`${runId}\``,
    `- User Context: \`${userContextId}\``,
    `- Conversation: \`${conversationId}\``,
    ``,
    `## Checks`,
    ...checks.map((check) => `- [${check.pass ? "x" : " "}] ${check.name}`),
    ``,
    `## Turns`,
    ...results.map((entry) => [
      `### Turn ${entry.turn}`,
      `- Prompt: ${entry.prompt}`,
      `- Route: ${entry.route}`,
      `- OK: ${entry.ok}`,
      `- Latency: ${entry.latencyMs}ms`,
      "```text",
      entry.reply.trim(),
      "```",
    ].join("\n")),
  ].join("\n");
  fs.writeFileSync(mdPath, `${md}\n`, "utf8");

  console.log(`json=${jsonPath}`);
  console.log(`md=${mdPath}`);
  console.log(`failed_checks=${failed.length}`);
  for (const item of failed) console.log(`fail=${item.name}`);
}

main().catch((error) => {
  console.error(`FAIL src-short-term-context-10turn-breaker: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
