import type { MemoryIndexManager } from "../memory/manager.js";
import type { Tool } from "./types.js";

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated]`;
}

export function createMemoryTools(memoryManager: MemoryIndexManager): Tool[] {
  const memorySearch: Tool = {
    name: "memory_search",
    description: "Search indexed memory chunks by semantic + keyword relevance.",
    capabilities: ["memory.read"],
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        top_k: { type: "number" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (input: { query?: string; top_k?: number }) => {
      const query = String(input?.query ?? "").trim();
      if (!query) return "memory_search error: query is required";
      const topK = Number(input?.top_k ?? 5);
      const results = await memoryManager.search(query, Number.isFinite(topK) ? topK : 5);
      if (results.length === 0) return "No memory results.";
      return truncate(
        results
          .map(
            (result, index) =>
              `[${index + 1}] id=${result.chunkId}\nsource=${result.source}\nscore=${result.score.toFixed(4)}\n${result.content}`,
          )
          .join("\n\n"),
        8000,
      );
    },
  };

  const memoryGet: Tool = {
    name: "memory_get",
    description: "Fetch the full source content for a memory chunk id.",
    capabilities: ["memory.read"],
    input_schema: {
      type: "object",
      properties: {
        chunk_id: { type: "string" },
      },
      required: ["chunk_id"],
      additionalProperties: false,
    },
    execute: async (input: { chunk_id?: string }) => {
      const chunkId = String(input?.chunk_id ?? "").trim();
      if (!chunkId) return "memory_get error: chunk_id is required";
      const source = await memoryManager.getSourceContentByChunkId(chunkId);
      if (!source) return `memory_get error: no source found for chunk ${chunkId}`;
      return truncate(source, 32_000);
    },
  };

  return [memorySearch, memoryGet];
}
