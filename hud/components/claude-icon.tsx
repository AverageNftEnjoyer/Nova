import type { ComponentProps } from "react"
import { Claude } from "@lobehub/icons"

export function ClaudeIcon(props: ComponentProps<typeof Claude.Color>) {
  return <Claude.Color {...props} />
}
