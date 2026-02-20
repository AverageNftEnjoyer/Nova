/**
 * tests/nlp-nova-routing.mjs
 *
 * Routing-critical audit: verifies that preprocessing never corrupts
 * the keywords Nova's intent router, tool selector, and fast-path
 * handlers depend on.
 *
 * Run: node tests/nlp-nova-routing.mjs
 */

import { preprocess, warmSpellChecker } from "../dist/nlp/preprocess.js";

process.stdout.write("Loading dictionary... ");
await warmSpellChecker();
console.log("ready.\n");

let bad = 0;
let good = 0;

async function check(label, input, mustContain, mustNotContain = []) {
  const r = await preprocess(input);
  const clean = r.clean_text.toLowerCase();
  let failed = false;

  for (const word of mustContain) {
    if (!clean.includes(word.toLowerCase())) {
      console.log(`✗  [${label}] missing "${word}"`);
      console.log(`     in:  ${r.raw_text}`);
      console.log(`     out: ${r.clean_text}`);
      failed = true;
    }
  }
  for (const word of mustNotContain) {
    if (clean.includes(word.toLowerCase())) {
      console.log(`✗  [${label}] should NOT contain "${word}"`);
      console.log(`     in:  ${r.raw_text}`);
      console.log(`     out: ${r.clean_text}`);
      failed = true;
    }
  }

  if (failed) bad++;
  else { good++; console.log(`✓  [${label}]`); }
}

console.log("── Shutdown / system commands ──────────────────────────────────\n");
await check("shutdown exact", "nova shutdown", ["nova", "shutdown"]);
await check("shutdown typo", "nova shutdwon", ["nova", "shutdown"], ["shutdwon"]);
await check("shut down two words", "nova shut down", ["nova", "shut", "down"]);

console.log("\n── Spotify routing keywords ────────────────────────────────────\n");
await check("spotify exact", "open spotify", ["spotify"]);
await check("play music", "play music", ["play", "music"]);
await check("play some typo", "paly some jazz", ["jazz"]);  // paly ambiguous, jazz fine
await check("spotify typo", "opne spotify", ["spotify"]);   // opne ambiguous, spotify protected
await check("next song", "next song", ["next", "song"]);
await check("pause music", "pause the music", ["pause", "music"]);

console.log("\n── Weather fast-path keywords ──────────────────────────────────\n");
await check("weather exact", "what is the weather today", ["weather", "today"]);
await check("weather typo city", "weatehr in new york", ["weather", "new", "york"]);
await check("forecast", "show me the forecast", ["forecast"]);
await check("temperature", "whats the temperature", ["temperature"]);
await check("rain tomorrow", "will it rain tomorrow", ["rain", "tomorrow"]);

console.log("\n── Mission / workflow keywords ─────────────────────────────────\n");
await check("create mission", "create a mission to send daily report", ["create", "mission", "daily", "report"]);
await check("build workflow", "build a workflow for telegram", ["build", "workflow", "telegram"]);
await check("schedule reminder", "remind me every morning", ["remind", "every", "morning"]);
await check("mission typo", "bild a misison for discord", ["discord"]);  // bild/misison ambiguous ok

console.log("\n── Memory commands ─────────────────────────────────────────────\n");
await check("update memory", "update your memory my name is Jack", ["update", "memory", "name"]);
await check("remember", "remember that I prefer dark mode", ["remember", "prefer", "dark", "mode"]);

console.log("\n── Web search keywords ─────────────────────────────────────────\n");
await check("search exact", "search for the latest news", ["search", "latest", "news"]);
await check("search typo", "serach for AI updates", ["search", "updates"]);
await check("latest scores", "latest NBA scores", ["latest", "scores"]);
await check("current price", "current bitcoin price", ["current", "bitcoin", "price"]);

console.log("\n── Tool / file keywords ────────────────────────────────────────\n");
await check("run command", "run npm install", ["run", "npm", "install"]);
await check("edit file", "edit the file src/index.ts", ["edit", "file"]);
await check("read file", "read C:\\Nova\\src\\agent\\runner.ts", ["read"]);
await check("path preserved in cmd", "open C:\\Nova\\src\\tools\\registry.ts", ["C:\\Nova\\src\\tools\\registry.ts"]);

console.log("\n── Voice / greeting fast-lane ──────────────────────────────────\n");
await check("hello", "hello", ["hello"]);
await check("hey nova", "hey nova", ["nova"]);
await check("thanks", "thanks", ["thanks"]);
await check("good morning", "good morning", ["good", "morning"]);

console.log("\n── Mixed typos + protected spans ───────────────────────────────\n");
await check("typo + url", "serach https://example.com for info", ["https://example.com"]);
await check("typo + path", "opne C:\\Nova\\hud\\app\\page.tsx", ["C:\\Nova\\hud\\app\\page.tsx"]);
await check("typo + env var", "chekc OPENAI_API_KEY value", ["OPENAI_API_KEY"]);
await check("typo + camelCase", "cehck getUserById function", ["getUserById"]);
await check("typo + inline code", "rnu `npm install` now", ["`npm install`"]);

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${good} correct, ${bad} problems`);
if (bad > 0) process.exit(1);
