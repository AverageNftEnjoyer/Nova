import type { CSSProperties, ReactNode } from "react"
import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import type { TownBuilding } from "@/lib/town/types"
import { integrationBuildingName, integrationLabel } from "@/lib/town/quests"
import { buildingCropStyle, INTEGRATION_SIGN_COLORS } from "../constants/buildings"

interface ConnectivityGridProps {
  activeSetup: IntegrationSetupKey
  onSelect: (setup: IntegrationSetupKey) => void
  /** Real level / uses per integration from GET /api/town; null when that request has not succeeded (shown as a dash). */
  townBuildings: ReadonlyArray<TownBuilding> | null
  items: Array<{
    key: IntegrationSetupKey
    connected: boolean
    icon: ReactNode
    ariaLabel: string
  }>
}

const LEVEL_PIPS: ReadonlyArray<1 | 2 | 3> = [1, 2, 3]

/**
 * One Nova City building per integration: the painted building (or a pixel lot when the painting has none), its neon sign
 * (lit while the integration is connected, a faulty flickering tube while it is not), connection state and building level.
 * Selecting a card opens that integration's setup, exactly like the old icon grid.
 */
export function ConnectivityGrid({ activeSetup, onSelect, townBuildings, items }: ConnectivityGridProps) {
  return (
    <ul className="ig-buildings" aria-label="Integration buildings">
      {items.map((item) => {
        const building = townBuildings?.find((candidate) => candidate.integration === item.key) ?? null
        const crop = buildingCropStyle(item.key)
        const buildingName = integrationBuildingName(item.key)
        const label = integrationLabel(item.key)
        const levelText = building ? `Level ${building.level} of 3` : "Level unavailable"
        const usesText = building
          ? building.nextLevelUses !== null
            ? `${building.uses} / ${building.nextLevelUses} uses`
            : `${building.uses} uses (max)`
          : "-- uses"
        return (
          <li key={item.key} className="ig-building-item">
            <button
              type="button"
              onClick={() => onSelect(item.key)}
              className="pixel-card ig-building"
              data-state={activeSetup === item.key ? "active" : undefined}
              data-active={activeSetup === item.key}
              data-connected={item.connected}
              style={{ "--ig-sign": INTEGRATION_SIGN_COLORS[item.key] } as CSSProperties}
              aria-label={item.ariaLabel}
              aria-pressed={activeSetup === item.key}
            >
              <span className="ig-building-art" style={crop ?? undefined} data-lot={crop ? undefined : "true"}>
                {crop ? null : <span className="ig-building-lot">{item.icon}</span>}
                <span className="ig-building-sign" data-lit={item.connected}>
                  <span className="ig-building-sign-icon" aria-hidden="true">{item.icon}</span>
                  <span className="ig-building-sign-text">{buildingName}</span>
                </span>
              </span>
              <span className="ig-building-meta">
                <span className="ig-building-label pixel-outline-sm">{label}</span>
                <span className={item.connected ? "pixel-label pixel-label--ok" : "pixel-label pixel-label--off"}>
                  {item.connected ? "Connected" : "Not connected"}
                </span>
                <span className="ig-building-level">
                  <span className="ig-building-pips" role="img" aria-label={levelText}>
                    {LEVEL_PIPS.map((pip) => (
                      <span key={pip} className="ig-building-pip" data-on={building ? building.level >= pip : false} />
                    ))}
                  </span>
                  <span className="ig-building-lv pixel-label">{building ? `LV ${building.level}` : "LV —"}</span>
                </span>
                <span className="ig-building-uses">{usesText}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
