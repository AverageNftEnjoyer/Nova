"use client"

import { EmptyState, Panel, SkeletonRows, Table, TBody, Tabs, TabsList, TabsTrigger, Td, Th, THead, Tr } from "@/components/ui"
import type { PolymarketLeaderboardEntry } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

import { formatAddress, formatUsd } from "../lib/format"

export type LeaderboardWindow = "day" | "week" | "month" | "all"

const WINDOWS: Array<{ value: LeaderboardWindow; label: string }> = [
  { value: "day", label: "1d" },
  { value: "week", label: "7d" },
  { value: "month", label: "30d" },
  { value: "all", label: "All" },
]

interface LeaderboardTableProps {
  window: LeaderboardWindow
  entries: PolymarketLeaderboardEntry[]
  loading: boolean
  error: string
  onWindowChange: (value: LeaderboardWindow) => void
}

export function LeaderboardTable({ window, entries, loading, error, onWindowChange }: LeaderboardTableProps) {
  return (
    <Panel
      title="Top traders"
      description="Public Polymarket leaderboard by profit."
      flush
      actions={
        <Tabs value={window} onValueChange={(value) => onWindowChange(value as LeaderboardWindow)} variant="segmented">
          <TabsList aria-label="Leaderboard window">
            {WINDOWS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      {loading ? (
        <div className="p-4">
          <SkeletonRows rows={5} />
        </div>
      ) : error ? (
        <EmptyState size="compact" tone="danger" title="Leaderboard did not load" description={error} />
      ) : entries.length === 0 ? (
        <EmptyState size="compact" title="No leaderboard entries" description="Polymarket returned no traders for this window." />
      ) : (
        <Table density="compact">
          <THead>
            <tr>
              <Th numeric className="w-12">Rank</Th>
              <Th>Trader</Th>
              <Th numeric>Profit</Th>
              <Th numeric>Volume</Th>
            </tr>
          </THead>
          <TBody>
            {entries.slice(0, 12).map((entry, index) => (
              <Tr key={`${entry.walletAddress}-${index}`}>
                <Td numeric mono muted>{entry.rank || index + 1}</Td>
                <Td className="max-w-0">
                  <span className="block truncate" title={entry.walletAddress}>
                    {entry.username || <span className="font-mono text-xs">{formatAddress(entry.walletAddress, "Unknown")}</span>}
                  </span>
                </Td>
                <Td numeric mono className={cn(entry.pnl >= 0 ? "text-success" : "text-danger")}>{formatUsd(entry.pnl)}</Td>
                <Td numeric mono muted>{formatUsd(entry.volume)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  )
}
