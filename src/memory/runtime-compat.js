// ===== Memory System =====
// Handles memory fact extraction, validation, and MEMORY.md management.

import { MEMORY_FACT_MAX_CHARS } from "../runtime/core/constants.js";

const AUTO_MEMORY_ENABLED = String(process.env.NOVA_AUTO_MEMORY_ENABLED || "1").trim() !== "0";
const AUTO_MEMORY_MAX_FACTS = Math.max(
  1,
  Number.parseInt(process.env.NOVA_AUTO_MEMORY_MAX_FACTS || "2", 10) || 2,
);

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

function normalizeFactText(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^["']+|["']+$/g, "")
    .slice(0, Math.max(60, MEMORY_FACT_MAX_CHARS));
}

function sanitizeValue(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.?!]+$/g, "")
    .replace(/^["']+|["']+$/g, "");
}

function isQuestionLike(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return false;
  if (text.endsWith("?")) return true;
  return /^(what|why|how|when|where|who|can|could|would|will|is|are|do|does|did|should)\b/.test(text);
}

function isWeakPreferenceValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || ["this", "that", "it", "things", "stuff"].includes(normalized);
}

function pushCandidate(out, fact, key) {
  const normalizedFact = normalizeFactText(fact);
  if (!normalizedFact) return;
  out.push({
    fact: normalizedFact,
    key: normalizeMemoryFieldKey(key || normalizedFact.slice(0, 42)),
  });
}

export function extractAutoMemoryFacts(input) {
  if (!AUTO_MEMORY_ENABLED) return [];
  const raw = String(input || "").trim();
  if (!raw || raw.length < 6 || raw.length > 260) return [];
  if (isQuestionLike(raw)) return [];
  if (isMemoryUpdateRequest(raw)) return [];

  const text = raw.replace(/\s+/g, " ");
  const out = [];

  const callMe = text.match(/(?:^|\b)call me\s+([a-z][a-z0-9' -]{1,40})$/i);
  if (callMe) {
    const preferredName = sanitizeValue(callMe[1]);
    if (preferredName) {
      pushCandidate(out, `My preferred name is ${preferredName}`, "preferred-name");
    }
  }

  const myName = text.match(/^(?:my name is|i am called|i go by)\s+([a-z][a-z0-9' -]{1,40})$/i);
  if (myName) {
    const preferredName = sanitizeValue(myName[1]);
    if (preferredName) {
      pushCandidate(out, `My preferred name is ${preferredName}`, "preferred-name");
    }
  }

  const timezone = text.match(/^(?:my|our)\s+(?:timezone|time zone)\s+(?:is|=)\s+([a-z0-9_/:+\- ]{2,80})$/i);
  if (timezone) {
    const value = sanitizeValue(timezone[1]);
    if (value) {
      pushCandidate(out, `My timezone is ${value}`, "timezone");
    }
  }

  const pronouns = text.match(/^(?:my|our)\s+pronouns\s+(?:are|=)\s+([a-z/ ]{2,60})$/i);
  if (pronouns) {
    const value = sanitizeValue(pronouns[1]);
    if (value) {
      pushCandidate(out, `My pronouns are ${value}`, "pronouns");
    }
  }

  const prefer = text.match(/^(?:i|we)\s+(?:prefer|like)\s+(.+)$/i);
  if (prefer) {
    const value = sanitizeValue(prefer[1]);
    if (!isWeakPreferenceValue(value)) {
      const keySuffix = normalizeMemoryFieldKey(value.slice(0, 28));
      pushCandidate(out, `I prefer ${value}`, `preference-${keySuffix || "general"}`);
    }
  }

  const dislike = text.match(/^(?:i|we)\s+(?:dislike|hate|do not like|don't like)\s+(.+)$/i);
  if (dislike) {
    const value = sanitizeValue(dislike[1]);
    if (!isWeakPreferenceValue(value)) {
      const keySuffix = normalizeMemoryFieldKey(value.slice(0, 28));
      pushCandidate(out, `I dislike ${value}`, `dislike-${keySuffix || "general"}`);
    }
  }

  const generic = text.match(
    /^(?:my|our)\s+([a-z0-9][a-z0-9 _-]{1,48})\s+(?:is|are|was|were|=)\s+(.+)$/i,
  );
  if (generic) {
    const field = sanitizeValue(generic[1]);
    const value = sanitizeValue(generic[2]);
    const key = normalizeMemoryFieldKey(field);
    if (field && value && key && value.length <= Math.max(80, MEMORY_FACT_MAX_CHARS)) {
      pushCandidate(out, `My ${field} is ${value}`, key);
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const candidate of out) {
    const marker = `${candidate.key}|${candidate.fact.toLowerCase()}`;
    if (seen.has(marker)) continue;
    seen.add(marker);
    deduped.push(candidate);
  }

  return deduped.slice(0, AUTO_MEMORY_MAX_FACTS);
}
