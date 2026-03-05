"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { BarChart2 } from "lucide-react"

import { cn } from "@/lib/shared/utils"

interface PolymarketLiveLinesModuleProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties | undefined
  className?: string
  onOpenIntegrations: () => void
}

const PLACEHOLDER_LINES = [
  { market: "AI chip export bill passes this quarter", yes: 61, no: 39, volume: "$1.8M vol" },
  { market: "NVIDIA closes above $1,200 this month", yes: 54, no: 46, volume: "$2.2M vol" },
  { market: "Federal Reserve cuts rates in June", yes: 43, no: 57, volume: "$3.1M vol" },
  { market: "Bitcoin above $120K by year end", yes: 67, no: 33, volume: "$4.5M vol" },
  { market: "Solana ETF approved this year", yes: 38, no: 62, volume: "$1.1M vol" },
  { market: "Apple launches AI Siri before WWDC", yes: 46, no: 54, volume: "$0.9M vol" },
  { market: "Ethereum breaks $5K this cycle", yes: 52, no: 48, volume: "$2.9M vol" },
  { market: "US CPI comes in below 2.8% next print", yes: 41, no: 59, volume: "$1.4M vol" },
] as const

type MarketSide = "yes" | "no"
type MarketLine = (typeof PLACEHOLDER_LINES)[number]

interface BuyTicketState {
  line: MarketLine
  side: MarketSide
}

export function PolymarketLiveLinesModule({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  className,
  onOpenIntegrations,
}: PolymarketLiveLinesModuleProps) {
  const [buyTicket, setBuyTicket] = useState<BuyTicketState | null>(null)
  const [shares, setShares] = useState("25")
  const [mockPrice, setMockPrice] = useState(0)

  const openBuyTicket = (line: MarketLine, side: MarketSide) => {
    const entryPrice = side === "yes" ? line.yes : line.no
    setBuyTicket({ line, side })
    setMockPrice(entryPrice)
    setShares("25")
  }

  useEffect(() => {
    if (!buyTicket) return
    const intervalId = window.setInterval(() => {
      setMockPrice((prev) => {
        const shift = Math.random() * 1.4 - 0.7
        const next = Math.max(1, Math.min(99, prev + shift))
        return Number(next.toFixed(1))
      })
    }, 1200)
    return () => window.clearInterval(intervalId)
  }, [buyTicket])

  useEffect(() => {
    if (!buyTicket) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBuyTicket(null)
    }
    window.addEventListener("keydown", onEscape)
    return () => window.removeEventListener("keydown", onEscape)
  }, [buyTicket])

  const shareCount = Number(shares) > 0 ? Number(shares) : 0
  const estimate = useMemo(() => Number(((mockPrice / 100) * shareCount).toFixed(2)), [mockPrice, shareCount])

  return (
    <>
      <section
        style={panelStyle}
        className={cn(
          `${panelClass} home-spotlight-shell h-[clamp(15rem,30vh,18.5rem)] px-3 pb-2 pt-2.5 flex flex-col`,
          className,
        )}
      >
        <div className="relative flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 text-s-80">
            <BarChart2 className="w-4 h-4 text-accent" />
          </div>
          <h2
            className={cn(
              "absolute left-1/2 -translate-x-1/2 text-sm uppercase tracking-[0.22em] font-semibold whitespace-nowrap",
              isLight ? "text-s-90" : "text-slate-200",
            )}
          >
            Polymarket
          </h2>
          <button
            onClick={onOpenIntegrations}
            className={cn(
              "h-7 px-2 rounded-md border text-[10px] uppercase tracking-[0.12em] transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover",
              subPanelClass,
            )}
            aria-label="Open integrations"
            title="Open integrations"
          >
            Setup
          </button>
        </div>

        <div className="mt-2 flex-1 min-h-0">
          <div className="grid h-full min-h-0 grid-cols-2 auto-rows-fr gap-1.5">
            {PLACEHOLDER_LINES.slice(0, 8).map((line) => (
              <div
                key={line.market}
                className={cn(
                  "min-w-0 h-full rounded-md border px-1.5 py-1 home-spotlight-card home-border-glow flex flex-col justify-between",
                  isLight ? "border-[#cdd9ea] bg-[#edf2fb]" : "home-subpanel-surface",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <p className={cn("text-[10px] font-semibold leading-tight truncate", isLight ? "text-s-80" : "text-slate-200")}>
                    {line.market}
                  </p>
                  <span
                    className={cn(
                      "text-[8px] uppercase tracking-[0.06em] shrink-0",
                      isLight ? "text-s-50" : "text-slate-400",
                    )}
                  >
                    {line.volume}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-col items-center gap-0.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openBuyTicket(line, "yes")}
                      className={cn(
                        "rounded-md border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em] cursor-pointer transition-all duration-150 hover:-translate-y-px hover:scale-[1.06] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1",
                        isLight
                          ? "border-emerald-300 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 focus-visible:ring-emerald-400"
                          : "border-emerald-300/30 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 focus-visible:ring-emerald-300/60",
                      )}
                      aria-label={`Buy yes at ${line.yes}%`}
                    >
                      YES {line.yes}%
                    </button>
                    <button
                      type="button"
                      onClick={() => openBuyTicket(line, "no")}
                      className={cn(
                        "rounded-md border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em] cursor-pointer transition-all duration-150 hover:-translate-y-px hover:scale-[1.06] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1",
                        isLight
                          ? "border-rose-300 bg-rose-100 text-rose-700 hover:bg-rose-200 focus-visible:ring-rose-400"
                          : "border-rose-300/30 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 focus-visible:ring-rose-300/60",
                      )}
                      aria-label={`Buy no at ${line.no}%`}
                    >
                      NO {line.no}%
                    </button>
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 h-1.5 w-full overflow-hidden rounded-full flex",
                      isLight ? "bg-[#dde6f4]" : "bg-white/10",
                    )}
                  >
                    <div className="h-full bg-emerald-400" style={{ width: `${line.yes}%` }} />
                    <div className="h-full bg-rose-400" style={{ width: `${line.no}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {buyTicket ? (
        <div style={panelStyle} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/72 p-4 backdrop-blur-[2px]">
          <div
            className={cn(
              "w-full max-w-md home-spotlight-shell rounded-xl border shadow-2xl",
              panelClass,
              isLight ? "bg-white/95" : "bg-black/90",
            )}
          >
            <div className={cn("border-b px-4 py-3", isLight ? "border-[#d5dce8]" : "border-white/10")}>
              <p className={cn("text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-400")}>
                Mock trade ticket
              </p>
              <h3 className={cn("mt-1 text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{buyTicket.line.market}</h3>
            </div>

            <div className="space-y-3 px-4 py-3">
              <div
                className={cn(
                  "rounded-md px-3 py-2 home-spotlight-card home-border-glow",
                  subPanelClass,
                  isLight ? "bg-white border-[#d5dce8]" : "bg-black/40 border-white/15",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("text-[11px] uppercase tracking-[0.1em]", isLight ? "text-s-60" : "text-slate-400")}>
                    Side
                  </span>
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                      buyTicket.side === "yes"
                        ? isLight
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-emerald-500/20 text-emerald-300"
                        : isLight
                          ? "bg-rose-100 text-rose-700"
                          : "bg-rose-500/20 text-rose-300",
                    )}
                  >
                    {buyTicket.side.toUpperCase()}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className={cn("text-[11px] uppercase tracking-[0.1em]", isLight ? "text-s-60" : "text-slate-400")}>
                    Live mock price
                  </span>
                  <span className={cn("text-lg font-semibold tabular-nums", isLight ? "text-s-90" : "text-slate-100")}>
                    {mockPrice.toFixed(1)}c
                  </span>
                </div>
              </div>

              <label className="block">
                <span className={cn("text-[11px] uppercase tracking-[0.1em]", isLight ? "text-s-60" : "text-slate-400")}>
                  Shares
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={shares}
                  onChange={(event) => setShares(event.target.value)}
                  className={cn(
                    "mt-1 h-9 w-full rounded-md border px-2 text-sm outline-none",
                    isLight
                      ? "border-[#d5dce8] bg-white text-s-90 focus:ring-1 focus:ring-[rgba(var(--accent-rgb),0.45)]"
                      : "border-white/15 bg-black/20 text-slate-100 focus:ring-1 focus:ring-[rgba(var(--accent-rgb),0.45)]",
                  )}
                />
              </label>

              <div
                className={cn(
                  "rounded-md px-3 py-2 home-spotlight-card home-border-glow",
                  subPanelClass,
                  isLight ? "bg-white border-[#d5dce8]" : "bg-black/40 border-white/15",
                )}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className={cn(isLight ? "text-s-60" : "text-slate-400")}>Estimated total</span>
                  <span className={cn("font-semibold tabular-nums", isLight ? "text-s-90" : "text-slate-100")}>${estimate.toFixed(2)}</span>
                </div>
                <p className={cn("mt-1 text-[10px] uppercase tracking-[0.08em]", isLight ? "text-s-50" : "text-slate-500")}>
                  UX mockup only. No order is sent.
                </p>
              </div>
            </div>

            <div className={cn("flex items-center justify-end gap-2 border-t px-4 py-3", isLight ? "border-[#d5dce8]" : "border-white/10")}>
              <button
                type="button"
                onClick={() => setBuyTicket(null)}
                className={cn(
                  "h-8 rounded-md border px-3 text-xs font-semibold uppercase tracking-[0.08em] home-spotlight-card home-border-glow",
                  isLight
                    ? "border-[#d5dce8] bg-white text-s-70 hover:bg-[#f7f9fd]"
                    : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10",
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setBuyTicket(null)}
                className={cn(
                  "h-8 rounded-md border px-3 text-xs font-semibold uppercase tracking-[0.08em]",
                  buyTicket.side === "yes"
                    ? isLight
                      ? "border-emerald-300 bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                      : "border-emerald-300/40 bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/35"
                    : isLight
                      ? "border-rose-300 bg-rose-100 text-rose-700 hover:bg-rose-200"
                      : "border-rose-300/40 bg-rose-500/25 text-rose-200 hover:bg-rose-500/35",
                )}
              >
                Buy {buyTicket.side.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
