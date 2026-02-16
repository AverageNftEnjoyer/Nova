import type { BootstrapFile } from "./bootstrap.js";
import { formatToolSummaries } from "./tool-summaries.js";
import type { Tool } from "../tools/types.js";
import type { Skill } from "../skills/types.js";
import { formatSkillsForPrompt } from "../skills/formatter.js";

export type PromptMode = "full" | "minimal" | "none";

export interface BuildSystemPromptParams {
  mode: PromptMode;
  workspacePath: string;
  tools: Tool[];
  skills: Skill[];
  bootstrapFiles: BootstrapFile[];
  memoryEnabled: boolean;
  timezone?: string;
}

function getBootstrapContent(files: BootstrapFile[], name: string): string {
  const found = files.find((file) => file.name.toLowerCase() === name.toLowerCase());
  return found?.content?.trim() ?? "";
}

function renderProjectContext(files: BootstrapFile[]): string {
  const visible = files.filter((file) => ["AGENTS.md", "MEMORY.md", "IDENTITY.md"].includes(file.name));
  if (visible.length === 0) return "";
  return visible
    .map((file) => `## ${file.name}\n${file.content}`)
    .join("\n\n");
}

export function buildSystemPrompt(params: BuildSystemPromptParams): string {
  if (params.mode === "none") {
    return "You are a personal assistant.";
  }

  const soul = getBootstrapContent(params.bootstrapFiles, "SOUL.md");
  const userIdentity = getBootstrapContent(params.bootstrapFiles, "USER.md");
  const identitySection = soul || "You are a helpful personal assistant that works inside a local workspace.";

  const tooling = formatToolSummaries(params.tools);
  const skillsPrompt = formatSkillsForPrompt(params.skills);

  if (params.mode === "minimal") {
    return [
      "## Identity",
      identitySection,
      "",
      "## Safety",
      "Do not attempt to bypass oversight or acquire resources beyond what's needed for the current task.",
      "",
      "## Tooling",
      tooling,
      "",
      "## Workspace",
      `Your working directory is: ${params.workspacePath}`,
    ].join("\n");
  }

  const lines = [
    "## Identity",
    identitySection,
    "",
    "## Safety",
    "Do not attempt to bypass oversight or acquire resources beyond what's needed for the current task.",
    "",
    "## Tooling",
    tooling,
    "",
  ];

  if (skillsPrompt) {
    lines.push("## Skills", skillsPrompt, "");
  }

  if (params.memoryEnabled) {
    lines.push(
      "## Memory Recall",
      "You have access to memory_search for recalling past context. Use it when the user references past conversations or assumes shared knowledge.",
      "",
    );
  }

  lines.push(
    "## Workspace",
    `Your working directory is: ${params.workspacePath}`,
    "",
    "## Current Date/Time",
    `Time zone: ${params.timezone || "UTC"}`,
    "Use session_status for exact current time if needed.",
    "",
  );

  if (userIdentity) {
    lines.push("## User Identity", userIdentity, "");
  }

  const projectContext = renderProjectContext(params.bootstrapFiles);
  if (projectContext) {
    lines.push("## Project Context", projectContext, "");
  }

  return lines.join("\n");
}
