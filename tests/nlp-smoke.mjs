/**
 * tests/nlp-smoke.mjs
 *
 * Interactive smoke test — run with:
 *   node tests/nlp-smoke.mjs
 *
 * Shows exactly what the preprocessor does to a set of realistic Nova inputs.
 * No assertions — just readable output so you can eyeball the behavior.
 */

import { preprocess, warmSpellChecker } from "../dist/nlp/preprocess.js";

process.stdout.write("Loading dictionary... ");
await warmSpellChecker();
console.log("ready.\n");

const INPUTS = [
  // Your actual message from this conversation
  "so how will this effect token usuagfe, how will this effect lartency and time of rerpsonse turnaround, how iwll this impact my project",

  // Typo-heavy commands
  "whats the ocmmans to launc nova",
  "can you serach for the lates nwes on AI",
  "shwo me the weatehr in new yrok",
  "opne spotifiy and paly some jazz",

  // Things that must NOT be changed
  "open https://steamcommunity.com/id/abc123",
  "edit file C:\\nova-hud\\app\\page.tsx",
  "use SUPABASE_SERVICE_ROLE_KEY to connect",
  "run `npm strt` in the terminal",
  "delete record 550e8400-e29b-41d4-a716-446655440000",
  "commit 0xdeadbeef1234abcd",

  // Mixed — some typos, some protected
  "serach for getUserById in C:\\Nova\\src\\tools",
  "NBA gams last nite, who wno",

  // Clean input — should pass through unchanged
  "what is the weather today",
  "open Spotify and play some jazz",
];

for (const input of INPUTS) {
  const r = await preprocess(input);
  const changed = r.clean_text !== r.raw_text;

  console.log(`IN:  ${r.raw_text}`);
  if (changed) {
    console.log(`OUT: ${r.clean_text}`);
    if (r.corrections.length > 0) {
      const fixes = r.corrections.map(c => `  ${c.from} → ${c.to}  (${c.reason}, conf=${c.confidence.toFixed(2)})`).join("\n");
      console.log(fixes);
    }
  } else {
    console.log(`OUT: [unchanged]`);
  }
  console.log();
}
