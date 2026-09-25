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

/**
 * The Skills section as a standalone block, for callers that place it after the static system prompt
 * (skills are picked per message, so keeping them out of the static part keeps that part cacheable).
 */
export function buildSkillsPromptBlock(skillsPrompt, promptMode = PromptMode.FULL) {
  if (promptMode !== PromptMode.FULL) return "";
  return buildSkillsSection({ skillsPrompt, isMinimal: false }).filter(Boolean).join("\n");
}

/**
 * One static line naming the integrations whose tools this runtime offers but the user has not connected. Their tool
 * schemas are left out of tool-loop requests (chat-handler/model-tool-scope), so the model is told what to answer
 * instead. Stable per user: it only changes when they connect or disconnect an integration.
 * `unconnectedIntegrations`: [{ label, covers }].
 */
export function buildUnconnectedIntegrationsLine(unconnectedIntegrations) {
  const entries = (Array.isArray(unconnectedIntegrations) ? unconnectedIntegrations : [])
    .map((entry) => ({
      label: sanitizeForPromptLiteral(entry?.label),
      covers: sanitizeForPromptLiteral(entry?.covers),
    }))
    .filter((entry) => entry.label);
  if (entries.length === 0) return "";
  const labels = entries.map((entry) => entry.label).join(", ");
  const covers = entries.map((entry) => (entry.covers ? `${entry.label}: ${entry.covers}` : entry.label)).join("; ");
  return `- Not connected for this user: ${labels} (${covers}). Their tools are unavailable. If a request needs one of them, say it is not connected and that the user can connect it on Nova's Integrations page; never guess or invent that data.`;
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
    return "You are Nova Operator, the user-facing assistant.";
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
    "You are Nova Operator, the only user-facing assistant identity in the Nova runtime.",
    "",
    "## Tooling",
    "Tool availability is runtime-dependent.",
    toolLines.length > 0
      ? toolLines.join("\n")
      : "- When tools are available for a request they are attached to it as tool definitions. Use only those; never claim a tool result you did not receive.",
    buildUnconnectedIntegrationsLine(params.unconnectedIntegrations),
    "",
    "## Safety",
    "Prioritize user intent and safe operation. Ask when instructions are unclear or risky.",
    "For vague asks, ask one concise clarifying question first. Avoid long option lists unless the user asks for them.",
    "Do not invent tool capabilities that are not present.",
    "Reply in English by default unless the user explicitly asks for another language.",
    "If web_search/web_fetch tools are available, use them for current events, scores, recaps, prices, and rapidly changing facts; do not claim internet is unavailable.",
    "If Coinbase tools are used, never fabricate prices/portfolio/transactions. On tool failure, explicitly say you could not verify live Coinbase data.",
    "",
    "## Response Quality",
    "Be conversational, warm, and direct. Never sound robotic or overly formal.",
    "Lead with the answer. Avoid preambles like 'Sure!' or 'Great question!' — just respond naturally.",
    "Keep replies concise unless the user asks for detail. One clear paragraph beats three vague ones.",
    "Use natural sentence structure. Avoid bullet lists unless the content genuinely benefits from them.",
    "Never say 'I cannot', 'As an AI', or 'I don't have the ability to'. If you lack info, say what you do know and what you'd need.",
    "",
    "## Source & Citation Policy",
    "Never attach source links, citations, confidence labels, or freshness metadata to your replies.",
    "Do not say things like 'Source:', 'Confidence:', 'Freshness:', or '(via …)' in any response.",
    "If the user explicitly asks for your source, asks you to fact-check, or says 'where did you get that', reply with ONLY a clickable markdown link — no extra commentary, no labels, just the URL in markdown link format.",
    "",
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

  // Skills are chosen per message, so they go last: everything above stays byte-identical between
  // calls, which lets providers with automatic prefix caching reuse it.
  const skillsSection = buildSkillsSection({ skillsPrompt: params.skillsPrompt, isMinimal });
  if (skillsSection.length > 0) lines.push("", ...skillsSection);

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
