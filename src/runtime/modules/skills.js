// ===== Skill Discovery & Management =====

import fs from "fs";
import path from "path";
import {
  ROOT_WORKSPACE_DIR,
  SKILL_DISCOVERY_CACHE_TTL_MS,
  STARTER_SKILLS_CATALOG_VERSION,
  STARTER_SKILLS,
  STARTER_SKILL_META_FILE,
  STARTER_SKILL_NAMES,
} from "../constants.js";

// Module-internal cache — not exported
const SKILL_DISCOVERY_CACHE = new Map();
const STARTER_SKILLS_SEEDED_DIRS = new Set();

// ===== XML escape (used when building skill prompt XML) =====
export function escapeXml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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
      byName.set(name, { name, description: metadata.description, readWhen: metadata.readWhen, location: skillFile });
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
function formatRuntimeSkillsPrompt(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return "";
  const body = skills
    .map(
      (skill) =>
        `<skill><name>${escapeXml(skill.name)}</name><description>${escapeXml(skill.description)}</description>${Array.isArray(skill.readWhen) && skill.readWhen.length > 0 ? `<read_when>${escapeXml(skill.readWhen.join(" | "))}</read_when>` : ""}<location>${escapeXml(skill.location)}</location></skill>`,
    )
    .join("");
  return [
    "Prefer skills whose metadata read_when hints match the request intent.",
    "Scan descriptions. If one applies, use the read tool to load its SKILL.md. Never load more than one upfront.",
    `<available_skills>${body}</available_skills>`,
  ].join("\n");
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

export function buildRuntimeSkillsPrompt(personaWorkspaceDir) {
  if (personaWorkspaceDir) ensureStarterSkillsForUser(personaWorkspaceDir);
  const dirs = personaWorkspaceDir
    ? [path.join(personaWorkspaceDir, "skills")]
    : [path.join(ROOT_WORKSPACE_DIR, "skills")];
  const skills = discoverRuntimeSkillsWithCache(dirs);
  return formatRuntimeSkillsPrompt(skills);
}
