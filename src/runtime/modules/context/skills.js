// ===== Skill Discovery & Management =====

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
  ROOT_WORKSPACE_DIR,
  SKILL_DISCOVERY_CACHE_TTL_MS,
  STARTER_SKILLS_CATALOG_VERSION,
  STARTER_SKILLS,
  STARTER_SKILL_META_FILE,
  STARTER_SKILL_NAMES,
} from "../../core/constants.js";

// Module-internal cache — not exported
const SKILL_DISCOVERY_CACHE = new Map();
const STARTER_SKILLS_SEEDED_DIRS = new Set();
const LEGACY_SKILLS_MIGRATED_DIRS = new Set();
const LEGACY_STARTER_SKILLS_PRUNED_DIRS = new Set();
const BINARY_AVAILABILITY_CACHE = new Map();
const RUNTIME_SKILLS_PROMPT_CACHE = new Map();
const RUNTIME_SKILLS_PROMPT_CACHE_TTL_MS = Math.max(
  1000,
  Number.parseInt(process.env.NOVA_RUNTIME_SKILLS_PROMPT_CACHE_TTL_MS || "8000", 10) || 8000,
);
const RUNTIME_SKILLS_PROMPT_CACHE_MAX = Math.max(
  16,
  Number.parseInt(process.env.NOVA_RUNTIME_SKILLS_PROMPT_CACHE_MAX || "160", 10) || 160,
);
const SKILL_PROMPT_MAX_SKILLS = Number.parseInt(process.env.NOVA_SKILL_PROMPT_MAX_SKILLS || "4", 10);
const SKILL_PROMPT_MAX_CHARS = Number.parseInt(process.env.NOVA_SKILL_PROMPT_MAX_CHARS || "1800", 10);
const SKILL_PROMPT_MAX_HINT_CHARS = Number.parseInt(process.env.NOVA_SKILL_PROMPT_MAX_HINT_CHARS || "120", 10);
const SKILL_PROMPT_MIN_SCORE = Number.parseInt(process.env.NOVA_SKILL_PROMPT_MIN_SCORE || "4", 10);
const SKILL_PROMPT_DEBUG = String(process.env.NOVA_SKILL_PROMPT_DEBUG || "").trim() === "1";
const SKILL_PROMPT_BASELINE_NAMES = Array.from(
  new Set(
    String(process.env.NOVA_SKILL_PROMPT_BASELINE || "nova-core")
      .split(",")
      .map((v) => String(v || "").trim().toLowerCase())
      .filter(Boolean),
  ),
);
const SKILL_ROUTING_STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "your", "you", "what", "when", "where", "why",
  "how", "about", "into", "onto", "over", "under", "just", "need", "help", "please", "want", "would",
  "could", "should", "have", "has", "had", "were", "was", "are", "can", "will", "hey", "hi", "hello",
  "nova", "assistant", "chat", "message", "today", "now", "thanks", "thank", "there", "them", "they",
]);
const SKILL_PROMPT_FALLBACK_ORDER = Array.from(
  new Set(
    String(process.env.NOVA_SKILL_PROMPT_FALLBACK || "summarize,research,pickup,handoff,daily-briefing")
      .split(",")
      .map((v) => String(v || "").trim().toLowerCase())
      .filter(Boolean),
  ),
);

const SAFE_BINARY_NAME = /^[A-Za-z0-9._-]{1,64}$/;

// ===== XML escape (used when building skill prompt XML) =====
export function escapeXml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function compactText(value, maxChars = 180) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function parseFrontmatter(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed.startsWith("---")) return "";
  const end = trimmed.indexOf("\n---", 3);
  if (end <= 0) return "";
  return trimmed.slice(3, end);
}

function extractFrontmatterArray(frontmatter, key) {
  const escapedKey = String(key || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Require a non-word-ish boundary before the key so `bins` does not match inside `anyBins`.
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9_-])["']?${escapedKey}["']?\\s*:\\s*\\[([^\\]]*)\\]`, "i");
  const match = String(frontmatter || "").match(pattern);
  if (!match?.[1]) return [];
  return Array.from(
    new Set(
      match[1]
        .split(",")
        .map((v) => String(v || "").trim().replace(/^['"`]|['"`]$/g, ""))
        .filter(Boolean),
    ),
  );
}

function extractSkillRequirements(content) {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return { bins: [], anyBins: [], env: [], os: [] };
  return {
    bins: extractFrontmatterArray(frontmatter, "bins"),
    anyBins: extractFrontmatterArray(frontmatter, "anyBins"),
    env: extractFrontmatterArray(frontmatter, "env"),
    os: extractFrontmatterArray(frontmatter, "os"),
  };
}

function isBinaryAvailable(binaryName) {
  const name = String(binaryName || "").trim();
  if (!name) return false;
  if (!SAFE_BINARY_NAME.test(name)) {
    BINARY_AVAILABILITY_CACHE.set(name, false);
    return false;
  }
  if (BINARY_AVAILABILITY_CACHE.has(name)) return BINARY_AVAILABILITY_CACHE.get(name) === true;
  try {
    const check = process.platform === "win32"
      ? spawnSync("where", [name], {
          stdio: "ignore",
          windowsHide: true,
          shell: false,
          timeout: 2000,
        })
      : spawnSync("which", [name], {
          stdio: "ignore",
          shell: false,
          timeout: 2000,
        });
    const available = check.status === 0;
    BINARY_AVAILABILITY_CACHE.set(name, available);
    return available;
  } catch {
    BINARY_AVAILABILITY_CACHE.set(name, false);
    return false;
  }
}

function isSkillCompatible(skill) {
  const req = skill?.requirements || {};
  const requiredEnv = Array.isArray(req.env) ? req.env : [];
  const requiredBins = Array.isArray(req.bins) ? req.bins : [];
  const anyBins = Array.isArray(req.anyBins) ? req.anyBins : [];
  const supportedOs = Array.isArray(req.os) ? req.os : [];

  if (supportedOs.length > 0 && !supportedOs.includes(process.platform)) return false;
  if (requiredEnv.some((envName) => !String(process.env[String(envName || "")] || "").trim())) return false;
  if (requiredBins.some((bin) => !isBinaryAvailable(bin))) return false;
  if (anyBins.length > 0 && !anyBins.some((bin) => isBinaryAvailable(bin))) return false;
  return true;
}

function tokenizeForSkillMatch(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((v) => v.trim())
    .filter((v) => v.length >= 3 && !SKILL_ROUTING_STOPWORDS.has(v));
}

function normalizeRequestForSkillScoring(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/\b(hey|hi|hello)\s+nova\b/g, "")
    .replace(/\bnova\b/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized;
}

function isLikelyGenericGreeting(value) {
  const normalized = normalizeRequestForSkillScoring(value);
  if (!normalized) return true;
  return /^(hey|hi|hello|yo|sup|test|ping|ok|okay|thanks|thank you)$/.test(normalized);
}

function estimateRequestComplexity(requestText) {
  const normalized = normalizeRequestForSkillScoring(requestText);
  if (!normalized) return "none";
  const tokenCount = tokenizeForSkillMatch(normalized).length;
  if (tokenCount <= 2) return "low";
  if (/\b(and|also|plus|then|compare|versus|vs)\b/.test(normalized) || tokenCount >= 14) return "high";
  return "medium";
}

function scoreSkillForRequest(skill, requestText) {
  const request = normalizeRequestForSkillScoring(requestText);
  if (!request) return 0;

  const requestTokens = new Set(tokenizeForSkillMatch(request));
  if (requestTokens.size === 0) return 0;

  const name = String(skill?.name || "").toLowerCase();
  const description = String(skill?.description || "").toLowerCase();
  const readWhen = Array.isArray(skill?.readWhen)
    ? skill.readWhen.map((v) => String(v || "").toLowerCase())
    : [];

  let score = 0;
  const flatName = name.replace(/-/g, " ");
  if (flatName && request.includes(flatName)) score += 24;
  if (name && request.includes(name)) score += 16;

  const nameTokens = new Set(tokenizeForSkillMatch(name));
  for (const token of requestTokens) {
    if (nameTokens.has(token)) score += 9;
  }

  const descriptionTokens = new Set(tokenizeForSkillMatch(description));
  for (const token of requestTokens) {
    if (descriptionTokens.has(token)) score += 2;
  }

  for (const hint of readWhen) {
    const hintTokens = new Set(tokenizeForSkillMatch(hint));
    let overlap = 0;
    for (const token of requestTokens) {
      if (hintTokens.has(token)) overlap += 1;
    }
    if (overlap > 0) score += Math.min(10, overlap * 3);
    if (hint && request.includes(hint.slice(0, Math.min(36, hint.length)))) score += 5;
  }

  return score;
}

function uniqueSkillsByName(skills) {
  const out = [];
  const seen = new Set();
  for (const skill of skills || []) {
    const name = String(skill?.name || "").trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(skill);
  }
  return out;
}

function selectSkillsForPrompt(skills, requestText) {
  const compatibleSkills = Array.isArray(skills) ? skills.filter((skill) => isSkillCompatible(skill)) : [];
  if (compatibleSkills.length === 0) return [];

  const maxSkills = Number.isFinite(SKILL_PROMPT_MAX_SKILLS) && SKILL_PROMPT_MAX_SKILLS > 0
    ? Math.trunc(SKILL_PROMPT_MAX_SKILLS)
    : 4;

  const byName = new Map(compatibleSkills.map((skill) => [String(skill.name || "").toLowerCase(), skill]));
  const baseline = SKILL_PROMPT_BASELINE_NAMES
    .map((name) => byName.get(name))
    .filter(Boolean);

  if (isLikelyGenericGreeting(requestText)) {
    const greetingSelection = uniqueSkillsByName([
      ...baseline,
      ...compatibleSkills,
    ]);
    return greetingSelection.slice(0, Math.max(1, Math.min(2, maxSkills)));
  }

  const scored = compatibleSkills
    .map((skill) => ({ skill, score: scoreSkillForRequest(skill, requestText) }))
    .filter((entry) => entry.score >= Math.max(1, SKILL_PROMPT_MIN_SCORE))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.skill.name || "").localeCompare(String(b.skill.name || ""));
    })
    .map((entry) => entry.skill);

  const fallback = SKILL_PROMPT_FALLBACK_ORDER
    .map((name) => byName.get(name))
    .filter(Boolean);

  const complexity = estimateRequestComplexity(requestText);
  const effectiveMax =
    complexity === "low"
      ? Math.max(1, Math.min(2, maxSkills))
      : complexity === "medium"
        ? Math.max(1, Math.min(3, maxSkills))
        : maxSkills;

  const merged = scored.length > 0
    ? uniqueSkillsByName([...baseline, ...scored])
    : uniqueSkillsByName([...baseline, ...fallback, ...compatibleSkills]);
  const selected = merged.slice(0, effectiveMax);

  if (SKILL_PROMPT_DEBUG) {
    console.log(
      `[Skills] Selected ${selected.length}/${compatibleSkills.length} for complexity=${complexity}: ${selected.map((s) => s.name).join(", ") || "none"}`,
    );
  }

  return selected;
}

// ===== File walking =====
function walkSkillFiles(dir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSkillFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") out.push(full);
  }
}

// ===== String helpers =====
function compactStrings(values) {
  const out = [];
  for (const value of values || []) {
    const normalized = String(value || "").trim();
    if (normalized) out.push(normalized);
  }
  return out;
}

function parseInlineFrontmatterArray(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  try {
    const parsed = JSON.parse(trimmed.replace(/'/g, '"'));
    if (!Array.isArray(parsed)) return [];
    return compactStrings(parsed);
  } catch {
    return [];
  }
}

function parseMetadataReadWhenInline(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return [];
  try {
    const parsed = JSON.parse(trimmed);
    const raw = parsed?.read_when;
    if (!Array.isArray(raw)) return [];
    return compactStrings(raw);
  } catch {
    return [];
  }
}

function normalizeLegacyReadWhenList(frontmatter, initialHints = []) {
  const lines = String(frontmatter || "").split("\n");
  const readWhen = [...initialHints];
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i] || "";
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();
    if (!line || indent > 0) continue;
    if (!/^read_when\s*:/i.test(line)) continue;
    readWhen.push(...parseInlineFrontmatterArray(line.replace(/^read_when\s*:/i, "").trim()));
    for (let j = i + 1; j < lines.length; j += 1) {
      const nextRaw = lines[j] || "";
      const nextTrimmed = nextRaw.trim();
      if (!nextTrimmed) continue;
      const nextIndent = nextRaw.length - nextRaw.trimStart().length;
      if (nextIndent <= indent) { i = j - 1; break; }
      if (nextTrimmed.startsWith("- ")) {
        const hint = nextTrimmed.slice(2).trim();
        if (hint) readWhen.push(hint);
        continue;
      }
      if (nextIndent <= indent + 1) { i = j - 1; break; }
    }
  }
  return Array.from(new Set(compactStrings(readWhen)));
}

// ===== Metadata extraction =====
export function extractSkillMetadata(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) return { description: "No description provided.", readWhen: [] };

  if (trimmed.startsWith("---")) {
    const end = trimmed.indexOf("\n---", 3);
    if (end > 0) {
      const frontmatter = trimmed.slice(3, end);
      const lines = frontmatter.split("\n");
      let description = "No description provided.";
      const readWhen = [];
      for (let i = 0; i < lines.length; i += 1) {
        const rawLine = lines[i] || "";
        const indent = rawLine.length - rawLine.trimStart().length;
        const line = rawLine.trim();
        if (!line || indent > 0) continue;
        if (/^description\s*:/i.test(line)) {
          description =
            String(line.replace(/^description\s*:/i, "").trim().replace(/^['"]|['"]$/g, "")) ||
            "No description provided.";
          continue;
        }
        if (/^metadata\s*:/i.test(line)) {
          const inline = line.replace(/^metadata\s*:/i, "").trim();
          if (inline) readWhen.push(...parseMetadataReadWhenInline(inline));
          let inMetadataReadWhen = false;
          let readWhenIndent = -1;
          for (let j = i + 1; j < lines.length; j += 1) {
            const nextRaw = lines[j] || "";
            const nextTrimmed = nextRaw.trim();
            if (!nextTrimmed) continue;
            const nextIndent = nextRaw.length - nextRaw.trimStart().length;
            if (nextIndent <= indent) { i = j - 1; break; }
            if (/^read_when\s*:/i.test(nextTrimmed)) {
              inMetadataReadWhen = true;
              readWhenIndent = nextIndent;
              readWhen.push(...parseInlineFrontmatterArray(nextTrimmed.replace(/^read_when\s*:/i, "").trim()));
              continue;
            }
            if (inMetadataReadWhen && nextIndent > readWhenIndent && nextTrimmed.startsWith("- ")) {
              const hint = nextTrimmed.slice(2).trim();
              if (hint) readWhen.push(hint);
              continue;
            }
            if (inMetadataReadWhen && nextIndent <= readWhenIndent) inMetadataReadWhen = false;
          }
          continue;
        }
      }
      return { description, readWhen: normalizeLegacyReadWhenList(frontmatter, readWhen) };
    }
  }

  const firstParagraph = trimmed
    .split(/\n\s*\n/)
    .map((part) => String(part || "").trim())
    .find(Boolean);
  return {
    description: String(firstParagraph || "No description provided.").replace(/^#\s+/, "").trim(),
    readWhen: [],
  };
}

// ===== Discovery with LRU cache =====
function discoverRuntimeSkills(dirs) {
  const byName = new Map();
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    const files = [];
    walkSkillFiles(dir, files);
    for (const skillFile of files) {
      let raw = "";
      try { raw = fs.readFileSync(skillFile, "utf8"); } catch { continue; }
      const name = path.basename(path.dirname(skillFile));
      if (!name) continue;
      const metadata = extractSkillMetadata(raw);
      const requirements = extractSkillRequirements(raw);
      byName.set(name, {
        name,
        description: metadata.description,
        readWhen: metadata.readWhen,
        requirements,
        location: skillFile,
      });
    }
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function discoverRuntimeSkillsWithCache(dirs) {
  const normalizedDirs = Array.from(
    new Set((Array.isArray(dirs) ? dirs : []).map((d) => String(d || "").trim()).filter(Boolean)),
  );
  const cacheKey = normalizedDirs.join("|");
  const now = Date.now();
  const entry = SKILL_DISCOVERY_CACHE.get(cacheKey);
  if (entry && Number.isFinite(entry.at) && now - entry.at < Math.max(0, SKILL_DISCOVERY_CACHE_TTL_MS) && Array.isArray(entry.skills)) {
    return entry.skills;
  }
  const skills = discoverRuntimeSkills(normalizedDirs);
  SKILL_DISCOVERY_CACHE.set(cacheKey, { at: now, skills });
  // LRU eviction when cache exceeds 24 entries
  if (SKILL_DISCOVERY_CACHE.size > 24) {
    let oldestKey = "";
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [k, v] of SKILL_DISCOVERY_CACHE.entries()) {
      const at = Number(v?.at || 0);
      if (at < oldestAt) { oldestAt = at; oldestKey = k; }
    }
    if (oldestKey) SKILL_DISCOVERY_CACHE.delete(oldestKey);
  }
  return skills;
}

// ===== Prompt builder =====
function formatRuntimeSkillsPrompt(skills, requestText = "") {
  if (!Array.isArray(skills) || skills.length === 0) return "";
  const selectedSkills = selectSkillsForPrompt(skills, requestText);
  if (selectedSkills.length === 0) return "";

  const promptMaxChars = Number.isFinite(SKILL_PROMPT_MAX_CHARS) && SKILL_PROMPT_MAX_CHARS > 0
    ? Math.trunc(SKILL_PROMPT_MAX_CHARS)
    : 1800;
  const promptLocation = (location) => {
    const raw = String(location || "").trim();
    if (!raw) return "";
    try {
      const relative = path.relative(ROOT_WORKSPACE_DIR, raw).replace(/\\/g, "/");
      if (relative && !relative.startsWith("..")) return relative;
    } catch {}
    return raw;
  };
  const buildSkillEntry = (skill, includeReadWhen = true) => {
    const readWhen = Array.isArray(skill.readWhen) && skill.readWhen.length > 0 && includeReadWhen
      ? `<read_when>${escapeXml(compactText(skill.readWhen.join(" | "), SKILL_PROMPT_MAX_HINT_CHARS))}</read_when>`
      : "";
    return `<skill><name>${escapeXml(skill.name)}</name><description>${escapeXml(compactText(skill.description, 120))}</description>${readWhen}<location>${escapeXml(promptLocation(skill.location))}</location></skill>`;
  };

  const prefix = [
    "Prefer skills whose metadata read_when hints match the request intent.",
    "Scan descriptions. If one applies, use the read tool to load its SKILL.md. Never load more than one upfront.",
    "<available_skills>",
  ].join("\n");
  const suffix = "</available_skills>";

  const parts = [];
  let consumed = prefix.length + suffix.length + 2;
  for (const skill of selectedSkills) {
    let entry = buildSkillEntry(skill, true);
    if (consumed + entry.length > promptMaxChars && parts.length > 0) {
      entry = buildSkillEntry(skill, false);
    }
    if (consumed + entry.length > promptMaxChars) break;
    parts.push(entry);
    consumed += entry.length;
  }

  if (parts.length === 0) {
    parts.push(buildSkillEntry(selectedSkills[0], false));
  }

  return `${prefix}${parts.join("")}\n${suffix}`;
}

// ===== Starter skill templates & seeding =====
export function buildStarterSkillTemplate(skillName, description) {
  const displayName = String(skillName || "")
    .split("-")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ""))
    .join(" ");
  const desc = String(description || "").trim() || `Workflow for ${displayName.toLowerCase()} tasks.`;
  return [
    "---",
    `name: ${skillName}`,
    `description: ${desc}`,
    "---",
    "",
    `# ${displayName} Skill`,
    "",
    "## Activation",
    "- Use this skill when the request clearly matches this domain.",
    "- Do not use this skill for unrelated tasks.",
    "",
    "## Workflow",
    "### 1. Scope",
    "- Identify the task goal and required output.",
    "",
    "### 2. Execute",
    "- Perform the smallest set of actions needed to complete the task.",
    "",
    "### 3. Verification Before Done",
    "- Validate key outcomes and assumptions.",
    "- Call out uncertainty when full verification is not possible.",
    "",
    "## Completion Criteria",
    "- Output is complete, accurate, and scoped to the request.",
    "- Verification results and residual risk are explicitly stated.",
    "",
  ].join("\n");
}

function readStarterSkillMeta(userSkillsDir) {
  const metaPath = path.join(userSkillsDir, STARTER_SKILL_META_FILE);
  try {
    if (!fs.existsSync(metaPath)) return { startersInitialized: false, disabledStarters: [], catalogVersion: 0 };
    const raw = String(fs.readFileSync(metaPath, "utf8") || "").trim();
    if (!raw) return { startersInitialized: false, disabledStarters: [], catalogVersion: 0 };
    const parsed = JSON.parse(raw) || {};
    const disabled = Array.isArray(parsed.disabledStarters)
      ? parsed.disabledStarters.map((v) => String(v || "").trim()).filter((v) => STARTER_SKILL_NAMES.has(v))
      : [];
    const catalogVersion = Number.isFinite(parsed.catalogVersion) ? Math.max(0, Number(parsed.catalogVersion || 0)) : 0;
    return { startersInitialized: Boolean(parsed.startersInitialized), disabledStarters: Array.from(new Set(disabled)), catalogVersion };
  } catch {
    return { startersInitialized: false, disabledStarters: [], catalogVersion: 0 };
  }
}

function writeStarterSkillMeta(userSkillsDir, meta) {
  const metaPath = path.join(userSkillsDir, STARTER_SKILL_META_FILE);
  const safe = {
    startersInitialized: Boolean(meta?.startersInitialized),
    disabledStarters: Array.isArray(meta?.disabledStarters)
      ? Array.from(new Set(meta.disabledStarters.map((v) => String(v || "").trim()).filter((v) => STARTER_SKILL_NAMES.has(v))))
      : [],
    catalogVersion: Number.isFinite(meta?.catalogVersion) ? Math.max(0, Number(meta.catalogVersion || 0)) : 0,
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
}

export function ensureStarterSkillsForUser(personaWorkspaceDir) {
  if (!personaWorkspaceDir) return;
  const userSkillsDir = path.join(personaWorkspaceDir, "skills");
  if (STARTER_SKILLS_SEEDED_DIRS.has(userSkillsDir)) return;
  try {
    fs.mkdirSync(userSkillsDir, { recursive: true });
    const meta = readStarterSkillMeta(userSkillsDir);
    const needsCatalogRefresh = Number(meta.catalogVersion || 0) < STARTER_SKILLS_CATALOG_VERSION;
    if (meta.startersInitialized && !needsCatalogRefresh) {
      STARTER_SKILLS_SEEDED_DIRS.add(userSkillsDir);
      return;
    }
    const disabled = new Set(meta.disabledStarters || []);
    for (const starter of STARTER_SKILLS) {
      if (disabled.has(starter.name)) continue;
      const targetPath = path.join(userSkillsDir, starter.name, "SKILL.md");
      if (fs.existsSync(targetPath)) continue;
      let content = "";
      const canonicalPath = path.join(ROOT_WORKSPACE_DIR, "skills", starter.name, "SKILL.md");
      try {
        if (fs.existsSync(canonicalPath)) content = String(fs.readFileSync(canonicalPath, "utf8") || "").trim();
      } catch {}
      if (!content) content = buildStarterSkillTemplate(starter.name, starter.description);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, `${content.replace(/\r\n/g, "\n").trim()}\n`, "utf8");
    }
    writeStarterSkillMeta(userSkillsDir, {
      startersInitialized: true,
      disabledStarters: Array.from(disabled),
      catalogVersion: STARTER_SKILLS_CATALOG_VERSION,
    });
    STARTER_SKILLS_SEEDED_DIRS.add(userSkillsDir);
  } catch {}
}

function migrateLegacyUserSkillsToGlobal(personaWorkspaceDir) {
  if (!personaWorkspaceDir) return;
  const legacySkillsDir = path.join(personaWorkspaceDir, "skills");
  if (LEGACY_SKILLS_MIGRATED_DIRS.has(legacySkillsDir)) return;
  LEGACY_SKILLS_MIGRATED_DIRS.add(legacySkillsDir);
  if (!fs.existsSync(legacySkillsDir)) return;

  const globalSkillsDir = path.join(ROOT_WORKSPACE_DIR, "skills");
  try { fs.mkdirSync(globalSkillsDir, { recursive: true }); } catch {}

  let moved = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(legacySkillsDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillName = String(entry.name || "").trim();
    if (!skillName || !STARTER_SKILL_NAMES.has(skillName)) continue;
    const legacySkillPath = path.join(legacySkillsDir, skillName, "SKILL.md");
    if (!fs.existsSync(legacySkillPath)) continue;
    const globalSkillPath = path.join(globalSkillsDir, skillName, "SKILL.md");
    if (fs.existsSync(globalSkillPath)) continue;
    try {
      const raw = fs.readFileSync(legacySkillPath, "utf8");
      fs.mkdirSync(path.dirname(globalSkillPath), { recursive: true });
      fs.writeFileSync(globalSkillPath, `${String(raw || "").replace(/\r\n/g, "\n").trim()}\n`, "utf8");
      moved += 1;
    } catch {}
  }

  if (moved > 0) {
    console.log(`[Skills] Migrated ${moved} legacy user skill(s) into global catalog.`);
  }
}

function pruneLegacyStarterSkills(personaWorkspaceDir) {
  if (!personaWorkspaceDir) return;
  const legacySkillsDir = path.join(personaWorkspaceDir, "skills");
  if (LEGACY_STARTER_SKILLS_PRUNED_DIRS.has(legacySkillsDir)) return;
  LEGACY_STARTER_SKILLS_PRUNED_DIRS.add(legacySkillsDir);
  if (!fs.existsSync(legacySkillsDir)) return;

  let entries = [];
  try {
    entries = fs.readdirSync(legacySkillsDir, { withFileTypes: true });
  } catch {
    return;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillName = String(entry.name || "").trim();
    if (!skillName || !STARTER_SKILL_NAMES.has(skillName)) continue;
    const skillDir = path.join(legacySkillsDir, skillName);
    try {
      fs.rmSync(skillDir, { recursive: true, force: true });
      removed += 1;
    } catch {}
  }

  const metaPath = path.join(legacySkillsDir, STARTER_SKILL_META_FILE);
  try {
    if (fs.existsSync(metaPath)) fs.rmSync(metaPath, { force: true });
  } catch {}

  if (removed > 0) {
    console.log(`[Skills] Pruned ${removed} legacy starter skill folder(s) from user context.`);
  }
}

export function buildRuntimeSkillsPrompt(personaWorkspaceDir, requestText = "") {
  migrateLegacyUserSkillsToGlobal(personaWorkspaceDir);
  pruneLegacyStarterSkills(personaWorkspaceDir);
  const dirs = [path.join(ROOT_WORKSPACE_DIR, "skills")];
  if (personaWorkspaceDir) dirs.push(path.join(personaWorkspaceDir, "skills"));
  const normalizedRequest = normalizeRequestForSkillScoring(requestText).slice(0, 240);
  const cacheKey = `${dirs.join("|")}::${normalizedRequest}`;
  const now = Date.now();
  const cached = RUNTIME_SKILLS_PROMPT_CACHE.get(cacheKey);
  if (cached && now - Number(cached.at || 0) < RUNTIME_SKILLS_PROMPT_CACHE_TTL_MS) {
    return String(cached.prompt || "");
  }
  const skills = discoverRuntimeSkillsWithCache(dirs);
  const prompt = formatRuntimeSkillsPrompt(skills, requestText);
  RUNTIME_SKILLS_PROMPT_CACHE.set(cacheKey, { at: now, prompt });
  if (RUNTIME_SKILLS_PROMPT_CACHE.size > RUNTIME_SKILLS_PROMPT_CACHE_MAX) {
    const entries = [...RUNTIME_SKILLS_PROMPT_CACHE.entries()]
      .sort((a, b) => Number(a[1]?.at || 0) - Number(b[1]?.at || 0));
    const removeCount = Math.max(1, entries.length - RUNTIME_SKILLS_PROMPT_CACHE_MAX);
    for (let i = 0; i < removeCount; i += 1) {
      const key = entries[i]?.[0];
      if (key) RUNTIME_SKILLS_PROMPT_CACHE.delete(key);
    }
  }
  return prompt;
}
