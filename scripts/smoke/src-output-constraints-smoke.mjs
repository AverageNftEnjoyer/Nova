import assert from "node:assert/strict";
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

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

const moduleRef = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/quality/output-constraints.js")).href
);

const {
  parseOutputConstraints,
  validateOutputConstraints,
  countSentences,
  shouldPreferNewVersionForAssistantMerge,
} = moduleRef;

await run("Parses one-word and sentence constraints", async () => {
  const parsed = parseOutputConstraints("Answer with one word and exactly one sentence.");
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.oneWord, true);
  assert.equal(parsed.sentenceCount, 1);
});

await run("Validates exact bullet counts", async () => {
  const parsed = parseOutputConstraints("Return exactly 3 bullet points");
  const ok = validateOutputConstraints("- one\n- two\n- three", parsed);
  const bad = validateOutputConstraints("- one\n- two", parsed);
  assert.equal(ok.ok, true);
  assert.equal(bad.ok, false);
});

await run("Validates JSON-only replies", async () => {
  const parsed = parseOutputConstraints("json only");
  const ok = validateOutputConstraints('{"ok":true}', parsed);
  const bad = validateOutputConstraints("```json\n{\"ok\":true}\n```", parsed);
  assert.equal(ok.ok, true);
  assert.equal(bad.ok, false);
});

await run("Validates JSON-only required key set", async () => {
  const parsed = parseOutputConstraints("Respond with JSON only with keys risk and action.");
  const ok = validateOutputConstraints('{"risk":"x","action":["a"]}', parsed);
  const badMissing = validateOutputConstraints('{"risk":"x"}', parsed);
  const badExtra = validateOutputConstraints('{"risk":"x","action":"y","note":"z"}', parsed);
  assert.equal(ok.ok, true);
  assert.equal(badMissing.ok, false);
  assert.equal(badExtra.ok, false);
});

await run("Counts sentences predictably", async () => {
  assert.equal(countSentences("One. Two."), 2);
  assert.equal(countSentences("No punctuation sentence"), 1);
  assert.equal(countSentences(""), 0);
});

await run("Assistant merge prefers corrected rewrite over concatenation", async () => {
  const base = "Magnesium glycinate helps sleep because it may calm the nervous system and support relaxation";
  const incoming = "Magnesium glycinate helps sleep because it may calm the nervous system and support relaxation.";
  assert.equal(shouldPreferNewVersionForAssistantMerge(base, incoming), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
