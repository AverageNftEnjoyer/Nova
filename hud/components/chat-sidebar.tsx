"use client"

import { Plus, Trash2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Conversation } from "@/lib/conversations"

interface ChatSidebarProps {
  conversations: Conversation[]
  activeId: string | null
  isOpen: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function ChatSidebar({ conversations, activeId, isOpen, onSelect, onNew, onDelete }: ChatSidebarProps) {
  if (!isOpen) return null

  return (
    <div className="w-64 h-dvh bg-[#0d0d14] border-r border-white/5 flex flex-col shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-white/5">
        <Button
          onClick={onNew}
          className="w-full justify-start gap-2 bg-white/5 hover:bg-white/10 text-white/70 border border-white/10 rounded-xl h-10 text-sm font-normal"
          variant="outline"
        >
          <Plus className="w-4 h-4" />
          New chat
        </Button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {conversations.length === 0 && (
          <p className="text-xs text-white/30 text-center py-8">No conversations yet</p>
        )}

        {conversations.map((convo) => (
          <div
            key={convo.id}
            className={cn(
              "group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer mb-0.5 transition-colors",
              convo.id === activeId
                ? "bg-white/10 text-white/90"
                : "text-white/50 hover:bg-white/5",
            )}
            onClick={() => onSelect(convo.id)}
          >
            <MessageSquare className="w-4 h-4 shrink-0 opacity-50" />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{convo.title}</p>
              <p className="text-[10px] text-white/30">{formatDate(convo.updatedAt)}</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(convo.id)
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-white/10 transition-opacity"
              aria-label="Delete conversation"
            >
              <Trash2 className="w-3.5 h-3.5 text-white/40" />
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-white/5">
        <p className="text-[10px] text-white/20 text-center">Nova AI Assistant</p>
      </div>
    </div>
  )
}
