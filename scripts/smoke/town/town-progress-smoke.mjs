/**
 * Nova City progression engine (hud/lib/town) against a scratch nova.db with seeded rows.
 *
 *   TW-1  Empty user: level 1, 0 XP, every building an empty lot, tutorial active on "Meet Nova", only the
 *         "founded" welcome event.
 *   TW-2  Tutorial control: skip hides the tutorial, restart brings it back, finish ends it; all persisted.
 *   TW-3  XP math on seeded activity: every source count, per-source XP, quest and daily rewards, total, level,
 *         level bounds and title; starter skills, failed tasks and failed tool runs earn nothing.
 *   TW-4  Buildings: level 0 when disconnected, 1..3 from their own uses (tool-name prefix, LLM provider).
 *   TW-5  Events: the baseline is not replayed; new quest completions, building level-ups and one level-up event fire
 *         once, survive recomputation without duplicates, and are gone after ack (ack is idempotent).
 *   TW-6  Nothing resets: deleting rows (pruned tool runs, deleted notes) and disconnecting an integration never lower
 *         XP; the state survives a cold cache.
 *   TW-7  Daily quests roll over at local midnight of the viewer's zone; yesterday's daily XP stays banked.
 *   TW-8  Cache: repeat reads within the TTL return the cached snapshot; ack invalidates it.
 *   TW-9  Ack request validation.
 *   TW-10 Cost: the per-user queries use their indexes (no full scans of the big tables).
 *
 * The town modules are transpiled with `typescript` and loaded in plain Node (technique of
 * scripts/smoke/lib/hud-task-store.mjs), sharing src/db with this script.
 *
 * Usage: node scripts/smoke/town/town-progress-smoke.mjs   (or npm run smoke:town)
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import { isolatedDataDir } from "../lib/isolated-data-dir.mjs";
import { repoRoot } from "../lib/hud-task-store.mjs";

const toPosix = (value) => value.replace(/\\/g, "/");
const hudRoot = path.join(repoRoot, "hud");

// ── Load the town engine (TypeScript → CommonJS; imports that leave hud/ point at the shared src/ modules) ────

const TOWN_SOURCES = [
  "hud/lib/integrations/navigation.ts",
  "hud/lib/analytics/time-zone.ts",
  "hud/lib/workspace/skills/service.ts",
  "hud/lib/town/types.ts",
  "hud/lib/town/rules.ts",
  "hud/lib/town/quests.ts",
  "hud/lib/town/state.ts",
  "hud/lib/town/stats.ts",
  "hud/lib/town/progress.ts",
];

function loadTown(outDir) {
  for (const relativePath of TOWN_SOURCES) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.ok(!source.includes('"server-only"'), `${relativePath} must stay importable outside Next (no server-only)`);
    const sourceDir = path.dirname(path.join(repoRoot, relativePath));
    const output = ts
      .transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      })
      .outputText.replace(/require\((["'])(\.{1,2}\/[^"']+)\1\)/g, (match, quote, specifier) => {
        const resolved = path.resolve(sourceDir, specifier);
        const insideHud = resolved.startsWith(hudRoot + path.sep);
        return insideHud ? match : `require(${quote}${toPosix(resolved)}${quote})`;
      });
    assert.ok(!/require\("@\//.test(output), `${relativePath} must not import "@/..." at runtime`);
    const target = path.join(outDir, relativePath.replace(/\.ts$/, ".js"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, "utf8");
  }
  const require = createRequire(path.join(outDir, "loader.cjs"));
  return {
    progress: require("./hud/lib/town/progress.js"),
    rules: require("./hud/lib/town/rules.js"),
    state: require("./hud/lib/town/state.js"),
  };
}

const { getDb, kvGet } = await import(pathToFileURL(path.join(repoRoot, "src/db/index.js")).href);
const { resolveUserContextRoot } = await import(pathToFileURL(path.join(repoRoot, "src/db/paths.js")).href);
const { progress: town, rules, state: townState } = loadTown(path.join(isolatedDataDir, "town-smoke-out"));

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

let failures = 0;
async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error?.stack || error}`);
  }
}

const TZ = "UTC";
/** Fixed "now" (UTC noon) so "today" is deterministic; seeded rows are placed relative to it. */
const NOW = new Date(Date.UTC(2026, 8, 30, 12, 0, 0));
const at = (offsetMinutes) => new Date(NOW.getTime() + offsetMinutes * 60_000).toISOString();
const TODAY = at(-60);
const TWO_DAYS_AGO = at(-2 * 24 * 60);

const db = getDb();
let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;

function seedTask(userId, status, completedAt) {
  db.prepare(
    `INSERT INTO agent_tasks (user_id, id, name, prompt, agent, model, status, priority, permission_mode, progress,
                              tokens_in, tokens_out, cost_usd, created_at, updated_at, completed_at)
     VALUES (?, ?, 'Task', 'Do it', 'nova', 'claude-sonnet-5', ?, 'normal', 'default', 100, 0, 0, 0, ?, ?, ?)`,
  ).run(userId, nextId("task"), status, TWO_DAYS_AGO, completedAt ?? TWO_DAYS_AGO, completedAt ?? null);
}
function seedThread(userId, createdAt = TODAY) {
  const id = nextId("thread");
  db.prepare(`INSERT INTO threads (user_id, id, title, created_at, updated_at) VALUES (?, ?, 'Chat', ?, ?)`).run(userId, id, createdAt, createdAt);
  return id;
}
function seedMessage(userId, threadId, role, createdAt = TODAY) {
  db.prepare(`INSERT INTO messages (user_id, thread_id, id, role, content, created_at) VALUES (?, ?, ?, ?, 'hi', ?)`).run(
    userId, threadId, nextId("msg"), role, createdAt,
  );
}
function seedNote(userId, updatedAt = TODAY) {
  db.prepare(`INSERT INTO notes (user_id, id, content, created_at, updated_at) VALUES (?, ?, 'note', ?, ?)`).run(
    userId, nextId("note"), updatedAt, updatedAt,
  );
}
function seedDeployment(userId, runStatuses) {
  const id = nextId("dep");
  db.prepare(
    `INSERT INTO deployments (user_id, id, kind, status, title, outcome, created_at, updated_at)
     VALUES (?, ?, 'task', 'active', 'Deploy', 'Outcome', ?, ?)`,
  ).run(userId, id, TODAY, TODAY);
  for (const status of runStatuses) {
    db.prepare(
      `INSERT INTO deployment_runs (user_id, id, deployment_id, deployment_revision, status, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
    ).run(userId, nextId("run"), id, status, TODAY, TODAY);
  }
}
function seedToolRun(userId, toolName, status = "success", createdAt = TODAY) {
  db.prepare(`INSERT INTO tool_runs (user_id, id, tool_name, status, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    userId, nextId("tool"), toolName, status, createdAt,
  );
}
function seedLlm(userId, provider, n) {
  const stmt = db.prepare(
    `INSERT INTO llm_usage (user_id, id, ts, source, provider, model, input_tokens, output_tokens)
     VALUES (?, ?, ?, 'chat', ?, 'm', 10, 10)`,
  );
  for (let i = 0; i < n; i++) stmt.run(userId, nextId("llm"), TODAY, provider);
}
function seedSkill(userId, name) {
  const dir = path.join(resolveUserContextRoot(), userId, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\n`, "utf8");
}

const build = (userId, connected, now = NOW) =>
  town.buildTownProgress(userId, { timeZone: TZ, connected: new Set(connected), now, fresh: true });
const source = (progress, id) => progress.sources.find((entry) => entry.id === id);
const quest = (progress, id) => progress.quests.find((entry) => entry.id === id);
const building = (progress, key) => progress.buildings.find((entry) => entry.integration === key);
const eventIds = (progress) => progress.pendingEvents.map((event) => event.id).sort();

// ── TW-1 / TW-2 ─────────────────────────────────────────────────────────────────────────────────────────────

await run("TW-1 empty user starts as a level-1 hamlet with the tutorial on Meet Nova", () => {
  const p = build("empty-user", []);
  assert.equal(p.level.level, 1);
  assert.equal(p.level.xp, 0);
  assert.equal(p.level.levelStartXp, 0);
  assert.equal(p.level.nextLevelXp, 60);
  assert.equal(p.level.title, "Hamlet");
  assert.ok(p.sources.every((entry) => entry.count === 0 && entry.xp === 0));
  assert.ok(p.buildings.length === 16 && p.buildings.every((b) => b.level === 0 && !b.connected && b.nextLevelUses === null));
  assert.deepEqual(p.tutorial, { active: true, currentQuestId: "tutorial-meet-nova", skipped: false });
  const tutorial = p.quests.filter((q) => q.category === "tutorial");
  assert.equal(tutorial[0].status, "active");
  assert.ok(tutorial.slice(1).every((q) => q.status === "locked"));
  assert.deepEqual(quest(p, "tutorial-meet-nova").target, { place: "chat" });
  assert.equal(p.quests.filter((q) => q.category === "daily").length, 4);
  assert.ok(p.quests.every((q) => q.status !== "completed"));
  assert.deepEqual(eventIds(p), ["founded"]);
  assert.equal(p.population, 3);
});

await run("TW-2 tutorial skip / restart / finish persist", () => {
  town.applyTownAck("empty-user", { tutorial: "skip" });
  let p = build("empty-user", []);
  assert.deepEqual(p.tutorial, { active: false, currentQuestId: "tutorial-meet-nova", skipped: true });
  assert.equal(kvGet("empty-user", "town-progress", "state").tutorial.skipped, true);
  town.applyTownAck("empty-user", { tutorial: "restart" });
  p = build("empty-user", []);
  assert.deepEqual(p.tutorial, { active: true, currentQuestId: "tutorial-meet-nova", skipped: false });
  town.applyTownAck("empty-user", { tutorial: "finish" });
  p = build("empty-user", []);
  assert.equal(p.tutorial.active, false);
  assert.equal(p.tutorial.skipped, false);
  // Quests keep working after the tutorial ends.
  const thread = seedThread("empty-user");
  seedMessage("empty-user", thread, "user");
  p = build("empty-user", []);
  assert.equal(quest(p, "tutorial-meet-nova").status, "completed");
  assert.equal(p.tutorial.currentQuestId, "tutorial-connect-ai");
  assert.equal(p.tutorial.active, false);
});

// ── TW-3 / TW-4: seeded activity ────────────────────────────────────────────────────────────────────────────

const U = "town-user";
{
  const thread = seedThread(U);
  seedMessage(U, thread, "user");
  seedMessage(U, thread, "user");
  seedMessage(U, thread, "user");
  seedMessage(U, thread, "assistant"); // not the user's
  seedTask(U, "completed", TODAY);
  seedTask(U, "completed", TWO_DAYS_AGO);
  seedTask(U, "failed", null); // earns nothing
  seedNote(U);
  seedDeployment(U, ["succeeded", "failed"]);
  seedToolRun(U, "gmail_list_messages");
  seedToolRun(U, "gmail_list_messages");
  seedToolRun(U, "gmail_get_message");
  seedToolRun(U, "web_search");
  seedToolRun(U, "gmail_forward_message", "blocked"); // earns nothing
  seedLlm(U, "claude", 5);
  seedSkill(U, "my-skill");
  seedSkill(U, "research"); // starter skill: earns nothing
}

let baseline;
await run("TW-3 XP math on seeded activity", () => {
  const p = build(U, ["claude", "telegram"]);
  baseline = p;
  const expected = {
    "agent-tasks": [2, 80],
    "deployment-runs": [1, 30],
    deployments: [1, 25],
    missions: [0, 0],
    "mission-runs": [0, 0],
    integrations: [2, 120],
    skills: [1, 50],
    notes: [1, 10],
    conversations: [1, 15],
    "chat-messages": [3, 6],
    "tool-runs": [4, 4],
    // All 8 tutorial quests (50+75+100+50+100+125+75+100) + Build the Writing Studio (50) + Telegraph Office (50).
    quests: [10, 775],
    // Daily shift (a task completed today, 60) + Daily journal (a note today, 25).
    "daily-quests": [2, 85],
  };
  for (const [id, [count, xp]] of Object.entries(expected)) {
    assert.deepEqual([source(p, id).count, source(p, id).xp], [count, xp], `source ${id}`);
  }
  assert.equal(p.sources.length, Object.keys(expected).length);
  assert.equal(p.level.xp, 1200);
  // Curve: 60, 180, 350, 550, 790 → level 5 starts at 1140, level 6 at 1930.
  assert.deepEqual([rules.xpForNextLevel(1), rules.xpForNextLevel(2), rules.xpForNextLevel(3), rules.xpForNextLevel(4), rules.xpForNextLevel(5)], [60, 180, 350, 550, 790]);
  assert.deepEqual(
    { level: p.level.level, start: p.level.levelStartXp, next: p.level.nextLevelXp, title: p.level.title },
    { level: 5, start: 1140, next: 1930, title: "Village" },
  );
  assert.equal(quest(p, "daily-chat-2026-09-30").progress, 3);
  assert.equal(quest(p, "daily-chat-2026-09-30").status, "active");
  assert.equal(quest(p, "daily-tools-2026-09-30").progress, 4);
  assert.equal(quest(p, "milestone-tasks-5").progress, 2);
  assert.equal(quest(p, "milestone-tasks-10"), undefined, "only the next milestone tier is listed");
  assert.deepEqual(p.tutorial, { active: false, currentQuestId: null, skipped: false });
  assert.ok(p.quests.filter((q) => q.category === "tutorial").every((q) => q.status === "completed" && q.completedAt));
  // Population: 1 conversation × 2 + floor(3 / 5) + level 5 × 3.
  assert.equal(p.population, 17);
  // The baseline is not replayed as events.
  assert.deepEqual(eventIds(p), ["founded"]);
});

await run("TW-4 building levels come from each integration's own usage", () => {
  const p = baseline;
  assert.deepEqual(building(p, "claude"), { integration: "claude", connected: true, level: 1, uses: 5, nextLevelUses: 100 });
  assert.deepEqual(building(p, "telegram"), { integration: "telegram", connected: true, level: 1, uses: 0, nextLevelUses: 25 });
  assert.deepEqual(building(p, "gmail"), { integration: "gmail", connected: false, level: 0, uses: 3, nextLevelUses: null });
  assert.equal(building(p, "brave").uses, 1);
  assert.equal(quest(p, "integration-claude-2").progress, 5);
  assert.equal(quest(p, "integration-claude-2").goal, 100);
  assert.deepEqual(quest(p, "integration-gmail-1").target, { place: "integration-gmail", route: "/integrations?setup=gmail", integration: "gmail" });
  const levels = [0, 24, 25, 149, 150].map((uses) => rules.buildingFor("gmail", true, uses).level);
  assert.deepEqual(levels, [1, 1, 2, 2, 3]);
  assert.equal(rules.buildingFor("openai", true, 1000).level, 3);
  assert.equal(rules.buildingFor("openai", true, 999).nextLevelUses, 1000);
});

// ── TW-5: events fire once ──────────────────────────────────────────────────────────────────────────────────

await run("TW-5 new progress fires each event once; ack clears it for good", () => {
  assert.deepEqual(town.applyTownAck(U, { eventIds: ["founded"] }), { acknowledged: 1 });
  assert.deepEqual(eventIds(build(U, ["claude", "telegram"])), []);

  const thread = seedThread(U);
  for (let i = 0; i < 2; i++) seedMessage(U, thread, "user"); // 5 today → Daily check-in
  for (let i = 0; i < 3; i++) seedTask(U, "completed", TWO_DAYS_AGO); // 5 tasks → Workforce I
  seedLlm(U, "claude", 96); // 101 Claude calls → Writing Studio level 2
  for (let i = 0; i < 4; i++) seedNote(U);
  seedSkill(U, "skill-two");
  seedSkill(U, "skill-three"); // 3 skills → Academy I

  const p = build(U, ["claude", "telegram", "gmail"]); // Gmail connected → Post Office + Skyline I
  const expectedEvents = [
    "building-claude-2",
    "building-gmail-1",
    "level-6",
    "quest-daily-chat-2026-09-30",
    "quest-integration-claude-2",
    "quest-integration-gmail-1",
    "quest-milestone-integrations-3",
    "quest-milestone-skills-3",
    "quest-milestone-tasks-5",
  ];
  assert.deepEqual(eventIds(p), expectedEvents);
  // 1200 + 3 tasks 120 + 2 msgs 4 + 1 conversation 15 + 4 notes 40 + 2 skills 100 + gmail 60
  // + quests (tasks-5 100, claude-2 100, gmail-1 50, integrations-3 120, skills-3 150) + daily chat 30.
  assert.equal(p.level.xp, 1200 + 120 + 4 + 15 + 40 + 100 + 60 + 100 + 100 + 50 + 120 + 150 + 30);
  assert.equal(p.level.level, 6);
  assert.equal(p.level.title, "Town");
  const levelUp = p.pendingEvents.find((event) => event.id === "level-6");
  assert.equal(levelUp.kind, "level-up");
  assert.equal(levelUp.title, "Level 6: Town");
  const questEvent = p.pendingEvents.find((event) => event.id === "quest-milestone-skills-3");
  assert.equal(questEvent.kind, "quest-complete");
  assert.equal(questEvent.xp, 150);
  assert.equal(building(p, "claude").level, 2);

  // Recomputing does not duplicate anything.
  const again = build(U, ["claude", "telegram", "gmail"]);
  assert.deepEqual(eventIds(again), expectedEvents);
  assert.equal(again.level.xp, p.level.xp);

  assert.deepEqual(town.applyTownAck(U, { eventIds: expectedEvents }), { acknowledged: expectedEvents.length });
  assert.deepEqual(eventIds(build(U, ["claude", "telegram", "gmail"])), []);
  assert.deepEqual(town.applyTownAck(U, { eventIds: expectedEvents }), { acknowledged: 0 });
  assert.deepEqual(eventIds(build(U, ["claude", "telegram", "gmail"])), []);
});

// ── TW-6: nothing resets ────────────────────────────────────────────────────────────────────────────────────

await run("TW-6 deleted rows and disconnects never lower XP; state survives a cold cache", () => {
  const before = build(U, ["claude", "telegram", "gmail"]);
  db.prepare("DELETE FROM tool_runs WHERE user_id = ?").run(U); // pruned audit trail
  db.prepare("DELETE FROM notes WHERE user_id = ?").run(U);
  db.prepare("DELETE FROM llm_usage WHERE user_id = ?").run(U); // retention prune
  globalThis.__novaTownProgressCache = undefined;
  const after = build(U, ["claude"]); // Telegram + Gmail disconnected
  assert.equal(after.level.xp, before.level.xp);
  assert.equal(source(after, "tool-runs").count, 4);
  assert.equal(source(after, "notes").count, 5);
  assert.equal(source(after, "integrations").count, 3);
  assert.equal(building(after, "claude").uses, 101, "building uses are high-water marks too");
  assert.equal(building(after, "claude").level, 2);
  assert.equal(building(after, "telegram").level, 0, "a disconnected integration is an empty lot");
  assert.equal(quest(after, "integration-telegram-1").status, "completed");
  assert.deepEqual(eventIds(after), []);
  // Reconnecting does not re-announce the building.
  assert.deepEqual(eventIds(build(U, ["claude", "telegram", "gmail"])), []);
});

// ── TW-7: daily rollover ────────────────────────────────────────────────────────────────────────────────────

await run("TW-7 daily quests roll over at local midnight; banked daily XP stays", () => {
  const today = build(U, ["claude", "telegram", "gmail"]);
  const tomorrow = new Date(Date.UTC(2026, 9, 1, 0, 30, 0));
  const p = build(U, ["claude", "telegram", "gmail"], tomorrow);
  const daily = p.quests.filter((q) => q.category === "daily");
  assert.deepEqual(daily.map((q) => q.id).sort(), [
    "daily-chat-2026-10-01",
    "daily-note-2026-10-01",
    "daily-task-2026-10-01",
    "daily-tools-2026-10-01",
  ]);
  assert.ok(daily.every((q) => q.status === "active" && q.progress === 0));
  assert.deepEqual([source(p, "daily-quests").count, source(p, "daily-quests").xp], [3, 115]);
  assert.equal(p.level.xp, today.level.xp);
  // Asia/Kolkata (+05:30): 00:30 UTC on Oct 1 is already Oct 1 local; 18:00 UTC on Sep 30 is 23:30 local Sep 30.
  const kolkata = town.buildTownProgress(U, { timeZone: "Asia/Kolkata", connected: new Set(["claude"]), now: new Date(Date.UTC(2026, 8, 30, 18, 0)), fresh: true });
  assert.ok(kolkata.quests.some((q) => q.id === "daily-chat-2026-09-30"));
});

// ── TW-8: cache ─────────────────────────────────────────────────────────────────────────────────────────────

await run("TW-8 cached within the TTL, invalidated by ack", () => {
  const user = "cache-user";
  const opts = (now) => ({ timeZone: TZ, connected: new Set(), now });
  const first = town.buildTownProgress(user, opts(NOW));
  seedNote(user);
  const cached = town.buildTownProgress(user, opts(new Date(NOW.getTime() + 1000)));
  assert.equal(cached, first, "same snapshot within the TTL");
  const expired = town.buildTownProgress(user, opts(new Date(NOW.getTime() + town.TOWN_CACHE_TTL_MS + 1)));
  assert.equal(source(expired, "notes").count, 1);
  assert.deepEqual(eventIds(expired), ["founded", "level-2", "quest-daily-note-2026-09-30", "quest-tutorial-first-note"]); // 10 + 50 + 25 XP
  town.applyTownAck(user, { eventIds: ["founded"] });
  const afterAck = town.buildTownProgress(user, opts(new Date(NOW.getTime() + town.TOWN_CACHE_TTL_MS + 2)));
  assert.deepEqual(eventIds(afterAck), ["level-2", "quest-daily-note-2026-09-30", "quest-tutorial-first-note"]);
});

// ── TW-9: ack validation ────────────────────────────────────────────────────────────────────────────────────

await run("TW-9 ack request validation", () => {
  assert.equal(town.parseTownAckRequest(null), null);
  assert.equal(town.parseTownAckRequest({}), null);
  assert.equal(town.parseTownAckRequest([]), null);
  assert.equal(town.parseTownAckRequest({ eventIds: "founded" }), null);
  assert.equal(town.parseTownAckRequest({ eventIds: [1] }), null);
  assert.equal(town.parseTownAckRequest({ tutorial: "later" }), null);
  assert.deepEqual(town.parseTownAckRequest({ eventIds: ["a"], tutorial: "skip" }), { eventIds: ["a"], tutorial: "skip" });
  assert.deepEqual(town.parseTownAckRequest({ tutorial: "restart" }), { tutorial: "restart" });
  // A corrupt stored state falls back to defaults instead of throwing.
  assert.deepEqual(townState.normalizeTownState("garbage"), townState.emptyTownState());
});

// ── TW-10: query plans ──────────────────────────────────────────────────────────────────────────────────────

await run("TW-10 per-user queries use indexes, never a full table scan", () => {
  const plans = [
    ["SELECT COUNT(*) FROM agent_tasks WHERE user_id = ? AND status = 'completed'", "agent_tasks"],
    ["SELECT COUNT(*) FROM deployment_runs WHERE user_id = ? AND status = 'succeeded'", "deployment_runs"],
    ["SELECT COUNT(*) FROM messages WHERE user_id = ? AND role = 'user'", "messages"],
    ["SELECT COUNT(*) FROM session_turns WHERE user_id = ? AND role = 'user'", "session_turns"],
    ["SELECT tool_name, COUNT(*) FROM tool_runs WHERE user_id = ? AND status = 'success' GROUP BY tool_name", "tool_runs"],
    ["SELECT provider, COUNT(*) FROM llm_usage WHERE user_id = ? GROUP BY provider", "llm_usage"],
  ];
  for (const [sql, table] of plans) {
    const detail = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("u").map((row) => row.detail).join(" | ");
    assert.ok(!new RegExp(`^SCAN ${table}$|SCAN ${table}(?! USING)`).test(detail), `${table}: ${detail}`);
  }
});

console.log(failures === 0 ? "\nTown progress smoke: all checks passed." : `\nTown progress smoke: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
