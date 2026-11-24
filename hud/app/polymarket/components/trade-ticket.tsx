"use client"

import Link from "next/link"
import { CandlestickChart, Wallet } from "lucide-react"

import { Button, Field, Input, Switch, Tabs, TabsList, TabsTrigger } from "@/components/ui"
import type { PolymarketMarket, PolymarketOutcome } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

import { formatCents, formatUsd } from "../lib/format"

export type OrderAction = "buy" | "sell"

const PRESETS = [10, 25, 50, 100]

interface TradeTicketProps {
  market: PolymarketMarket
  outcome: PolymarketOutcome | null
  /** Price the order would fill at (best ask, else last price). */
  price: number
  action: OrderAction
  onActionChange: (action: OrderAction) => void
  amount: string
  onAmountChange: (amount: string) => void
  connected: boolean
  liveTradingEnabled: boolean
  savePending: boolean
  onToggleLiveTrading: (next: boolean) => void
  submitting: boolean
  onSubmit: () => void
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className={cn("font-mono tabular-nums", tone === "positive" ? "text-success" : tone === "negative" ? "text-danger" : "text-fg")}>{value}</span>
    </div>
  )
}

/** Order form: side, amount (USDC to spend or shares to sell), estimate, live-trading gate and submit. */
export function TradeTicket({
  market,
  outcome,
  price,
  action,
  onActionChange,
  amount,
  onAmountChange,
  connected,
  liveTradingEnabled,
  savePending,
  onToggleLiveTrading,
  submitting,
  onSubmit,
}: TradeTicketProps) {
  const value = Number.parseFloat(amount)
  const valid = Number.isFinite(value) && value > 0
  const shares = action === "buy" && valid && price > 0 ? value / price : 0
  const proceeds = action === "sell" && valid ? value * price : 0
  const profit = shares - (valid ? value : 0)
  const canSubmit = Boolean(outcome?.tokenId) && connected && liveTradingEnabled && valid && !submitting

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Tabs value={action} onValueChange={(next) => onActionChange(next as OrderAction)} variant="segmented">
          <TabsList aria-label="Order side">
            <TabsTrigger value="buy">Buy</TabsTrigger>
            <TabsTrigger value="sell">Sell</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted">
          {outcome ? `${outcome.label} at ` : ""}
          <span className="font-mono tabular-nums text-fg">{formatCents(price)}</span>
        </span>
      </div>

      <Field
        label={action === "buy" ? "Spend (USDC)" : "Shares to sell"}
        hint={`Minimum order ${market.orderMinSize || 5} shares.`}
      >
        <Input value={amount} onChange={(event) => onAmountChange(event.target.value)} inputMode="decimal" mono placeholder="25" />
      </Field>
      {action === "buy" ? (
        <div className="grid grid-cols-4 gap-1.5">
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              variant={value === preset ? "secondary" : "outline"}
              size="sm"
              onClick={() => onAmountChange(String(preset))}
              aria-pressed={value === preset}
              className="font-mono tabular-nums"
            >
              ${preset}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2">
        {action === "buy" ? (
          <>
            <Row label="Shares, estimated" value={shares > 0 ? shares.toFixed(2) : "None"} />
            <Row label={`Payout if ${outcome?.label ?? "it"} wins`} value={shares > 0 ? formatUsd(shares) : "None"} />
            <Row label={`Profit if ${outcome?.label ?? "it"} wins`} value={shares > 0 ? formatUsd(profit) : "None"} tone={shares > 0 ? (profit >= 0 ? "positive" : "negative") : undefined} />
          </>
        ) : (
          <Row label="Proceeds, estimated" value={proceeds > 0 ? formatUsd(proceeds) : "None"} />
        )}
      </div>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="flex flex-col">
          <span className="text-fg">Live trading</span>
          <span className="text-xs text-muted">Orders are signed in your wallet; Nova never holds keys.</span>
        </span>
        <Switch
          checked={liveTradingEnabled}
          onCheckedChange={onToggleLiveTrading}
          disabled={!connected || savePending}
          aria-label="Live trading"
        />
      </label>

      {!connected ? (
        <p className="flex items-start gap-2 rounded-md border border-border-subtle px-3 py-2 text-xs text-muted">
          <Wallet className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Connect a wallet to trade.{" "}
            <Link href="/integrations?setup=polymarket" className="text-accent-text hover:underline">
              Set up Polymarket
            </Link>
          </span>
        </p>
      ) : !liveTradingEnabled ? (
        <p className="text-xs text-muted">Turn on live trading to place orders.</p>
      ) : null}

      <Button onClick={onSubmit} disabled={!canSubmit} loading={submitting}>
        <CandlestickChart />
        {action === "buy" ? `Buy ${outcome?.label ?? ""}` : `Sell ${outcome?.label ?? ""}`}
        {action === "buy" && valid ? ` for ${formatUsd(value)}` : ""}
      </Button>
    </div>
  )
}
