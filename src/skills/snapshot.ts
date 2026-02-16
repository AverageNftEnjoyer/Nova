import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { discoverSkills } from "./discovery.js";
import type { Skill } from "./types.js";

async function walkSkillFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkSkillFiles(full)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      files.push(full);
    }
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
    const entries: string[] = [];
    for (const dir of this.dirs) {
      const files = await walkSkillFiles(dir);
      for (const file of files) {
        const stat = await fs.stat(file).catch(() => null);
        if (!stat) continue;
        entries.push(`${file}:${stat.mtimeMs}:${stat.size}`);
      }
    }
    entries.sort();
    return crypto.createHash("sha256").update(entries.join("|"), "utf8").digest("hex");
  }
}
