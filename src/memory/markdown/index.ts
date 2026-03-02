export function normalizeMemoryFieldKey(rawField: string): string {
  return String(rawField || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function extractMemoryUpdateFact(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const directPatterns = [
    /update\s+(?:your|ur)\s+memory(?:\s+to\s+this)?\s*[:,-]?\s*(.+)$/i,
    /remember\s+this\s*[:,-]?\s*(.+)$/i,
    /remember\s+that\s*[:,-]?\s*(.+)$/i,
  ];
  for (const pattern of directPatterns) {
    const match = raw.match(pattern);
    if (match) return String(match[1] || "").trim();
  }
  return "";
}

export function isMemoryUpdateRequest(input: string): boolean {
  const raw = String(input || "").trim();
  if (!raw) return false;
  return (
    /update\s+(?:your|ur)\s+memory/i.test(raw) ||
    /remember\s+this/i.test(raw) ||
    /remember\s+that/i.test(raw)
  );
}

export function buildMemoryFactMetadata(
  factText: string,
  maxFactChars = 280,
): {
  fact: string;
  key: string;
  hasStructuredField: boolean;
} {
  const normalizedFact = String(factText || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, Math.max(60, maxFactChars));
  const relationMatch = normalizedFact.match(
    /^(?:my|our)\s+(.+?)\s+(?:is|are|was|were|equals|=)\s+(.+)$/i,
  );
  const field = relationMatch ? String(relationMatch[1] || "").trim() : "";
  const value = relationMatch ? String(relationMatch[2] || "").trim() : "";
  const key = field ? normalizeMemoryFieldKey(field) : "";
  return {
    fact: normalizedFact,
    key,
    hasStructuredField: Boolean(field && value),
  };
}

export function ensureMemoryTemplate(): string {
  return [
    "# Persistent Memory",
    "This file is loaded into every conversation. Add important facts, decisions, and context here.",
    "",
    "## Important Facts",
    "",
  ].join("\n");
}

export function upsertMemoryFactInMarkdown(existingContent: string, factText: string, key: string): string {
  const content = String(existingContent || "");
  const lines = content.length > 0 ? content.split(/\r?\n/) : ensureMemoryTemplate().split(/\r?\n/);
  const today = new Date().toISOString().slice(0, 10);
  const marker = key ? `[memory:${key}]` : "[memory:general]";
  const memoryLine = `- ${today}: ${marker} ${factText}`;
  const normalizedIncomingFact = String(factText || "").trim().replace(/\s+/g, " ").toLowerCase();

  const filtered = lines.filter((line) => {
    if (key) {
      return !line.includes(`[memory:${key}]`);
    }

    const match = /^\s*-\s+\d{4}-\d{2}-\d{2}:\s+\[memory:([a-z0-9-]+)\]\s*(.+)\s*$/i.exec(line);
    if (!match) return true;
    const markerKey = String(match[1] || "").toLowerCase();
    const existingFact = String(match[2] || "").trim().replace(/\s+/g, " ").toLowerCase();
    if (markerKey !== "general") return true;
    return existingFact !== normalizedIncomingFact;
  });

  const sectionIndex = filtered.findIndex(
    (line) => line.trim().toLowerCase() === "## important facts",
  );
  if (sectionIndex === -1) {
    if (filtered.length > 0 && filtered[filtered.length - 1]?.trim() !== "") filtered.push("");
    filtered.push("## Important Facts", "", memoryLine);
    return filtered.join("\n");
  }

  let insertAt = sectionIndex + 1;
  while (insertAt < filtered.length && filtered[insertAt]?.trim() === "") insertAt += 1;
  filtered.splice(insertAt, 0, memoryLine);

  const memoryLineIndexes: number[] = [];
  for (let i = 0; i < filtered.length; i += 1) {
    if (/\[memory:[a-z0-9-]+\]/i.test(filtered[i] || "")) memoryLineIndexes.push(i);
  }
  const maxMemoryLines = 80;
  if (memoryLineIndexes.length > maxMemoryLines) {
    const removeCount = memoryLineIndexes.length - maxMemoryLines;
    const toRemove = new Set(memoryLineIndexes.slice(memoryLineIndexes.length - removeCount));
    return filtered.filter((_, idx) => !toRemove.has(idx)).join("\n");
  }

  return filtered.join("\n");
}
