import { streamText } from "ai"
import { NextResponse } from "next/server"
import { resolveConfiguredLlmProvider } from "@/lib/integrations/provider-selection"
import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"

function toAiSdkModelId(provider: string, model: string): string {
  const normalizedProvider = String(provider || "").trim().toLowerCase()
  const normalizedModel = String(model || "").trim()
  if (!normalizedModel) return "openai/gpt-4.1-mini"
  if (normalizedProvider === "claude") return `anthropic/${normalizedModel}`
  if (normalizedProvider === "grok") return `xai/${normalizedModel}`
  if (normalizedProvider === "gemini") return `google/${normalizedModel}`
  return `openai/${normalizedModel}`
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  ensureNotificationSchedulerStarted()

  try {
    const { messages, model } = await req.json()

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Invalid request: messages array required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    let selectedModel = String(model || "").trim()
    if (!selectedModel) {
      const config = await loadIntegrationsConfig(verified)
      const { provider, model: providerModel } = resolveConfiguredLlmProvider(config)
      selectedModel = toAiSdkModelId(provider, providerModel)
    }

    const lastIndex = messages.length - 1
    const transformedMessages = messages.map(
      (m: { role: string; content: string; imageData?: string }, index: number) => {
        // Only process image for the last user message
        const isLastUserMessage = index === lastIndex && m.role === "user"

        if (isLastUserMessage && m.imageData && m.imageData.startsWith("data:image/")) {
          // For the current message with an image, use multimodal content format
          return {
            role: m.role as "user" | "assistant",
            content: [
              {
                type: "image" as const,
                image: m.imageData,
              },
              {
                type: "text" as const,
                text: m.content || "Describe this image in detail.",
              },
            ],
          }
        }

        // For all other messages (history), use text only
        // If there was an image, mention it in the text
        let textContent = m.content
        if (m.imageData && !isLastUserMessage) {
          textContent = m.content || "[User shared an image]"
        }

        return {
          role: m.role as "user" | "assistant",
          content: textContent,
        }
      },
    )

    // Filter out any messages with empty content
    const validMessages = transformedMessages.filter((m: { content: string | object[] }) => {
      if (typeof m.content === "string") {
        return m.content.trim().length > 0
      }
      return true // Keep multimodal messages
    })

    if (validMessages.length === 0) {
      return new Response(JSON.stringify({ error: "No valid messages to process" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    const result = streamText({
      model: selectedModel,
      messages: validMessages as NonNullable<Parameters<typeof streamText>[0]["messages"]>,
      system: `You are a helpful, friendly AI assistant. You provide clear, concise, and accurate responses.
When explaining code or technical concepts, use markdown formatting with code blocks where appropriate.
Be conversational but professional. If you're unsure about something, say so honestly.
When analyzing images, describe them in detail and answer any questions about them.`,
    })

    return result.toTextStreamResponse()
  } catch (error) {
    console.error("Chat API error:", error)

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An unexpected error occurred",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
}
