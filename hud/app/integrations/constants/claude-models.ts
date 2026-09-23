import type { FluidSelectOption } from "@/components/ui/fluid-select"
import { formatModelPriceHint } from "./pricing"
import type { ModelOption } from "./types"

export { CLAUDE_MODEL_PRICING_USD_PER_1M } from "../../../../src/providers/pricing/index.js"

// Default first.
export const CLAUDE_DEFAULT_MODEL = "claude-sonnet-5"

export const CLAUDE_MODEL_OPTIONS: ModelOption[] = [
  { value: CLAUDE_DEFAULT_MODEL, label: "Claude Sonnet 5", priceHint: formatModelPriceHint(CLAUDE_DEFAULT_MODEL) },
  { value: "claude-opus-5-5", label: "Claude Opus 5.5", priceHint: formatModelPriceHint("claude-opus-5-5") },
  { value: "claude-fable-5-1", label: "Claude Fable 5.1", priceHint: formatModelPriceHint("claude-fable-5-1") },
  {
    value: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    priceHint: formatModelPriceHint("claude-haiku-4-5-20251001"),
  },
]

function extractHighestVersion(text: string): { major: number; minor: number } {
  const normalized = text.toLowerCase()
  const scopedMatches = [
    ...normalized.matchAll(/(?:opus|sonnet|haiku|fable)\s*(\d+)(?:[.\-_](\d+))?/g),
    ...normalized.matchAll(/claude\s*(\d+)(?:[.\-_](\d+))?/g),
  ]
  if (scopedMatches.length === 0) return { major: 0, minor: 0 }

  let bestMajor = 0
  let bestMinor = 0
  for (const m of scopedMatches) {
    const major = Number(m[1] || 0)
    const minor = Number(m[2] || 0)
    // Ignore date-like or malformed high numbers; Claude major versions are small integers.
    if (major > 20) continue
    if (major > bestMajor || (major === bestMajor && minor > bestMinor)) {
      bestMajor = major
      bestMinor = minor
    }
  }
  return { major: bestMajor, minor: bestMinor }
}

function extractClaudeDate(model: string): number {
  const match = model.match(/(20\d{6})/)
  return Number(match?.[1] || 0)
}

function claudeFamilyWeight(model: string): number {
  const normalized = model.toLowerCase()
  if (normalized.includes("fable")) return 4
  if (normalized.includes("opus")) return 3
  if (normalized.includes("sonnet")) return 2
  if (normalized.includes("haiku")) return 1
  return 0
}

export function sortClaudeOptions(options: FluidSelectOption[]): FluidSelectOption[] {
  return [...options].sort((a, b) => {
    const aText = `${a.label} ${a.value}`
    const bText = `${b.label} ${b.value}`
    const av = extractHighestVersion(aText)
    const bv = extractHighestVersion(bText)
    if (av.major !== bv.major) return bv.major - av.major
    if (av.minor !== bv.minor) return bv.minor - av.minor

    const af = claudeFamilyWeight(aText)
    const bf = claudeFamilyWeight(bText)
    if (af !== bf) return bf - af

    const ad = extractClaudeDate(aText)
    const bd = extractClaudeDate(bText)
    if (ad !== bd) return bd - ad

    return a.label.localeCompare(b.label)
  })
}

export const CLAUDE_MODEL_SELECT_FALLBACK: FluidSelectOption[] = sortClaudeOptions(
  CLAUDE_MODEL_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  })),
)

export const CLAUDE_DEFAULT_BASE_URL = "https://api.anthropic.com"
