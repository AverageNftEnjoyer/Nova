"use client"

import { useEffect, useState } from "react"
import { DISTRICT_PLACES, type CityHotspot, type CityPlaceId } from "@/components/pixel-city"
import type { TownProgress, TownQuest } from "@/lib/town/types"
import { cn } from "@/lib/shared/utils"
import { GameBar } from "./game-bar"
import { NovaPortrait } from "./nova-portrait"
import { formatXp, hasQuestTarget, questPlace, questRatio, SKILLS_TARGET } from "./town-ui"

interface TutorialGuideProps {
  progress: TownProgress
  assistantName: string
  /** Home's building buttons, to find the one a step points at. */
  hotspots: readonly CityHotspot[]
  minimized: boolean
  onMinimize: (minimized: boolean) => void
  onGo: (quest: TownQuest) => void
  onSkip: () => void
  onFinish: () => void
}

interface TargetRect {
  left: number
  top: number
  width: number
  height: number
}

/** The HUD bar's height: the arrow never sits under it. */
const HUD_CLEARANCE = 72

/** What a step points at: a building in the city, or the HUD's Settings chip (skills live in Settings). */
type PointerTarget = { kind: "hotspot"; place: CityPlaceId; label: string | null } | { kind: "settings" }

/** The building's button: by its place id, else by its aria-label ("label" or "label: detail"). */
function findHotspotButton(place: string, label: string | null): HTMLElement | null {
  const byId = document.querySelector<HTMLElement>(`.pixel-hotspot[data-place="${CSS.escape(place)}"]`)
  if (byId || !label) return byId
  for (const el of document.querySelectorAll<HTMLElement>(".pixel-hotspot")) {
    const aria = el.getAttribute("aria-label") ?? ""
    if (aria === label || aria.startsWith(`${label}:`)) return el
  }
  return null
}

function sameRect(a: TargetRect | null, b: TargetRect | null): boolean {
  if (!a || !b) return a === b
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

function isOnScreen(r: TargetRect, topClearance: number): boolean {
  return r.left + r.width > 0 && r.left < window.innerWidth && r.top + r.height > topClearance && r.top < window.innerHeight
}

function pointerTarget(quest: TownQuest, hotspots: readonly CityHotspot[]): PointerTarget | null {
  if (quest.target?.place === SKILLS_TARGET) return { kind: "settings" }
  const place = questPlace(quest)
  if (!place) return null
  const label = hotspots.find((spot) => spot.id === place)?.label ?? DISTRICT_PLACES.find((p) => p.id === place)?.name ?? null
  return { kind: "hotspot", place, label }
}

/**
 * Where on screen the target is, re-measured every frame while the step is shown: the city's camera pans, zooms and
 * eases, and the buttons move with it. If the building starts off screen, focusing its button makes the scene pan
 * to it (once per step).
 */
function useTargetRect(target: PointerTarget | null): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null)
  const place = target?.kind === "hotspot" ? target.place : null
  const label = target?.kind === "hotspot" ? target.label : null
  const key = target ? (target.kind === "settings" ? "settings" : `hotspot:${target.place}`) : null

  useEffect(() => {
    if (!key) return
    let frame = 0
    let revealed = false
    const measure = () => {
      const el = place ? findHotspotButton(place, label) : document.querySelector<HTMLElement>('button[aria-label="Open settings"]')
      const r = el?.getBoundingClientRect()
      const next = r && r.width > 0 ? { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null
      if (el && next && place && !revealed) {
        revealed = true
        if (!isOnScreen(next, HUD_CLEARANCE)) el.focus({ preventScroll: true })
      }
      setRect((prev) => (sameRect(prev, next) ? prev : next))
      frame = requestAnimationFrame(measure)
    }
    frame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(frame)
  }, [key, place, label])

  return key ? rect : null
}

/**
 * First-run guide: Nova speaks from a pixel bubble, points at the building for the current tutorial quest with a
 * bobbing arrow, and moves on when the server reports the quest completed. Never blocks the city: only the bubble
 * takes clicks.
 */
export function TutorialGuide({ progress, assistantName, hotspots, minimized, onMinimize, onGo, onSkip, onFinish }: TutorialGuideProps) {
  const { tutorial, quests } = progress
  const tutorialQuests = quests.filter((quest) => quest.category === "tutorial")
  const current = tutorial.currentQuestId ? (quests.find((quest) => quest.id === tutorial.currentQuestId) ?? null) : null
  const currentId = current?.id ?? null

  // When the server moves the tutorial on, hold a short "done" beat for the finished step until the user taps Next.
  const [track, setTrack] = useState<{ questId: string | null; done: TownQuest | null }>({ questId: currentId, done: null })
  if (track.questId !== currentId) {
    const finished = quests.find((quest) => quest.id === track.questId && quest.status === "completed") ?? null
    setTrack({ questId: currentId, done: finished })
  }
  const done = track.done
  const [confirmSkip, setConfirmSkip] = useState(false)

  const allDone = tutorialQuests.length > 0 && tutorialQuests.every((quest) => quest.status === "completed")
  const showing = tutorial.active && !minimized && (!!current || allDone)
  const pointAt = showing && current && !done ? pointerTarget(current, hotspots) : null
  const measured = useTargetRect(pointAt)
  const inHud = pointAt?.kind === "settings"
  // The camera can pan a building off screen: then only the bubble shows.
  const rect = measured && isOnScreen(measured, inHud ? 0 : HUD_CLEARANCE) ? measured : null

  if (!tutorial.active || (!current && !allDone)) return null

  const total = tutorialQuests.length
  const completedCount = tutorialQuests.filter((quest) => quest.status === "completed").length
  const stepIndex = current ? tutorialQuests.findIndex((quest) => quest.id === current.id) : -1
  const step = stepIndex >= 0 ? stepIndex + 1 : Math.min(total, completedCount + 1)

  if (minimized) {
    return (
      <button type="button" onClick={() => onMinimize(false)} className="pixel-chip game-tutorial-reopen" aria-label={`Show the tutorial, step ${step} of ${total}`}>
        <NovaPortrait className="h-5 w-5" />
        <span>
          Tutorial {step}/{total}
        </span>
      </button>
    )
  }

  // The bubble sits on the side away from the building it points at, so it never covers the target.
  const targetOnLeft = rect ? rect.left + rect.width / 2 < window.innerWidth / 2 : false
  const arrowTop = rect ? Math.max(HUD_CLEARANCE, rect.top - 6) : 0

  return (
    <>
      {rect ? (
        <>
          <div className="game-target-ring" style={{ left: rect.left - 3, top: rect.top - 3, width: rect.width + 6, height: rect.height + 6 }} aria-hidden="true" />
          {inHud ? (
            <div className="game-arrow game-arrow--up" style={{ left: rect.left + rect.width / 2, top: rect.top + rect.height + 8 }} aria-hidden="true" />
          ) : (
            <div className="game-arrow" style={{ left: rect.left + rect.width / 2, top: arrowTop }} aria-hidden="true" />
          )}
        </>
      ) : null}

      <section
        className={cn("game-tutorial pixel-ui", targetOnLeft ? "right-4" : "left-4")}
        aria-label={`${assistantName}'s tutorial`}
        aria-live="polite"
      >
        <div className="game-bubble pixel-notch">
          <header className="flex items-center gap-2 border-b-2 border-(--px-border) bg-(--px-bg-3) px-2 py-1.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center border-2 border-(--px-border) bg-(--px-bg-2)">
              <NovaPortrait className="h-7 w-7" />
            </span>
            <span className="pixel-label min-w-0 flex-1 truncate text-(--px-accent)">{assistantName}</span>
            <span className="font-pixel text-[12px] tabular-nums text-(--px-muted)">
              Tutorial {done ? Math.max(1, step - 1) : step}/{total}
            </span>
          </header>

          <div className="flex flex-col gap-2 px-3 py-2.5">
            {done ? (
              <>
                <p className="font-pixel text-[15px] leading-snug text-(--px-text)">
                  Nice work! <span className="text-(--px-green)">{done.title}</span> is done.{" "}
                  <span className="text-(--px-accent)">+{formatXp(done.xpReward)} XP</span>
                  {done.townsfolkReward ? <span className="text-(--px-green)"> · +{done.townsfolkReward} townsfolk</span> : null}
                </p>
                {current ? <p className="font-pixel text-[13px] text-(--px-muted)">Next up: {current.title}</p> : null}
              </>
            ) : current ? (
              <>
                {step === 1 && completedCount === 0 ? (
                  <p className="font-pixel text-[13px] leading-snug text-(--px-muted)">
                    Welcome to Nova City! I&apos;m {assistantName}. Every building here is a part of Nova, and it grows as we work together.
                  </p>
                ) : null}
                <p className="font-pixel text-[16px] leading-tight text-(--px-accent)">{current.title}</p>
                <p className="font-pixel text-[14px] leading-snug text-(--px-text)">{current.description}</p>
                {current.goal > 1 ? (
                  <div className="flex items-center gap-2">
                    <GameBar value={questRatio(current)} label={current.title} valueText={`${Math.min(current.progress, current.goal)} of ${current.goal}`} className="flex-1" />
                    <span className="font-pixel text-[12px] tabular-nums text-(--px-muted)">
                      {Math.min(current.progress, current.goal)}/{current.goal}
                    </span>
                  </div>
                ) : null}
                <p className="font-pixel text-[12px] text-(--px-muted)">
                  Reward <span className="text-(--px-accent)">+{formatXp(current.xpReward)} XP</span>
                  {current.townsfolkReward ? <span className="text-(--px-green)"> · +{current.townsfolkReward} townsfolk</span> : null}
                </p>
              </>
            ) : (
              <p className="font-pixel text-[15px] leading-snug text-(--px-text)">
                That&apos;s the tour! The city keeps growing with every task, deployment and chat. Find daily quests and milestones in the Quest log.
              </p>
            )}
          </div>

          <footer className="flex flex-wrap items-center justify-end gap-1.5 px-3 pb-2.5">
            {current || done ? (
              <button
                type="button"
                onClick={() => {
                  if (!confirmSkip) {
                    setConfirmSkip(true)
                    return
                  }
                  onSkip()
                }}
                onBlur={() => setConfirmSkip(false)}
                className="game-link mr-auto"
              >
                {confirmSkip ? "Skip? Click again" : "Skip tutorial"}
              </button>
            ) : null}
            {done ? (
              <button type="button" onClick={() => setTrack({ questId: currentId, done: null })} className="pixel-chip h-8! px-3! text-[13px]!" data-active="true">
                Next
              </button>
            ) : current ? (
              <>
                <button type="button" onClick={() => onMinimize(true)} className="pixel-chip h-8! px-3! text-[13px]!">
                  Hide
                </button>
                {hasQuestTarget(current) ? (
                  <button type="button" onClick={() => onGo(current)} className="pixel-chip h-8! px-3! text-[13px]!" data-active="true">
                    Show me
                  </button>
                ) : null}
              </>
            ) : (
              <button type="button" onClick={onFinish} className="pixel-chip h-8! px-3! text-[13px]!" data-active="true">
                Finish
              </button>
            )}
          </footer>
        </div>
      </section>
    </>
  )
}
