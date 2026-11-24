"use client"

import Link from "next/link"
import { RefreshCw } from "lucide-react"

import { Button, EmptyState, Panel, SkeletonRows, Table, TBody, Td, Th, THead, Tr } from "@/components/ui"
import type { PolymarketPosition } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

import { formatCents, formatSignedPct, formatUsd } from "../lib/format"

interface PortfolioPanelProps {
  connected: boolean
  positions: PolymarketPosition[]
  loadingPositions: boolean
  openOrders: unknown[]
  recentTrades: unknown[]
  loadingActivity: boolean
  activityError: string
  onRefreshActivity: () => void
}

function field(entry: unknown, ...keys: string[]): string {
  const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value)
  }
  return ""
}

function ActivityList({ title, rows, empty, kind }: { title: string; rows: unknown[]; empty: string; kind: "order" | "trade" }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 px-4 text-xs font-medium text-muted">{title}</p>
      {rows.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-faint">{empty}</p>
      ) : (
        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
          {rows.slice(0, 6).map((entry, index) => (
            <li key={`${kind}-${index}`} className="flex items-center justify-between gap-3 px-4 py-1.5 text-xs">
              <span className="min-w-0 truncate font-mono text-fg" title={field(entry, "market", "asset_id", "id")}>
                {field(entry, "market", "asset_id", "id") || "Unknown market"}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-muted">
                {[field(entry, "side"), field(entry, "size", "original_size"), field(entry, "price")].filter(Boolean).join(" ") || "No detail"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Positions from the profile, plus wallet-signed open orders and fills on request. */
export function PortfolioPanel({
  connected,
  positions,
  loadingPositions,
  openOrders,
  recentTrades,
  loadingActivity,
  activityError,
  onRefreshActivity,
}: PortfolioPanelProps) {
  if (!connected) {
    return (
      <Panel title="Portfolio" description="Positions, open orders and recent fills.">
        <EmptyState
          size="compact"
          title="No wallet connected"
          description="Connect a Polymarket wallet to see your positions and orders."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/integrations?setup=polymarket">Set up Polymarket</Link>
            </Button>
          }
        />
      </Panel>
    )
  }

  return (
    <Panel
      title="Portfolio"
      description="Positions, open orders and recent fills."
      flush
      actions={
        <Button variant="outline" size="sm" onClick={onRefreshActivity} disabled={loadingActivity}>
          <RefreshCw className={cn(loadingActivity && "animate-spin")} />
          Load orders and fills
        </Button>
      }
    >
      {loadingPositions ? (
        <div className="p-4">
          <SkeletonRows rows={4} />
        </div>
      ) : positions.length === 0 ? (
        <EmptyState size="compact" title="No open positions" description="Positions on this Polymarket profile appear here." />
      ) : (
        <Table density="compact">
          <THead>
            <tr>
              <Th>Market</Th>
              <Th>Outcome</Th>
              <Th numeric>Shares</Th>
              <Th numeric>Avg</Th>
              <Th numeric>Value</Th>
              <Th numeric>P&amp;L</Th>
            </tr>
          </THead>
          <TBody>
            {positions.map((position) => (
              <Tr key={`${position.tokenId}-${position.outcome}`}>
                <Td className="max-w-0">
                  <span className="block truncate" title={position.title || position.slug}>
                    {position.title || position.slug}
                  </span>
                </Td>
                <Td muted>{position.outcome || "Unknown"}</Td>
                <Td numeric mono>{position.size.toFixed(2)}</Td>
                <Td numeric mono muted>{formatCents(position.avgPrice)}</Td>
                <Td numeric mono>{formatUsd(position.currentValue)}</Td>
                <Td numeric mono className={cn(position.percentPnl >= 0 ? "text-success" : "text-danger")}>
                  {formatSignedPct(position.percentPnl)}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <div className="grid grid-cols-1 gap-3 border-t border-border-subtle py-3 lg:grid-cols-2">
        {activityError ? <p className="px-4 text-xs text-danger lg:col-span-2">{activityError}</p> : null}
        <ActivityList title="Open orders" rows={openOrders} empty="Load orders and fills to sign in with your wallet and list open orders." kind="order" />
        <ActivityList title="Recent fills" rows={recentTrades} empty="Recent fills appear after loading." kind="trade" />
      </div>
    </Panel>
  )
}
