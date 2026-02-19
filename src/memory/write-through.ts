import fs from "node:fs";
import path from "node:path";
import type { MemoryIndexManager } from "./manager.js";
import {
  buildMemoryFactMetadata,
  ensureMemoryTemplate,
  extractMemoryUpdateFact,
  isMemoryUpdateRequest,
  upsertMemoryFactInMarkdown,
} from "./markdown.js";

export interface MemoryWriteThroughResult {
  handled: boolean;
  response: string;
  memoryFilePath?: string;
  reindexMs?: number;
}

export async function applyMemoryWriteThrough(params: {
  input: string;
  personaWorkspaceDir: string;
  memoryManager: MemoryIndexManager | null;
  maxFactChars?: number;
}): Promise<MemoryWriteThroughResult> {
  const input = String(params.input || "");
  if (!isMemoryUpdateRequest(input)) {
    return { handled: false, response: "" };
  }

  const fact = extractMemoryUpdateFact(input);
  if (!fact) {
    return {
      handled: true,
      response: "Tell me exactly what to remember after 'update your memory'.",
    };
  }

  const memoryFilePath = path.join(params.personaWorkspaceDir, "MEMORY.md");
  try {
    fs.mkdirSync(path.dirname(memoryFilePath), { recursive: true });

    const existingContent = fs.existsSync(memoryFilePath)
      ? fs.readFileSync(memoryFilePath, "utf8")
      : ensureMemoryTemplate();
    const memoryMeta = buildMemoryFactMetadata(fact, params.maxFactChars ?? 280);
    const updatedContent = upsertMemoryFactInMarkdown(existingContent, memoryMeta.fact, memoryMeta.key);
    fs.writeFileSync(memoryFilePath, updatedContent, "utf8");

    let reindexMs = 0;
    if (params.memoryManager) {
      const start = Date.now();
      await params.memoryManager.indexFile(memoryFilePath);
      reindexMs = Date.now() - start;
    }

    const response = memoryMeta.hasStructuredField
      ? `Memory updated. I will remember this as current: ${memoryMeta.fact}`
      : `Memory updated. I saved: ${memoryMeta.fact}`;

    return {
      handled: true,
      response,
      memoryFilePath,
      ...(reindexMs > 0 ? { reindexMs } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      handled: true,
      response: `I couldn't update MEMORY.md: ${message}`,
      memoryFilePath,
    };
  }
}
