"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2, MessageSquare, Settings, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Conversation } from "@/lib/conversations"
import { loadUserSettings, type UserSettings } from "@/lib/userSettings"
import { SettingsModal } from "./settings-modal"

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
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    setUserSettings(loadUserSettings())
  }, [])

  // Reload settings when modal closes
  useEffect(() => {
    if (!settingsOpen) {
      setUserSettings(loadUserSettings())
    }
  }, [settingsOpen])

  if (!isOpen) return null

  const profile = userSettings?.profile

  return (
    <>
      <div className="w-64 h-dvh bg-sidebar-page border-r border-s-5 flex flex-col shrink-0">
        {/* NovaOS Branding */}
        <div className="px-4 pt-4 pb-2">
          <h1 className="text-white text-lg font-semibold tracking-wide">NovaOS</h1>
          <p className="text-[10px] text-blue-400 font-mono">V.0 Beta</p>
        </div>

        {/* Header */}
        <div className="p-3 border-b border-s-5">
          <Button
            onClick={onNew}
            className="w-full justify-start gap-2 bg-s-5 hover:bg-s-10 text-s-70 border border-s-10 rounded-xl h-10 text-sm font-normal"
            variant="outline"
          >
            <Plus className="w-4 h-4" />
            New chat
          </Button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {conversations.length === 0 && (
            <p className="text-xs text-s-30 text-center py-8">No conversations yet</p>
          )}

          {conversations.map((convo) => (
            <div
              key={convo.id}
              className={cn(
                "group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer mb-0.5 transition-colors",
                convo.id === activeId
                  ? "bg-s-10 text-s-90"
                  : "text-s-50 hover:bg-s-5",
              )}
              onClick={() => onSelect(convo.id)}
            >
              <MessageSquare className="w-4 h-4 shrink-0 opacity-50" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{convo.title}</p>
                <p className="text-[10px] text-s-30">{formatDate(convo.updatedAt)}</p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(convo.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-s-10 transition-opacity"
                aria-label="Delete conversation"
              >
                <Trash2 className="w-3.5 h-3.5 text-s-40" />
              </button>
            </div>
          ))}
        </div>

        {/* Profile Pill with Settings inside */}
        <div className="p-3 border-t border-s-5">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-full bg-s-10 hover:bg-s-12 transition-colors">
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0 overflow-hidden">
              {profile?.avatar ? (
                <img src={profile.avatar} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-4 h-4 text-white" />
              )}
            </div>

            {/* Name & Access Level */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-medium truncate">
                {profile?.name || "User"}
              </p>
              <p className="text-[10px] text-violet-400 font-mono truncate">
                {profile?.accessTier || "Core Access"}
              </p>
            </div>

            {/* Settings Gear - Inside the pill */}
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-8 h-8 rounded-full bg-s-15 hover:bg-accent-20 flex items-center justify-center transition-all duration-200 shrink-0 group/gear hover:scale-110"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4 text-s-50 group-hover/gear:text-accent transition-all duration-200 group-hover/gear:rotate-90" />
            </button>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
