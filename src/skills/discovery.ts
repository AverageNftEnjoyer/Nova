import fs from "node:fs/promises";
import path from "node:path";
import type { Skill } from "./types.js";

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const results: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walk(full)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      results.push(full);
    }
  }

  return results;
}

function extractDescription(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "No description provided.";

  if (trimmed.startsWith("---")) {
    const end = trimmed.indexOf("\n---", 3);
    if (end > 0) {
      const frontmatter = trimmed.slice(3, end);
      const match = frontmatter.match(/description:\s*(.+)/i);
      if (match?.[1]) {
        return match[1].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }

  const firstParagraph = trimmed
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean);

  return firstParagraph?.replace(/^#\s+/, "").trim() || "No description provided.";
}

export async function discoverSkills(dirs: string[]): Promise<Skill[]> {
  const allSkillFiles: string[] = [];
  for (const dir of dirs) {
    allSkillFiles.push(...(await walk(path.resolve(dir))));
  }

  const deduped = Array.from(new Set(allSkillFiles));
  const skills: Skill[] = [];

  for (const skillFile of deduped) {
    const raw = await fs.readFile(skillFile, "utf8").catch(() => "");
    const location = skillFile;
    const name = path.basename(path.dirname(skillFile));
    const description = extractDescription(raw);
    skills.push({ name, description, location });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
