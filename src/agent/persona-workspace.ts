import fs from "node:fs";
import path from "node:path";
import { normalizeUserContextId } from "../session/key.js";

const BOOTSTRAP_FILE_NAMES = ["SOUL.md", "USER.md", "AGENTS.md", "MEMORY.md", "IDENTITY.md"];

export interface ResolvePersonaWorkspaceParams {
  workspaceRoot: string;
  userContextRoot: string;
  userContextId?: string;
}

export function resolvePersonaWorkspaceDir(params: ResolvePersonaWorkspaceParams): string {
  const workspaceRoot = path.resolve(params.workspaceRoot);
  const userContextRoot = path.resolve(params.userContextRoot);
  const normalized = normalizeUserContextId(String(params.userContextId || ""));
  const contextId = normalized || "anonymous";
  const userDir = path.join(userContextRoot, contextId);

  try {
    fs.mkdirSync(userDir, { recursive: true });
  } catch {
    return userDir;
  }

  // Preserve legacy behavior: seed from templates only for explicit user contexts.
  if (!normalized) return userDir;

  const templatesDir = path.join(workspaceRoot, "templates");
  for (const fileName of BOOTSTRAP_FILE_NAMES) {
    const targetPath = path.join(userDir, fileName);
    if (fs.existsSync(targetPath)) continue;
    const templatePath = path.join(templatesDir, fileName);
    if (!fs.existsSync(templatePath)) continue;
    try {
      fs.copyFileSync(templatePath, targetPath);
    } catch {
      // Ignore per-file seeding failures; callers still use user-scoped directory.
    }
  }

  return userDir;
}
