"use client"

import { useState, type FormEvent } from "react"
import { Lock } from "lucide-react"
import { useCosmeticStatus, type PersonSheetId } from "@/components/pixel-city"
import type { TownWardrobeState } from "../../hooks/use-town-wardrobe"
import { cn } from "@/lib/shared/utils"
import type { CosmeticSlot, OwnedCosmetic, ResidentId } from "@/lib/town/wardrobe-types"
import { CosmeticPreview } from "./cosmetic-preview"

/** Longest resident name the server accepts (MAX_RESIDENT_NAME_LENGTH in lib/town/wardrobe.ts). */
const MAX_NAME_LENGTH = 24
const SLOTS: ReadonlyArray<{ slot: CosmeticSlot; label: string }> = [
  { slot: "outfit", label: "Outfit" },
  { slot: "hat", label: "Hat" },
]
const RARITY_LABEL: Record<OwnedCosmetic["rarity"], string> = { starter: "Starter", common: "Common", rare: "Rare", epic: "Epic" }

interface ResidentCustomizerProps {
  residentId: ResidentId
  /** The name the resident has when none is chosen (task name, "<Integration> worker"). */
  defaultName: string
  /** The job sheet the resident wears with nothing equipped. */
  sheet: PersonSheetId
  wardrobe: Pick<TownWardrobeState, "wardrobe" | "loading" | "error" | "update">
}

interface TryOn {
  slot: CosmeticSlot
  id: string | undefined
}

/**
 * Rename and dress one resident: a live preview (what the city draws), a name field and the wardrobe grid per slot with
 * equipped, owned and locked items. Locked items name the quest that unlocks them. Everything saved goes through
 * POST /api/town/wardrobe and the screen shows the server's answer.
 */
export function ResidentCustomizer({ residentId, defaultName, sheet, wardrobe: state }: ResidentCustomizerProps) {
  const { wardrobe, loading, error: loadError, update } = state
  const look = wardrobe?.residents[residentId]
  const savedName = look?.name ?? ""
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [tryOn, setTryOn] = useState<TryOn | null>(null)

  const name = draft ?? savedName
  const trimmed = name.trim()
  const dirty = trimmed !== savedName.trim()

  const equippedOutfit = look?.equipped.outfit
  const equippedHat = look?.equipped.hat
  const shownOutfit = tryOn?.slot === "outfit" ? tryOn.id : equippedOutfit
  const shownHat = tryOn?.slot === "hat" ? tryOn.id : equippedHat
  const items = wardrobe?.items ?? []
  const nameOf = (id: string | undefined) => items.find((item) => item.id === id)?.name

  const save = async (request: Parameters<typeof update>[0]) => {
    setBusy(true)
    setError("")
    try {
      const result = await update(request)
      if (!result.ok) setError(result.error)
      return result.ok
    } finally {
      setBusy(false)
    }
  }

  const submitName = async (event: FormEvent) => {
    event.preventDefault()
    if (!dirty || busy) return
    if (trimmed.length > MAX_NAME_LENGTH) {
      setError(`Names are 1 to ${MAX_NAME_LENGTH} characters.`)
      return
    }
    if (await save({ residentId, name: trimmed || null })) setDraft(null)
  }

  const equip = (slot: CosmeticSlot, id: string | null) => {
    setTryOn(null)
    void save({ residentId, equipped: { [slot]: id } })
  }

  const inputClass = "h-8 min-w-0 flex-1 border-2 border-(--px-border) bg-(--px-bg) px-2 font-pixel text-[14px] text-(--px-text) outline-none focus:border-(--px-accent)"
  const chip = "pixel-chip h-8! px-3! text-[13px]! disabled:cursor-not-allowed disabled:opacity-50"
  const previewLabel = `${trimmed || defaultName}${shownOutfit || shownHat ? ` wearing ${[nameOf(shownOutfit), nameOf(shownHat)].filter(Boolean).join(" and ")}` : " in the default look"}`

  return (
    <section className="pixel-subpanel px-3 py-2" aria-label="Rename and dress this resident" aria-busy={busy}>
      <h3 className="pixel-label text-(--px-muted)">Name and wardrobe</h3>
      <div className="mt-2 flex gap-3">
        <div className="pixel-subpanel grid shrink-0 place-items-end justify-center overflow-hidden" style={{ width: 4 * 32 + 12, height: 4 * 32 + 8 }}>
          <CosmeticPreview sheet={sheet} outfit={shownOutfit} hat={shownHat} scale={4} label={previewLabel} />
        </div>
        <div className="min-w-0 flex-1">
          <form onSubmit={(event) => void submitName(event)} className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`resident-name-${residentId}`}>
              Resident name
            </label>
            <input
              id={`resident-name-${residentId}`}
              type="text"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              placeholder={defaultName}
              onChange={(event) => setDraft(event.target.value)}
              className={inputClass}
            />
            <button type="submit" disabled={!dirty || busy} className={chip}>
              Save name
            </button>
          </form>
          <p className="mt-1 font-pixel text-[12px] leading-snug text-(--px-muted)">
            1 to {MAX_NAME_LENGTH} characters. Leave it empty to use &quot;{defaultName}&quot;.
          </p>
          <ArtNotice id={shownOutfit} name={nameOf(shownOutfit)} />
          <ArtNotice id={shownHat} name={nameOf(shownHat)} />
        </div>
      </div>

      {loading && !wardrobe ? <p className="mt-2 font-pixel text-[13px] text-(--px-muted)">Loading the wardrobe…</p> : null}
      {!wardrobe && !loading ? (
        <p className="mt-2 font-pixel text-[13px] text-(--px-red)" role="alert">
          {loadError ?? "The wardrobe is not available right now."}
        </p>
      ) : null}

      {wardrobe
        ? SLOTS.map(({ slot, label }) => {
            const slotItems = items.filter((item) => item.slot === slot).sort((a, b) => Number(b.unlocked) - Number(a.unlocked))
            const equipped = slot === "outfit" ? equippedOutfit : equippedHat
            return (
              <div key={slot} className="mt-3">
                <h4 className="pixel-label text-(--px-muted)">{label}</h4>
                <ul className="wardrobe-grid mt-1.5" onMouseLeave={() => setTryOn(null)}>
                  <li>
                    <button
                      type="button"
                      className="wardrobe-tile font-pixel"
                      data-state={equipped ? "owned" : "equipped"}
                      data-rarity="starter"
                      aria-pressed={!equipped}
                      disabled={busy}
                      onClick={() => equipped && equip(slot, null)}
                      onMouseEnter={() => setTryOn({ slot, id: undefined })}
                      onFocus={() => setTryOn({ slot, id: undefined })}
                      onBlur={() => setTryOn(null)}
                    >
                      <span className="wardrobe-tile-name">Default</span>
                      <span className="wardrobe-tile-meta">{equipped ? "Take it off" : "Wearing"}</span>
                    </button>
                  </li>
                  {slotItems.map((item) => (
                    <li key={item.id}>
                      <ItemTile
                        item={item}
                        sheet={sheet}
                        equipped={equipped === item.id}
                        busy={busy}
                        onEquip={() => equip(slot, item.id)}
                        onTry={(on) => setTryOn(on ? { slot, id: item.id } : null)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )
          })
        : null}

      {error ? (
        <p className="mt-2 font-pixel text-[13px] text-(--px-red)" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

/** Says so when a worn item's sheet has not been drawn yet: the city (and the preview) show the default look for it. */
function ArtNotice({ id, name }: { id: string | undefined; name: string | undefined }) {
  const status = useCosmeticStatus(id)
  if (status !== "missing") return null
  return (
    <p className="mt-1 font-pixel text-[12px] leading-snug text-(--px-accent)" role="status">
      {name ?? "This item"} has no art yet, so the default look is shown for it.
    </p>
  )
}

interface ItemTileProps {
  item: OwnedCosmetic
  sheet: PersonSheetId
  equipped: boolean
  busy: boolean
  onEquip: () => void
  onTry: (on: boolean) => void
}

function ItemTile({ item, sheet, equipped, busy, onEquip, onTry }: ItemTileProps) {
  const status = useCosmeticStatus(item.id)
  const state = equipped ? "equipped" : item.unlocked ? "owned" : "locked"
  const questTitle = item.source.kind === "quest" ? item.source.questTitle : null
  const unlockHint = questTitle ? `Unlocked by the quest "${questTitle}"` : "Locked"
  return (
    <button
      type="button"
      className="wardrobe-tile font-pixel"
      data-state={state}
      data-rarity={item.rarity}
      data-art={status}
      aria-pressed={item.unlocked ? equipped : undefined}
      aria-disabled={!item.unlocked || undefined}
      aria-label={`${item.name}, ${RARITY_LABEL[item.rarity]} ${item.slot}. ${item.unlocked ? (equipped ? "Wearing" : "Wear it") : unlockHint}`}
      title={item.description}
      disabled={busy}
      onClick={() => item.unlocked && !equipped && onEquip()}
      onMouseEnter={() => item.unlocked && onTry(true)}
      onFocus={() => item.unlocked && onTry(true)}
      onBlur={() => onTry(false)}
    >
      {status === "ready" ? (
        <span className="wardrobe-tile-art" aria-hidden="true">
          <CosmeticPreview
            sheet={sheet}
            outfit={item.slot === "outfit" ? item.id : undefined}
            hat={item.slot === "hat" ? item.id : undefined}
            scale={2}
            label=""
            className={cn(!item.unlocked && "opacity-40 grayscale")}
          />
        </span>
      ) : null}
      <span className="wardrobe-tile-name">{item.name}</span>
      <span className="wardrobe-tile-meta">
        {RARITY_LABEL[item.rarity]}
        {equipped ? " · Wearing" : null}
      </span>
      {!item.unlocked ? (
        <span className="wardrobe-tile-lock">
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{questTitle ?? "Locked"}</span>
        </span>
      ) : null}
    </button>
  )
}
