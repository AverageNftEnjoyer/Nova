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
} from "../../src/memory/runtime-compat.js";

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

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
