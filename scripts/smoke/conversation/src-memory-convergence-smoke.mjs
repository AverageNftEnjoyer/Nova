import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildMemoryFactMetadata as buildLegacyMemoryFactMetadata,
  ensureMemoryTemplate as ensureLegacyMemoryTemplate,
  extractMemoryUpdateFact as extractLegacyMemoryUpdateFact,
  isMemoryUpdateRequest as isLegacyMemoryUpdateRequest,
  upsertMemoryFactInMarkdown as upsertLegacyMemoryFactInMarkdown,
} from "../../../src/memory/runtime-compat/index.js";

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

function approxTokens(text) {
  return Math.ceil(String(text || "").length / 3.5);
}

function normalizeVec(vec) {
  const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (!mag) return vec;
  return vec.map((v) => v / mag);
}

class DeterministicFlakyEmbeddings {
  constructor(params = {}) {
    this.failEvery = Number(params.failEvery || 0);
    this.callCount = 0;
  }

  async embed(text) {
    this.callCount += 1;
    if (this.failEvery > 0 && this.callCount % this.failEvery === 0) {
      throw new Error("deterministic-embed-failure");
    }
    const src = String(text || "");
    const vec = Array.from({ length: 128 }, (_, i) => {
      const code = src.charCodeAt(i % Math.max(1, src.length)) || 0;
      return ((code % 97) / 48.5) - 1;
    });
    return normalizeVec(vec);
  }

  async embedBatch(texts) {
    const out = [];
    for (const text of texts) out.push(await this.embed(text));
    return out;
  }
}

async function evaluateRecallSet(params) {
  const latencies = [];
  let hits = 0;
  let failures = 0;
  for (const item of params.queries) {
    const started = Date.now();
    try {
      const results = await params.manager.search(item.query, 3);
      const diag = params.manager.getLastSearchDiagnostics();
      const degradeInStrictMode = params.strictMode && diag.mode !== "hybrid";
      const effectiveResults = degradeInStrictMode ? [] : results;
      if (degradeInStrictMode) failures += 1;
      const hasHit = effectiveResults.some((row) =>
        String(row.content || "").toLowerCase().includes(String(item.expect).toLowerCase()),
      );
      if (hasHit) hits += 1;
    } catch {
      failures += 1;
    } finally {
      latencies.push(Date.now() - started);
    }
  }
  const total = Math.max(1, params.queries.length);
  const avgLatency = latencies.reduce((sum, v) => sum + v, 0) / Math.max(1, latencies.length);
  return {
    hitRate: hits / total,
    failureRate: failures / total,
    avgLatencyMs: avgLatency,
  };
}

const markdownModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "memory", "markdown.js")).href);
const recallModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "memory", "recall.js")).href);
const writeThroughModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "memory", "write-through.js")).href);
const managerModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "memory", "manager.js")).href);
const mmrModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "memory", "mmr.js")).href);
const temporalDecayModule = await import(pathToFileURL(path.join(process.cwd(), "dist", "memory", "temporal-decay.js")).href);

const {
  buildMemoryFactMetadata,
  ensureMemoryTemplate,
  extractMemoryUpdateFact,
  isMemoryUpdateRequest,
  upsertMemoryFactInMarkdown,
} = markdownModule;
const { buildMemoryRecallContext, injectMemoryRecallSection } = recallModule;
const { applyMemoryWriteThrough } = writeThroughModule;
const { MemoryIndexManager } = managerModule;
const { applyMmrRerank } = mmrModule;
const { applyTemporalDecayToSearchResults } = temporalDecayModule;

function createMemoryConfig(rootDir) {
  return {
    enabled: true,
    dbPath: path.join(rootDir, "memory.db"),
    embeddingProvider: "local",
    embeddingModel: "text-embedding-3-small",
    embeddingApiKey: "",
    chunkSize: 400,
    chunkOverlap: 80,
    hybridVectorWeight: 0.7,
    hybridBm25Weight: 0.3,
    topK: 5,
    syncOnSessionStart: true,
    sourceDirs: [path.join(rootDir, "memory")],
  };
}

await run("P6-C1 MEMORY.md update parity (legacy vs src memory markdown)", async () => {
  const input = "update your memory: my timezone is America/New_York";
  assert.equal(isMemoryUpdateRequest(input), isLegacyMemoryUpdateRequest(input));

  const srcFact = extractMemoryUpdateFact(input);
  const legacyFact = extractLegacyMemoryUpdateFact(input);
  assert.equal(srcFact, legacyFact);

  const srcMeta = buildMemoryFactMetadata(srcFact);
  const legacyMeta = buildLegacyMemoryFactMetadata(legacyFact);
  assert.equal(srcMeta.key, legacyMeta.key);
  assert.equal(srcMeta.hasStructuredField, legacyMeta.hasStructuredField);

  const srcTemplate = ensureMemoryTemplate();
  const legacyTemplate = ensureLegacyMemoryTemplate();
  assert.equal(srcTemplate.includes("## Important Facts"), true);
  assert.equal(legacyTemplate.includes("## Important Facts"), true);

  const srcUpdated = upsertMemoryFactInMarkdown(srcTemplate, srcMeta.fact, srcMeta.key);
  const legacyUpdated = upsertLegacyMemoryFactInMarkdown(legacyTemplate, legacyMeta.fact, legacyMeta.key);
  assert.equal(srcUpdated.includes("[memory:timezone]"), true);
  assert.equal(legacyUpdated.includes("[memory:timezone]"), true);
  assert.equal(srcUpdated.includes(srcMeta.fact), true);
  assert.equal(legacyUpdated.includes(legacyMeta.fact), true);

  const duplicateGeneral = "- 2026-02-19: [memory:general] that the nba indiana pacers arem y guys";
  const srcDuplicateSeed = `${srcTemplate}\n${duplicateGeneral}\n${duplicateGeneral}\n`;
  const legacyDuplicateSeed = `${legacyTemplate}\n${duplicateGeneral}\n${duplicateGeneral}\n`;
  const srcDeduped = upsertMemoryFactInMarkdown(srcDuplicateSeed, "that the nba indiana pacers arem y guys", "");
  const legacyDeduped = upsertLegacyMemoryFactInMarkdown(legacyDuplicateSeed, "that the nba indiana pacers arem y guys", "");
  const srcCount = (srcDeduped.match(/\[memory:general\]\s+that the nba indiana pacers arem y guys/gi) || []).length;
  const legacyCount = (legacyDeduped.match(/\[memory:general\]\s+that the nba indiana pacers arem y guys/gi) || []).length;
  assert.equal(srcCount, 1);
  assert.equal(legacyCount, 1);
});

await run("P6-C2 retrieval relevance + token budget bounds + no duplicate injection", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-memory-recall-smoke-"));
  const memoryDir = path.join(root, "memory");
  await fsp.mkdir(memoryDir, { recursive: true });

  const relevant = path.join(memoryDir, "profile.md");
  const noise = path.join(memoryDir, "noise.md");
  await fsp.writeFile(
    relevant,
    "# Profile\n\nMy timezone is America/New_York and my preferred stack is TypeScript.",
    "utf8",
  );
  await fsp.writeFile(
    noise,
    "# Notes\n\nUnrelated build logs and shell output that should rank lower for timezone queries.",
    "utf8",
  );

  const manager = new MemoryIndexManager(createMemoryConfig(root));
  await manager.indexFile(relevant);
  await manager.indexFile(noise);

  const recall = await buildMemoryRecallContext({
    memoryManager: manager,
    query: "what is my timezone",
    topK: 3,
    maxChars: 320,
    maxTokens: 80,
  });

  assert.equal(recall.length > 0, true);
  assert.equal(recall.toLowerCase().includes("timezone"), true);
  assert.equal(recall.length <= 320, true);
  assert.equal(approxTokens(recall) <= 80, true);

  const base = "## Identity\nYou are Nova.";
  const once = injectMemoryRecallSection(base, recall);
  const twice = injectMemoryRecallSection(once, recall);
  const marker = "## Live Memory Recall";
  assert.equal((twice.match(new RegExp(marker, "g")) || []).length, 1);
});

await run("P6-C3 fast reindex on write-through memory update", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-memory-write-smoke-"));
  const personaDir = path.join(root, "persona-user-a");
  await fsp.mkdir(personaDir, { recursive: true });

  const manager = new MemoryIndexManager(createMemoryConfig(root));
  const result = await applyMemoryWriteThrough({
    input: "remember this: my timezone is America/New_York",
    personaWorkspaceDir: personaDir,
    memoryManager: manager,
  });

  assert.equal(result.handled, true);
  assert.equal(String(result.response).startsWith("Memory updated."), true);
  assert.equal(typeof result.memoryFilePath === "string", true);
  assert.equal(fs.existsSync(String(result.memoryFilePath)), true);
  assert.equal(Number(result.reindexMs || 0) >= 0, true);
  assert.equal(Number(result.reindexMs || 0) <= 5000, true);

  const hits = await manager.search("timezone", 3);
  assert.equal(Array.isArray(hits), true);
  assert.equal(hits.length > 0, true);
  const joined = hits.map((hit) => String(hit.content || "")).join("\n").toLowerCase();
  assert.equal(joined.includes("timezone"), true);
});

await run("P6-C4 temporal intent + source diversity rerank behavior", async () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const rawResults = [
    {
      chunkId: "a-old",
      source: "/memory/source-a.md",
      content: "project alpha status update notes",
      score: 1.0,
      vectorScore: 0.9,
      bm25Score: 0.9,
      updatedAt: now - 180 * dayMs,
    },
    {
      chunkId: "a-new",
      source: "/memory/source-a.md",
      content: "latest project alpha status update with decisions",
      score: 0.97,
      vectorScore: 0.88,
      bm25Score: 0.91,
      updatedAt: now - 2 * dayMs,
    },
    {
      chunkId: "b-new",
      source: "/memory/source-b.md",
      content: "latest project alpha timeline and blockers",
      score: 0.96,
      vectorScore: 0.86,
      bm25Score: 0.9,
      updatedAt: now - 1 * dayMs,
    },
  ];

  const decayed = applyTemporalDecayToSearchResults(rawResults, {
    enabled: true,
    query: "latest project alpha status today",
    halfLifeDays: 45,
    temporalHalfLifeDays: 14,
    evergreenHalfLifeDays: 180,
    minMultiplier: 0.2,
  });

  const oldest = decayed.find((item) => item.chunkId === "a-old");
  const newest = decayed.find((item) => item.chunkId === "b-new");
  assert.equal(Boolean(oldest), true);
  assert.equal(Boolean(newest), true);
  assert.equal((newest?.score || 0) > (oldest?.score || 0), true);

  const reranked = applyMmrRerank(decayed, {
    enabled: true,
    lambda: 0.7,
    sourcePenaltyWeight: 0.2,
    maxPerSourceSoft: 1,
  });

  assert.equal(reranked.length >= 2, true);
  assert.equal(reranked[0]?.chunkId, "b-new");
});

await run("P19-C1 long-thread recall benchmark retains fixed critical facts under token pressure", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-memory-long-thread-smoke-"));
  const memoryDir = path.join(root, "memory");
  await fsp.mkdir(memoryDir, { recursive: true });

  const canonicalFacts = [
    "Project codename is Atlas.",
    "Primary deployment region is us-east-2.",
    "Incident bridge fallback channel is #atlas-war-room.",
  ];
  await fsp.writeFile(
    path.join(memoryDir, "canonical.md"),
    `# Canonical Facts\n\n${canonicalFacts.join("\n\n")}\n`,
    "utf8",
  );

  for (let i = 0; i < 40; i += 1) {
    await fsp.writeFile(
      path.join(memoryDir, `noise-${String(i).padStart(2, "0")}.md`),
      [
        `# Noise ${i}`,
        "",
        "Daily notes about unrelated shell logs and UI polish work.",
        "Random status updates with no deployment region details.",
        "Discussion about typography, spacing, and dashboard cards.",
      ].join("\n"),
      "utf8",
    );
  }

  const manager = new MemoryIndexManager(createMemoryConfig(root));
  await manager.sync();

  const recall = await buildMemoryRecallContext({
    memoryManager: manager,
    query: "what is the project codename and primary deployment region",
    topK: 6,
    maxChars: 900,
    maxTokens: 220,
  });

  const normalized = recall.toLowerCase();
  assert.equal(normalized.includes("atlas"), true);
  assert.equal(normalized.includes("us-east-2"), true);
  assert.equal(approxTokens(recall) <= 220, true);
});

await run("P0-C5 embedding reliability fallback improves hit-rate under deterministic failures", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-memory-embed-reliability-"));
  const memoryDir = path.join(root, "memory");
  await fsp.mkdir(memoryDir, { recursive: true });

  await fsp.writeFile(
    path.join(memoryDir, "profile.md"),
    [
      "# Profile",
      "",
      "Timezone is America/New_York.",
      "Preferred stack is TypeScript and Next.js.",
      "Project codename is Atlas.",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    path.join(memoryDir, "runbook.md"),
    [
      "# Runbook",
      "",
      "Incident bridge fallback channel is #atlas-war-room.",
      "Primary deployment region is us-east-2.",
    ].join("\n"),
    "utf8",
  );
  for (let i = 0; i < 25; i += 1) {
    await fsp.writeFile(
      path.join(memoryDir, `noise-${i}.md`),
      `# Noise ${i}\n\nUnrelated notes about dashboard spacing and CSS polish.`,
      "utf8",
    );
  }

  const queries = [
    { query: "what is my timezone", expect: "America/New_York" },
    { query: "what is the project codename", expect: "Atlas" },
    { query: "where is deployment region", expect: "us-east-2" },
    { query: "what fallback channel during incidents", expect: "atlas-war-room" },
  ];

  const createEvalConfig = (dbRoot) => ({
    ...createMemoryConfig(dbRoot),
    sourceDirs: [memoryDir],
  });
  const baselineRoot = path.join(root, "baseline");
  const improvedRoot = path.join(root, "improved");
  await fsp.mkdir(baselineRoot, { recursive: true });
  await fsp.mkdir(improvedRoot, { recursive: true });

  const baselineProvider = new DeterministicFlakyEmbeddings({ failEvery: 3 });
  const baseline = new MemoryIndexManager(createEvalConfig(baselineRoot), {
    provider: baselineProvider,
    fallbackProvider: baselineProvider,
    staleReindexBudgetMs: 50,
  });
  await baseline.sync();
  const before = await evaluateRecallSet({
    manager: baseline,
    queries,
    strictMode: true,
  });

  const improved = new MemoryIndexManager(createEvalConfig(improvedRoot), {
    provider: new DeterministicFlakyEmbeddings({ failEvery: 3 }),
    staleReindexBudgetMs: 50,
  });
  await improved.sync();
  const after = await evaluateRecallSet({
    manager: improved,
    queries,
    strictMode: false,
  });

  console.log(
    `[P0-C5] before hit=${before.hitRate.toFixed(3)} fail=${before.failureRate.toFixed(3)} lat=${before.avgLatencyMs.toFixed(1)}ms`,
  );
  console.log(
    `[P0-C5] after  hit=${after.hitRate.toFixed(3)} fail=${after.failureRate.toFixed(3)} lat=${after.avgLatencyMs.toFixed(1)}ms`,
  );

  assert.equal(after.hitRate >= before.hitRate + 0.2, true);
  assert.equal(after.failureRate <= before.failureRate, true);
  assert.equal(after.avgLatencyMs <= before.avgLatencyMs + 40, true);
});

await run("P0-C6 diagnostics are available before/after search and survive malformed payload access patterns", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-memory-diag-shape-"));
  const memoryDir = path.join(root, "memory");
  await fsp.mkdir(memoryDir, { recursive: true });
  await fsp.writeFile(path.join(memoryDir, "profile.md"), "# Profile\n\nTimezone is America/New_York.", "utf8");
  const manager = new MemoryIndexManager(createMemoryConfig(root));
  const initial = manager.getLastSearchDiagnostics();
  assert.equal(initial.hasSearch, false);
  assert.equal(initial.updatedAtMs, 0);
  await manager.sync();
  const outcome = await manager.searchWithDiagnostics("timezone", 3, "diag-shape-1");
  assert.equal(Array.isArray(outcome.results), true);
  assert.equal(outcome.diagnostics.hasSearch, true);
  assert.equal(outcome.diagnostics.updatedAtMs > 0, true);
  assert.equal(typeof outcome.diagnostics.staleSourcesBefore, "number");
  assert.equal(typeof outcome.diagnostics.staleSourcesAfter, "number");
  assert.equal(typeof outcome.diagnostics.staleReindexTimedOut, "boolean");
  const fetched = manager.getSearchDiagnostics("diag-shape-1");
  assert.equal(Boolean(fetched), true);
  assert.equal(fetched?.updatedAtMs === outcome.diagnostics.updatedAtMs, true);
  assert.equal(manager.getSearchDiagnostics(""), null);
  assert.equal(manager.getSearchDiagnostics("missing-id"), null);
});

await run("P0-C7 diagnostics remain request-scoped under concurrent searches", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-memory-diag-concurrency-"));
  const memoryDir = path.join(root, "memory");
  await fsp.mkdir(memoryDir, { recursive: true });
  await fsp.writeFile(path.join(memoryDir, "a.md"), "# A\n\nProject codename is Atlas.", "utf8");
  await fsp.writeFile(path.join(memoryDir, "b.md"), "# B\n\nPrimary deployment region is us-east-2.", "utf8");
  const manager = new MemoryIndexManager(createMemoryConfig(root));
  await manager.sync();
  const [a, b] = await Promise.all([
    manager.searchWithDiagnostics("project codename", 3, "q-a"),
    manager.searchWithDiagnostics("deployment region", 3, "q-b"),
  ]);
  const byA = manager.getSearchDiagnostics("q-a");
  const byB = manager.getSearchDiagnostics("q-b");
  assert.equal(Boolean(byA), true);
  assert.equal(Boolean(byB), true);
  assert.equal(byA?.updatedAtMs === a.diagnostics.updatedAtMs, true);
  assert.equal(byB?.updatedAtMs === b.diagnostics.updatedAtMs, true);
  assert.equal(Array.isArray(a.results), true);
  assert.equal(Array.isArray(b.results), true);
});

await run("P0-C8 stale diagnostics track before/after state when reindex completes", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "nova-memory-diag-stale-"));
  const memoryDir = path.join(root, "memory");
  await fsp.mkdir(memoryDir, { recursive: true });
  const profile = path.join(memoryDir, "profile.md");
  await fsp.writeFile(profile, "# Profile\n\nTimezone is America/New_York.", "utf8");
  const manager = new MemoryIndexManager(createMemoryConfig(root), { staleReindexBudgetMs: 1000, staleScanTtlMs: 0 });
  await manager.sync();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await fsp.writeFile(profile, "# Profile\n\nTimezone is America/Chicago.", "utf8");
  const outcome = await manager.searchWithDiagnostics("timezone", 3, "stale-check");
  assert.equal(outcome.diagnostics.staleSourcesBefore >= 1, true);
  assert.equal(outcome.diagnostics.staleReindexAttempted, true);
  assert.equal(outcome.diagnostics.staleReindexCompleted, true);
  assert.equal(outcome.diagnostics.staleSourcesAfter, 0);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
