"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Plus,
  Trash2,
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
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type UserSettings } from "@/lib/userSettings"
import type { NovaState } from "@/lib/useNovaState"
import { useTheme } from "@/lib/theme-context"
import { SettingsModal } from "./settings-modal"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { NovaOrbIndicator } from "./nova-orb-indicator"

interface ChatSidebarProps {
  conversations: Conversation[]
  activeId: string | null
  isOpen: boolean
  showNewChatButton?: boolean
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

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function ChatSidebar({
  conversations,
  activeId,
  isOpen,
  showNewChatButton = true,
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
  const sidebarRef = useRef<HTMLDivElement | null>(null)
  const spotlightRef = useRef<HTMLDivElement | null>(null)
  const router = useRouter()
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingTitle, setRenamingTitle] = useState("")
  const [archivedOpen, setArchivedOpen] = useState(true)
  const [orbHovered, setOrbHovered] = useState(false)
  const { theme } = useTheme()
  const isLight = theme === "light"
  const orbPalette = ORB_COLORS[userSettings?.app.orbColor ?? "violet"]
  const spotlightEnabled = userSettings?.app.spotlightEnabled ?? true
  const spotlightActive = spotlightEnabled && isOpen
  const orbHoverFilter = `drop-shadow(0 0 8px ${hexToRgba(orbPalette.circle1, 0.55)}) drop-shadow(0 0 14px ${hexToRgba(orbPalette.circle2, 0.35)})`

  useEffect(() => {
    if (!spotlightActive) return
    const sidebar = sidebarRef.current
    const spotlight = spotlightRef.current
    if (!sidebar) return

    if (!spotlightActive) {
      if (spotlight) spotlight.style.opacity = "0"
      const cards = sidebar.querySelectorAll<HTMLElement>(".chat-sidebar-card")
      cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
      return
    }

    if (!spotlight) return
    let liveStars = 0

    const handleMouseMove = (e: MouseEvent) => {
      const rect = sidebar.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      spotlight.style.left = `${mouseX}px`
      spotlight.style.top = `${mouseY}px`
      spotlight.style.opacity = "0.95"

      const cards = sidebar.querySelectorAll<HTMLElement>(".chat-sidebar-card")
      const fadeDistance = 56

      cards.forEach((card) => {
        const cardRect = card.getBoundingClientRect()
        const isInsideCard =
          e.clientX >= cardRect.left &&
          e.clientX <= cardRect.right &&
          e.clientY >= cardRect.top &&
          e.clientY <= cardRect.bottom
        const dx =
          e.clientX < cardRect.left ? cardRect.left - e.clientX : e.clientX > cardRect.right ? e.clientX - cardRect.right : 0
        const dy =
          e.clientY < cardRect.top ? cardRect.top - e.clientY : e.clientY > cardRect.bottom ? e.clientY - cardRect.bottom : 0
        const distanceToCard = Math.hypot(dx, dy)

        let glowIntensity = 0
        if (isInsideCard) {
          glowIntensity = 1
        } else if (distanceToCard <= fadeDistance) {
          glowIntensity = 1 - distanceToCard / fadeDistance
        }
        if (glowIntensity < 0.08) glowIntensity = 0

        const relativeX = ((e.clientX - cardRect.left) / cardRect.width) * 100
        const relativeY = ((e.clientY - cardRect.top) / cardRect.height) * 100
        card.style.setProperty("--glow-x", `${relativeX}%`)
        card.style.setProperty("--glow-y", `${relativeY}%`)
        card.style.setProperty("--glow-intensity", glowIntensity.toString())
        card.style.setProperty("--glow-radius", "90px")

        if (isInsideCard && glowIntensity > 0.2 && Math.random() <= 0.16 && liveStars < 42) {
          liveStars += 1
          const star = document.createElement("span")
          star.className = "fx-star-particle"
          star.style.left = `${e.clientX - cardRect.left}px`
          star.style.top = `${e.clientY - cardRect.top}px`
          star.style.setProperty("--fx-star-color", "rgba(255,255,255,1)")
          star.style.setProperty("--fx-star-glow", "rgba(255,255,255,0.7)")
          star.style.setProperty("--star-x", `${(Math.random() - 0.5) * 34}px`)
          star.style.setProperty("--star-y", `${-12 - Math.random() * 26}px`)
          star.style.animationDuration = `${0.9 + Math.random() * 0.6}s`
          card.appendChild(star)
          star.addEventListener(
            "animationend",
            () => {
              star.remove()
              liveStars = Math.max(0, liveStars - 1)
            },
            { once: true },
          )
        }
      })
    }

    const handleMouseLeave = () => {
      spotlight.style.opacity = "0"
      const cards = sidebar.querySelectorAll<HTMLElement>(".chat-sidebar-card")
      cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
    }

    sidebar.addEventListener("mousemove", handleMouseMove)
    sidebar.addEventListener("mouseleave", handleMouseLeave)

    return () => {
      sidebar.removeEventListener("mousemove", handleMouseMove)
      sidebar.removeEventListener("mouseleave", handleMouseLeave)
      spotlight.style.opacity = "0"
      const cards = sidebar.querySelectorAll<HTMLElement>(".chat-sidebar-card")
      cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
    }
  }, [spotlightActive])

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
  const panelClass = "bg-transparent border-transparent shadow-none rounded-none backdrop-blur-none"
  const subPanelClass = isLight
    ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md"
  const spotlightCardClass = "chat-sidebar-card home-spotlight-card home-border-glow sidebar-spotlight-card"

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
        `${spotlightCardClass} group flex items-center gap-2 px-2.5 py-2 cursor-pointer mb-2 transition-all duration-150`,
        subPanelClass,
        convo.id === activeId
          ? "bg-s-10 border-s-10 text-s-90 sidebar-selected-flat"
          : "text-s-50",
      )}
      onClick={() => onSelect(convo.id)}
    >
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
            <p className="text-sm truncate text-s-80">{convo.title}</p>
            <p className="text-xs text-s-40">{formatDate(convo.updatedAt)}</p>
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
          >
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                beginRename(convo)
              }}
              className="rounded-md text-s-70 data-highlighted:text-s-70 data-highlighted:bg-transparent"
            >
              <Pencil className="w-4 h-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onArchive?.(convo.id, !convo.archived)
              }}
              className="rounded-md text-s-70 data-highlighted:text-s-70 data-highlighted:bg-transparent"
            >
              <Archive className="w-4 h-4" />
              {convo.archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onPin?.(convo.id, !convo.pinned)
              }}
              className="rounded-md text-s-70 data-highlighted:text-s-70 data-highlighted:bg-transparent"
            >
              <Pin className="w-4 h-4" />
              {convo.pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onDelete(convo.id)
              }}
              className="rounded-md text-red-400 data-highlighted:text-red-400 data-highlighted:bg-transparent"
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
        ref={sidebarRef}
        className={cn(
          "home-spotlight-shell fixed left-0 top-0 bottom-0 z-30 m-0 w-72 flex flex-col overflow-hidden",
          panelClass,
        )}
      >
        <div ref={spotlightRef} className="home-global-spotlight" />
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/home")}
              onMouseEnter={() => setOrbHovered(true)}
              onMouseLeave={() => setOrbHovered(false)}
              className="group relative h-10 w-10 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-110"
              aria-label="Go to home"
            >
              {userSettings ? (
                <NovaOrbIndicator
                  palette={orbPalette}
                  size={26}
                  animated={false}
                  className="transition-all duration-200"
                  style={{ filter: orbHovered ? orbHoverFilter : "none" }}
                />
              ) : (
                <div className="h-6.5 w-6.5 rounded-full" />
              )}
            </button>
            <div>
              <h1 className="text-s-90 text-2xl font-semibold tracking-tight">NovaOS</h1>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-[10px] text-accent font-mono">V.0 Beta</p>
                {showStatus && (
                  <div className={cn(`${spotlightCardClass} inline-flex items-center gap-2 rounded-full px-2.5 py-1`, subPanelClass)}>
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

        {showNewChatButton && (
          <div className="px-4 py-2">
            <button
              onClick={onNew}
              className={cn(
                "appearance-none w-full h-11 px-4 flex items-center justify-start gap-2 text-s-80 text-sm font-medium transition-all duration-150",
                spotlightCardClass,
                subPanelClass,
              )}
            >
              <Plus className="w-4 h-4" />
              New chat
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto py-2 px-4">
          {activeConversations.length === 0 && (
            <p className="text-xs text-s-30 text-center py-8">No conversations yet</p>
          )}

          {activeConversations.map(renderConversationRow)}

          <div className="mt-2">
            <button
              onClick={() => setArchivedOpen((v) => !v)}
              className={cn(
                "appearance-none w-full h-10 px-3 flex items-center justify-between text-[12px] uppercase tracking-[0.15em] text-s-40 transition-all outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
                spotlightCardClass,
                subPanelClass,
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

        <div className="px-4 py-3">
          <div
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 transition-colors",
              spotlightCardClass,
              subPanelClass,
            )}
          >
            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden", "border border-white/15 bg-white/5")}>
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
                    spotlightCardClass,
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
                    spotlightCardClass,
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
