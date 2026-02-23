/**
 * AI Node Executors
 */

import "server-only"

import type { AiSummarizeNode, AiClassifyNode, AiExtractNode, AiGenerateNode, AiChatNode, NodeOutput, ExecutionContext } from "../../types"
import { completeWithConfiguredLlm } from "../../llm/providers"
import { truncateForModel } from "../../text/cleaning"
import { aggregateUpstreamNodeText } from "../../output/briefing-presenter"

const MAX_INPUT_CHARS = 12000
const MAX_PROMPT_CHARS = 11000

function resolveAiInput(node: { inputExpression?: string }, ctx: ExecutionContext, fallback: string): string {
  if (node.inputExpression) {
    const resolved = ctx.resolveExpr(node.inputExpression)
    if (resolved.trim()) return truncateForModel(resolved, MAX_INPUT_CHARS)
  }
  return truncateForModel(fallback, MAX_INPUT_CHARS)
}

function getUpstreamContextText(ctx: ExecutionContext): string {
  const aggregated = aggregateUpstreamNodeText({
    mission: ctx.mission,
    nodeOutputs: ctx.nodeOutputs,
    maxChars: MAX_INPUT_CHARS,
    perNodeMaxChars: 1600,
  }).trim()
  if (aggregated) return aggregated
  let lastText = ""
  for (const [, output] of ctx.nodeOutputs.entries()) {
    if (output.text) lastText = output.text
  }
  return truncateForModel(lastText, MAX_INPUT_CHARS)
}

// ─── Summarize ────────────────────────────────────────────────────────────────

export async function executeAiSummarize(
  node: AiSummarizeNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const inputText = resolveAiInput(node, ctx, getUpstreamContextText(ctx))
  if (!inputText.trim()) {
    return { ok: false, error: "No input text available for AI summarization." }
  }

  const prompt = ctx.resolveExpr(node.prompt)
  const system = node.systemPrompt || undefined
  const fullPrompt = truncateForModel(
    `${prompt}\n\n---INPUT---\n${inputText}`,
    MAX_PROMPT_CHARS,
  )

  try {
    const override = node.integration || node.model
      ? { provider: node.integration || undefined, model: node.model || undefined }
      : undefined
    const result = await completeWithConfiguredLlm(system || "", fullPrompt, 2200, ctx.scope, override)
    return { ok: true, text: result.text, data: { text: result.text, provider: result.provider, model: result.model } }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ─── Classify ─────────────────────────────────────────────────────────────────

export async function executeAiClassify(
  node: AiClassifyNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const inputText = resolveAiInput(node, ctx, getUpstreamContextText(ctx))
  const categories = (node.categories || []).join(", ")
  const prompt = `${ctx.resolveExpr(node.prompt)}\n\nCategories: ${categories}\n\nClassify the following:\n${inputText}\n\nRespond with ONLY the category name.`

  try {
    const override = node.integration || node.model
      ? { provider: node.integration || undefined, model: node.model || undefined }
      : undefined
    const result = await completeWithConfiguredLlm("", truncateForModel(prompt, MAX_PROMPT_CHARS), 500, ctx.scope, override)
    const classification = result.text.trim()
    return {
      ok: true,
      text: classification,
      data: { classification, categories: node.categories, provider: result.provider },
    }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ─── Extract ──────────────────────────────────────────────────────────────────

export async function executeAiExtract(
  node: AiExtractNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const inputText = resolveAiInput(node, ctx, getUpstreamContextText(ctx))
  const schemaHint = node.outputSchema ? `\n\nOutput as JSON matching this schema:\n${node.outputSchema}` : "\n\nOutput as JSON."
  const prompt = `${ctx.resolveExpr(node.prompt)}${schemaHint}\n\n---INPUT---\n${inputText}`

  try {
    const override = node.integration || node.model
      ? { provider: node.integration || undefined, model: node.model || undefined }
      : undefined
    const result = await completeWithConfiguredLlm("", truncateForModel(prompt, MAX_PROMPT_CHARS), 2200, ctx.scope, override)
    let data: unknown = result.text
    try { data = JSON.parse(result.text) } catch { /* keep as text */ }
    return { ok: true, text: result.text, data }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ─── Generate ─────────────────────────────────────────────────────────────────

export async function executeAiGenerate(
  node: AiGenerateNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const contextText = getUpstreamContextText(ctx)
  const prompt = ctx.resolveExpr(node.prompt)
  const fullPrompt = contextText
    ? truncateForModel(`${prompt}\n\n---CONTEXT---\n${contextText}`, MAX_PROMPT_CHARS)
    : truncateForModel(prompt, MAX_PROMPT_CHARS)

  try {
    const override = node.integration || node.model
      ? { provider: node.integration || undefined, model: node.model || undefined }
      : undefined
    const result = await completeWithConfiguredLlm(node.systemPrompt || "", fullPrompt, 2200, ctx.scope, override)
    return { ok: true, text: result.text, data: { text: result.text, provider: result.provider, model: result.model } }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export async function executeAiChat(
  node: AiChatNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const messages = node.messages || []
  // Resolve expressions in message content
  const resolvedMessages = messages.map((m) => ({
    role: m.role,
    content: ctx.resolveExpr(m.content),
  }))

  // Build a combined prompt from the conversation
  const combinedPrompt = resolvedMessages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n")
  const system = resolvedMessages.find((m) => m.role === "system")?.content

  try {
    const override = node.integration || node.model
      ? { provider: node.integration || undefined, model: node.model || undefined }
      : undefined
    const result = await completeWithConfiguredLlm(system || "", truncateForModel(combinedPrompt, MAX_PROMPT_CHARS), 2200, ctx.scope, override)
    return { ok: true, text: result.text, data: { text: result.text, provider: result.provider } }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
