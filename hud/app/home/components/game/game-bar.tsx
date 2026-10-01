import { cn } from "@/lib/shared/utils"

export type GameBarTone = "xp" | "quest" | "done"

/** Core bar colours: XP is gold (the default fill), a quest in progress teal, a finished one green. */
const TONE_CLASS: Record<GameBarTone, string> = {
  xp: "",
  quest: "pixel-bar--teal",
  done: "pixel-bar--green",
}

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

/** A segmented pixel progress bar (XP, quest progress, building uses): the core `.pixel-bar`. */
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
      className={cn("pixel-bar", TONE_CLASS[tone], className)}
    >
      <span className="pixel-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}
