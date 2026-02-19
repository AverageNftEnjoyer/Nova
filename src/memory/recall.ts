import type { MemoryIndexManager } from "./manager.js";

function countApproxTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
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

  const results = await params.memoryManager.search(query, topK);
  if (!Array.isArray(results) || results.length === 0) return "";

  const blocks: string[] = [];
  let usedChars = 0;
  let usedTokens = 0;

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    if (!result) continue;
    const snippet = truncate(String(result.content || "").trim(), 600);
    if (!snippet) continue;
    const block = `[${i + 1}] ${String(result.source || "unknown")}\n${snippet}`;
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
