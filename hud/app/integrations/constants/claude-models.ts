import type { FluidSelectOption } from "@/components/ui/fluid-select"
import type { ModelOption, ModelPricing } from "./types"

export const CLAUDE_MODEL_OPTIONS: ModelOption[] = [
  { value: "claude-opus-4-1-20250805", label: "Claude Opus 4.1", priceHint: "Highest reasoning quality, premium token cost" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4", priceHint: "Advanced reasoning and coding, premium token cost" },
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", priceHint: "Balanced speed, quality, and cost" },
  { value: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet", priceHint: "Strong all-around quality at mid-tier cost" },
  { value: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet", priceHint: "Reliable quality with good cost efficiency" },
  { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku", priceHint: "Fastest and lowest-cost Claude option" },
]

export const CLAUDE_MODEL_PRICING_USD_PER_1M: Record<string, ModelPricing> = {
  "claude-opus-4-1-20250805": { input: 15.0, output: 75.0 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-3-7-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4.0 },
}

function extractHighestVersion(text: string): { major: number; minor: number } {
  const normalized = text.toLowerCase()
  const scopedMatches = [
    ...normalized.matchAll(/(?:opus|sonnet|haiku)\s*(\d+)(?:[.\-_](\d+))?/g),
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

export const CLAUDE_DEFAULT_MODEL = "claude-sonnet-4-20250514"
export const CLAUDE_DEFAULT_BASE_URL = "https://api.anthropic.com"
