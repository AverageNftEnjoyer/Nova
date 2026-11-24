"use client"

import { Badge, EmptyState, Panel, Table, TBody, Td, Th, THead, Tr } from "@/components/ui"
import {
  USAGE_SOURCE_LABELS,
  USAGE_TIER_LABELS,
  type UsageAnalytics,
  type UsageByModelRow,
  type UsageTier,
} from "@/lib/analytics/types"
import { cn } from "@/lib/shared/utils"

import { ShareBar, type ChartTokens } from "./chart-kit"
import { providerColor, sourceColor } from "./usage-charts"
import { formatCount, formatPercent, formatTokens, formatUsd, providerLabel } from "../lib/format"
import type { AnalyticsScope } from "../lib/scope"

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
}

function tierColor(tokens: ChartTokens, tier: UsageTier): string {
  if (tier === "trivial") return tokens.series[1]
  if (tier === "standard") return tokens.series[0]
  if (tier === "hard") return tokens.series[2]
  return tokens.faint
}

export function ModelTable({ usage, scope, tokens }: { usage: UsageAnalytics; scope: AnalyticsScope; tokens: ChartTokens }) {
  const rows: UsageByModelRow[] =
    scope.kind === "provider" ? usage.byModel.filter((row) => row.provider === scope.value) : usage.byModel
  const costTotal = rows.reduce((sum, row) => sum + row.costUsd, 0)
  const description =
    scope.kind === "source"
      ? "All sources: the ledger does not split models by source."
      : "Savings are estimated at list prices; negative means cache writes cost more than they saved."

  return (
    <Panel title="By model" description={description} flush>
      {rows.length === 0 ? (
        <EmptyState size="compact" title="No model calls in this range" description="Models appear here once they have been called." />
      ) : (
        <Table density="compact">
          <THead>
            <tr>
              <Th>Model</Th>
              <Th>Provider</Th>
              <Th numeric>Calls</Th>
              <Th numeric>Input</Th>
              <Th numeric>Output</Th>
              <Th numeric>Cached</Th>
              <Th numeric>Cost</Th>
              <Th>Share of cost</Th>
              <Th numeric>Savings</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={`${row.provider}\u0000${row.model}`}>
                <Td mono className="max-w-[22rem]">
                  <span className="block truncate" title={row.model}>
                    {row.model || "unknown model"}
                  </span>
                </Td>
                <Td muted className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <Swatch color={providerColor(tokens, row.provider)} />
                    {providerLabel(row.provider)}
                  </span>
                </Td>
                <Td numeric mono>{formatCount(row.calls)}</Td>
                <Td numeric mono>{formatTokens(row.inputTokens)}</Td>
                <Td numeric mono>{formatTokens(row.outputTokens)}</Td>
                <Td numeric mono muted>{formatPercent(row.cacheHitRate)}</Td>
                <Td numeric mono className="whitespace-nowrap">
                  {row.priced ? formatUsd(row.costUsd) : <Badge tone="warning">Unpriced</Badge>}
                </Td>
                <Td>
                  {row.priced ? (
                    <ShareBar fraction={costTotal > 0 ? row.costUsd / costTotal : 0} label={`${row.model} share of cost`} />
                  ) : (
                    <span className="text-xs text-faint">Not in total</span>
                  )}
                </Td>
                <Td numeric mono className={cn(row.priced && row.savingsUsd < 0 ? "text-warning" : "text-muted")}>
                  {row.priced ? formatUsd(row.savingsUsd) : "None"}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  )
}

export function SourceTable({ usage, tokens }: { usage: UsageAnalytics; tokens: ChartTokens }) {
  const costTotal = usage.bySource.reduce((sum, row) => sum + row.costUsd, 0)
  return (
    <Panel title="By source" description="Where model calls came from." flush>
      <Table density="compact">
        <THead>
          <tr>
            <Th>Source</Th>
            <Th numeric>Calls</Th>
            <Th numeric>Tokens</Th>
            <Th numeric>Cached</Th>
            <Th numeric>Cost</Th>
            <Th>Share</Th>
          </tr>
        </THead>
        <TBody>
          {usage.bySource.map((row) => (
            <Tr key={row.source} className={cn(row.calls === 0 && "text-faint")}>
              <Td className="whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <Swatch color={sourceColor(tokens, row.source)} />
                  {USAGE_SOURCE_LABELS[row.source] ?? row.source}
                </span>
              </Td>
              <Td numeric mono>{formatCount(row.calls)}</Td>
              <Td numeric mono>{formatTokens(row.inputTokens + row.outputTokens)}</Td>
              <Td numeric mono muted>{formatPercent(row.cacheHitRate)}</Td>
              <Td numeric mono>{formatUsd(row.costUsd)}</Td>
              <Td>
                <ShareBar
                  fraction={costTotal > 0 ? row.costUsd / costTotal : 0}
                  color={sourceColor(tokens, row.source)}
                  label={`${USAGE_SOURCE_LABELS[row.source]} share of cost`}
                />
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Panel>
  )
}

export function TierTable({ usage, tokens }: { usage: UsageAnalytics; tokens: ChartTokens }) {
  // Absent from servers older than tiered model routing.
  const rows = usage.byTier ?? []
  const costTotal = rows.reduce((sum, row) => sum + row.costUsd, 0)
  return (
    <Panel
      title="By routing tier"
      description="Tier of each call (Settings, Model routing). Embeddings, model tests and older calls are untagged."
      flush
    >
      {rows.length === 0 ? (
        <EmptyState size="compact" title="No tier data" description="This server does not record routing tiers yet." />
      ) : (
        <Table density="compact">
          <THead>
            <tr>
              <Th>Tier</Th>
              <Th numeric>Calls</Th>
              <Th numeric>Tokens</Th>
              <Th numeric>Unpriced</Th>
              <Th numeric>Cost</Th>
              <Th>Share</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={row.tier} className={cn(row.calls === 0 && "text-faint")}>
                <Td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <Swatch color={tierColor(tokens, row.tier)} />
                    {USAGE_TIER_LABELS[row.tier] ?? row.tier}
                  </span>
                </Td>
                <Td numeric mono>{formatCount(row.calls)}</Td>
                <Td numeric mono>{formatTokens(row.inputTokens + row.outputTokens)}</Td>
                <Td numeric mono muted>{formatCount(row.unpricedCalls)}</Td>
                <Td numeric mono>{formatUsd(row.costUsd)}</Td>
                <Td>
                  <ShareBar
                    fraction={costTotal > 0 ? row.costUsd / costTotal : 0}
                    color={tierColor(tokens, row.tier)}
                    label={`${USAGE_TIER_LABELS[row.tier]} share of cost`}
                  />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  )
}
