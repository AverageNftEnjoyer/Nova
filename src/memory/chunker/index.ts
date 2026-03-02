import crypto from "node:crypto";
import type { Chunk } from "../types/index.js";

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function extractLastHeading(text: string): string | null {
  const matches = text.match(/^#{1,6}\s+.+$/gm);
  if (!matches || matches.length === 0) {
    return null;
  }
  return matches[matches.length - 1]?.trim() ?? null;
}

export function chunkMarkdown(
  content: string,
  source: string,
  chunkSize = 400,
  overlap = 80,
): Chunk[] {
  const maxChars = Math.max(400, chunkSize * 4);
  const overlapChars = Math.max(0, overlap * 4);
  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let current = "";
  let currentStartLine = 1;
  let consumedChars = 0;
  let lastHeading: string | null = null;

  const flush = (forceHeading: string | null) => {
    const body = current.trim();
    if (!body) return;

    const text = forceHeading && !body.startsWith(forceHeading) ? `${forceHeading}\n\n${body}` : body;
    const startLine = currentStartLine;
    const endLine = startLine + Math.max(0, countLines(body) - 1);

    chunks.push({
      id: `${source}:${hashText(`${startLine}:${endLine}:${text}`)}`,
      source,
      content: text,
      startLine,
      endLine,
      ...(forceHeading ? { heading: forceHeading } : {}),
    });

    if (overlapChars <= 0) {
      current = "";
      consumedChars += body.length;
      currentStartLine = countLines(content.slice(0, consumedChars + 1));
      return;
    }

    const overlapSlice = body.slice(-overlapChars).trim();
    consumedChars += body.length;
    current = overlapSlice;
    currentStartLine = Math.max(1, endLine - countLines(overlapSlice) + 1);
  };

  let cursorLine = 1;
  for (const paragraph of paragraphs) {
    const headingInParagraph = extractLastHeading(paragraph);
    if (headingInParagraph) {
      lastHeading = headingInParagraph;
    }

    const nextBlock = current ? `${current}\n\n${paragraph}` : paragraph;
    if (nextBlock.length > maxChars && current) {
      flush(lastHeading);
    }

    if (!current) {
      currentStartLine = cursorLine;
    }

    current = current ? `${current}\n\n${paragraph}` : paragraph;
    cursorLine += countLines(paragraph) + 1;

    while (current.length > maxChars) {
      const splitAt = current.lastIndexOf("\n\n", maxChars);
      const safeSplit = splitAt > Math.floor(maxChars * 0.5) ? splitAt : maxChars;
      const chunkText = current.slice(0, safeSplit).trim();
      const remainder = current.slice(safeSplit).trim();
      current = chunkText;
      flush(lastHeading);
      current = remainder;
      currentStartLine = Math.max(1, cursorLine - countLines(remainder));
    }
  }

  flush(lastHeading);
  return chunks;
}
