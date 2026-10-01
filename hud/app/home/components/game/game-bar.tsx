import { cn } from "@/lib/shared/utils"

export type GameBarTone = "xp" | "quest" | "done"

interface GameBarProps {
  /** 0..1 */
  value: number
  tone?: GameBarTone
  /** Accessible name, e.g. "Experience" or the quest title. */
  label: string
  /** Read out instead of a percentage, e.g. "3 of 5". */
  valueText?: string
  className?: string
}

/** A segmented pixel progress bar (XP, quest progress, building uses). */
export function GameBar({ value, tone = "quest", label, valueText, className }: GameBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={valueText}
      className={cn("game-bar", `game-bar--${tone}`, className)}
    >
      <div className="game-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}
