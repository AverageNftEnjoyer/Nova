import fs from "fs";
import path from "path";
import { ROOT_WORKSPACE_DIR, USER_CONTEXT_ROOT } from "../../core/constants/index.js";

const SKILL_FILE_NAME = "SKILL.md";
const SKILL_UPDATE_VERBS_REGEX =
  /\b(update|customi(?:s|z)e|change|adjust|modify|set|tweak|refine|tailor|personalize)\b/i;
const SKILL_PREFERENCE_SIGNAL_REGEX =
  /\b(skill|skills|preference|preferences|from now on|going forward|always|never|only|include|exclude|format|style|tone|rule|rules|default|defaults)\b/i;
const SKILL_PREFERENCE_SECTION_HEADER = "## User Preference Overrides";
const SKILL_PREFERENCE_MAX_RULES = 40;
const SKILL_DISCOVERY_CACHE_TTL_MS = Math.max(
  1000,
  Number.parseInt(process.env.NOVA_SKILL_PREFERENCE_DISCOVERY_CACHE_TTL_MS || "8000", 10) || 8000,
);
const SKILL_DISCOVERY_CACHE = new Map();

function normalizeUserContextId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function normalizeSkillName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toTitleCaseSlug(value) {
  return String(value || "")
    .split("-")
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : ""))
    .join(" ");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAliasMention(text, alias) {
  const normalized = compactWhitespace(text).toLowerCase();
  const cleanAlias = compactWhitespace(alias).toLowerCase();
  if (!normalized || !cleanAlias) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(cleanAlias)}([^a-z0-9]|$)`, "i");
  return pattern.test(normalized);
}

function resolvePersonaSkillsDir(userContextId, workspaceDir) {
  const normalizedUserContextId = normalizeUserContextId(userContextId);
  const explicitWorkspaceDir = String(workspaceDir || "").trim();
  const personaWorkspaceDir = explicitWorkspaceDir
    || path.join(USER_CONTEXT_ROOT, normalizedUserContextId || "anonymous");
  return path.join(personaWorkspaceDir, "skills");
}

function listSkillNamesFromDir(skillsDir) {
  const names = new Set();
  if (!skillsDir || !fs.existsSync(skillsDir)) return names;
  let entries = [];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return names;
  }
  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue;
    const normalized = normalizeSkillName(entry.name);
    if (!normalized) continue;
    const skillPath = path.join(skillsDir, entry.name, SKILL_FILE_NAME);
    if (!fs.existsSync(skillPath)) continue;
    names.add(normalized);
  }
  return names;
}

function discoverSkillNames(userContextId, workspaceDir) {
  const normalizedUserContextId = normalizeUserContextId(userContextId) || "anonymous";
  const cacheKey = `${normalizedUserContextId}::${String(workspaceDir || "").trim() || "_default"}`;
  const now = Date.now();
  const cached = SKILL_DISCOVERY_CACHE.get(cacheKey);
  if (cached && now - Number(cached.at || 0) < SKILL_DISCOVERY_CACHE_TTL_MS) {
    return cached.skills;
  }

  const baselineSkillsDir = path.join(ROOT_WORKSPACE_DIR, "skills");
  const personaSkillsDir = resolvePersonaSkillsDir(normalizedUserContextId, workspaceDir);
  const merged = new Set();
  for (const name of listSkillNamesFromDir(baselineSkillsDir)) merged.add(name);
  for (const name of listSkillNamesFromDir(personaSkillsDir)) merged.add(name);

  const skills = [...merged].sort((a, b) => a.localeCompare(b));
  SKILL_DISCOVERY_CACHE.set(cacheKey, { at: now, skills });
  if (SKILL_DISCOVERY_CACHE.size > 48) {
    const oldest = [...SKILL_DISCOVERY_CACHE.entries()]
      .sort((a, b) => Number(a[1]?.at || 0) - Number(b[1]?.at || 0))
      .slice(0, Math.max(1, SKILL_DISCOVERY_CACHE.size - 48));
    for (const [key] of oldest) SKILL_DISCOVERY_CACHE.delete(key);
  }
  return skills;
}

function extractDirectiveFromMessage(input, skillName) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const quoted = raw.match(/["'](.{3,500}?)['\"]/);
  if (quoted?.[1]) return compactWhitespace(quoted[1]).replace(/[.?!;:]+$/, "");

  const tailMatch = raw.match(/\b(?:to|so that|so|with)\b\s+(.+)$/i);
  if (tailMatch?.[1]) return compactWhitespace(tailMatch[1]).replace(/[.?!;:]+$/, "");

  const colonMatch = raw.match(/:\s*(.+)$/);
  if (colonMatch?.[1]) return compactWhitespace(colonMatch[1]).replace(/[.?!;:]+$/, "");

  const normalizedSkillName = normalizeSkillName(skillName);
  if (normalizedSkillName) {
    const alias = normalizedSkillName.replace(/-/g, " ");
    const idx = raw.toLowerCase().lastIndexOf(alias);
    if (idx >= 0) {
      const remainder = compactWhitespace(raw.slice(idx + alias.length));
      const cleaned = remainder
        .replace(/^(skill|workflow|report|settings?|preferences?)\b[:\s-]*/i, "")
        .replace(/^(that|which)\s+/i, "");
      if (cleaned.length >= 3) return cleaned.replace(/[.?!;:]+$/, "");
    }
  }

  return "";
}

function findMentionedSkill(input, knownSkills) {
  const text = compactWhitespace(input).toLowerCase();
  if (!text) return "";

  const ordered = [...(Array.isArray(knownSkills) ? knownSkills : [])]
    .map((name) => normalizeSkillName(name))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const skillName of ordered) {
    const aliases = [
      skillName,
      skillName.replace(/-/g, " "),
      skillName.replace(/-/g, ""),
    ].filter(Boolean);
    if (aliases.some((alias) => hasAliasMention(text, alias))) {
      return skillName;
    }
  }
  return "";
}

function buildFallbackSkillTemplate(skillName) {
  const title = toTitleCaseSlug(skillName) || "Custom";
  return [
    "---",
    `name: ${skillName}`,
    "description: User-customizable workflow override.",
    "---",
    "",
    `# ${title} Skill`,
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
    "- Perform the smallest safe set of actions needed to complete the request.",
    "",
    "### 3. Verification Before Done",
    "- Validate key outcomes and assumptions.",
    "",
    "## Completion Criteria",
    "- Output is complete, accurate, and scoped to the request.",
    "",
  ].join("\n");
}

function ensureUserScopedSkillFile(userContextId, workspaceDir, skillName) {
  const normalizedUserContextId = normalizeUserContextId(userContextId);
  const normalizedSkillName = normalizeSkillName(skillName);
  if (!normalizedUserContextId || !normalizedSkillName) {
    return { ok: false, filePath: "", content: "" };
  }

  const userSkillsDir = resolvePersonaSkillsDir(normalizedUserContextId, workspaceDir);
  const userSkillPath = path.join(userSkillsDir, normalizedSkillName, SKILL_FILE_NAME);
  try {
    if (fs.existsSync(userSkillPath)) {
      return {
        ok: true,
        filePath: userSkillPath,
        content: String(fs.readFileSync(userSkillPath, "utf8") || ""),
      };
    }
  } catch {}

  const baselineSkillPath = path.join(ROOT_WORKSPACE_DIR, "skills", normalizedSkillName, SKILL_FILE_NAME);
  let content = "";
  try {
    if (fs.existsSync(baselineSkillPath)) {
      content = String(fs.readFileSync(baselineSkillPath, "utf8") || "");
    }
  } catch {}
  if (!content) content = buildFallbackSkillTemplate(normalizedSkillName);

  try {
    fs.mkdirSync(path.dirname(userSkillPath), { recursive: true });
    fs.writeFileSync(userSkillPath, `${String(content || "").replace(/\r\n/g, "\n").trim()}\n`, "utf8");
    return { ok: true, filePath: userSkillPath, content };
  } catch {
    return { ok: false, filePath: userSkillPath, content };
  }
}

function upsertPreferenceSection(rawContent, directiveText) {
  const content = String(rawContent || "").replace(/\r\n/g, "\n");
  const directive = compactWhitespace(directiveText).replace(/[.?!;:]+$/, "");
  if (!directive) {
    return { content, updated: false, duplicate: false, ruleCount: 0 };
  }

  const lines = content.split("\n");
  let sectionStart = lines.findIndex(
    (line) => compactWhitespace(line).toLowerCase() === SKILL_PREFERENCE_SECTION_HEADER.toLowerCase(),
  );
  let sectionEnd = -1;
  if (sectionStart >= 0) {
    for (let i = sectionStart + 1; i < lines.length; i += 1) {
      if (/^##\s+/.test(String(lines[i] || "").trim())) {
        sectionEnd = i;
        break;
      }
    }
    if (sectionEnd < 0) sectionEnd = lines.length;
  } else {
    if (lines.length > 0 && compactWhitespace(lines[lines.length - 1]) !== "") lines.push("");
    sectionStart = lines.length;
    lines.push(SKILL_PREFERENCE_SECTION_HEADER, "");
    sectionEnd = lines.length;
  }

  const existingRules = [];
  const existingSet = new Set();
  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    const line = compactWhitespace(lines[i] || "");
    if (!line) continue;
    const match = line.match(/^-\s*rule\s*:\s*(.+)$/i) || line.match(/^rule\s*:\s*(.+)$/i);
    if (!match?.[1]) continue;
    const normalized = compactWhitespace(match[1]).toLowerCase();
    if (!normalized || existingSet.has(normalized)) continue;
    existingSet.add(normalized);
    existingRules.push(compactWhitespace(match[1]));
  }

  const directiveNormalized = directive.toLowerCase();
  const duplicate = existingSet.has(directiveNormalized);
  if (!duplicate) existingRules.push(directive);
  const trimmedRules = existingRules.slice(-SKILL_PREFERENCE_MAX_RULES);
  const sectionLines = [
    SKILL_PREFERENCE_SECTION_HEADER,
    "- Applies only to this user context.",
    ...trimmedRules.map((rule) => `- rule: ${rule}`),
    "",
  ];
  const rebuilt = [
    ...lines.slice(0, sectionStart),
    ...sectionLines,
    ...lines.slice(sectionEnd),
  ].join("\n");
  return {
    content: `${rebuilt.replace(/\r\n/g, "\n").trim()}\n`,
    updated: !duplicate,
    duplicate,
    ruleCount: trimmedRules.length,
  };
}

function buildPreferenceAck(skillName, directive, { duplicate = false } = {}) {
  const displayName = toTitleCaseSlug(skillName) || skillName;
  if (duplicate) {
    return [
      `That ${displayName} preference was already saved for your profile.`,
      `Rule: ${directive}`,
    ].join("\n");
  }
  return [
    `Saved a user-specific ${displayName} skill preference.`,
    `Rule: ${directive}`,
    "This only affects your profile.",
  ].join("\n");
}

export function applySkillPreferenceUpdateFromMessage({
  userContextId = "",
  workspaceDir = "",
  userInputText = "",
} = {}) {
  const normalizedUserContextId = normalizeUserContextId(userContextId);
  const rawInput = String(userInputText || "").trim();
  if (!normalizedUserContextId || !rawInput) return { handled: false };

  if (!SKILL_UPDATE_VERBS_REGEX.test(rawInput)) return { handled: false };
  if (!SKILL_PREFERENCE_SIGNAL_REGEX.test(rawInput)) return { handled: false };

  const knownSkills = discoverSkillNames(normalizedUserContextId, workspaceDir);
  if (knownSkills.length === 0) return { handled: false };
  const skillName = findMentionedSkill(rawInput, knownSkills);
  if (!skillName) return { handled: false };

  // Coinbase already has a dedicated deterministic parser/writer in crypto fast-path.
  if (skillName === "coinbase") return { handled: false };

  const directive = extractDirectiveFromMessage(rawInput, skillName);
  if (!directive) {
    return {
      handled: true,
      updated: false,
      skillName,
      reply: `Say exactly what to change in ${toTitleCaseSlug(skillName)}. Example: "update my ${skillName} skill to always include source links".`,
    };
  }

  const ensured = ensureUserScopedSkillFile(normalizedUserContextId, workspaceDir, skillName);
  if (!ensured.ok || !ensured.filePath) {
    return {
      handled: true,
      updated: false,
      skillName,
      error: "Failed creating user skill file.",
      reply: "I couldn't save that skill preference yet. Retry once.",
    };
  }

  const update = upsertPreferenceSection(ensured.content, directive);
  try {
    fs.writeFileSync(ensured.filePath, update.content, "utf8");
    return {
      handled: true,
      updated: update.updated || update.duplicate,
      duplicate: update.duplicate,
      skillName,
      directive,
      filePath: ensured.filePath,
      ruleCount: update.ruleCount,
      reply: buildPreferenceAck(skillName, directive, { duplicate: update.duplicate }),
    };
  } catch {
    return {
      handled: true,
      updated: false,
      skillName,
      error: "Failed writing user skill file.",
      reply: "I couldn't save that skill preference yet. Retry once.",
    };
  }
}
