/**
 * tests/nlp-gold-eval.mjs
 *
 * Frozen gold-corpus evaluation for NLP preprocessing quality.
 * This is meant to catch drift/regressions over time with production-like prompts.
 *
 * Run:
 *   npm run test:nlp:gold
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { preprocess, warmSpellChecker } from "../dist/nlp/preprocess.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const corpusPath = path.join(__dirname, "nlp-gold-corpus.jsonl");

const MIN_PRECISION = Number(process.env.NLP_GOLD_MIN_PRECISION || "0.95");
const MIN_RECALL = Number(process.env.NLP_GOLD_MIN_RECALL || "0.90");
const MIN_EXPECTATION_PASS_RATE = Number(process.env.NLP_GOLD_MIN_EXPECTATION_PASS_RATE || "0.90");
const STRICT_PRESERVE = String(process.env.NLP_GOLD_STRICT_PRESERVE || "1") !== "0";

function parseCorpus(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    try {
      const row = JSON.parse(line);
      if (!row.id || typeof row.input !== "string" || typeof row.expectChanged !== "boolean") {
        throw new Error("Missing required fields (id, input, expectChanged)");
      }
      rows.push({
        id: String(row.id),
        input: row.input,
        expectChanged: row.expectChanged,
        mustContain: Array.isArray(row.mustContain) ? row.mustContain.map(String) : [],
        mustNotContain: Array.isArray(row.mustNotContain) ? row.mustNotContain.map(String) : [],
        mustPreserve: Array.isArray(row.mustPreserve) ? row.mustPreserve.map(String) : [],
        tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      });
    } catch (err) {
      throw new Error(`Invalid JSONL at line ${i + 1}: ${err.message}`);
    }
  }
  return rows;
}

function toLowerSafe(s) {
  return String(s || "").toLowerCase();
}

function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksLikeSingleWord(term) {
  return /^[A-Za-z0-9']+$/.test(term);
}

function includesExpectation(clean, expected) {
  const expectedText = String(expected || "");
  if (!expectedText) return true;
  if (looksLikeSingleWord(expectedText)) {
    const re = new RegExp(`\\b${escapeRegex(expectedText)}\\b`, "i");
    return re.test(clean);
  }
  return toLowerSafe(clean).includes(toLowerSafe(expectedText));
}

function evaluateCase(tc, result) {
  const failures = [];
  const clean = result.clean_text;
  const cleanLower = toLowerSafe(clean);
  const changed = clean !== result.raw_text;

  if (result.raw_text !== tc.input) {
    failures.push("raw_text mutated");
  }

  if (tc.expectChanged && !changed) {
    failures.push("expected change but output unchanged");
  }
  if (!tc.expectChanged && changed) {
    failures.push("unexpected change");
  }

  for (const expected of tc.mustContain) {
    if (!includesExpectation(clean, expected)) {
      failures.push(`missing required phrase "${expected}"`);
    }
  }

  for (const forbidden of tc.mustNotContain) {
    if (includesExpectation(clean, forbidden)) {
      failures.push(`contains forbidden phrase "${forbidden}"`);
    }
  }

  for (const preserved of tc.mustPreserve) {
    if (!clean.includes(preserved)) {
      failures.push(`protected span mutated "${preserved}"`);
    }
  }

  return {
    changed,
    pass: failures.length === 0,
    failures,
  };
}

function pct(numerator, denominator) {
  if (denominator <= 0) return 1;
  return numerator / denominator;
}

function fmt(num) {
  return `${(num * 100).toFixed(2)}%`;
}

console.log("Loading NLP dictionary...");
await warmSpellChecker();

const corpus = parseCorpus(corpusPath);
if (corpus.length === 0) {
  console.error("Corpus is empty.");
  process.exit(1);
}

let tp = 0;
let fp = 0;
let fn = 0;
let tn = 0;
let passed = 0;
let failed = 0;
let preserveChecks = 0;
let preserveFailures = 0;

const failedCases = [];
const byTag = new Map();

for (const tc of corpus) {
  const result = await preprocess(tc.input);
  const evaluation = evaluateCase(tc, result);
  const changed = evaluation.changed;

  if (tc.expectChanged) {
    if (changed) tp += 1;
    else fn += 1;
  } else if (changed) {
    fp += 1;
  } else {
    tn += 1;
  }

  preserveChecks += tc.mustPreserve.length;
  preserveFailures += evaluation.failures.filter((f) => f.startsWith("protected span mutated")).length;

  if (evaluation.pass) passed += 1;
  else {
    failed += 1;
    failedCases.push({
      id: tc.id,
      input: tc.input,
      out: result.clean_text,
      failures: evaluation.failures,
      corrections: result.corrections.map((c) => `${c.from}->${c.to} (${c.reason}, ${c.confidence.toFixed(2)})`),
    });
  }

  const tags = tc.tags.length > 0 ? tc.tags : ["untagged"];
  for (const tag of tags) {
    const stats = byTag.get(tag) || { total: 0, passed: 0 };
    stats.total += 1;
    if (evaluation.pass) stats.passed += 1;
    byTag.set(tag, stats);
  }
}

const precision = pct(tp, tp + fp);
const recall = pct(tp, tp + fn);
const expectationPassRate = pct(passed, corpus.length);
const preservePassRate = pct(preserveChecks - preserveFailures, preserveChecks);

console.log("\n=== NLP Gold Eval ===");
console.log(`Cases: ${corpus.length}`);
console.log(`Pass: ${passed}, Fail: ${failed}`);
console.log(`Change precision (TP/(TP+FP)): ${fmt(precision)}  [TP=${tp}, FP=${fp}]`);
console.log(`Change recall (TP/(TP+FN)):    ${fmt(recall)}  [TP=${tp}, FN=${fn}]`);
console.log(`Expectation pass rate:         ${fmt(expectationPassRate)}`);
if (preserveChecks > 0) {
  console.log(`Protected span pass rate:      ${fmt(preservePassRate)}  [checks=${preserveChecks}]`);
}

console.log("\nTag pass rates:");
for (const [tag, stats] of [...byTag.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const tagRate = pct(stats.passed, stats.total);
  console.log(`- ${tag}: ${stats.passed}/${stats.total} (${fmt(tagRate)})`);
}

if (failedCases.length > 0) {
  console.log("\nFailed cases:");
  for (const fc of failedCases) {
    console.log(`\n[${fc.id}]`);
    console.log(`in:  ${fc.input}`);
    console.log(`out: ${fc.out}`);
    if (fc.corrections.length > 0) {
      console.log(`corrections: ${fc.corrections.join(", ")}`);
    }
    for (const reason of fc.failures) {
      console.log(`- ${reason}`);
    }
  }
}

const thresholdErrors = [];
if (precision < MIN_PRECISION) thresholdErrors.push(`precision ${fmt(precision)} < ${fmt(MIN_PRECISION)}`);
if (recall < MIN_RECALL) thresholdErrors.push(`recall ${fmt(recall)} < ${fmt(MIN_RECALL)}`);
if (expectationPassRate < MIN_EXPECTATION_PASS_RATE) {
  thresholdErrors.push(`expectation pass rate ${fmt(expectationPassRate)} < ${fmt(MIN_EXPECTATION_PASS_RATE)}`);
}
if (STRICT_PRESERVE && preserveFailures > 0) {
  thresholdErrors.push(`protected span violations: ${preserveFailures}`);
}

if (thresholdErrors.length > 0 || failedCases.length > 0) {
  console.error("\nNLP gold eval failed:");
  for (const err of thresholdErrors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log("\nNLP gold eval passed.");
