"use client"

import { useCallback, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react"
import { Activity, MessageSquarePlus, MessagesSquare, Mic, MicOff, SendHorizontal } from "lucide-react"

import type { NovaState } from "@/lib/chat/hooks/useNovaState"
import { cn } from "@/lib/shared/utils"

type CommandMode = "home" | "chat"

interface HomeCommandModuleProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties | undefined
  className?: string
  connected: boolean
  novaState: NovaState
  thinkingStatus: string
  latestHomeCommandReply: string
  latestHomeCommandReplyTs: number
  isMuted: boolean
  muteHydrated: boolean
  onToggleMute: () => void
  onSendHomeCommand: (text: string) => void
  onSendToChat: (text: string) => void
  onStartNewChat: () => void
  onOpenChat: () => void
}

const HOME_COMMAND_EXAMPLES = [
  "Play a YouTube video about AI chip updates from channel Bloomberg Technology",
  "Give me a one-line summary of today's market mood",
  "Speak a 20-second briefing for my next meeting",
] as const

const CHAT_THREAD_EXAMPLES = [
  "Draft a rollout plan for the chat module overhaul",
  "Compare two architecture options for our HUD",
  "Help me debug websocket event routing",
] as const

function getStatusLabel(connected: boolean, novaState: NovaState, thinkingStatus: string): string {
  if (!connected) return "offline"
  if (novaState === "muted") return "muted"
  if (novaState === "thinking") return thinkingStatus ? `thinking: ${thinkingStatus}` : "thinking"
  if (novaState === "listening") return "listening"
  if (novaState === "speaking") return "speaking"
  return "ready"
}

function formatRelativeReplyTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ""
  const ageMs = Math.max(0, Date.now() - ts)
  if (ageMs < 60_000) return "just now"
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`
  return `${Math.floor(ageMs / 3_600_000)}h ago`
}

export function HomeCommandModule({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  className,
  connected,
  novaState,
  thinkingStatus,
  latestHomeCommandReply,
  latestHomeCommandReplyTs,
  isMuted,
  muteHydrated,
  onToggleMute,
  onSendHomeCommand,
  onSendToChat,
  onStartNewChat,
  onOpenChat,
}: HomeCommandModuleProps) {
  const [mode, setMode] = useState<CommandMode>("home")
  const [value, setValue] = useState("")

  const statusLabel = useMemo(
    () => getStatusLabel(connected, novaState, thinkingStatus),
    [connected, novaState, thinkingStatus],
  )
  const examples = mode === "home" ? HOME_COMMAND_EXAMPLES : CHAT_THREAD_EXAMPLES
  const canSend = connected && value.trim().length > 0

  const send = useCallback(() => {
    const text = value.trim()
    if (!text || !connected) return
    if (mode === "home") {
      onSendHomeCommand(text)
    } else {
      onSendToChat(text)
    }
    setValue("")
  }, [connected, mode, onSendHomeCommand, onSendToChat, value])

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }, [send])

  const handleExampleClick = useCallback((example: string) => {
    if (mode === "home" && connected) {
      onSendHomeCommand(example)
      setValue("")
      return
    }
    setValue(example)
  }, [connected, mode, onSendHomeCommand])

  return (
    <section
      style={panelStyle}
      className={cn(`${panelClass} home-spotlight-shell p-3 flex flex-col min-h-0`, className ?? "shrink-0")}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 min-w-0">
          <Activity className="w-4 h-4 text-accent" />
          <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
            Command Chat
          </h2>
          <span
            className={cn(
              "text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 rounded-full border whitespace-nowrap max-w-44 truncate",
              statusLabel === "offline"
                ? isLight
                  ? "border-rose-300 bg-rose-50 text-rose-600"
                  : "border-rose-400/40 bg-rose-500/15 text-rose-400"
                : statusLabel === "muted"
                  ? isLight
                    ? "border-amber-300 bg-amber-50 text-amber-600"
                    : "border-amber-400/40 bg-amber-500/15 text-amber-400"
                  : isLight
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-emerald-400/40 bg-emerald-500/15 text-emerald-300",
            )}
          >
            {statusLabel}
          </span>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <button
            onClick={onStartNewChat}
            className={cn("h-8 px-2 rounded-md border text-[10px] uppercase tracking-[0.12em] inline-flex items-center gap-1 home-spotlight-card home-border-glow", subPanelClass)}
            title="Start a new chat thread"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            New Chat
          </button>
          <button
            onClick={onOpenChat}
            className={cn("h-8 px-2 rounded-md border text-[10px] uppercase tracking-[0.12em] inline-flex items-center gap-1 home-spotlight-card home-border-glow", subPanelClass)}
            title="Open the chat page"
          >
            <MessagesSquare className="w-3.5 h-3.5" />
            Open Chat
          </button>
          <button
            onClick={onToggleMute}
            disabled={!muteHydrated}
            className={cn(
              "h-8 w-8 rounded-md border inline-flex items-center justify-center home-spotlight-card home-border-glow disabled:opacity-40",
              subPanelClass,
            )}
            aria-label={!muteHydrated ? "Syncing mute state" : isMuted ? "Unmute Nova" : "Mute Nova"}
            title={!muteHydrated ? "Syncing mute state" : isMuted ? "Unmute Nova" : "Mute Nova"}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5 text-rose-400" /> : <Mic className="w-3.5 h-3.5 text-emerald-400" />}
          </button>
        </div>
      </div>

      <div className={cn("mt-2 p-1 rounded-md border flex items-center gap-1 shrink-0", subPanelClass)}>
        <button
          onClick={() => setMode("home")}
          className={cn(
            "h-7 px-2.5 rounded-sm text-[10px] uppercase tracking-[0.12em] border transition-colors flex-1",
            mode === "home"
              ? isLight
                ? "border-[#bfd1ea] bg-[#e9f0fb] text-s-90"
                : "border-white/25 bg-white/12 text-slate-100"
              : "border-transparent text-slate-400 hover:text-slate-200",
          )}
        >
          Home Command
        </button>
        <button
          onClick={() => setMode("chat")}
          className={cn(
            "h-7 px-2.5 rounded-sm text-[10px] uppercase tracking-[0.12em] border transition-colors flex-1",
            mode === "chat"
              ? isLight
                ? "border-[#bfd1ea] bg-[#e9f0fb] text-s-90"
                : "border-white/25 bg-white/12 text-slate-100"
              : "border-transparent text-slate-400 hover:text-slate-200",
          )}
        >
          Chat Thread
        </button>
      </div>

      <div className={cn("mt-2 flex-1 min-h-0 rounded-md border p-2.5 overflow-y-auto home-spotlight-card home-border-glow", subPanelClass)}>
        <div className="flex items-start gap-2">
          <span className={cn("mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border", isLight ? "border-[#cdd9ea] bg-[#edf2fb] text-s-70" : "border-white/15 bg-white/10 text-slate-200")}>
            <Activity className="w-3.5 h-3.5 text-accent" />
          </span>
          <div className="min-w-0">
            <p className={cn("text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-400")}>
              Nova
            </p>
            <p className={cn("mt-1 text-[12px] leading-5", isLight ? "text-s-80" : "text-slate-200")}>
              {latestHomeCommandReply || (mode === "home"
                ? "Type a home command and press Enter. Results render directly on Home."
                : "Type a prompt for chat thread handoff and press Enter.")}
            </p>
            {latestHomeCommandReply ? (
              <p className={cn("mt-1 text-[9px] uppercase tracking-[0.08em]", isLight ? "text-s-40" : "text-slate-500")}>
                {formatRelativeReplyTime(latestHomeCommandReplyTs)}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-1.5">
          {examples.slice(0, 2).map((example) => (
            <button
              key={example}
              onClick={() => handleExampleClick(example)}
              className={cn(
                "rounded-md border px-2 py-1 text-[10px] text-left home-spotlight-card home-border-glow",
                subPanelClass,
              )}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("mt-2 rounded-md border p-2 shrink-0", subPanelClass)}>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleInputKeyDown}
          disabled={!connected}
          rows={2}
          placeholder={
            mode === "home"
              ? "Write a home command and press Enter..."
              : "Write a chat message and press Enter..."
          }
          className={cn(
            "w-full bg-transparent text-sm px-1.5 py-1 resize-none outline-none disabled:opacity-50",
            isLight ? "text-s-90 placeholder:text-[#9ca9bb]" : "text-slate-100 placeholder:text-[#8da0b8]",
          )}
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className={cn("text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-400")}>
            {mode === "home" ? "Auto-runs on Enter" : "Thread handoff mode"}
          </p>
          {mode === "chat" ? (
            <button
              onClick={send}
              disabled={!canSend}
              className={cn(
                "h-7 w-7 rounded-full border inline-flex items-center justify-center transition-colors disabled:opacity-45",
                isLight
                  ? "border-[#bfd1ea] bg-[#e9f0fb] text-s-90 hover:bg-[#dde9fa]"
                  : "border-white/20 bg-white/10 text-slate-100 hover:bg-white/15",
              )}
              aria-label="Send to chat"
              title="Send to chat"
            >
              <SendHorizontal className="w-3.5 h-3.5" />
            </button>
          ) : (
            <div className={cn("h-7 px-2 rounded-full border text-[9px] uppercase tracking-[0.1em] inline-flex items-center", isLight ? "border-[#cdd9ea] bg-[#edf2fb] text-s-70" : "border-white/15 bg-white/10 text-slate-300")}>
              Home
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
