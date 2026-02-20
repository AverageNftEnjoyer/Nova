/**
 * tests/nlp-audit.mjs
 *
 * Broad audit of the NLP preprocessor.
 * Flags any correction that looks wrong — either a bad substitution or
 * a protected span that got mutated.
 *
 * Run: node tests/nlp-audit.mjs
 */

import { preprocess, warmSpellChecker } from "../dist/nlp/preprocess.js";

process.stdout.write("Loading dictionary... ");
await warmSpellChecker();
console.log("ready.\n");

let badCount = 0;
let goodCount = 0;

function check(label, input, opts = {}) {
  return { label, input, ...opts };
}

// ─── Cases where we EXPECT a correction ──────────────────────────────────────
const EXPECT_CHANGED = [
  check("basic transposition", "srearch the web", { contains: "search" }),
  check("double-char swap", "shwo me", { contains: "show" }),
  check("missing letter", "launc nova", { contains: "launch" }),
  check("extra letter", "searrch", { contains: "search" }),
  check("common misspelling recieve", "recieve the data", { contains: "receive" }),
  check("common misspelling seperate", "seperate the files", { contains: "separate" }),
  check("common misspelling occured", "it occured yesterday", { contains: "occurred" }),
  check("common misspelling definately", "definately correct", { contains: "definitely" }),
  check("common misspelling accomodate", "accomodate the request", { contains: "accommodate" }),
  check("informal nite", "good nite", { contains: "night" }),
  check("informal whats", "whats up", { contains: "what's" }),
  check("informal dont", "dont do that", { contains: "don't" }),
  check("informal cant", "cant open it", { contains: "can't" }),
  check("informal wont", "it wont work", { contains: "won't" }),
  check("informal thru", "go thru the list", { contains: "through" }),
  check("informal gonna", "gonna launch it", { contains: "going to" }),
  check("lartency typo", "high lartency", { contains: "latency" }),
  check("usuagfe typo", "token usuagfe", { contains: "usage" }),
  check("weatehr typo", "check weatehr", { contains: "weather" }),
];

// ─── Cases where we EXPECT NO change ─────────────────────────────────────────
const EXPECT_UNCHANGED = [
  // Protected spans
  check("url", "open https://steamcommunity.com/id/abc"),
  check("url with typo outside", "opn https://example.com/path"),  // 'opn' may correct but URL must not
  check("windows path", "edit C:\\nova-hud\\app\\page.tsx"),
  check("posix path", "edit /home/user/project/src/main.ts"),
  check("env var", "use SUPABASE_SERVICE_ROLE_KEY"),
  check("env var 2", "set OPENAI_API_KEY=sk-abc"),
  check("uuid", "delete 550e8400-e29b-41d4-a716-446655440000"),
  check("hex", "commit 0xdeadbeef1234"),
  check("inline code", "run `npm start` now"),
  check("inline code with typo", "run `npm strt` now"),  // strt inside backticks must not change
  check("fenced code", "```\nconst x = undifined\n```"),
  check("email", "send to user@example.com"),
  check("semver", "upgrade to v2.3.1"),
  check("number", "set timeout to 5000ms"),
  check("date", "scheduled for 2024-01-15"),
  check("time", "at 14:30:00"),

  // Structural guards — identifiers
  check("camelCase", "call getUserById"),
  check("PascalCase", "render MyComponent"),
  check("ALL_CAPS constant", "use MAX_RETRIES"),
  check("kebab slug", "route /my-app-settings"),
  check("npm scoped package", "install @scope/package"),

  // Proper nouns — Title-case unknown words pass through
  check("brand Supabase", "connect to Supabase"),
  check("brand Vercel", "deploy to Vercel"),
  check("brand Anthropic", "using Anthropic API"),
  check("brand Discord", "send to Discord"),
  check("brand Spotify", "open Spotify"),
  check("brand Steam", "open Steam"),
  check("brand GitHub", "push to GitHub"),
  check("name Nova", "ask Nova"),
  check("name Claude", "using Claude"),

  // Clean English — must not be touched
  check("clean sentence", "what is the weather today"),
  check("clean question", "how do I open a file"),
  check("clean command", "search for the latest news"),
  check("short words", "go to the top"),
  check("numbers in sentence", "retry 3 times after 500ms"),

  // Ambiguous — should be left alone (no confident correction)
  check("ambiguous gams", "NBA gams"),
  check("ambiguous iwll", "iwll do it"),
  check("ambiguous short nwes", "nwes today"),
  check("mixed code and text", "run getUserById in production"),

  // Things that look like typos but are valid words
  check("its possessive", "its value is correct"),
  check("were past tense", "they were ready"),
  check("well adverb", "it works well"),
];

// ─── Run EXPECT_CHANGED ───────────────────────────────────────────────────────
console.log("── Expect corrections ──────────────────────────────────────────\n");
for (const tc of EXPECT_CHANGED) {
  const r = await preprocess(tc.input);
  const clean = r.clean_text.toLowerCase();
  const ok = tc.contains ? clean.includes(tc.contains.toLowerCase()) : r.clean_text !== r.raw_text;
  const tag = ok ? "✓" : "✗ MISS";
  if (!ok) badCount++;
  else goodCount++;
  console.log(`${tag}  [${tc.label}]`);
  if (!ok || r.corrections.length > 0) {
    console.log(`     in:  ${r.raw_text}`);
    console.log(`     out: ${r.clean_text}`);
    if (r.corrections.length > 0) {
      console.log(`     fixes: ${r.corrections.map(c => `${c.from}→${c.to}`).join(", ")}`);
    }
  }
}

// ─── Run EXPECT_UNCHANGED ─────────────────────────────────────────────────────
console.log("\n── Expect no bad mutations ─────────────────────────────────────\n");
for (const tc of EXPECT_UNCHANGED) {
  const r = await preprocess(tc.input);

  // For "url with typo outside" — the URL itself must be intact even if the word outside changes
  let bad = false;
  let reason = "";

  if (tc.label === "url with typo outside") {
    // Only check the URL is intact
    bad = !r.clean_text.includes("https://example.com/path");
    reason = "URL mutated";
  } else if (tc.label === "inline code with typo") {
    bad = !r.clean_text.includes("`npm strt`");
    reason = "inline code mutated";
  } else if (tc.label === "fenced code") {
    bad = !r.clean_text.includes("undifined");
    reason = "fenced code mutated";
  } else {
    // General: check that nothing in the input that should be protected was changed
    // We flag if clean_text differs AND the correction looks wrong
    if (r.corrections.length > 0) {
      for (const c of r.corrections) {
        // Flag corrections that look wrong:
        // - correcting something that appears inside a protected token
        // - correcting a known proper noun or brand
        const suspiciousBrands = ["supabase","vercel","anthropic","discord","spotify","steam","github","nova","claude","openai"];
        if (suspiciousBrands.some(b => c.from.toLowerCase() === b)) {
          bad = true;
          reason = `brand name corrected: ${c.from}→${c.to}`;
        }
        // Correcting ALL_CAPS
        if (c.from === c.from.toUpperCase() && c.from.length > 2) {
          bad = true;
          reason = `ALL_CAPS corrected: ${c.from}→${c.to}`;
        }
        // Correcting camelCase
        if (/[a-z][A-Z]/.test(c.from)) {
          bad = true;
          reason = `camelCase corrected: ${c.from}→${c.to}`;
        }
      }
    }
    // Also check the raw_text is always preserved
    if (r.raw_text !== tc.input) {
      bad = true;
      reason = "raw_text mutated!";
    }
  }

  const tag = bad ? "✗ BAD" : "✓";
  if (bad) badCount++;
  else goodCount++;

  console.log(`${tag}  [${tc.label}]`);
  if (bad || r.corrections.length > 0) {
    console.log(`     in:  ${r.raw_text}`);
    console.log(`     out: ${r.clean_text}`);
    if (r.corrections.length > 0) {
      console.log(`     fixes: ${r.corrections.map(c => `${c.from}→${c.to}  (${c.reason})`).join(", ")}`);
    }
    if (bad) console.log(`     REASON: ${reason}`);
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${goodCount} correct, ${badCount} problems`);
if (badCount > 0) process.exit(1);
