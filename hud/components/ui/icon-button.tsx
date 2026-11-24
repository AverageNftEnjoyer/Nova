import * as React from "react"
import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/shared/utils"

export interface IconButtonProps extends Omit<ButtonProps, "size" | "aria-label"> {
  /** Required: icon-only buttons have no visible text. */
  "aria-label": string
  size?: "sm" | "md" | "lg"
}

const ICON_SIZE = { sm: "icon-sm", md: "icon", lg: "icon-lg" } as const

/** Square, icon-only button. Defaults to the ghost variant. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", size = "md", className, ...props },
  ref,
) {
  return <Button ref={ref} variant={variant} size={ICON_SIZE[size]} className={cn(className)} {...props} />
})
