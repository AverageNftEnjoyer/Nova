export type IntegrationCatalogKind = "channel" | "llm" | "api"
export type IntegrationCatalogCapability = "output" | "fetch" | "ai"

export interface IntegrationCatalogItem {
  id: string
  label: string
  kind: IntegrationCatalogKind
  connected: boolean
  endpoint?: string
  source: "core" | "agent"
  capabilities: IntegrationCatalogCapability[]
  updatedAt?: string
}

function toCapabilities(raw: unknown): IntegrationCatalogCapability[] {
  if (!Array.isArray(raw)) return []
  const capabilities: IntegrationCatalogCapability[] = []
  for (const item of raw) {
    if (item === "output" || item === "fetch" || item === "ai") {
      capabilities.push(item)
    }
  }
  return Array.from(new Set(capabilities))
}

export function normalizeIntegrationCatalog(raw: unknown): IntegrationCatalogItem[] {
  if (!Array.isArray(raw)) return []
  const out: IntegrationCatalogItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const id = String(record.id || "").trim()
    const label = String(record.label || "").trim()
    const kind = record.kind === "channel" || record.kind === "llm" || record.kind === "api" ? record.kind : null
    const source = record.source === "agent" ? "agent" : "core"
    if (!id || !label || !kind) continue
    out.push({
      id,
      label,
      kind,
      source,
      connected: Boolean(record.connected),
      endpoint: typeof record.endpoint === "string" && record.endpoint.trim().length > 0 ? record.endpoint.trim() : undefined,
      capabilities: toCapabilities(record.capabilities),
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    })
  }
  return out
}
