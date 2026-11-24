"use client"

import * as React from "react"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { Input, type InputProps } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"

export interface SearchInputProps extends Omit<InputProps, "type" | "value" | "onChange"> {
  value: string
  onValueChange: (value: string) => void
  /** Keyboard hint shown on the right while empty (e.g. "/"). The caller binds the key. */
  shortcut?: string
  containerClassName?: string
}

/** Search field with an icon, Esc to clear and a clear button. */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onValueChange, shortcut, className, containerClassName, onKeyDown, placeholder = "Search", ...props },
  ref,
) {
  return (
    <div className={cn("relative flex items-center", containerClassName)}>
      <Search aria-hidden className="pointer-events-none absolute left-2.5 size-3.5 text-faint" />
      <Input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={props["aria-label"] ?? (typeof placeholder === "string" ? placeholder : "Search")}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.stopPropagation()
            onValueChange("")
          }
          onKeyDown?.(event)
        }}
        className={cn("pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden", className)}
        {...props}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onValueChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 inline-flex size-5 items-center justify-center rounded-sm text-faint hover:bg-hover hover:text-fg"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : shortcut ? (
        <Kbd className="pointer-events-none absolute right-2">{shortcut}</Kbd>
      ) : null}
    </div>
  )
})
