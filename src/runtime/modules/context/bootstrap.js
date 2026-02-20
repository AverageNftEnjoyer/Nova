import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// context/ lives one level deeper than the legacy modules root.
const ROOT_DIR = path.join(__dirname, "../../..");

const BOOTSTRAP_FILES = ["SOUL.md", "USER.md", "MEMORY.md", "IDENTITY.md", "AGENTS.md"];
const MAX_CHARS_PER_FILE = 20000;
const MAX_TOTAL_CHARS = 24000;
const PERSONA_PROMPT_CACHE = new Map();
const PERSONA_PROMPT_CACHE_MAX = Math.max(
  8,
  Number.parseInt(process.env.NOVA_PERSONA_PROMPT_CACHE_MAX || "64", 10) || 64,
);

function computeBootstrapSignature(absWorkspace) {
  let entries = [];
  try {
    entries = fs.readdirSync(absWorkspace, { withFileTypes: true });
  } catch {
    return `unreadable:${absWorkspace}`;
  }

  const fileByLower = new Map();
  for (const entry of entries) {
    if (entry.isFile()) fileByLower.set(entry.name.toLowerCase(), entry.name);
  }

  const signatureParts = [];
  for (const name of BOOTSTRAP_FILES) {
    const actualName = fileByLower.get(name.toLowerCase());
    if (!actualName) {
      signatureParts.push(`${name}:missing`);
      continue;
    }
    const filePath = path.join(absWorkspace, actualName);
    try {
      const stat = fs.statSync(filePath);
      signatureParts.push(`${name}:${Number(stat.mtimeMs || 0)}:${Number(stat.size || 0)}`);
    } catch {
      signatureParts.push(`${name}:unreadable`);
    }
  }
  return signatureParts.join("|");
}

/**
 * Discover and load bootstrap files (SOUL.md, USER.md, etc.)
 * These files define agent persona, identity, and behavioral guidelines.
 * @param {string} workspaceDir - Root workspace directory
 * @returns {Array<{name: string, content: string, truncated: boolean}>}
 */
export function discoverBootstrapFiles(workspaceDir = ROOT_DIR) {
  const absWorkspace = path.resolve(workspaceDir);

  let entries = [];
  try {
    entries = fs.readdirSync(absWorkspace, { withFileTypes: true });
  } catch (err) {
    console.warn(`[Bootstrap] Cannot read workspace directory "${absWorkspace}": ${err.message}`);
    return BOOTSTRAP_FILES.map(name => ({
      name,
      content: `[${name} - directory unreadable]`,
      truncated: false
    }));
  }

  const fileByLower = new Map();
  for (const entry of entries) {
    if (entry.isFile()) {
      fileByLower.set(entry.name.toLowerCase(), entry.name);
    }
  }

  let usedChars = 0;
  const results = [];

  for (const name of BOOTSTRAP_FILES) {
    const actualName = fileByLower.get(name.toLowerCase());

    if (!actualName) {
      results.push({
        name,
        content: "",
        truncated: false,
        missing: true
      });
      continue;
    }

    const filePath = path.join(absWorkspace, actualName);
    let content = "";

    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      console.warn(`[Bootstrap] Cannot read "${filePath}": ${err.message}`);
      results.push({
        name,
        content: `[${name} - unreadable]`,
        truncated: false
      });
      continue;
    }

    const remaining = Math.max(0, MAX_TOTAL_CHARS - usedChars);
    const allowed = Math.min(MAX_CHARS_PER_FILE, remaining);

    if (allowed <= 0) {
      results.push({
        name,
        content: "[truncated - bootstrap cap reached]",
        truncated: true
      });
      continue;
    }

    const truncated = content.length > allowed;
    const finalContent = truncated ? content.slice(0, allowed) : content;
    usedChars += finalContent.length;

    results.push({
      name,
      content: finalContent,
      truncated
    });
  }

  return results;
}

/**
 * Build a persona prompt from loaded bootstrap files
 * @param {string} workspaceDir - Root workspace directory
 * @returns {{prompt: string, files: Array, hasPersona: boolean}}
 */
export function buildPersonaPrompt(workspaceDir = ROOT_DIR) {
  const absWorkspace = path.resolve(workspaceDir);
  const signature = computeBootstrapSignature(absWorkspace);
  const cached = PERSONA_PROMPT_CACHE.get(absWorkspace);
  if (cached && cached.signature === signature) return cached.value;

  const files = discoverBootstrapFiles(absWorkspace);
  const parts = [];

  const soul = files.find(f => f.name === "SOUL.md");
  if (soul && soul.content && !soul.missing) {
    parts.push("## Agent Soul\n" + soul.content.trim());
  }

  const user = files.find(f => f.name === "USER.md");
  if (user && user.content && !user.missing) {
    parts.push("## User Profile\n" + user.content.trim());
  }

  const memory = files.find(f => f.name === "MEMORY.md");
  if (memory && memory.content && !memory.missing) {
    parts.push("## Product Memory\n" + memory.content.trim());
  }

  const identity = files.find(f => f.name === "IDENTITY.md");
  if (identity && identity.content && !identity.missing) {
    parts.push("## Identity\n" + identity.content.trim());
  }

  const value = {
    prompt: parts.join("\n\n"),
    files,
    hasPersona: parts.length > 0
  };
  PERSONA_PROMPT_CACHE.set(absWorkspace, { signature, value });
  if (PERSONA_PROMPT_CACHE.size > PERSONA_PROMPT_CACHE_MAX) {
    const oldestKey = PERSONA_PROMPT_CACHE.keys().next().value;
    if (oldestKey) PERSONA_PROMPT_CACHE.delete(oldestKey);
  }
  return value;
}

/**
 * Get specific bootstrap file content
 * @param {string} fileName - Name of the file (e.g., "SOUL.md")
 * @param {string} workspaceDir - Root workspace directory
 * @returns {string|null}
 */
export function getBootstrapFile(fileName, workspaceDir = ROOT_DIR) {
  const files = discoverBootstrapFiles(workspaceDir);
  const file = files.find(f => f.name.toLowerCase() === fileName.toLowerCase());
  if (file && file.content && !file.missing) {
    return file.content;
  }
  return null;
}

export default {
  discoverBootstrapFiles,
  buildPersonaPrompt,
  getBootstrapFile
};
