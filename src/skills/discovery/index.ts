import fs from "node:fs/promises";
import path from "node:path";
import type { Skill } from "../types/index.js";

const DISCOVER_SKILLS_IO_MAX_PARALLEL = Math.max(
  1,
  Math.min(16, Number.parseInt(process.env.NOVA_DISCOVER_SKILLS_IO_MAX_PARALLEL || "6", 10) || 6),
);

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const capped = Math.max(1, Math.floor(concurrency));
  const output = new Array<R>(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(capped, items.length)).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const results: string[] = [];
  const directories: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      directories.push(full);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      results.push(full);
    }
  }

  const nested = await mapWithConcurrency(
    directories,
    DISCOVER_SKILLS_IO_MAX_PARALLEL,
    async (subdir): Promise<string[]> => walk(subdir),
  );
  for (const group of nested) {
    results.push(...group);
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
  const allSkillFiles = (
    await mapWithConcurrency(
      dirs,
      DISCOVER_SKILLS_IO_MAX_PARALLEL,
      async (dir) => walk(path.resolve(dir)),
    )
  ).flat();

  const deduped = Array.from(new Set(allSkillFiles));
  const skills = await mapWithConcurrency(
    deduped,
    DISCOVER_SKILLS_IO_MAX_PARALLEL,
    async (skillFile): Promise<Skill> => {
      const raw = await fs.readFile(skillFile, "utf8").catch(() => "");
      const location = skillFile;
      const name = path.basename(path.dirname(skillFile));
      const description = extractDescription(raw);
      return { name, description, location };
    },
  );

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
