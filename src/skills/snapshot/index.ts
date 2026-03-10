import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { discoverSkills } from "../discovery/index.js";
import type { Skill } from "../types/index.js";

const SKILL_SNAPSHOT_VERSION_IO_MAX_PARALLEL = Math.max(
  1,
  Math.min(16, Number.parseInt(process.env.NOVA_SKILL_SNAPSHOT_VERSION_IO_MAX_PARALLEL || "6", 10) || 6),
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

async function walkSkillFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  const directories: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      directories.push(full);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      files.push(full);
    }
  }

  const nested = await mapWithConcurrency(
    directories,
    SKILL_SNAPSHOT_VERSION_IO_MAX_PARALLEL,
    async (subdir): Promise<string[]> => walkSkillFiles(subdir),
  );
  for (const group of nested) {
    files.push(...group);
  }

  return files;
}

export class SkillSnapshot {
  private readonly dirs: string[];
  private cachedVersion = "";
  private cachedSkills: Skill[] = [];

  public constructor(dirs: string[]) {
    this.dirs = dirs.map((dir) => path.resolve(dir));
  }

  public async getSnapshot(): Promise<Skill[]> {
    const version = await this.computeVersion();
    if (version === this.cachedVersion) {
      return this.cachedSkills;
    }

    this.cachedSkills = await discoverSkills(this.dirs);
    this.cachedVersion = version;
    return this.cachedSkills;
  }

  private async computeVersion(): Promise<string> {
    const entries = (
      await mapWithConcurrency(
        (
          await mapWithConcurrency(
            this.dirs,
            SKILL_SNAPSHOT_VERSION_IO_MAX_PARALLEL,
            async (dir) => walkSkillFiles(dir),
          )
        ).flat(),
        SKILL_SNAPSHOT_VERSION_IO_MAX_PARALLEL,
        async (file) => {
          const stat = await fs.stat(file).catch(() => null);
          if (!stat) return null;
          return `${file}:${stat.mtimeMs}:${stat.size}`;
        },
      )
    ).filter((entry): entry is string => Boolean(entry));
    entries.sort();
    return crypto.createHash("sha256").update(entries.join("|"), "utf8").digest("hex");
  }
}
