import type { PolymarketLeaderboardEntry } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

export type LeaderboardWindow = "day" | "week" | "month" | "all"

interface LeaderboardTableProps {
  isLight: boolean
  subPanelClass: string
  window: LeaderboardWindow
  entries: PolymarketLeaderboardEntry[]
  loading: boolean
  error: string
  onWindowChange: (value: LeaderboardWindow) => void
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value)
}

function formatAddress(value: string): string {
  const normalized = String(value || "").trim()
  if (!normalized) return "Unknown"
  if (normalized.length <= 12) return normalized
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`
}

const WINDOWS: Array<{ value: LeaderboardWindow; label: string }> = [
  { value: "day", label: "1D" },
  { value: "week", label: "7D" },
  { value: "month", label: "30D" },
  { value: "all", label: "All" },
]

export function LeaderboardTable({
  isLight,
  subPanelClass,
  window,
  entries,
  loading,
  error,
  onWindowChange,
}: LeaderboardTableProps) {
  return (
    <div className={cn("rounded-2xl border p-4", subPanelClass)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-slate-500")}>Top Traders</p>
        <div className="inline-flex items-center gap-1 rounded-md border border-white/10 px-1 py-1">
          {WINDOWS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onWindowChange(item.value)}
              className={cn(
                "rounded px-2 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors",
                window === item.value
                  ? (isLight ? "bg-[#e4ecf8] text-s-90" : "bg-white/14 text-slate-100")
                  : (isLight ? "text-s-50 hover:bg-[#edf2fb]" : "text-slate-500 hover:bg-white/8 hover:text-slate-200"),
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <p className="mt-3 text-sm text-slate-400">Loading leaderboard...</p> : null}
      {!loading && error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      {!loading && !error && entries.length === 0 ? <p className="mt-3 text-sm text-slate-400">No leaderboard entries returned.</p> : null}

      {!loading && !error && entries.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
          <div className={cn("grid grid-cols-[3rem_minmax(0,1fr)_7rem_7rem] px-3 py-2 text-[10px] uppercase tracking-[0.12em]", isLight ? "bg-[#edf2fb] text-s-50" : "bg-white/5 text-slate-500")}>
            <span>Rank</span>
            <span>Trader</span>
            <span className="text-right">PnL</span>
            <span className="text-right">Volume</span>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {entries.slice(0, 12).map((entry, index) => (
              <div
                key={`${entry.walletAddress}-${index}`}
                className={cn("grid grid-cols-[3rem_minmax(0,1fr)_7rem_7rem] items-center px-3 py-2 text-sm", isLight ? "border-t border-[#d5dce8] bg-white text-s-70" : "border-t border-white/10 bg-black/20 text-slate-300")}
              >
                <span className={cn("font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{entry.rank || index + 1}</span>
                <span className="truncate">{entry.username || formatAddress(entry.walletAddress)}</span>
                <span className={cn("text-right font-medium", entry.pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>{formatUsd(entry.pnl)}</span>
                <span className={cn("text-right", isLight ? "text-s-70" : "text-slate-300")}>{formatUsd(entry.volume)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
