// ===== Memory System =====
// Handles memory fact extraction, validation, and MEMORY.md management.

import { MEMORY_FACT_MAX_CHARS } from "../constants.js";

export function normalizeMemoryFieldKey(rawField) {
  return String(rawField || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function extractMemoryUpdateFact(input) {
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

export function isMemoryUpdateRequest(input) {
  const raw = String(input || "").trim();
  if (!raw) return false;
  return (
    /update\s+(?:your|ur)\s+memory/i.test(raw) ||
    /remember\s+this/i.test(raw) ||
    /remember\s+that/i.test(raw)
  );
}

export function buildMemoryFactMetadata(factText) {
  const normalizedFact = String(factText || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, Math.max(60, MEMORY_FACT_MAX_CHARS));
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

export function ensureMemoryTemplate() {
  return [
    "# Persistent Memory",
    "This file is loaded into every conversation. Add important facts, decisions, and context here.",
    "",
    "## Important Facts",
    "",
  ].join("\n");
}

export function upsertMemoryFactInMarkdown(existingContent, factText, key) {
  const content = String(existingContent || "");
  const lines = content.length > 0 ? content.split(/\r?\n/) : ensureMemoryTemplate().split(/\r?\n/);
  const today = new Date().toISOString().slice(0, 10);
  const marker = key ? `[memory:${key}]` : "[memory:general]";
  const memoryLine = `- ${today}: ${marker} ${factText}`;

  const filtered = lines.filter((line) => {
    if (!key) return true;
    return !line.includes(`[memory:${key}]`);
  });

  const sectionIndex = filtered.findIndex(
    (line) => line.trim().toLowerCase() === "## important facts",
  );
  if (sectionIndex === -1) {
    if (filtered.length > 0 && filtered[filtered.length - 1].trim() !== "") filtered.push("");
    filtered.push("## Important Facts", "", memoryLine);
    return filtered.join("\n");
  }

  let insertAt = sectionIndex + 1;
  while (insertAt < filtered.length && filtered[insertAt].trim() === "") insertAt += 1;
  filtered.splice(insertAt, 0, memoryLine);

  // Keep MEMORY.md bounded: retain latest 80 tagged memory lines.
  const memoryLineIndexes = [];
  for (let i = 0; i < filtered.length; i += 1) {
    if (/\[memory:[a-z0-9-]+\]/i.test(filtered[i])) memoryLineIndexes.push(i);
  }
  const maxMemoryLines = 80;
  if (memoryLineIndexes.length > maxMemoryLines) {
    const removeCount = memoryLineIndexes.length - maxMemoryLines;
    const toRemove = new Set(memoryLineIndexes.slice(memoryLineIndexes.length - removeCount));
    return filtered.filter((_, idx) => !toRemove.has(idx)).join("\n");
  }

  return filtered.join("\n");
}
