import type { Skill } from "./types.js";

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const body = skills
    .map(
      (skill) =>
        `<skill><name>${escapeXml(skill.name)}</name><description>${escapeXml(skill.description)}</description><location>${escapeXml(skill.location)}</location></skill>`,
    )
    .join("");

  return [
    "Scan descriptions. If one applies, use the read tool to load its SKILL.md. Never load more than one upfront.",
    `<available_skills>${body}</available_skills>`,
  ].join("\n");
}
