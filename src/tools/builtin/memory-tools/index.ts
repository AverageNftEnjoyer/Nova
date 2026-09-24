import type { MemoryIndexManager } from "../../../memory/manager/index.js";
import type { Tool } from "../../core/types/index.js";

// Output caps (memory_search 8,000, memory_get 12,000 chars) are applied by the executor (core/output-caps).

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
      return results
        .map(
          (result, index) =>
            `[${index + 1}] id=${result.chunkId}\nsource=${result.source}\nscore=${result.score.toFixed(4)}\n${result.content}`,
        )
        .join("\n\n");
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
        offset: {
          type: "number",
          description: "Character offset to start at (default 0); a truncation note names the next one.",
        },
      },
      required: ["chunk_id"],
      additionalProperties: false,
    },
    execute: async (input: { chunk_id?: string; offset?: number }) => {
      const chunkId = String(input?.chunk_id ?? "").trim();
      if (!chunkId) return "memory_get error: chunk_id is required";
      const source = await memoryManager.getSourceContentByChunkId(chunkId);
      if (!source) return `memory_get error: no source found for chunk ${chunkId}`;
      // The executor's cap names the next offset (core/output-caps), so the source can be read part by part.
      const requestedOffset = Number(input?.offset ?? 0);
      const offset = Number.isFinite(requestedOffset) && requestedOffset > 0 ? Math.floor(requestedOffset) : 0;
      if (offset === 0) return source;
      if (offset >= source.length) {
        return `memory_get error: offset ${offset} is past the end of this source (${source.length} chars).`;
      }
      return source.slice(offset);
    },
  };

  return [memorySearch, memoryGet];
}
