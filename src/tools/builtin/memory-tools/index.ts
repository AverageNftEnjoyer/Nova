import type { MemoryIndexManager } from "../../../memory/manager/index.js";
import type { Tool } from "../../core/types/index.js";
import { MEMORY_GET_PAGE_CHARS, pageTextByOffset } from "../../core/output-caps/index.js";

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
      // Output cap: memory_search entry in src/tools/core/output-caps (applied by the executor).
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
    description: "Fetch the source content for a memory chunk id. Long sources come in parts (see offset).",
    capabilities: ["memory.read"],
    input_schema: {
      type: "object",
      properties: {
        chunk_id: { type: "string" },
        offset: { type: "number" },
      },
      required: ["chunk_id"],
      additionalProperties: false,
    },
    execute: async (input: { chunk_id?: string; offset?: number }) => {
      const chunkId = String(input?.chunk_id ?? "").trim();
      if (!chunkId) return "memory_get error: chunk_id is required";
      const source = await memoryManager.getSourceContentByChunkId(chunkId);
      if (!source) return `memory_get error: no source found for chunk ${chunkId}`;
      return pageTextByOffset({
        text: source,
        offset: input?.offset,
        pageChars: MEMORY_GET_PAGE_CHARS,
        nextCall: (nextOffset) => `call memory_get with {"chunk_id": ${JSON.stringify(chunkId)}, "offset": ${nextOffset}}.`,
      }).page;
    },
  };

  return [memorySearch, memoryGet];
}
