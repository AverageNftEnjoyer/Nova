"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { MessageSquare, Trash2, Clock, ChevronRight, Plus, PanelLeftOpen, PanelLeftClose } from "lucide-react"
import { loadConversations, saveConversations, setActiveId, createConversation, type Conversation } from "@/lib/conversations"
import { AnimatedOrb } from "@/components/animated-orb"
import { ThemeToggle } from "@/components/theme-toggle"
import { ChatSidebar } from "@/components/chat-sidebar"
import { Button } from "@/components/ui/button"

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

export default function HistoryPage() {
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loaded, setLoaded] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    setConversations(loadConversations()) 
    setLoaded(true)
  }, [])

  const handleOpen = (convo: Conversation) => {
    setActiveId(convo.id)
    router.push("/chat")
  }

  const handleDelete = useCallback((id: string) => {
    const remaining = conversations.filter((c) => c.id !== id)
    setConversations(remaining)
    saveConversations(remaining)
  }, [conversations])

  const handleRename = useCallback((id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    const next = conversations.map((c) =>
      c.id === id ? { ...c, title: trimmed, updatedAt: new Date().toISOString() } : c,
    )
    setConversations(next)
    saveConversations(next)
  }, [conversations])

  const handleArchive = useCallback((id: string, archived: boolean) => {
    const next = conversations.map((c) =>
      c.id === id ? { ...c, archived, updatedAt: new Date().toISOString() } : c,
    )
    setConversations(next)
    saveConversations(next)
  }, [conversations])

  const handlePin = useCallback((id: string, pinned: boolean) => {
    const next = conversations.map((c) => (c.id === id ? { ...c, pinned } : c))
    setConversations(next)
    saveConversations(next)
  }, [conversations])

  const handleNewChat = useCallback(() => {
    const fresh = createConversation()
    const convos = [fresh, ...conversations]
    setConversations(convos)
    saveConversations(convos)
    setActiveId(fresh.id)
    router.push("/chat")
  }, [conversations, router])

  const handleSelectConvo = useCallback((id: string) => {
    setActiveId(id)
    router.push("/chat")
  }, [router])

  const nonEmpty = conversations.filter((c) => c.messages.length > 0)
  const grouped = groupByDate(nonEmpty)

  return (
    <div className="relative flex h-dvh bg-page text-foreground">
      {/* Sidebar */}
      <ChatSidebar
        conversations={conversations}
        activeId={null}
        isOpen={sidebarOpen}
        onSelect={handleSelectConvo}
        onNew={handleNewChat}
        onDelete={handleDelete}
        onRename={handleRename}
        onArchive={handleArchive}
        onPin={handlePin}
      />

      {/* Main content */}
      <div
        className="flex-1 overflow-y-auto"
        style={{
          marginLeft: "0",
        }}
      >
        {/* Header */}
        <div className="border-b border-s-5">
          <div className="max-w-3xl mx-auto px-6 py-8">
            <div className="flex items-center gap-4">
              <Button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-s-60 border border-[#d9e0ea] bg-[#f4f7fd] hover:bg-[#eef3fb]"
                aria-label="Toggle sidebar"
              >
                {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              </Button>
              <AnimatedOrb size={40} />
              <div className="flex-1">
                <h1 className="text-2xl font-light tracking-wide text-s-90">
                  Previous Chats
                </h1>
                <p className="text-sm text-s-30 mt-0.5 font-mono">
                  {nonEmpty.length} conversation{nonEmpty.length !== 1 ? "s" : ""}
                </p>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-3xl mx-auto px-6 py-6">
          {!loaded && (
            <div className="flex items-center justify-center py-20">
              <AnimatedOrb size={64} />
            </div>
          )}

          {loaded && nonEmpty.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-s-30">
              <MessageSquare className="w-12 h-12 mb-4 opacity-30" />
              <p className="text-lg">No conversations yet</p>
              <p className="text-sm mt-1 text-s-20">
                Start chatting with Nova to see your history here
              </p>
              <button
                onClick={handleNewChat}
                className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 text-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                New chat
              </button>
            </div>
          )}

          {loaded &&
            grouped.map(([label, convos]) => (
              <div key={label} className="mb-8">
                <h2 className="text-[11px] font-mono tracking-widest uppercase text-violet-400/40 mb-3 px-1">
                  {label}
                </h2>
                <div className="space-y-2">
                  {convos.map((convo) => {
                    const lastMsg = convo.messages[convo.messages.length - 1]
                    const preview = lastMsg
                      ? lastMsg.content.length > 120
                        ? lastMsg.content.slice(0, 120) + "..."
                        : lastMsg.content
                      : ""

                    return (
                      <div
                        key={convo.id}
                        className="group relative flex items-start gap-4 p-4 rounded-2xl bg-s-2 border border-s-5 hover:bg-s-5 hover:border-s-10 cursor-pointer transition-all"
                        onClick={() => handleOpen(convo)}
                      >
                        <div className="shrink-0 mt-1">
                          <div className="w-9 h-9 rounded-xl bg-violet-500/10 flex items-center justify-center">
                            <MessageSquare className="w-4 h-4 text-violet-400/60" />
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-s-80 truncate">
                              {convo.title}
                            </h3>
                            <span className="shrink-0 text-[10px] text-s-20 font-mono">
                              {convo.messages.length} msg{convo.messages.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                          {preview && (
                            <p className="text-xs text-s-25 mt-1 line-clamp-2 leading-relaxed">
                              {preview}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <Clock className="w-3 h-3 text-s-15" />
                            <span className="text-[10px] text-s-20 font-mono">
                              {formatTime(convo.updatedAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0 self-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(convo.id)
                            }}
                            className="opacity-0 group-hover:opacity-100 p-2 rounded-xl hover:bg-s-10 transition-all"
                            aria-label="Delete conversation"
                          >
                            <Trash2 className="w-4 h-4 text-s-30" />
                          </button>
                          <ChevronRight className="w-4 h-4 text-s-10 group-hover:text-s-30 transition-colors" />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
        </div>

        {/* Footer */}
        <div className="border-t border-s-5 mt-auto">
          <div className="max-w-3xl mx-auto px-6 py-4">
            <p className="text-[10px] text-s-15 text-center font-mono">
              NOVA AI SYSTEMS — CONVERSATION ARCHIVE
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function groupByDate(convos: Conversation[]): [string, Conversation[]][] {
  const groups: Record<string, Conversation[]> = {}

  for (const convo of convos) {
    const label = formatDate(convo.updatedAt)
    if (!groups[label]) groups[label] = []
    groups[label].push(convo)
  }

  const order = ["Today", "Yesterday"]
  const entries = Object.entries(groups)
  entries.sort(([a], [b]) => {
    const ai = order.indexOf(a)
    const bi = order.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return 0
  })

  return entries
}
