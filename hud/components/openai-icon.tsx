import type { ComponentProps } from "react"
import { OpenAI } from "@lobehub/icons"

type OpenAIIconProps = Omit<ComponentProps<typeof OpenAI>, "size"> & {
  size?: number
}

export function OpenAIIcon({ size = 18, ...props }: OpenAIIconProps) {
  return <OpenAI size={size} {...props} style={{ ...(props.style || {}), color: "#000000" }} />
}
