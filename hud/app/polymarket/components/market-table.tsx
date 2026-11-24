"use client"

import { Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui"
import type { PolymarketMarket } from "@/lib/integrations/polymarket/api"

import { formatCents, formatCompactUsd, formatDate, outcomePrice } from "../lib/format"

interface MarketTableProps {
  markets: PolymarketMarket[]
  selectedSlug: string
  onSelect: (market: PolymarketMarket) => void
}

/** Dense market list: question, first two outcome prices, 24h volume, liquidity, end date. Rows select. */
export function MarketTable({ markets, selectedSlug, onSelect }: MarketTableProps) {
  return (
    <Table density="compact" stickyHeader containerClassName="overflow-visible">
      <THead>
        <tr>
          <Th>Market</Th>
          <Th numeric className="w-16">Yes</Th>
          <Th numeric className="w-16">No</Th>
          <Th numeric className="w-20">Vol 24h</Th>
          <Th numeric className="w-20">Liquidity</Th>
          <Th numeric className="w-28">Ends</Th>
        </tr>
      </THead>
      <TBody>
        {markets.map((market) => {
          const selected = market.slug === selectedSlug
          const [first, second] = market.outcomes
          return (
            <Tr key={market.slug} interactive selected={selected} onClick={() => onSelect(market)}>
              <Td className="max-w-0 py-1.5">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelect(market)
                  }}
                  aria-pressed={selected}
                  className="block w-full truncate text-left font-medium text-fg focus-visible:outline-2 focus-visible:outline-ring"
                  title={market.question}
                >
                  {market.question}
                </button>
                <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                  {!market.acceptingOrders ? <Badge variant="outline">Not trading</Badge> : null}
                  <span className="truncate">{market.tags.slice(0, 3).map((tag) => tag.label).join(", ") || "Untagged"}</span>
                </span>
              </Td>
              <Td numeric mono title={first ? first.label : undefined}>{formatCents(outcomePrice(first))}</Td>
              <Td numeric mono muted title={second ? second.label : undefined}>{formatCents(outcomePrice(second))}</Td>
              <Td numeric mono>{formatCompactUsd(market.volume24hr)}</Td>
              <Td numeric mono muted>{formatCompactUsd(market.liquidity)}</Td>
              <Td numeric mono muted className="whitespace-nowrap">{formatDate(market.endDate) || "Open"}</Td>
            </Tr>
          )
        })}
      </TBody>
    </Table>
  )
}
