import type { CityWorkplace } from "../types"

/** Where a task's tools send its agent to work. Scans from the most recent tool back to the first integration hit. */
export function workplaceForTools(toolCalls: readonly string[] | undefined): CityWorkplace {
  if (!toolCalls || toolCalls.length === 0) return "lab"
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const name = String(toolCalls[i] || "").toLowerCase()
    if (!name) continue
    if (name.includes("gmail") || name.includes("calendar") || name.includes("mail")) return "post"
    if (name.includes("telegram") || name.includes("discord") || name.includes("slack")) return "comms"
    if (name.includes("coinbase") || name.includes("phantom") || name.includes("wallet")) return "bank"
    if (name.includes("polymarket")) return "parlour"
    if (name.includes("spotify") || name.includes("youtube")) return "cinema"
    if (name.includes("web_search") || name.includes("web_fetch") || name.includes("browser")) return "library"
  }
  return "lab"
}
