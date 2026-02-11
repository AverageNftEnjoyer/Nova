"use client"

import { useEffect, useState } from "react"
import {
  Plus,
  Trash2,
  MessageSquare,
  Settings,
  RotateCcw,
  User,
  MoreHorizontal,
  Pencil,
  Archive,
  Pin,
  FolderArchive,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Conversation } from "@/lib/conversations"
import { USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type UserSettings } from "@/lib/userSettings"
import type { NovaState } from "@/lib/useNovaState"
import { useTheme } from "@/lib/theme-context"
import { SettingsModal } from "./settings-modal"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

interface ChatSidebarProps {
  conversations: Conversation[]
  activeId: string | null
  isOpen: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename?: (id: string, title: string) => void
  onArchive?: (id: string, archived: boolean) => void
  onPin?: (id: string, pinned: boolean) => void
  onReplayBoot?: () => void
  novaState?: NovaState
  agentConnected?: boolean
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

export function ChatSidebar({
  conversations,
  activeId,
  isOpen,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onArchive,
  onPin,
  onReplayBoot,
  novaState,
  agentConnected,
}: ChatSidebarProps) {
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingTitle, setRenamingTitle] = useState("")
  const [archivedOpen, setArchivedOpen] = useState(true)
  const { theme } = useTheme()
  const isLight = theme === "light"

  useEffect(() => {
    setUserSettings(loadUserSettings())
  }, [])

  useEffect(() => {
    const refresh = () => setUserSettings(loadUserSettings())
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [])

  useEffect(() => {
    if (!settingsOpen) {
      setUserSettings(loadUserSettings())
    }
  }, [settingsOpen])

  if (!isOpen) return null

  const profile = userSettings?.profile
  const activeConversations = conversations.filter((c) => !c.archived)
  const archivedConversations = conversations.filter((c) => c.archived)
  const showStatus = typeof agentConnected === "boolean" && typeof novaState !== "undefined"
  const light = {
    shellBg: "#f6f8fc",
    subBg: "#f4f7fd",
    border: "#d9e0ea",
  }
  const hoverFx = isLight
    ? "hover:bg-[#eef3fb] hover:border-[#d5dce8] hover:text-s-80"
    : "hover:bg-[#141923] hover:border-[#2b3240] hover:text-s-80"

  const statusText = !agentConnected
    ? "Agent offline"
    : novaState === "muted"
    ? "Nova muted"
    : novaState === "listening"
    ? "Nova online"
    : `Nova ${novaState}`
  const statusDotClass = !agentConnected
    ? "bg-red-400"
    : novaState === "muted"
    ? "bg-red-400"
    : novaState === "speaking"
    ? "bg-violet-400"
    : novaState === "thinking"
    ? "bg-amber-400"
    : novaState === "listening"
    ? "bg-emerald-400"
    : "bg-slate-400"
  const beginRename = (c: Conversation) => {
    setRenamingId(c.id)
    setRenamingTitle(c.title)
  }

  const saveRename = () => {
    if (!renamingId || !onRename) {
      setRenamingId(null)
      setRenamingTitle("")
      return
    }
    const next = renamingTitle.trim()
    if (!next) return
    onRename(renamingId, next)
    setRenamingId(null)
    setRenamingTitle("")
  }

  const renderConversationRow = (convo: Conversation) => (
    <div
      key={convo.id}
      className={cn(
        "group flex items-center gap-2.5 px-3 py-3 rounded-xl cursor-pointer mb-1 border transition-all duration-150",
        convo.id === activeId
          ? "bg-accent-10 border-accent-30 text-accent"
          : cn("border-transparent text-s-50", hoverFx),
      )}
      onClick={() => onSelect(convo.id)}
    >
      <MessageSquare className="w-4 h-4 shrink-0 opacity-50" />
      <div className="flex-1 min-w-0">
        {renamingId === convo.id ? (
          <input
            autoFocus
            value={renamingTitle}
            onChange={(e) => setRenamingTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveRename()
              if (e.key === "Escape") {
                setRenamingId(null)
                setRenamingTitle("")
              }
            }}
            onBlur={saveRename}
            onClick={(e) => e.stopPropagation()}
            className="w-full h-7 px-2 rounded-md bg-s-12 border border-s-10 text-sm text-s-90 outline-none"
          />
        ) : (
          <>
            <p className="text-sm truncate">{convo.title}</p>
            <p className="text-[10px] text-s-30">{formatDate(convo.updatedAt)}</p>
          </>
        )}
      </div>
      {renamingId !== convo.id && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 h-7 w-7 flex items-center justify-center transition-all text-s-40 hover:text-accent outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
              aria-label="Conversation options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className={cn(
              "rounded-xl text-s-80 p-1.5 min-w-42.5 shadow-none data-[state=open]:animate-none data-[state=closed]:animate-none",
              isLight ? "border bg-white" : "border border-white/10 bg-[rgba(9,14,24,0.96)]",
            )}
            style={isLight ? { borderColor: light.border } : undefined}
          >
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                beginRename(convo)
              }}
              className="rounded-md text-s-70 hover:text-accent data-highlighted:bg-accent-10"
            >
              <Pencil className="w-4 h-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onArchive?.(convo.id, !convo.archived)
              }}
              className="rounded-md text-s-70 hover:text-accent data-highlighted:bg-accent-10"
            >
              <Archive className="w-4 h-4" />
              {convo.archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onPin?.(convo.id, !convo.pinned)
              }}
              className="rounded-md text-s-70 hover:text-accent data-highlighted:bg-accent-10"
            >
              <Pin className="w-4 h-4" />
              {convo.pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onDelete(convo.id)
              }}
              className="rounded-md text-red-400 hover:text-red-300 data-highlighted:bg-red-500/12"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )

  return (
    <>
      <div
        className={cn(
          "w-72 h-[calc(100dvh-1rem)] ml-2 my-2 mr-0 rounded-2xl flex flex-col shrink-0 overflow-hidden",
          isLight ? "border bg-white" : "border border-white/10 bg-[rgba(7,11,18,0.78)] backdrop-blur-xl",
        )}
        style={isLight ? { borderColor: light.border, backgroundColor: light.shellBg } : undefined}
      >
        <div className={cn("px-5 pt-5 pb-4", isLight ? "border-b" : "border-b border-white/10")} style={isLight ? { borderColor: light.border } : undefined}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-linear-to-tr from-[#00f5ff] to-[#ff00e5] flex items-center justify-center">
              <span className="text-white text-xs font-bold">N</span>
            </div>
            <div>
              <h1 className="text-s-90 text-2xl font-semibold tracking-tight">NovaOS</h1>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-[10px] text-accent font-mono">V.0 Beta</p>
                {showStatus && (
                  <div className={cn("inline-flex items-center gap-2 rounded-full px-2.5 py-1", isLight ? "border" : "border border-white/10 bg-[rgba(255,255,255,0.03)]")} style={isLight ? { borderColor: light.border, backgroundColor: light.subBg } : undefined}>
                    <span className={`h-2 w-2 rounded-full ${statusDotClass}`} />
                    <span className="text-[10px] uppercase tracking-[0.16em] text-s-70 font-semibold">
                      {statusText}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className={cn("px-4 py-3", isLight ? "border-b" : "border-b border-white/10")} style={isLight ? { borderColor: light.border } : undefined}>
          <button
            onClick={onNew}
            className={cn(
              "appearance-none w-full h-11 px-4 flex items-center justify-start gap-2 rounded-xl text-s-70 text-sm font-medium transition-all duration-150",
              hoverFx,
              isLight ? "border border-[#d9e0ea] bg-[#f4f7fd]" : "border border-white/15 bg-[rgba(255,255,255,0.03)]",
            )}
          >
            <Plus className="w-4 h-4" />
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-3">
          {activeConversations.length === 0 && (
            <p className="text-xs text-s-30 text-center py-8">No conversations yet</p>
          )}

          {activeConversations.map(renderConversationRow)}

          <div className={cn("mt-3 pt-2", isLight ? "border-t" : "border-t border-white/10")} style={isLight ? { borderColor: light.border } : undefined}>
            <button
              onClick={() => setArchivedOpen((v) => !v)}
              className={cn(
                "appearance-none w-full h-10 px-3 flex items-center justify-between rounded-xl text-[12px] uppercase tracking-[0.15em] text-s-40 transition-all outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
                hoverFx,
                isLight ? "border border-[#d9e0ea] bg-[#f4f7fd]" : "border border-white/10 bg-[rgba(255,255,255,0.02)]",
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <FolderArchive className="w-3.5 h-3.5" />
                Archived Chats ({archivedConversations.length})
              </span>
              {archivedOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            {archivedOpen && (
              <div className="mt-1">
                {archivedConversations.length === 0 ? (
                  <p className="text-[11px] text-s-30 px-3 py-2">No archived chats.</p>
                ) : (
                  archivedConversations.map(renderConversationRow)
                )}
              </div>
            )}
          </div>
        </div>

        <div className={cn("px-4 py-3", isLight ? "border-t" : "border-t border-white/10")} style={isLight ? { borderColor: light.border } : undefined}>
          <div
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-xl transition-colors",
              isLight ? "border border-[#d9e0ea] bg-white hover:bg-[#eef3fb] hover:border-accent-30" : "border border-white/10 bg-[rgba(255,255,255,0.02)] hover:bg-accent-10 hover:border-accent-30",
            )}
          >
            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden", isLight ? "border" : "bg-white/10 border border-white/10")} style={isLight ? { borderColor: light.border, backgroundColor: light.subBg } : undefined}>
              {profile?.avatar ? (
                <img src={profile.avatar} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-4 h-4 text-s-80" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-base text-s-90 font-medium truncate">
                {profile?.name || "User"}
              </p>
              <p className="text-xs text-accent font-mono truncate">
                {profile?.accessTier || "Core Access"}
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {onReplayBoot && (
                <button
                  onClick={onReplayBoot}
                  className={cn(
                    "appearance-none h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                    isLight
                      ? "border border-[#d9e0ea] bg-[#f4f7fd] hover:bg-[#eef3fb] hover:border-[#d5dce8]"
                      : "border border-white/10 bg-[rgba(255,255,255,0.02)] hover:bg-[#141923] hover:border-[#2b3240]",
                  )}
                  aria-label="Replay boot sequence"
                  title="Replay boot sequence"
                >
                  <RotateCcw className="w-4 h-4 text-s-50 hover:text-accent transition-colors" />
                </button>
              )}
              <button
                onClick={() => setSettingsOpen(true)}
                className={cn(
                  "appearance-none h-8 w-8 rounded-lg flex items-center justify-center transition-colors group/gear",
                  isLight
                    ? "border border-[#d9e0ea] bg-[#f4f7fd] hover:bg-[#eef3fb] hover:border-[#d5dce8]"
                    : "border border-white/10 bg-[rgba(255,255,255,0.02)] hover:bg-[#141923] hover:border-[#2b3240]",
                )}
                aria-label="Settings"
              >
                <Settings className="w-4 h-4 text-s-50 group-hover/gear:text-accent group-hover/gear:rotate-90 transition-transform duration-200" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
