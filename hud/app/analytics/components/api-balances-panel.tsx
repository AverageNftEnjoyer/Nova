import { Wallet } from "lucide-react"

import type { ApiBalanceRow } from "../types"

interface ApiBalancesPanelProps {
  balances: ApiBalanceRow[]
  isLight: boolean
}

function formatUsageLabel(balance: ApiBalanceRow): string {
  if (balance.unit === "$") return `Est. spend: $${balance.used.toFixed(4)}`
  return `${balance.used.toLocaleString()} tokens used`
}

function formatWithLimit(balance: ApiBalanceRow): string {
  if (balance.unit === "$") return `$${balance.used.toFixed(2)} / $${balance.limit.toFixed(0)}`
  return `${balance.used.toLocaleString()} / ${balance.limit.toLocaleString()} ${balance.unit}`
}

function formatRemaining(balance: ApiBalanceRow): string {
  const remaining = Math.max(0, balance.limit - balance.used)
  if (balance.unit === "$") return `$${remaining.toFixed(2)} left`
  return `${remaining.toLocaleString()} ${balance.unit} left`
}

export function ApiBalancesPanel({ balances, isLight }: ApiBalancesPanelProps) {
  return (
    <section className="h-full p-4 flex flex-col">
      <div className="mb-3 flex items-center gap-2">
        <Wallet className="h-4 w-4 text-accent" />
        <h3 className={`text-sm uppercase tracking-[0.22em] font-semibold ${isLight ? "text-s-90" : "text-slate-200"}`}>API Usage</h3>
      </div>
      <p className={`mb-3 text-xs ${isLight ? "text-s-50" : "text-slate-400"}`}>Estimated spend from conversation logs</p>

      <div className="module-hover-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {balances.length === 0 && (
          <p className={`text-xs ${isLight ? "text-s-50" : "text-slate-400"}`}>No API usage recorded yet.</p>
        )}
        {balances.map((balance) => {
          const hasLimit = balance.limit > 0
          const pct = hasLimit ? Math.min(100, (balance.used / balance.limit) * 100) : 0
          const isCritical = hasLimit && pct >= 80

          return (
            <div key={balance.key} className={`home-spotlight-card rounded-lg border p-3 ${isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/25 backdrop-blur-md"}`}>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className={`font-medium ${isLight ? "text-s-90" : "text-slate-100"}`}>
                  {balance.name}
                </span>
                {hasLimit ? (
                  <span className="font-mono text-s-50">{formatRemaining(balance)}</span>
                ) : (
                  <span className={`text-[10px] ${isLight ? "text-s-40" : "text-slate-500"}`}>no billing limit set</span>
                )}
              </div>

              {hasLimit ? (
                <>
                  <div className={`h-2 overflow-hidden rounded-full ${isLight ? "bg-[#dfe5ef]" : "bg-white/10"}`}>
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${isCritical ? "bg-linear-to-r from-amber-400 to-rose-400" : "bg-linear-to-r from-accent to-cyan-400"}`}
                      style={{ width: `${pct.toFixed(2)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] font-mono text-s-50">{formatWithLimit(balance)}</p>
                </>
              ) : (
                <p className="text-[11px] font-mono text-s-50">{formatUsageLabel(balance)}</p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
