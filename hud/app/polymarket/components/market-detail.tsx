"use client"

import { useState } from "react"
import { ChevronDown, ExternalLink } from "lucide-react"

import { Badge, Button } from "@/components/ui"
import { buildPolymarketMarketUrl, type PolymarketMarket } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

import { formatCents, formatCompactUsd, formatDate, outcomePrice } from "../lib/format"
import { parseNarrative } from "../lib/narrative"

interface MarketDetailProps {
  market: PolymarketMarket
  selectedOutcomeIndex: number
  onSelectOutcome: (index: number) => void
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate font-mono text-sm tabular-nums text-fg" title={value}>
        {value}
      </dd>
    </div>
  )
}

/** Market header: question, facts, outcome picker, and the rules from the market description. */
export function MarketDetail({ market, selectedOutcomeIndex, onSelectOutcome }: MarketDetailProps) {
  const [rulesOpen, setRulesOpen] = useState(false)
  const narrative = parseNarrative(market.description)
  const opened = narrative.openedAt || formatDate(market.createdAt || market.startDate)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {market.acceptingOrders ? (
              <Badge tone="success" dot="pulse">
                Trading
              </Badge>
            ) : (
              <Badge variant="outline">Not trading</Badge>
            )}
            {market.tags.slice(0, 3).map((tag) => (
              <Badge key={tag.slug || tag.label}>{tag.label}</Badge>
            ))}
          </div>
          <h2 className="text-md font-medium leading-snug text-fg">{market.question}</h2>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={market.url || buildPolymarketMarketUrl(market.slug)} target="_blank" rel="noreferrer">
            <ExternalLink />
            Polymarket
          </a>
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Fact label="Volume 24h" value={formatCompactUsd(market.volume24hr)} />
        <Fact label="Liquidity" value={formatCompactUsd(market.liquidity)} />
        <Fact label="Ends" value={formatDate(market.endDate) || "Open"} />
        <Fact label="Opened" value={opened || "Unknown"} />
      </dl>

      <div role="radiogroup" aria-label="Outcome" className="grid grid-cols-2 gap-2">
        {market.outcomes.slice(0, 2).map((outcome) => {
          const selected = outcome.index === selectedOutcomeIndex
          return (
            <button
              key={`${market.slug}-${outcome.index}`}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelectOutcome(outcome.index)}
              className={cn(
                "flex flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors duration-150",
                selected ? "border-accent-border bg-accent-muted" : "border-border bg-surface hover:bg-hover",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-fg">{outcome.label}</span>
                <span className="font-mono text-md tabular-nums text-fg">{formatCents(outcomePrice(outcome))}</span>
              </span>
              <span className="font-mono text-2xs tabular-nums text-muted">
                Bid {formatCents(outcome.bestBid)}, ask {formatCents(outcome.bestAsk)}
              </span>
            </button>
          )
        })}
      </div>

      <div className="rounded-md border border-border-subtle">
        <button
          type="button"
          onClick={() => setRulesOpen((open) => !open)}
          aria-expanded={rulesOpen}
          className="flex h-9 w-full items-center justify-between gap-2 px-3 text-left text-sm text-fg hover:bg-hover"
        >
          Rules and resolution
          <ChevronDown className={cn("size-4 text-muted transition-transform duration-150", rulesOpen && "rotate-180")} aria-hidden />
        </button>
        {rulesOpen ? (
          <div className="flex flex-col gap-3 border-t border-border-subtle px-3 py-3 text-sm leading-6 text-muted">
            {narrative.sections.length > 0 ? (
              narrative.sections.map((section, index) => (
                <div key={`${section.title}-${index}`}>
                  <p className="text-xs font-medium text-fg">{section.title}</p>
                  {section.paragraphs.map((paragraph, j) => (
                    <p key={j} className="mt-1">
                      {paragraph}
                    </p>
                  ))}
                </div>
              ))
            ) : (
              <p>This market has no rules text on Polymarket.</p>
            )}
            <div>
              <p className="text-xs font-medium text-fg">Resolution source</p>
              <p className="mt-1">{market.resolutionSource || "Not stated by Polymarket."}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
