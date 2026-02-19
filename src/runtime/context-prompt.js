export function countApproxTokens(text) {
  if (!text) return 0;
  const asText = typeof text === "string" ? text : JSON.stringify(text);
  return Math.ceil(asText.length / 3.5);
}

export function enforcePromptTokenBound(systemPrompt, userMessage, maxPromptTokens = 600) {
  const systemTokens = countApproxTokens(systemPrompt);
  const userTokens = countApproxTokens(userMessage);
  const total = systemTokens + userTokens;
  if (total > maxPromptTokens) {
    console.warn(`[Token] Prompt exceeds ${maxPromptTokens} tokens (${total}).`);
  }
  return { systemTokens, userTokens, total };
}

export function buildSystemPromptWithPersona({
  buildAgentSystemPrompt,
  buildPersonaPrompt,
  workspaceDir,
  promptArgs,
}) {
  const personaContext = buildPersonaPrompt(workspaceDir);
  const memoryPrompt = personaContext.hasPersona ? personaContext.prompt : "";

  const systemPrompt = buildAgentSystemPrompt({
    ...promptArgs,
    memoryPrompt,
  });

  return {
    systemPrompt,
    personaContext,
    tokenBreakdown: {
      persona: countApproxTokens(memoryPrompt),
    },
  };
}
