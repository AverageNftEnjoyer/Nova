"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, MotionConfig, motion } from "motion/react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/shared/utils"

export interface FluidSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface FluidSelectProps {
  value: string
  options: FluidSelectOption[]
  onChange: (value: string) => void
  isLight: boolean
  className?: string
  buttonClassName?: string
}

export function FluidSelect({ value, options, onChange, isLight, className, buttonClassName }: FluidSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [hoveredValue, setHoveredValue] = useState<string | null>(null)
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const selected = useMemo(() => options.find((o) => o.value === value) ?? options[0], [options, value])

  useEffect(() => {
    if (!isOpen) return

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const viewportPadding = 12
      const gap = 8
      const estimatedMenuHeight = options.length * 36 + 10

      const spaceBelow = viewportHeight - rect.bottom - viewportPadding
      const spaceAbove = rect.top - viewportPadding
      const availableBelow = Math.max(0, spaceBelow - gap)
      const availableAbove = Math.max(0, spaceAbove - gap)
      const shouldOpenUp = availableBelow < estimatedMenuHeight && availableAbove > availableBelow
      const preferredAvailable = shouldOpenUp ? availableAbove : availableBelow
      const maxHeight = Math.max(
        80,
        Math.min(estimatedMenuHeight, preferredAvailable),
      )
      const top = shouldOpenUp
        ? Math.max(viewportPadding, rect.top - gap - maxHeight)
        : Math.min(rect.bottom + gap, viewportHeight - viewportPadding - maxHeight)

      const unclampedLeft = rect.left
      const maxLeft = viewportWidth - viewportPadding - rect.width
      const left = Math.max(viewportPadding, Math.min(unclampedLeft, maxLeft))

      setMenuStyle({
        left,
        top,
        width: rect.width,
        maxHeight,
      })
    }

    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [isOpen, options.length])

  useEffect(() => {
    if (!isOpen) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setIsOpen(false)
    }

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false)
    }

    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onEscape)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onEscape)
    }
  }, [isOpen])

  return (
    <MotionConfig reducedMotion="user">
      <div ref={rootRef} className={cn("relative", className)}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className={cn(
            "h-9 w-full rounded-md border px-3 text-left text-sm transition-colors inline-flex items-center justify-between",
            isLight
              ? "border-[#d5dce8] bg-[#f4f7fd] text-s-90 hover:bg-[#eef3fb]"
              : "border-white/12 bg-white/[0.06] text-slate-100 backdrop-blur-md hover:bg-white/[0.1]",
            buttonClassName,
          )}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          <span className="truncate">{selected?.label ?? ""}</span>
          <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.16 }}>
            <ChevronDown className={cn("h-4 w-4", isLight ? "text-s-50" : "text-slate-400")} />
          </motion.div>
        </button>

        {typeof document !== "undefined" && menuStyle
          ? createPortal(
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    ref={menuRef}
                    initial={{ opacity: 0, y: -6, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    exit={{ opacity: 0, y: -6, height: 0 }}
                    transition={{ duration: 0.14, ease: "easeOut" }}
                    style={{ left: menuStyle.left, top: menuStyle.top, width: menuStyle.width, maxHeight: menuStyle.maxHeight }}
                    className="fixed z-[80]"
                  >
                    <motion.div
                      className={cn(
                        "max-h-full overflow-hidden rounded-lg border p-1 shadow-lg backdrop-blur-xl",
                        isLight
                          ? "border-[#d5dce8] bg-[#f7faff]/95 shadow-[0_10px_30px_-18px_rgba(73,98,141,0.35)]"
                          : "border-white/14 bg-white/8 shadow-[0_14px_36px_-20px_rgba(120,170,255,0.35)]",
                      )}
                      initial={{ opacity: 0.95 }}
                      animate={{ opacity: 1 }}
                    >
                      {options.map((option, index) => (
                        <motion.button
                          key={option.value}
                          type="button"
                          disabled={option.disabled}
                          onMouseEnter={() => setHoveredValue(option.value)}
                          onMouseLeave={() => setHoveredValue(null)}
                          onClick={() => {
                            if (option.disabled) return
                            onChange(option.value)
                            setIsOpen(false)
                          }}
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.16, delay: index * 0.03 }}
                          className={cn(
                            "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                            option.disabled && "cursor-not-allowed opacity-45",
                            !option.disabled && (isLight ? "hover:bg-[#eaf1fd]" : "hover:bg-white/12"),
                            (value === option.value || hoveredValue === option.value) && !option.disabled
                              ? isLight
                                ? "bg-[#eaf1fd] text-s-90"
                                : "bg-white/14 text-slate-100"
                              : isLight
                                ? "text-s-70"
                                : "text-slate-300",
                          )}
                        >
                          {option.label}
                        </motion.button>
                      ))}
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>,
              document.body,
            )
          : null}
      </div>
    </MotionConfig>
  )
}
