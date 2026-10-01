"use client"

import { useEffect, useState, type CSSProperties } from "react"
import type { TownAckRequest, TownEvent } from "@/lib/town/types"
import { formatXp } from "./town-ui"

interface TownCelebrationsProps {
  events: readonly TownEvent[]
  ack: (request: TownAckRequest) => Promise<boolean>
}

interface Celebration {
  key: string
  kind: TownEvent["kind"]
  title: string
  detail: string
  xp?: number
  /** item-unlock only: the cosmetic's rarity (read from the event's title, "New <rarity> <slot>: <name>"). */
  rarity?: string
}

/** The rarity an item-unlock event names in its title; undefined for any other event. */
function rarityOf(event: TownEvent): string | undefined {
  if (event.kind !== "item-unlock") return undefined
  return /^New (starter|common|rare|epic) /.exec(event.title)?.[1]
}

/** A first launch for a busy user can hold dozens of events: show this many one by one, fold the rest into one. */
const MAX_SEQUENTIAL = 3
const TOAST_MS = 4200
const BANNER_MS = 5200
const GAP_MS = 350

const KIND_LABEL: Record<TownEvent["kind"], string> = {
  "level-up": "Level up",
  "quest-complete": "Quest complete",
  "building-up": "New building",
  achievement: "Achievement",
  "item-unlock": "New cosmetic",
}

/**
 * Plays each pending event once (a level-up banner, or a toast for everything else), acking its id as it shows so it
 * never repeats. Ids shown this session are remembered so a poll that races the ack cannot replay them.
 */
export function TownCelebrations({ events, ack }: TownCelebrationsProps) {
  const [shownIds, setShownIds] = useState<ReadonlySet<string>>(() => new Set())
  const [current, setCurrent] = useState<Celebration | null>(null)
  const pending = events.filter((event) => !shownIds.has(event.id)).sort((a, b) => a.at.localeCompare(b.at))
  const pendingKey = pending.map((event) => event.id).join("|")

  // Pick the next celebration after a short gap once the stage is free.
  useEffect(() => {
    if (current || pending.length === 0) return
    const timer = setTimeout(() => {
      let batch: TownEvent[]
      let next: Celebration
      if (pending.length > MAX_SEQUENTIAL) {
        // Too many to play one by one: the newest level-up (if any) leads, the rest are counted in its line.
        const levelUp = [...pending].reverse().find((event) => event.kind === "level-up")
        batch = pending
        const others = pending.length - (levelUp ? 1 : 0)
        next = levelUp
          ? { key: levelUp.id, kind: "level-up", title: levelUp.title, detail: `${levelUp.detail} · plus ${others} more rewards`, xp: levelUp.xp }
          : { key: pending[0].id, kind: "achievement", title: `${pending.length} new rewards`, detail: "See the Quest log and Town Hall for everything you earned." }
      } else {
        const event = pending[0]
        batch = [event]
        next = { key: event.id, kind: event.kind, title: event.title, detail: event.detail, xp: event.xp, rarity: rarityOf(event) }
      }
      const ids = batch.map((event) => event.id)
      setShownIds((prev) => new Set([...prev, ...ids]))
      setCurrent(next)
      void ack({ eventIds: ids })
    }, GAP_MS)
    return () => clearTimeout(timer)
    // pendingKey stands for `pending` (a new array every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, pendingKey, ack])

  // Auto-dismiss.
  useEffect(() => {
    if (!current) return
    const timer = setTimeout(() => setCurrent(null), current.kind === "level-up" ? BANNER_MS : TOAST_MS)
    return () => clearTimeout(timer)
  }, [current])

  if (!current) return null
  const dismiss = () => setCurrent(null)

  if (current.kind === "level-up") {
    return (
      <div className="game-celebration-stage pixel-ui" role="status" aria-live="polite">
        <div className="game-levelup-wrap" key={current.key}>
          <span className="game-sparks" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index} className="game-spark" style={{ "--i": index } as CSSProperties} />
            ))}
          </span>
          <button type="button" onClick={dismiss} className="game-levelup pixel-notch" aria-label={`${current.title}. ${current.detail}. Dismiss`}>
            <span className="pixel-label text-(--px-accent-2)">{KIND_LABEL[current.kind]}</span>
            <span className="game-levelup-title font-pixel-display">{current.title}</span>
            <span className="font-pixel text-[14px] text-(--px-muted)">{current.detail}</span>
            {current.xp ? <span className="font-pixel text-[14px] text-(--px-accent)">+{formatXp(current.xp)} XP</span> : null}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="game-toast-stage pixel-ui" role="status" aria-live="polite">
      {current.kind === "item-unlock" && (current.rarity === "rare" || current.rarity === "epic") ? (
        <span className="game-sparks" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="game-spark" style={{ "--i": index } as CSSProperties} />
          ))}
        </span>
      ) : null}
      <button type="button" onClick={dismiss} className="game-toast pixel-notch" data-kind={current.kind} data-rarity={current.rarity} key={current.key} aria-label={`${KIND_LABEL[current.kind]}: ${current.title}. Dismiss`}>
        <span className="game-toast-icon" aria-hidden="true" />
        <span className="flex min-w-0 flex-col items-start gap-1 text-left">
          <span className="pixel-label text-(--px-accent-2)">{KIND_LABEL[current.kind]}</span>
          <span className="font-pixel text-[15px] leading-tight text-(--px-text)">{current.title}</span>
          <span className="font-pixel text-[13px] leading-snug text-(--px-muted)">{current.detail}</span>
        </span>
        {current.xp ? <span className="shrink-0 font-pixel text-[14px] tabular-nums text-(--px-accent)">+{formatXp(current.xp)} XP</span> : null}
      </button>
    </div>
  )
}
