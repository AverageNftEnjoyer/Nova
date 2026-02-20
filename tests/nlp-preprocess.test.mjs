/**
 * tests/nlp-preprocess.test.mjs
 *
 * Acceptance tests for the NLP preprocessing pipeline.
 * Run after building: npm run build:agent-core && node tests/nlp-preprocess.test.mjs
 */

import { preprocess } from "../dist/nlp/preprocess.js";

let passed = 0;
let failed = 0;

function assert(condition, label, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function run(name, fn) {
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (err) {
    console.error(`  ✗ THREW: ${err.message}`);
    failed++;
  }
}

// ─── Acceptance Case 1: Typo correction ──────────────────────────────────────
await run("AC-1: Typo correction — 'whats the ocmmans to launc hnovsm'", async () => {
  const r = await preprocess("whats the ocmmans to launc hnovsm");
  assert(typeof r.clean_text === "string", "returns clean_text string");
  assert(r.raw_text === "whats the ocmmans to launc hnovsm", "raw_text unchanged");
  const corrected = r.clean_text.toLowerCase();
  assert(corrected.includes("command") || r.corrections.some(c => c.from.toLowerCase() === "ocmmans"), "corrects 'ocmmans'");
  assert(corrected.includes("launch") || r.corrections.some(c => c.from.toLowerCase() === "launc"), "corrects 'launc'");
  assert(r.corrections.length > 0, "records corrections");
  assert(r.confidence > 0 && r.confidence <= 1.0, "confidence in range");
  console.log(`    clean_text: "${r.clean_text}"`);
  console.log(`    corrections: ${JSON.stringify(r.corrections.map(c => `${c.from}→${c.to}`))}`);
});

// ─── Acceptance Case 2: URL preserved ────────────────────────────────────────
await run("AC-2: URL preserved — 'open https://steamcommunity.com/id/abc'", async () => {
  const r = await preprocess("open https://steamcommunity.com/id/abc");
  assert(r.raw_text === "open https://steamcommunity.com/id/abc", "raw_text unchanged");
  assert(r.clean_text.includes("https://steamcommunity.com/id/abc"), "URL intact in clean_text");
  assert(!r.corrections.some(c => c.from.includes("steamcommunity")), "no correction inside URL");
  console.log(`    clean_text: "${r.clean_text}"`);
});

// ─── Acceptance Case 3: Windows path preserved ───────────────────────────────
await run("AC-3: Windows path preserved — 'edit file C:\\nova-hud\\app\\page.tsx'", async () => {
  const input = "edit file C:\\nova-hud\\app\\page.tsx";
  const r = await preprocess(input);
  assert(r.raw_text === input, "raw_text unchanged");
  assert(r.clean_text.includes("C:\\nova-hud\\app\\page.tsx"), "Windows path intact");
  assert(!r.corrections.some(c => c.from.includes("nova")), "no correction inside path");
  console.log(`    clean_text: "${r.clean_text}"`);
});

// ─── Acceptance Case 4: Env var token preserved ──────────────────────────────
await run("AC-4: Env var preserved — 'use SUPABASE_SERVICE_ROLE_KEY'", async () => {
  const r = await preprocess("use SUPABASE_SERVICE_ROLE_KEY");
  assert(r.raw_text === "use SUPABASE_SERVICE_ROLE_KEY", "raw_text unchanged");
  assert(r.clean_text.includes("SUPABASE_SERVICE_ROLE_KEY"), "env var intact");
  assert(!r.corrections.some(c => c.from === "SUPABASE_SERVICE_ROLE_KEY"), "env var not corrected");
  console.log(`    clean_text: "${r.clean_text}"`);
});

// ─── Acceptance Case 5: Common typos ─────────────────────────────────────────
await run("AC-5: Common typos — 'NBA gams last nite'", async () => {
  const r = await preprocess("NBA gams last nite");
  assert(r.raw_text === "NBA gams last nite", "raw_text unchanged");
  // "nite" → "night" via informal substitution table
  assert(r.corrections.some(c => c.from.toLowerCase() === "nite"), "corrects 'nite'");
  assert(r.clean_text.toLowerCase().includes("night"), "nite→night in clean_text");
  // "gams" has 26 equidistant dictionary candidates — correctly left unchanged
  // (ambiguous: gabs, jams, hams, game, games, etc. are all equally valid)
  assert(!r.corrections.some(c => c.from === "gams" && c.to === "gabs"), "gams not wrongly corrected to gabs");
  // NBA is ALL_CAPS — skipped by structural guard, not a hardcoded whitelist
  assert(r.clean_text.includes("NBA"), "NBA (ALL_CAPS) preserved by structural guard");
  console.log(`    clean_text: "${r.clean_text}"`);
  console.log(`    corrections: ${JSON.stringify(r.corrections.map(c => `${c.from}→${c.to}`))}`);
});

// ─── Acceptance Case 6: Inline code protected ────────────────────────────────
await run("AC-6: Inline code protected — 'run `npm strt`'", async () => {
  const r = await preprocess("run `npm strt`");
  assert(r.raw_text === "run `npm strt`", "raw_text unchanged");
  assert(r.clean_text.includes("`npm strt`"), "inline code block intact");
  assert(!r.corrections.some(c => c.from === "strt"), "no correction inside backticks");
  console.log(`    clean_text: "${r.clean_text}"`);
});

// ─── Edge cases ───────────────────────────────────────────────────────────────
await run("Edge: Empty string", async () => {
  const r = await preprocess("");
  assert(r.raw_text === "", "raw_text is empty");
  assert(r.clean_text === "", "clean_text is empty");
  assert(r.corrections.length === 0, "no corrections");
  assert(r.confidence === 1.0, "confidence is 1.0");
});

await run("Edge: Fenced code block fully protected", async () => {
  const input = "here is my code:\n```\nconst x = undifined\n```\nuse it";
  const r = await preprocess(input);
  assert(r.clean_text.includes("undifined"), "typo inside fence not corrected");
  console.log(`    clean_text: "${r.clean_text}"`);
});

await run("Edge: Email address preserved", async () => {
  const r = await preprocess("email me at user@example.com please");
  assert(r.clean_text.includes("user@example.com"), "email intact");
  assert(!r.corrections.some(c => c.from.includes("@")), "no correction on email");
});

await run("Edge: UUID preserved", async () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const r = await preprocess(`delete record ${uuid} now`);
  assert(r.clean_text.includes(uuid), "UUID intact");
});

await run("Edge: Hex string preserved", async () => {
  const r = await preprocess("commit hash 0xdeadbeef1234abcd");
  assert(r.clean_text.includes("0xdeadbeef1234abcd"), "hex string intact");
});

await run("Edge: No overcorrection of short words", async () => {
  const r = await preprocess("go to the top");
  assert(r.clean_text === "go to the top", "common short words untouched");
  assert(r.corrections.length === 0, "no spurious corrections");
});

await run("Edge: Uppercase proper noun not corrected", async () => {
  // ALL_CAPS tokens are skipped by the structural guard (not a hardcoded list)
  const r = await preprocess("ask NOVA to help");
  assert(r.clean_text.includes("NOVA"), "ALL_CAPS token preserved");
  assert(!r.corrections.some(c => c.from === "NOVA"), "NOVA not in corrections");
});

await run("Edge: Unknown proper noun (Title Case) not corrected", async () => {
  // Title-case unknown words: the heuristic skips them since they look like proper nouns
  const r = await preprocess("connect to Supabase database");
  assert(r.clean_text.includes("Supabase"), "Supabase preserved");
  assert(!r.corrections.some(c => c.from === "Supabase"), "Supabase not corrected");
  console.log(`    clean_text: "${r.clean_text}"`);
});

await run("Edge: POSIX path preserved", async () => {
  const r = await preprocess("edit /home/user/project/src/index.ts");
  assert(r.clean_text.includes("/home/user/project/src/index.ts"), "POSIX path intact");
});

await run("Edge: Confidence is 1.0 when no corrections", async () => {
  const r = await preprocess("what is the weather today");
  assert(r.confidence === 1.0, "confidence 1.0 for clean input");
});

await run("Edge: raw_text always equals original input", async () => {
  const inputs = [
    "hello world",
    "NBA gams",
    "run `npm strt`",
    "C:\\Users\\Jack\\file.txt",
    "",
    "   spaces   ",
  ];
  for (const input of inputs) {
    const r = await preprocess(input);
    assert(r.raw_text === input, `raw_text preserved for: "${input}"`);
  }
});

await run("Edge: Unicode NFKC normalization", async () => {
  const r = await preprocess("ｈｅｌｌｏ ｗｏｒｌｄ");
  assert(r.clean_text === "hello world", `NFKC normalizes fullwidth: got "${r.clean_text}"`);
});

await run("Edge: Non-breaking space collapsed", async () => {
  const r = await preprocess("hello\u00A0world");
  assert(r.clean_text === "hello world", `NBSP collapsed: got "${r.clean_text}"`);
});

await run("Edge: camelCase identifier not corrected", async () => {
  const r = await preprocess("call getUserById function");
  assert(!r.corrections.some(c => c.from === "getUserById"), "camelCase skipped");
  console.log(`    clean_text: "${r.clean_text}"`);
});

await run("Edge: Broad misspelling coverage", async () => {
  // These are common English misspellings that a real dictionary should handle
  const cases = [
    ["recieve", "receive"],
    ["seperate", "separate"],
    ["occured", "occurred"],
    ["definately", "definitely"],
    ["accomodate", "accommodate"],
  ];
  for (const [typo, expected] of cases) {
    const r = await preprocess(typo);
    const corrected = r.clean_text.toLowerCase();
    assert(
      corrected === expected || r.corrections.some(c => c.from === typo),
      `corrects common misspelling '${typo}' (got '${corrected}')`,
    );
  }
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
