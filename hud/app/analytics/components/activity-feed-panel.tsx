import { AlertTriangle, CheckCircle2, Clock3, Globe, ShieldQuestion } from "lucide-react"

import { TelegramIcon } from "@/components/telegram-icon"
import { DiscordIcon } from "@/components/discord-icon"
import { BraveIcon } from "@/components/brave-icon"
import { OpenAIIcon } from "@/components/openai-icon"
import { ClaudeIcon } from "@/components/claude-icon"
import { XAIIcon } from "@/components/xai-icon"
import { GeminiIcon } from "@/components/gemini-icon"
import { GmailIcon } from "@/components/gmail-icon"

import type { ActivityEvent } from "../types"

interface ActivityFeedPanelProps {
  events: ActivityEvent[]
  isLight: boolean
}

function statusIcon(status: ActivityEvent["status"]) {
  if (status === "success") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
  if (status === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
  return <AlertTriangle className="h-3.5 w-3.5 text-rose-300" />
}

function iconForService(service: string) {
  const value = service.trim().toLowerCase()
  if (value.includes("openai")) return <OpenAIIcon size={14} />
  if (value.includes("claude")) return <ClaudeIcon className="h-3.5 w-3.5" />
  if (value.includes("grok")) return <XAIIcon size={14} />
  if (value.includes("gemini")) return <GeminiIcon className="h-3.5 w-3.5" />
  if (value.includes("telegram")) return <TelegramIcon className="h-3.5 w-3.5" />
  if (value.includes("discord")) return <DiscordIcon className="h-3.5 w-3.5" />
  if (value.includes("gmail")) return <GmailIcon className="h-3.5 w-3.5" />
  if (value.includes("brave")) return <BraveIcon className="h-3.5 w-3.5" />
  if (value.includes("firecrawl")) return <Globe className="h-3.5 w-3.5" />
  return <ShieldQuestion className="h-3.5 w-3.5" />
}

export function ActivityFeedPanel({ events, isLight }: ActivityFeedPanelProps) {
  return (
    <section className="h-full p-4 flex flex-col">
      <div className="mb-3 flex items-center gap-2">
        <Clock3 className="h-4 w-4 text-accent" />
        <h3 className={`text-sm uppercase tracking-[0.22em] font-semibold ${isLight ? "text-s-90" : "text-slate-200"}`}>Live Activity</h3>
      </div>
      <p className={`mb-3 text-xs ${isLight ? "text-s-50" : "text-slate-400"}`}>Recent events across integrations</p>

      <div className="module-hover-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {events.map((event) => (
          <div key={event.id} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 ${isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/25 backdrop-blur-md"}`}>
            <span className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md border ${isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20"}`}>
              {iconForService(event.service)}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-[13px] leading-tight ${isLight ? "text-s-90" : "text-slate-100"}`}>{event.service}</p>
              <p className="truncate text-[11px] text-s-50">{event.action}</p>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-s-50">{event.timeAgo}</span>
              <span className="shrink-0">{statusIcon(event.status)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
