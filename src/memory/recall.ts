import type { MemoryIndexManager } from "./manager.js";
import { extractMemoryQueryKeywords } from "./query-expansion.js";

function countApproxTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function tokenize(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function splitSentences(text: string): string[] {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractSalientSnippet(params: {
  content: string;
  queryKeywords: string[];
  maxChars: number;
}): string {
  const sentences = splitSentences(params.content);
  if (sentences.length === 0) {
    return truncate(String(params.content || "").trim(), params.maxChars);
  }

  const keywordSet = new Set(params.queryKeywords);
  const ranked = sentences
    .map((sentence, idx) => {
      const tokens = tokenize(sentence);
      let overlap = 0;
      for (const token of tokens) {
        if (keywordSet.has(token)) overlap += 1;
      }
      const density = tokens.length > 0 ? overlap / tokens.length : 0;
      const positionBias = Math.max(0, 1 - idx * 0.04);
      const score = overlap * 1.5 + density * 2 + positionBias;
      return { sentence, score, idx };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.idx - b.idx;
    });

  const selected: string[] = [];
  let used = 0;
  for (const item of ranked) {
    const candidate = item.sentence;
    if (!candidate) continue;
    const extra = candidate.length + (selected.length > 0 ? 1 : 0);
    if (used + extra > params.maxChars) continue;
    selected.push(candidate);
    used += extra;
    if (used >= params.maxChars * 0.85) break;
  }

  if (selected.length === 0) {
    return truncate(sentences[0] || String(params.content || "").trim(), params.maxChars);
  }
  return truncate(selected.join(" "), params.maxChars);
}

function toSourceLabel(source: string): string {
  const normalized = String(source || "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return "unknown";
  return parts.slice(-2).join("/");
}

function fingerprint(text: string): string {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .trim();
  return normalized.slice(0, 180);
}

export async function buildMemoryRecallContext(params: {
  memoryManager: MemoryIndexManager;
  query: string;
  topK?: number;
  maxChars?: number;
  maxTokens?: number;
}): Promise<string> {
  const query = String(params.query || "").trim();
  if (!query) return "";

  const topK = Math.max(1, Number(params.topK ?? 3));
  const maxChars = Math.max(200, Number(params.maxChars ?? 2200));
  const maxTokens = Math.max(80, Number(params.maxTokens ?? 480));
  const queryKeywords = extractMemoryQueryKeywords(query);

  const results = await params.memoryManager.search(query, topK);
  if (!Array.isArray(results) || results.length === 0) return "";

  const blocks: string[] = [];
  let usedChars = 0;
  let usedTokens = 0;
  const seenFingerprints = new Set<string>();
  const perBlockMaxChars = Math.max(180, Math.floor(maxChars / Math.max(1, Math.min(results.length, topK))));

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    if (!result) continue;
    const snippet = extractSalientSnippet({
      content: String(result.content || "").trim(),
      queryKeywords,
      maxChars: Math.min(700, perBlockMaxChars + 220),
    });
    if (!snippet) continue;
    const fp = fingerprint(snippet);
    if (!fp || seenFingerprints.has(fp)) continue;
    seenFingerprints.add(fp);

    const sourceLabel = toSourceLabel(String(result.source || "unknown"));
    const block = `[${i + 1}] ${sourceLabel} score=${Number(result.score || 0).toFixed(3)}\n${snippet}`;
    const blockTokens = countApproxTokens(block);
    if (usedChars + block.length > maxChars || usedTokens + blockTokens > maxTokens) {
      break;
    }
    blocks.push(block);
    usedChars += block.length;
    usedTokens += blockTokens;
  }

  return blocks.join("\n\n").trim();
}

export function injectMemoryRecallSection(systemPrompt: string, recallContext: string): string {
  const base = String(systemPrompt || "");
  const context = String(recallContext || "").trim();
  if (!context) return base;
  if (base.includes("## Live Memory Recall")) return base;
  return `${base}\n\n## Live Memory Recall\nUse this indexed context when relevant:\n${context}`;
}
