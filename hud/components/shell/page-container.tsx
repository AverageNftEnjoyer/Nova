import * as React from "react"
import { cn } from "@/lib/shared/utils"

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * default: 72rem reading/working width (lists, settings-like pages).
   * wide: 96rem for tables and dashboards.
   * full: no max width (editors, canvases, calendars).
   */
  width?: "default" | "wide" | "full"
  /** Fill the shell's content height (no page scroll; the page scrolls its own regions). For chat, canvases. */
  fill?: boolean
  /** Drop the gutter (edge-to-edge layouts that draw their own borders). */
  flush?: boolean
}

const WIDTH = {
  default: "max-w-[72rem]",
  wide: "max-w-[96rem]",
  full: "max-w-none",
} as const

/**
 * Standard page frame inside the app shell's scrolling `<main>`: 24px gutter (32px from 1280px), centred max width.
 * Render `<PageHeader>` first, then the content.
 */
export function PageContainer({ width = "default", fill = false, flush = false, className, ...props }: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full",
        WIDTH[width],
        !flush && "px-6 pt-6 pb-10 xl:px-8 xl:pt-7",
        fill && "flex h-full min-h-0 flex-col pb-6",
        className,
      )}
      {...props}
    />
  )
}
