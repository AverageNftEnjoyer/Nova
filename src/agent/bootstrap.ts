import fs from "node:fs";
import path from "node:path";

export interface BootstrapFile {
  name: string;
  content: string;
  truncated: boolean;
}

const BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "MEMORY.md", "IDENTITY.md"];

export function discoverBootstrapFiles(
  workspaceDir: string,
  limits?: { bootstrapMaxChars?: number; bootstrapTotalMaxChars?: number },
): BootstrapFile[] {
  const maxChars = limits?.bootstrapMaxChars ?? 20_000;
  const totalMaxChars = limits?.bootstrapTotalMaxChars ?? 24_000;
  const absWorkspace = path.resolve(workspaceDir);

  const rootEntries = fs.existsSync(absWorkspace)
    ? fs.readdirSync(absWorkspace, { withFileTypes: true })
    : [];
  const fileByLower = new Map<string, string>();

  for (const entry of rootEntries) {
    if (!entry.isFile()) continue;
    fileByLower.set(entry.name.toLowerCase(), entry.name);
  }

  let usedChars = 0;
  const out: BootstrapFile[] = [];

  for (const name of BOOTSTRAP_FILES) {
    const actualName = fileByLower.get(name.toLowerCase());
    if (!actualName) {
      out.push({
        name,
        content: `[${name} missing]`,
        truncated: false,
      });
      continue;
    }

    const filePath = path.join(absWorkspace, actualName);
    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      out.push({
        name,
        content: `[${name} unreadable]`,
        truncated: false,
      });
      continue;
    }

    const remaining = Math.max(0, totalMaxChars - usedChars);
    const allowed = Math.min(maxChars, remaining);
    if (allowed <= 0) {
      out.push({
        name,
        content: "[truncated due to global bootstrap cap]",
        truncated: true,
      });
      continue;
    }

    const truncated = content.length > allowed;
    const finalContent = truncated ? content.slice(0, allowed) : content;
    usedChars += finalContent.length;
    out.push({
      name,
      content: finalContent,
      truncated,
    });
  }

  return out;
}
