const SILENT_REPLY_TOKEN = "__SILENT__";

function sanitizeForPromptLiteral(value) {
  return String(value || "").replace(/\r?\n/g, " ").trim();
}

function listDeliverableMessageChannels() {
  return ["telegram", "discord"];
}

/**
 * Controls which hardcoded sections are included in the system prompt.
 * - "full": All sections (default, for main agent)
 * - "minimal": Reduced sections (Tooling, Workspace, Runtime) - used for subagents
 * - "none": Just basic identity line, no sections
 */
export const PromptMode = {
  FULL: "full",
  MINIMAL: "minimal",
  NONE: "none",
};

function buildSkillsSection(params) {
  if (params.isMinimal) return [];
  const trimmed = String(params.skillsPrompt || "").trim();
  if (!trimmed) return [];
  return [
    "## Skills (framework)",
    "Choose one best-fit skill before execution.",
    "Do not load multiple skills up front.",
    trimmed,
    "",
  ];
}

function buildMemorySection(params) {
  if (params.isMinimal) return [];
  const trimmedMemoryPrompt = String(params.memoryPrompt || "").trim();
  if (!trimmedMemoryPrompt) return [];
  const lines = [
    "## Memory",
    "Use the memory context below as soft guidance; prefer current user instructions if conflict exists.",
    trimmedMemoryPrompt,
  ];
  if (params.memoryCitationsMode === "on") {
    lines.push("When helpful, cite memory source snippets once memory tooling is enabled.");
  }
  lines.push("");
  return lines;
}

function buildUserIdentitySection(ownerLine, isMinimal) {
  if (!ownerLine || isMinimal) return [];
  return ["## User Identity", ownerLine, ""];
}

function buildTimeSection(params) {
  if (!params.userTimezone) return [];
  return ["## Current Date & Time", `Time zone: ${params.userTimezone}`, ""];
}

function buildReplyTagsSection(isMinimal) {
  if (isMinimal) return [];
  return [
    "## Reply Tags",
    "If channel routing requires it, reply tags can be added by runtime adapters.",
    "Keep assistant content clean and user-facing by default.",
    "",
  ];
}

function buildMessagingSection(params) {
  if (params.isMinimal) return [];
  return [
    "## Messaging",
    "- Reply naturally in the current session.",
    "- Cross-session routing can be introduced by runtime tools later.",
    `- Available channel families: ${params.messageChannelOptions}.`,
    `- If runtime consumes silent token for already-delivered messages, use: ${SILENT_REPLY_TOKEN}.`,
    ...(params.messageToolHints || []),
    "",
  ];
}

function buildVoiceSection(params) {
  if (params.isMinimal) return [];
  const hint = String(params.ttsHint || "").trim();
  if (!hint) return [];
  return ["## Voice (TTS)", hint, ""];
}

function buildDocsSection(params) {
  const docsPath = String(params.docsPath || "").trim();
  if (!docsPath || params.isMinimal) return [];
  return [
    "## Documentation",
    `Local docs: ${docsPath}`,
    "Consult local docs before guessing implementation details.",
    "",
  ];
}

export function buildAgentSystemPrompt(params) {
  const promptMode = params.promptMode || PromptMode.FULL;
  if (promptMode === PromptMode.NONE) {
    return "You are Nova, a personal assistant.";
  }

  const isMinimal = promptMode === PromptMode.MINIMAL;
  const workspaceDir = sanitizeForPromptLiteral(params.workspaceDir || ".");
  const ownerNumbers = (params.ownerNumbers || []).map((v) => String(v).trim()).filter(Boolean);
  const ownerLine =
    ownerNumbers.length > 0
      ? `Owner numbers: ${ownerNumbers.join(", ")}. Treat messages from these numbers as the primary user.`
      : "";
  const runtimeInfo = params.runtimeInfo || {};
  const runtimeChannel = String(runtimeInfo.channel || "").trim().toLowerCase();
  const runtimeCapabilities = (runtimeInfo.capabilities || []).map((v) => String(v).trim()).filter(Boolean);
  const messageChannelOptions = listDeliverableMessageChannels().join("|");
  const toolNames = (params.toolNames || []).map((v) => String(v).trim()).filter(Boolean);
  const toolSummaries = params.toolSummaries || {};
  const toolLines = toolNames.map((name) => {
    const summary = String(toolSummaries[name] || "").trim();
    return summary ? `- ${name}: ${summary}` : `- ${name}`;
  });

  const lines = [
    "You are Nova, a personal assistant running in the Nova runtime.",
    "",
    "## Tooling",
    "Tool availability is runtime-dependent.",
    toolLines.length > 0 ? toolLines.join("\n") : "- No external tool contracts registered in this runtime yet.",
    "",
    "## Safety",
    "Prioritize user intent and safe operation. Ask when instructions are unclear or risky.",
    "Do not invent tool capabilities that are not present.",
    "If web_search/web_fetch tools are available, use them for current events, scores, recaps, prices, and rapidly changing facts; do not claim internet is unavailable.",
    "",
    ...buildSkillsSection({
      skillsPrompt: params.skillsPrompt,
      isMinimal,
    }),
    ...buildMemorySection({
      isMinimal,
      memoryPrompt: params.memoryPrompt,
      memoryCitationsMode: params.memoryCitationsMode,
    }),
    ...buildDocsSection({
      docsPath: params.docsPath,
      isMinimal,
    }),
    ...buildUserIdentitySection(ownerLine, isMinimal),
    ...buildTimeSection({
      userTimezone: params.userTimezone,
    }),
    ...buildReplyTagsSection(isMinimal),
    ...buildMessagingSection({
      isMinimal,
      messageChannelOptions,
      messageToolHints: params.messageToolHints,
    }),
    ...buildVoiceSection({
      isMinimal,
      ttsHint: params.ttsHint,
    }),
    "## Workspace",
    `Working directory: ${workspaceDir}`,
    "Treat this directory as the primary workspace unless user instructs otherwise.",
    ...((params.workspaceNotes || []).map((v) => String(v).trim()).filter(Boolean)),
    "",
  ];

  const extraSystemPrompt = String(params.extraSystemPrompt || "").trim();
  if (extraSystemPrompt) {
    lines.push("## Context", extraSystemPrompt, "");
  }

  lines.push(
    "## Runtime",
    buildRuntimeLine(runtimeInfo, runtimeChannel, runtimeCapabilities, params.defaultThinkLevel),
    `Reasoning: ${params.reasoningLevel || "off"}`,
    "",
    "## Silent Replies",
    `When runtime expects an already-delivered response marker, reply with only: ${SILENT_REPLY_TOKEN}`,
  );

  return lines.filter(Boolean).join("\n");
}

export function buildRuntimeLine(
  runtimeInfo = {},
  runtimeChannel = "",
  runtimeCapabilities = [],
  defaultThinkLevel = "off",
) {
  return `Runtime: ${[
    runtimeInfo.agentId ? `agent=${runtimeInfo.agentId}` : "",
    runtimeInfo.host ? `host=${runtimeInfo.host}` : "",
    runtimeInfo.repoRoot ? `repo=${runtimeInfo.repoRoot}` : "",
    runtimeInfo.os
      ? `os=${runtimeInfo.os}${runtimeInfo.arch ? ` (${runtimeInfo.arch})` : ""}`
      : runtimeInfo.arch
        ? `arch=${runtimeInfo.arch}`
        : "",
    runtimeInfo.node ? `node=${runtimeInfo.node}` : "",
    runtimeInfo.model ? `model=${runtimeInfo.model}` : "",
    runtimeInfo.defaultModel ? `default_model=${runtimeInfo.defaultModel}` : "",
    runtimeInfo.shell ? `shell=${runtimeInfo.shell}` : "",
    runtimeChannel ? `channel=${runtimeChannel}` : "",
    runtimeChannel
      ? `capabilities=${runtimeCapabilities.length > 0 ? runtimeCapabilities.join(",") : "none"}`
      : "",
    `thinking=${defaultThinkLevel}`,
  ]
    .filter(Boolean)
    .join(" | ")}`;
}
