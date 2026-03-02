import Anthropic from "@anthropic-ai/sdk";

export interface CompactResult {
  summary: string;
  removedTurns: number;
  savedTokens: number;
}

function messagesToTranscript(messages: Anthropic.MessageParam[]): string {
  return messages
    .map((message) => {
      const content = Array.isArray(message.content)
        ? message.content
            .map((block) => {
              if ((block as { type?: string }).type === "text") {
                return (block as { text?: string }).text ?? "";
              }
              if ((block as { type?: string }).type === "tool_use") {
                const tool = block as { name?: string; input?: unknown };
                return `[tool_use:${tool.name ?? "unknown"}] ${JSON.stringify(tool.input ?? {})}`;
              }
              if ((block as { type?: string }).type === "tool_result") {
                const result = block as { content?: unknown };
                return `[tool_result] ${typeof result.content === "string" ? result.content : JSON.stringify(result.content ?? "")}`;
              }
              return "";
            })
            .join("\n")
        : String(message.content ?? "");
      return `${message.role.toUpperCase()}: ${content}`;
    })
    .join("\n\n");
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function compactSession(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  model: string,
): Promise<CompactResult> {
  const transcript = messagesToTranscript(messages);
  const beforeTokens = estimateTokens(transcript);

  const prompt = [
    "Summarize this conversation preserving:",
    "- key decisions",
    "- user preferences",
    "- task context",
    "- any commitments made",
    "Be concise.",
    "",
    transcript.slice(0, 120_000),
  ].join("\n");

  const completion = await client.messages.create({
    model,
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });

  const summary = completion.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const afterTokens = estimateTokens(summary);
  return {
    summary,
    removedTurns: Math.max(0, messages.length - 8),
    savedTokens: Math.max(0, beforeTokens - afterTokens),
  };
}
