import type { ComponentProps } from "react"
import { Gemini } from "@lobehub/icons"

export function GeminiIcon(props: ComponentProps<typeof Gemini.Color>) {
  return <Gemini.Color {...props} />
}
