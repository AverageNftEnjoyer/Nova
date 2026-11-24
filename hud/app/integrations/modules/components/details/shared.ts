import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import type { SetupPanelHeaderProps } from "../../../components/SetupPanelHeader"
import type { DetailTabState } from "../../../components/setup-parts"
import { catalogEntry } from "../../../constants/catalog"
import { integrationStatus } from "../../integration-status"
import type { IntegrationsMainPanelProps } from "../../types"

export type DetailProps = IntegrationsMainPanelProps

/** The header and tab props every integration detail shares. */
export function detailBase(props: DetailProps, setup: IntegrationSetupKey): SetupPanelHeaderProps & DetailTabState {
  const entry = catalogEntry(setup)
  return {
    setup,
    title: entry.label,
    purpose: entry.purpose,
    status: integrationStatus(props.settings, setup, props.lastError ? setup : null),
    error: props.lastError,
    onDismissError: props.dismissError,
    tab: props.tab,
    onTabChange: props.onTabChange,
  }
}

/** Split a whitespace-separated OAuth scope string into a readable, deduplicated list. */
export function scopeList(...sources: Array<string | string[] | undefined>): string[] {
  const out = new Set<string>()
  for (const source of sources) {
    const parts = Array.isArray(source) ? source : typeof source === "string" ? source.split(/\s+/) : []
    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed) out.add(trimmed)
    }
  }
  return [...out]
}

export function formatTimestamp(value: string | undefined): string {
  if (!value) return "Never"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
