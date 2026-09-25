/**
 * Token-efficiency Stage 2: tool output ceilings (src/tools/core/output-caps, applied in src/tools/core/executor).
 *
 * Adversarial inputs go through the REAL executor, and through the real tool wherever that needs no network:
 * - read: a 20,000-line file, with and without a line range, a single huge line, and small files (unchanged).
 * - grep: a minified line is shown as a bounded window around the match with a per-line note (TC-19).
 * - web_fetch: the real tool (SSRF guard, readability worker) against a stubbed globalThis.fetch and a TEST-NET
 *   IP literal (no DNS, nothing leaves the process). A second module copy with a 50 ms worker timeout proves the
 *   plain-text fallback returns capped content instead of an error (TC-17, TC-18).
 * - memory_get / memory_search: the real tools over a stub memory manager (huge source, offset paging).
 * - exec: a local `node` child process printing 200,000 chars (approval mode "auto").
 * - browser_agent: needs the agent-browser binary, so a stub tool with the same name returns a huge result through
 *   the executor (default cap and the maxOutputChars override).
 * - an unknown tool, a structured-JSON (gmail_*) tool and a throwing tool with a huge input.
 * Each result must be under its cap (+ the bounded marker), carry a marker that says how much was cut and how to
 * get more, and be byte-identical when repeated (markers must not break prompt caching).
 *
 * Needs `npm run build:agent-core` (dist/); `npm run smoke:tool-output-caps` does that first.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isolatedDataDir } from "../lib/isolated-data-dir.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dist = (rel) => pathToFileURL(path.join(repoRoot, "dist", rel)).href;
// The readability worker's cold start can pass the 5 s default on a busy machine; read at web-fetch import time.
process.env.NOVA_WEB_FETCH_PARSE_WORKER_TIMEOUT_MS = "15000";

const caps = await import(dist("tools/core/output-caps/index.js"));
const { executeToolUse } = await import(dist("tools/core/executor/index.js"));
const { createFileTools } = await import(dist("tools/builtin/file-tools/index.js"));
const { createMemoryTools } = await import(dist("tools/builtin/memory-tools/index.js"));
const { createExecTool } = await import(dist("tools/builtin/exec/index.js"));
const { createWebFetchTool } = await import(dist("tools/web/web-fetch/index.js"));

const { TOOL_OUTPUT_LIMITS, TOOL_OUTPUT_MARKER_MAX_CHARS, DEFAULT_TOOL_OUTPUT_MAX_CHARS, READ_DEFAULT_WINDOW_LINES } = caps;
const MARKER_RE = /\n\.\.\. \[truncated: [^\n]*\]$/;

const results = [];
async function run(name, fn) {
  try {
    await fn();
    results.push({ status: "PASS", name });
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.message : String(error) });
  }
}

let callNo = 0;
async function call(tools, name, input) {
  callNo += 1;
  const result = await executeToolUse({ id: `t${callNo}`, name, input, type: "tool_use" }, tools, { source: "smoke", allowElevatedTools: true, allowDangerousTools: true });
  return String(result.content);
}

/** Result is at most `maxChars` of output plus one bounded marker, the marker is last, and it names a way on. */
function assertCapped(output, maxChars, { mustMatch = [] } = {}) {
  assert.ok(output.length <= maxChars + TOOL_OUTPUT_MARKER_MAX_CHARS, `length ${output.length} > ${maxChars} + marker`);
  const marker = output.match(MARKER_RE)?.[0] || "";
  assert.ok(marker, `no truncation marker at the end: ${JSON.stringify(output.slice(-200))}`);
  assert.ok(marker.length <= TOOL_OUTPUT_MARKER_MAX_CHARS, `marker too long (${marker.length})`);
  assert.ok(output.length - marker.length <= maxChars, `kept ${output.length - marker.length} > ${maxChars}`);
  assert.doesNotMatch(output, /\.\.\. \[truncated\]$/, "old unspecific marker still present");
  assert.doesNotMatch(marker, /\d{4}-\d{2}-\d{2}T|\d{1,3},\d{3}/, "marker must be deterministic (no timestamps or locale numbers)");
  for (const pattern of mustMatch) assert.match(marker, pattern);
  return marker;
}

// ── read ────────────────────────────────────────────────────────────────────────────────────────────────────

const workspace = path.join(isolatedDataDir, "tool-output-caps-ws");
fs.mkdirSync(workspace, { recursive: true });
const BIG_LINES = 20_000;
fs.writeFileSync(
  path.join(workspace, "huge.log"),
  `${Array.from({ length: BIG_LINES }, (_, i) => `line ${i + 1} ${"ab ".repeat(8)}`).join("\n")}\n`,
);
fs.writeFileSync(path.join(workspace, "one-line.min.js"), `var a=${"1+".repeat(150_000)}1;`);
fs.writeFileSync(path.join(workspace, "small.txt"), "alpha\nbeta\ngamma\n");
const fileTools = createFileTools(workspace);
const READ_CAP = TOOL_OUTPUT_LIMITS.read.maxChars;

await run("TC-1 read huge file, no range -> first window, marker names total lines and the next startLine", async () => {
  const out = await call(fileTools, "read", { path: "huge.log" });
  // read keeps body + marker inside its cap, so the executor never cuts it a second time.
  assert.ok(out.length <= READ_CAP, `read result ${out.length} > ${READ_CAP}`);
  const marker = assertCapped(out, READ_CAP, {
    mustMatch: [new RegExp(`lines 1-${READ_DEFAULT_WINDOW_LINES} of ${BIG_LINES}`), /more lines not shown/, new RegExp(`startLine=${READ_DEFAULT_WINDOW_LINES + 1}`)],
  });
  const body = out.slice(0, out.length - marker.length);
  assert.equal(body.split("\n").length, READ_DEFAULT_WINDOW_LINES);
  assert.ok(body.startsWith("line 1 ") && body.endsWith("ab ab "), "window must be whole lines");
  assert.equal(await call(fileTools, "read", { path: "huge.log" }), out, "repeat call must be byte-identical");
});

await run("TC-2 read huge explicit range -> stays under the char cap, marker continues the requested range", async () => {
  const out = await call(fileTools, "read", { path: "huge.log", startLine: 100, endLine: 15_000 });
  assert.ok(out.length <= READ_CAP, `read result ${out.length} > ${READ_CAP}`);
  const marker = assertCapped(out, READ_CAP, { mustMatch: [/of the requested 100-15000/, /lines not shown/, /endLine=15000/] });
  const next = Number(marker.match(/startLine=(\d+)/)?.[1]);
  const body = out.slice(0, out.length - marker.length);
  assert.ok(body.startsWith("line 100 "), "range must start at startLine");
  assert.equal(body.split("\n").length, next - 100, "startLine in the marker must follow the last line shown");
  const follow = await call(fileTools, "read", { path: "huge.log", startLine: next, endLine: next + 1 });
  assert.ok(follow.startsWith(`line ${next} `), "following the marker must continue at the next line");
});

await run("TC-3 read with startLine only -> next window of lines", async () => {
  const out = await call(fileTools, "read", { path: "huge.log", startLine: 401 });
  assertCapped(out, READ_CAP, { mustMatch: [/lines 401-800 of 20000/, /startLine=801/] });
});

await run("TC-4 read a single huge line -> cut inside the line with an explicit note", async () => {
  const out = await call(fileTools, "read", { path: "one-line.min.js" });
  assert.ok(out.length <= READ_CAP);
  assertCapped(out, READ_CAP, { mustMatch: [/of 300008 chars of line 1/, /too long/] });
});

await run("TC-5 read small file and small ranges -> unchanged from before Stage 2", async () => {
  assert.equal(await call(fileTools, "read", { path: "small.txt" }), "alpha\nbeta\ngamma\n");
  assert.equal(await call(fileTools, "read", { path: "small.txt", startLine: 2, endLine: 3 }), "beta\ngamma");
  assert.equal(await call(fileTools, "read", { path: "small.txt", startLine: 2 }), "beta\ngamma\n");
  assert.match(await call(fileTools, "read", { path: "small.txt", startLine: 9 }), /past the end of the file \(3 lines\)/);
});

// ── grep ────────────────────────────────────────────────────────────────────────────────────────────────────

await run("TC-19 grep over a minified line -> a window around the match with a per-line note; short lines unchanged", async () => {
  const grepWs = path.join(isolatedDataDir, "tool-output-caps-grep-ws");
  fs.mkdirSync(grepWs, { recursive: true });
  const minified = `${"a=1;".repeat(5_000)}NEEDLE();${"b=2;".repeat(5_000)}`; // 40,009 chars, match at index 20,000
  fs.writeFileSync(path.join(grepWs, "bundle.min.js"), `${minified}\n  short NEEDLE line  \n`);
  const tools = createFileTools(grepWs);
  const out = await call(tools, "grep", { pattern: "needle" });
  const [first, second] = out.split("\n");
  assert.equal(second, "bundle.min.js:2: short NEEDLE line", "short lines keep the old format");
  assert.ok(first.startsWith("bundle.min.js:1: ..."), first.slice(0, 60));
  assert.match(first, /NEEDLE\(\);/, "the window must contain the match");
  assert.ok(first.endsWith(`... [line cut: chars 19901-20200 of ${minified.length}]`), first.slice(-80));
  assert.equal(first.length, "bundle.min.js:1: ".length + 3 + caps.GREP_LINE_MAX_CHARS + 3 + ` [line cut: chars 19901-20200 of ${minified.length}]`.length);
  assert.equal(await call(tools, "grep", { pattern: "needle" }), out, "repeat call must be byte-identical");
  // 200 minified hits: every line is bounded, and the whole result still under the grep cap.
  fs.writeFileSync(path.join(grepWs, "many.min.js"), Array.from({ length: 200 }, () => minified).join("\n"));
  const many = await call(tools, "grep", { pattern: "needle", path: "many.min.js" });
  const lines = many.split("\n").filter((line) => line.startsWith("many.min.js:"));
  assert.ok(lines.length > 50, `grep with a file path must search that file (got ${lines.length} hit lines)`);
  assert.ok(lines.every((line) => line.length < 400), "every hit line must be bounded");
  assert.doesNotMatch(many, /bundle\.min\.js/, "a file path must limit the search to that file");
  assert.ok(many.length <= TOOL_OUTPUT_LIMITS.grep.maxChars + TOOL_OUTPUT_MARKER_MAX_CHARS);
});

// ── web_fetch ───────────────────────────────────────────────────────────────────────────────────────────────

const PAGE_URL = "http://203.0.113.10/huge-article"; // TEST-NET-3 literal: passes the SSRF guard without DNS
const hugeHtml = `<!doctype html><html><head><title>Huge article</title></head><body><article><h1>Huge article</h1>${
  Array.from({ length: 400 }, (_, i) => `<p>Paragraph ${i + 1}: ${"The quick brown fox jumps over the lazy dog. ".repeat(3)}</p>`).join("")
}</article></body></html>`;
const realFetch = globalThis.fetch;
const fetchLog = [];
globalThis.fetch = async (url) => {
  fetchLog.push(String(url));
  if (String(url) !== PAGE_URL) throw new Error(`smoke blocked network call to ${url}`);
  return new Response(hugeHtml, { status: 200, headers: { "content-type": "text/html" } });
};

await run("TC-6 web_fetch huge page (real tool, stubbed fetch) -> capped with a narrower-URL hint", async () => {
  const tools = [createWebFetchTool()];
  const out = await call(tools, "web_fetch", { url: PAGE_URL });
  assert.ok(out.startsWith("# Huge article"), `unexpected page head: ${out.slice(0, 80)}`);
  assertCapped(out, TOOL_OUTPUT_LIMITS.web_fetch.maxChars, { mustMatch: [/showed chars 1-18000 of \d+/, /more not shown/, /narrower URL/] });
  assert.equal(await call(tools, "web_fetch", { url: PAGE_URL }), out, "repeat call must be byte-identical");
  assert.deepEqual([...new Set(fetchLog)], [PAGE_URL], "only the stubbed URL may be fetched");
});

// A second copy of the web_fetch module (new URL = fresh module state) that reads a tiny worker timeout, so the
// readability worker cannot even start in time: the tool must fall back to plain text instead of returning an error.
process.env.NOVA_WEB_FETCH_PARSE_WORKER_TIMEOUT_MS = "50";
const { createWebFetchTool: createWebFetchToolFastTimeout, extractPlainTextFallback } = await import(
  `${dist("tools/web/web-fetch/index.js")}?worker-timeout-50ms`
);
process.env.NOVA_WEB_FETCH_PARSE_WORKER_TIMEOUT_MS = "15000";

await run("TC-17 web_fetch worker timeout on a huge page -> capped plain text with a note, not an error", async () => {
  const tools = [createWebFetchToolFastTimeout()];
  const out = await call(tools, "web_fetch", { url: PAGE_URL });
  assert.doesNotMatch(out, /^web_fetch error/, `fell through to an error: ${out.slice(0, 200)}`);
  assert.ok(out.startsWith(`# Huge article\n\nSource: ${PAGE_URL}\n\nNote: readable extraction failed (web_fetch worker parse timed out after 50ms)`), `unexpected head: ${out.slice(0, 240)}`);
  assert.match(out, /showing the page's plain text without formatting\.\n\nHuge article\nParagraph 1: The quick brown fox/);
  assert.doesNotMatch(out, /<p>|<\/p>|<article>/, "tags must be stripped");
  assertCapped(out, TOOL_OUTPUT_LIMITS.web_fetch.maxChars, { mustMatch: [/showed chars 1-18000 of \d+/, /narrower URL/] });
  assert.equal(await call(tools, "web_fetch", { url: PAGE_URL }), out, "repeat call must be byte-identical");
  assert.deepEqual([...new Set(fetchLog)], [PAGE_URL], "only the stubbed URL may be fetched");
});

await run("TC-18 plain-text fallback drops scripts/styles/comments, decodes entities, survives broken HTML", async () => {
  const html = "<!DOCTYPE html><html><head><title>A &amp; B</title><style>p{color:red}</style></head><body>"
    + "<script>var x = '<p>not text</p>';</script><!-- hidden --><div>one &lt; two&nbsp;&#65;&#x42;</div>"
    + "<p>a < b</p><SCRIPT type=x>still hidden</SCRIPT ><p>tail</p><script>never closed <p>gone";
  const { title, markdown } = extractPlainTextFallback(html, "fallback-host");
  assert.equal(title, "A & B");
  assert.equal(markdown, "one < two AB\na < b\ntail");
  assert.equal(extractPlainTextFallback("no tags at all", "host").title, "host");
  // Linear on a pathological page: 2 MB of unclosed "<script" openers must not backtrack.
  const started = Date.now();
  extractPlainTextFallback("<p>x</p>" + "<div>".repeat(200_000) + "<script>".repeat(50_000), "host");
  assert.ok(Date.now() - started < 3_000, `fallback took ${Date.now() - started}ms`);
});
globalThis.fetch = realFetch;

// ── memory_get / memory_search ──────────────────────────────────────────────────────────────────────────────

const HUGE_DOC = Array.from({ length: 4_000 }, (_, i) => `Fact ${i + 1}: the user prefers concise answers.`).join("\n");
const memoryTools = createMemoryTools({
  async getSourceContentByChunkId(chunkId) {
    return chunkId === "chunk-1" ? HUGE_DOC : null;
  },
  async search() {
    return Array.from({ length: 40 }, (_, i) => ({ chunkId: `chunk-${i}`, source: "MEMORY.md", score: 0.5, content: HUGE_DOC.slice(0, 2_000) }));
  },
});
const MEMORY_GET_CAP = TOOL_OUTPUT_LIMITS.memory_get.maxChars;

await run("TC-7 memory_get huge doc -> 12,000 chars and a marker with the next offset", async () => {
  assert.equal(MEMORY_GET_CAP, 12_000);
  const out = await call(memoryTools, "memory_get", { chunk_id: "chunk-1" });
  assertCapped(out, MEMORY_GET_CAP, {
    mustMatch: [new RegExp(`showed chars 1-12000 of ${HUGE_DOC.length}`), /offset=12000/, /chunk_id/],
  });
});

await run("TC-8 memory_get offset paging reassembles the whole source; old calls without offset still work", async () => {
  let offset = 0;
  let assembled = "";
  for (let page = 0; page < 50; page += 1) {
    const out = await call(memoryTools, "memory_get", offset > 0 ? { chunk_id: "chunk-1", offset } : { chunk_id: "chunk-1" });
    const marker = out.match(MARKER_RE)?.[0] || "";
    assembled += out.slice(0, out.length - marker.length);
    if (!marker) break;
    assert.match(marker, new RegExp(`showed chars ${offset + 1}-${offset + MEMORY_GET_CAP} of ${HUGE_DOC.length}`));
    offset = Number(marker.match(/offset=(\d+)/)?.[1]);
  }
  assert.equal(assembled, HUGE_DOC);
  assert.match(await call(memoryTools, "memory_get", { chunk_id: "chunk-1", offset: HUGE_DOC.length }), /past the end/);
  assert.match(await call(memoryTools, "memory_get", { chunk_id: "missing" }), /no source found/);
});

await run("TC-9 memory_search huge results -> 8,000-char cap", async () => {
  const out = await call(memoryTools, "memory_search", { query: "preferences", top_k: 40 });
  assertCapped(out, TOOL_OUTPUT_LIMITS.memory_search.maxChars, { mustMatch: [/top_k/] });
});

// ── exec ────────────────────────────────────────────────────────────────────────────────────────────────────

await run("TC-10 exec printing 200,000 chars -> 8,000-char cap", async () => {
  const tools = [createExecTool({ approvalMode: "auto", safeBinaries: [], workspaceDir: workspace })];
  const command = `"${process.execPath}" -e "process.stdout.write('x'.repeat(200000))"`;
  const out = await call(tools, "exec", { command });
  assertCapped(out, TOOL_OUTPUT_LIMITS.exec.maxChars, { mustMatch: [/of 200000/, /Narrow the command/] });
});

// ── browser_agent (stub: the real tool needs the agent-browser binary) ──────────────────────────────────────

const browserStub = [{
  name: "browser_agent",
  description: "stub",
  input_schema: { type: "object" },
  async execute() {
    return JSON.stringify({ snapshot: "node ".repeat(40_000) });
  },
}];

await run("TC-11 browser_agent huge output -> default 12,000 cap, hint offers maxOutputChars", async () => {
  const out = await call(browserStub, "browser_agent", { session: "browser:u:c", command: "snapshot" });
  assertCapped(out, 12_000, { mustMatch: [/showed chars 1-12000 of/, /maxOutputChars \(max 32000\)/] });
});

await run("TC-12 browser_agent maxOutputChars override is honored and clamped to 1,000-32,000", async () => {
  const at20k = await call(browserStub, "browser_agent", { session: "browser:u:c", command: "snapshot", maxOutputChars: 20_000 });
  assertCapped(at20k, 20_000, { mustMatch: [/1-20000/] });
  const over = await call(browserStub, "browser_agent", { session: "browser:u:c", command: "snapshot", maxOutputChars: 500_000 });
  const marker = assertCapped(over, 32_000, { mustMatch: [/1-32000/] });
  assert.doesNotMatch(marker, /raise maxOutputChars/, "at the maximum the hint must not suggest raising it");
  const under = await call(browserStub, "browser_agent", { session: "browser:u:c", command: "snapshot", maxOutputChars: 10 });
  assertCapped(under, 1_000, { mustMatch: [/1-1000 of/] });
});

// ── unknown / structured / failing tools ────────────────────────────────────────────────────────────────────

await run("TC-13 unknown tool with a huge result -> default cap and a generic hint", async () => {
  const tools = [{ name: "made_up_tool", description: "", input_schema: { type: "object" }, execute: async () => "z".repeat(250_000) }];
  const out = await call(tools, "made_up_tool", {});
  assertCapped(out, DEFAULT_TOOL_OUTPUT_MAX_CHARS, { mustMatch: [new RegExp(`1-${DEFAULT_TOOL_OUTPUT_MAX_CHARS} of 250000`), /narrower result/] });
  const small = "fine";
  const smallTools = [{ ...tools[0], execute: async () => small }];
  assert.equal(await call(smallTools, "made_up_tool", {}), small, "output under the cap must be returned unchanged");
});

await run("TC-14 structured JSON tools (gmail_*/coinbase_*) get the large ceiling; normal payloads stay intact", async () => {
  const payload = JSON.stringify({ ok: true, messages: Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, snippet: "s".repeat(200) })) });
  const tools = [{ name: "gmail_list_messages", description: "", input_schema: { type: "object" }, execute: async () => payload }];
  assert.equal(await call(tools, "gmail_list_messages", {}), payload, "a 30-row Gmail payload must not be cut");
  const huge = [{ ...tools[0], name: "coinbase_portfolio_report", execute: async () => "c".repeat(200_000) }];
  assertCapped(await call(huge, "coinbase_portfolio_report", {}), 64_000, { mustMatch: [/fewer items/] });
});

await run("TC-15 a failing tool echoing a huge input is capped too", async () => {
  const tools = [{ name: "write", description: "", input_schema: { type: "object" }, execute: async () => { throw new Error("disk full"); } }];
  const result = await executeToolUse({ id: "tf", name: "write", input: { path: "a.txt", content: "q".repeat(100_000) }, type: "tool_use" }, tools, {});
  assert.equal(result.is_error, true);
  assert.match(result.content, /^Tool execution failed: disk full/);
  assertCapped(result.content, DEFAULT_TOOL_OUTPUT_MAX_CHARS);
});

await run("TC-16 registry keeps every pre-Stage-2 limit (only read and memory_get changed on purpose)", async () => {
  const expected = { web_fetch: 18_000, web_search: 6_000, exec: 8_000, browser_agent: 12_000, memory_search: 8_000, memory_get: 12_000, read: 20_000, grep: 24_000 };
  for (const [name, maxChars] of Object.entries(expected)) assert.equal(TOOL_OUTPUT_LIMITS[name]?.maxChars, maxChars, name);
  assert.equal(caps.resolveToolOutputMaxChars("browser_agent", { maxOutputChars: 32_000 }), 32_000);
  assert.equal(caps.truncateInline("abcdef", 4), "abcd... [+2 chars]");
});

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
const failed = results.filter((result) => result.status === "FAIL").length;
console.log(`\ntool-output-caps: ${results.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
