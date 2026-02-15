"use client"

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const content = contentRef.current
    if (!content) return
    let liveStars = 0

    const handleMouseMove = (e: MouseEvent) => {
      const rect = content.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      content.style.setProperty("--fx-overlay-x", `${mouseX}px`)
      content.style.setProperty("--fx-overlay-y", `${mouseY}px`)
      content.style.setProperty("--fx-overlay-opacity", "1")

      const items = content.querySelectorAll<HTMLElement>(
        "[data-slot='dropdown-menu-item'], [data-slot='dropdown-menu-checkbox-item'], [data-slot='dropdown-menu-radio-item'], [data-slot='dropdown-menu-sub-trigger']",
      )
      const proximity = 52
      const fadeDistance = 104

      items.forEach((item) => {
        const itemRect = item.getBoundingClientRect()
        const isInsideItem =
          e.clientX >= itemRect.left &&
          e.clientX <= itemRect.right &&
          e.clientY >= itemRect.top &&
          e.clientY <= itemRect.bottom
        const centerX = itemRect.left + itemRect.width / 2
        const centerY = itemRect.top + itemRect.height / 2
        const distance =
          Math.hypot(e.clientX - centerX, e.clientY - centerY) - Math.max(itemRect.width, itemRect.height) / 2
        const effectiveDistance = Math.max(0, distance)

        let glowIntensity = 0
        if (effectiveDistance <= proximity) {
          glowIntensity = 1
        } else if (effectiveDistance <= fadeDistance) {
          glowIntensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity)
        }

        const relativeX = ((e.clientX - itemRect.left) / itemRect.width) * 100
        const relativeY = ((e.clientY - itemRect.top) / itemRect.height) * 100
        item.style.setProperty("--glow-x", `${relativeX}%`)
        item.style.setProperty("--glow-y", `${relativeY}%`)
        item.style.setProperty("--glow-intensity", glowIntensity.toString())
        item.style.setProperty("--glow-radius", "74px")

        if (isInsideItem && glowIntensity > 0.2 && Math.random() <= 0.12 && liveStars < 18) {
          liveStars += 1
          const star = document.createElement("span")
          star.className = "fx-star-particle"
          star.style.left = `${e.clientX - itemRect.left}px`
          star.style.top = `${e.clientY - itemRect.top}px`
          star.style.setProperty("--fx-star-color", "rgba(255,255,255,1)")
          star.style.setProperty("--fx-star-glow", "rgba(255,255,255,0.72)")
          star.style.setProperty("--star-x", `${(Math.random() - 0.5) * 22}px`)
          star.style.setProperty("--star-y", `${-8 - Math.random() * 16}px`)
          star.style.animationDuration = `${0.75 + Math.random() * 0.5}s`
          item.appendChild(star)
          star.addEventListener(
            "animationend",
            () => {
              star.remove()
              liveStars = Math.max(0, liveStars - 1)
            },
            { once: true },
          )
        }
      })
    }

    const handleMouseLeave = () => {
      content.style.setProperty("--fx-overlay-opacity", "0")
      const items = content.querySelectorAll<HTMLElement>(
        "[data-slot='dropdown-menu-item'], [data-slot='dropdown-menu-checkbox-item'], [data-slot='dropdown-menu-radio-item'], [data-slot='dropdown-menu-sub-trigger']",
      )
      items.forEach((item) => item.style.setProperty("--glow-intensity", "0"))
    }

    content.addEventListener("mousemove", handleMouseMove)
    content.addEventListener("mouseleave", handleMouseLeave)

    return () => {
      content.removeEventListener("mousemove", handleMouseMove)
      content.removeEventListener("mouseleave", handleMouseLeave)
    }
  }, [])

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={contentRef}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "fx-spotlight-shell z-50 min-w-[8rem] overflow-hidden rounded-xl p-1.5 backdrop-blur-xl",
          "max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin)",
          "border border-white/8 bg-[#0c1019]/95 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)]",
          "dark:border-white/8 dark:bg-[#0c1019]/95 dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)]",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
          "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        style={
          {
            "--fx-overlay-x": "50%",
            "--fx-overlay-y": "50%",
            "--fx-overlay-opacity": "0",
          } as React.CSSProperties
        }
        {...props}
      >
        <div className="fx-spotlight-overlay fx-spotlight-overlay--sm" />
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "fx-dropdown-item fx-spotlight-card fx-border-glow relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-hidden select-none transition-all duration-150",
        "text-s-60 data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-s-90",
        "data-[variant=destructive]:text-red-400 data-[variant=destructive]:data-[highlighted]:bg-red-500/10 data-[variant=destructive]:data-[highlighted]:text-red-400",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:opacity-70",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "fx-dropdown-item fx-spotlight-card fx-border-glow relative flex cursor-pointer items-center gap-3 rounded-lg py-2.5 pr-3 pl-9 text-sm outline-hidden select-none transition-all duration-150",
        "text-s-60 data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-s-90",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-3 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4 text-accent" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "fx-dropdown-item fx-spotlight-card fx-border-glow relative flex cursor-pointer items-center gap-3 rounded-lg py-2.5 pr-3 pl-9 text-sm outline-hidden select-none transition-all duration-150",
        "text-s-60 data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-s-90",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-3 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-accent text-accent" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-3 py-2 text-xs font-medium uppercase tracking-wider text-s-40 data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("my-1.5 h-px bg-white/[0.06]", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-wider text-s-30 font-mono",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "fx-dropdown-item fx-spotlight-card fx-border-glow flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-hidden select-none transition-all duration-150",
        "text-s-60 data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-s-90",
        "data-[state=open]:bg-white/[0.04] data-[state=open]:text-s-80",
        "data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:opacity-70",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4 opacity-50" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-xl p-1.5 backdrop-blur-xl",
        "origin-(--radix-dropdown-menu-content-transform-origin)",
        "border border-white/8 bg-[#0c1019]/95 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
        "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
