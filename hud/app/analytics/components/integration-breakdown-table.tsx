import { Globe, ShieldQuestion, Sparkles, Waypoints } from "lucide-react"

import { BraveIcon, ClaudeIcon, DiscordIcon, GeminiIcon, GmailIcon, OpenAIIcon, TelegramIcon, XAIIcon } from "@/components/icons"

import type { IntegrationMetricRow } from "../types"

interface IntegrationBreakdownTableProps {
  rows: IntegrationMetricRow[]
  isLight: boolean
}

function iconForSlug(slug: string) {
  const normalized = slug.trim().toLowerCase()
  if (normalized === "openai") return <OpenAIIcon size={14} />
  if (normalized === "claude") return <ClaudeIcon className="h-3.5 w-3.5" />
  if (normalized === "grok") return <XAIIcon size={14} />
  if (normalized === "gemini") return <GeminiIcon className="h-3.5 w-3.5" />
  if (normalized === "telegram") return <TelegramIcon className="h-3.5 w-3.5" />
  if (normalized === "discord") return <DiscordIcon className="h-3.5 w-3.5" />
  if (normalized === "gmail") return <GmailIcon className="h-3.5 w-3.5" />
  if (normalized === "brave") return <BraveIcon className="h-3.5 w-3.5" />
  if (normalized === "firecrawl") return <Globe className="h-3.5 w-3.5" />
  return <ShieldQuestion className="h-3.5 w-3.5" />
}

function statusClass(status: IntegrationMetricRow["status"]): string {
  if (status === "active") return "text-emerald-300 bg-emerald-500/15 border-emerald-300/40"
  if (status === "error") return "text-rose-300 bg-rose-500/15 border-rose-300/40"
  return "text-slate-300 bg-slate-500/15 border-slate-300/30"
}

export function IntegrationBreakdownTable({ rows, isLight }: IntegrationBreakdownTableProps) {
  return (
    <section className="h-full p-4 flex flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className={`text-sm uppercase tracking-[0.22em] font-semibold ${isLight ? "text-s-90" : "text-slate-200"}`}>Integration Breakdown</h3>
          <p className={`mt-1 text-xs ${isLight ? "text-s-50" : "text-slate-400"}`}>Discovered services and throughput</p>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-s-50">
          <Sparkles className="h-3.5 w-3.5" /> {rows.length} services
        </div>
      </div>

      <div className={`module-hover-scroll min-h-0 flex-1 overflow-y-auto rounded-xl border pr-1 ${isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/25 backdrop-blur-md"}`}>
        <table className="w-full text-xs">
          <thead>
            <tr className={isLight ? "text-s-50" : "text-slate-400"}>
              <th className="px-2 py-1.5 text-left text-[11px] uppercase tracking-[0.14em]">Service</th>
              <th className="px-2 py-1.5 text-right text-[11px] uppercase tracking-[0.14em]">Requests</th>
              <th className="px-2 py-1.5 text-right text-[11px] uppercase tracking-[0.14em]">Success</th>
              <th className="px-2 py-1.5 text-right text-[11px] uppercase tracking-[0.14em]">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className={`px-2.5 py-8 text-center text-sm ${isLight ? "text-s-50" : "text-slate-400"}`}>
                  No integrations match active filters.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              return (
                <tr key={row.key} className={isLight ? "border-t border-[#dfe5ef]" : "border-t border-white/10"}>
                  <td className="px-2 py-2">
                    <div className="inline-flex items-center gap-1.5">
                      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md border ${isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20 backdrop-blur-sm"}`}>
                        {iconForSlug(row.slug)}
                      </span>
                      <span className={`truncate max-w-[80px] ${isLight ? "text-s-90" : "text-slate-100"}`}>{row.name}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs">{row.requests.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right font-mono text-xs">{row.successRate.toFixed(1)}%</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusClass(row.status)}`}>
                      <Waypoints className="h-3 w-3" /> {row.status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

