function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeComparable(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function buildEmptyConstraints() {
  return {
    enabled: false,
    instructions: "",
    oneWord: false,
    exactBulletCount: 0,
    jsonOnly: false,
    requiredJsonKeys: [],
    sentenceCount: 0,
  };
}

function extractRequestedJsonKeys(raw) {
  const match = String(raw || "").match(/\bkeys?\b([^.?!\n]*)/i);
  if (!match?.[1]) return [];
  const clause = String(match[1] || "")
    .replace(/^\s*(?:are|is|=|:|with)\s+/i, "")
    .replace(/\b(top[- ]level|only|just|required|json|object)\b/gi, " ")
    .replace(/\band\b/gi, ",");
  const stopWords = new Set(["key", "keys", "with", "and", "or"]);
  const deduped = [];
  for (const token of clause.split(/[^a-z0-9_-]+/gi)) {
    const cleaned = String(token || "").trim().toLowerCase();
    if (!cleaned) continue;
    if (stopWords.has(cleaned)) continue;
    if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(cleaned)) continue;
    if (deduped.includes(cleaned)) continue;
    deduped.push(cleaned);
    if (deduped.length >= 8) break;
  }
  return deduped;
}

export function parseOutputConstraints(text) {
  const raw = normalizeText(text);
  if (!raw) return buildEmptyConstraints();

  const next = buildEmptyConstraints();
  const rules = [];

  if (/\b(?:answer|respond)\s+(?:with|in)\s+one[- ]word\b/i.test(raw)) {
    next.oneWord = true;
    rules.push("Return exactly one word with no extra words.");
  }

  const exactBulletMatch = raw.match(/\bexactly\s+(\d{1,2})\s+bullet(?:\s+points?)?\b/i);
  const exactBulletCount = Number.parseInt(String(exactBulletMatch?.[1] || "0"), 10);
  if (Number.isFinite(exactBulletCount) && exactBulletCount > 0) {
    next.exactBulletCount = exactBulletCount;
    rules.push(`Return exactly ${exactBulletCount} bullet points.`);
    rules.push('Each bullet line must start with "- ".');
  }

  if (/\bjson\s+only\b/i.test(raw)) {
    next.jsonOnly = true;
    rules.push("Return raw JSON only with no markdown or prose outside the JSON.");
    const requestedKeys = extractRequestedJsonKeys(raw);
    if (requestedKeys.length > 0) {
      next.requiredJsonKeys = requestedKeys;
      rules.push(`JSON object must include exactly these top-level keys: ${requestedKeys.join(", ")}.`);
      rules.push("Do not include any additional top-level keys.");
    }
  }

  if (/\btwo\s+short\s+sentences\b/i.test(raw) || /\bexactly\s+two\s+sentences\b/i.test(raw)) {
    next.sentenceCount = 2;
    rules.push("Return exactly two short sentences.");
  } else if (/\bin\s+one\s+sentence\b/i.test(raw) || /\bexactly\s+one\s+sentence\b/i.test(raw)) {
    next.sentenceCount = 1;
    rules.push("Return exactly one sentence.");
  }

  next.enabled = rules.length > 0;
  next.instructions = rules.join("\n");
  return next;
}

export function countSentences(text) {
  const normalized = normalizeText(text).replace(/\n+/g, " ");
  if (!normalized) return 0;
  const matches = normalized.match(/[^.!?]+[.!?]+(?=\s|$)/g);
  if (Array.isArray(matches) && matches.length > 0) return matches.length;
  return normalized ? 1 : 0;
}

function isSingleWord(text) {
  const trimmed = normalizeText(text);
  if (!trimmed) return false;
  const tokens = trimmed.split(/\s+/g).filter(Boolean);
  if (tokens.length !== 1) return false;
  const token = tokens[0].replace(/^[`"'([{]+|[`"')\]}.,!?;:]+$/g, "");
  return Boolean(token) && !/\s/.test(token);
}

function parseJsonOnly(text, requiredKeys = []) {
  const trimmed = normalizeText(text);
  if (!trimmed) return { ok: false, reason: "empty_reply" };
  if (/^```/m.test(trimmed)) return { ok: false, reason: "json_only_markdown_fence" };
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return { ok: false, reason: "json_only_non_json_prefix" };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: "json_only_invalid_json" };
  }
  if (Array.isArray(requiredKeys) && requiredKeys.length > 0) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "json_required_object" };
    }
    const presentKeys = Object.keys(parsed).map((key) => String(key || "").trim().toLowerCase()).filter(Boolean);
    for (const key of requiredKeys) {
      if (!presentKeys.includes(String(key || "").trim().toLowerCase())) {
        return { ok: false, reason: `json_missing_key:${key}` };
      }
    }
    for (const key of presentKeys) {
      if (!requiredKeys.includes(key)) {
        return { ok: false, reason: `json_extra_key:${key}` };
      }
    }
  }
  return { ok: true, reason: "" };
}

function parseBulletConstraint(text, expectedCount) {
  const lines = normalizeText(text).split(/\n+/g).map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => line.startsWith("- "));
  if (bullets.length !== expectedCount) {
    return { ok: false, reason: `exact_bullet_count_mismatch:${expectedCount}` };
  }
  if (bullets.length !== lines.length) {
    return { ok: false, reason: "bullet_contains_non_bullet_lines" };
  }
  return { ok: true, reason: "" };
}

export function validateOutputConstraints(reply, constraints) {
  const active = constraints && typeof constraints === "object" ? constraints : buildEmptyConstraints();
  if (!active.enabled) return { ok: true, reason: "" };

  const text = normalizeText(reply);
  if (!text) return { ok: false, reason: "empty_reply" };

  if (active.oneWord && !isSingleWord(text)) {
    return { ok: false, reason: "requires_one_word" };
  }

  if (Number(active.exactBulletCount || 0) > 0) {
    const bulletCheck = parseBulletConstraint(text, Number(active.exactBulletCount));
    if (!bulletCheck.ok) return bulletCheck;
  }

  if (active.jsonOnly) {
    const jsonCheck = parseJsonOnly(text, Array.isArray(active.requiredJsonKeys) ? active.requiredJsonKeys : []);
    if (!jsonCheck.ok) return jsonCheck;
  }

  if (Number(active.sentenceCount || 0) > 0) {
    const observed = countSentences(text);
    if (observed !== Number(active.sentenceCount)) {
      return { ok: false, reason: `sentence_count_mismatch:${active.sentenceCount}` };
    }
  }

  return { ok: true, reason: "" };
}

export function shouldPreferNewVersionForAssistantMerge(base, incoming) {
  const left = normalizeComparable(base);
  const right = normalizeComparable(incoming);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftCompact = left.replace(/[^a-z0-9]+/g, "");
  const rightCompact = right.replace(/[^a-z0-9]+/g, "");
  if (!leftCompact || !rightCompact) return false;
  if (rightCompact.includes(leftCompact)) return true;
  if (leftCompact.includes(rightCompact)) return false;

  const leftWords = new Set(left.split(/\s+/g).filter(Boolean));
  const rightWords = new Set(right.split(/\s+/g).filter(Boolean));
  if (leftWords.size < 8 || rightWords.size < 8) return false;
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }
  const smaller = Math.min(leftWords.size, rightWords.size);
  const overlapRatio = smaller > 0 ? overlap / smaller : 0;
  const lenRatio = Math.min(leftCompact.length, rightCompact.length) / Math.max(leftCompact.length, rightCompact.length);
  return overlapRatio >= 0.82 && lenRatio >= 0.62;
}
