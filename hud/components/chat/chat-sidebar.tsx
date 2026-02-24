"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
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
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderArchive,
} from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { NOVA_VERSION } from "@/lib/meta/version"
import type { Conversation } from "@/lib/chat/conversations"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type UserSettings } from "@/lib/settings/userSettings"
import { INTEGRATIONS_UPDATED_EVENT, loadIntegrationsSettings } from "@/lib/integrations/client-store"
import { formatCompactModelLabelFromIntegrations, formatCompactModelLabelFromRunningLabel } from "@/lib/integrations/model-label"
import type { NovaState } from "@/lib/chat/hooks/useNovaState"
import { useTheme } from "@/lib/context/theme-context"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { SettingsModal } from "@/components/settings/settings-modal"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { NovaOrbIndicator } from "./nova-orb-indicator"

interface ChatSidebarProps {
  conversations: Conversation[]
  activeId: string | null
  isOpen: boolean
  embedded?: boolean
  showShellHeader?: boolean
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
  runningNowLabel?: string
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
  embedded = false,
  showShellHeader = true,
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
  runningNowLabel,
}: ChatSidebarProps) {
  const sidebarRef = useRef<HTMLDivElement | null>(null)
  const spotlightRef = useRef<HTMLDivElement | null>(null)
  const router = useRouter()
  const pathname = usePathname()
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fallbackModelLabel, setFallbackModelLabel] = useState("Model Unset")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingTitle, setRenamingTitle] = useState("")
  const [orbHovered, setOrbHovered] = useState(false)
  const [chatsOpen, setChatsOpen] = useState(true)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const { theme } = useTheme()
  const pageActive = usePageActive()
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

        // Avoid appending ephemeral nodes into React-managed card trees.
        // Spotlight intensity is preserved via CSS vars only.
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
    const refresh = () => setUserSettings(loadUserSettings())
    refresh()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [])

  useEffect(() => {
    const refreshModelLabel = () => {
      const integrations = loadIntegrationsSettings()
      setFallbackModelLabel(formatCompactModelLabelFromIntegrations(integrations))
    }
    refreshModelLabel()
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, refreshModelLabel as EventListener)
    return () => window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, refreshModelLabel as EventListener)
  }, [])

  useEffect(() => {
    if (!settingsOpen) {
      setUserSettings(loadUserSettings()) // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [settingsOpen])

  if (!isOpen) return null

  const profile = userSettings?.profile
  const activeConversations = conversations.filter((c) => !c.archived)
  const archivedConversations = conversations.filter((c) => c.archived)
  const quickActionConversations = activeConversations.filter((c) => c.pinned).slice(0, 3)
  const panelClass = embedded
    ? (isLight
        ? "rounded-2xl border border-[#d9e0ea] bg-white shadow-none"
        : "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl")
    : "bg-transparent border-transparent shadow-none rounded-none backdrop-blur-none"
  const subPanelClass = isLight
    ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md"
  const spotlightCardClass = "chat-sidebar-card home-spotlight-card home-border-glow"
  const noGlowCardClass = "chat-sidebar-card home-spotlight-card"

  const presence = getNovaPresence({ agentConnected, novaState })
  const hubLabel = pathname?.startsWith("/chat")
    ? "Communications Hub"
    : pathname?.startsWith("/home")
    ? "Home Page"
    : pathname?.startsWith("/missions")
    ? "Missions & Automations Hub"
    : pathname?.startsWith("/integrations")
    ? "Integrations Hub"
    : pathname?.startsWith("/analytics")
    ? "Analytics Hub"
    : pathname?.startsWith("/history")
    ? "Communications Hub"
    : "Home Page"
  const compactModelLabel = formatCompactModelLabelFromRunningLabel(runningNowLabel) || fallbackModelLabel
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
              className={cn(
                "opacity-0 group-hover:opacity-100 h-7 w-7 flex items-center justify-center transition-all duration-150 text-s-40 hover:text-accent outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
                "home-spotlight-card home-border-glow home-spotlight-card--hover rounded-md",
                isLight ? "hover:bg-[#eef3fb]" : "hover:bg-white/8",
              )}
              aria-label="Conversation options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className={cn(
              "rounded-xl p-1.5 min-w-[180px] backdrop-blur-xl",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
              "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
              "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
              isLight
                ? "!border-[#d5dce8] !bg-[#f4f7fd]/95 !shadow-[0_10px_30px_-12px_rgba(15,23,42,0.25)]"
                : "!border-white/10 !bg-black/25 !shadow-[0_14px_34px_-14px_rgba(0,0,0,0.55)]",
            )}
          >
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                beginRename(convo)
              }}
              className={cn(
                "rounded-lg px-3 py-2.5 text-sm gap-3 cursor-pointer transition-all duration-150",
                isLight
                  ? "text-s-70 data-[highlighted]:bg-[#eef3fb] data-[highlighted]:text-s-90"
                  : "text-s-60 data-[highlighted]:bg-white/8 data-[highlighted]:text-s-90",
              )}
            >
              <Pencil className="w-4 h-4 opacity-70" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onArchive?.(convo.id, !convo.archived)
              }}
              className={cn(
                "rounded-lg px-3 py-2.5 text-sm gap-3 cursor-pointer transition-all duration-150",
                isLight
                  ? "text-s-70 data-[highlighted]:bg-[#eef3fb] data-[highlighted]:text-s-90"
                  : "text-s-60 data-[highlighted]:bg-white/8 data-[highlighted]:text-s-90",
              )}
            >
              <Archive className="w-4 h-4 opacity-70" />
              {convo.archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onPin?.(convo.id, !convo.pinned)
              }}
              className={cn(
                "rounded-lg px-3 py-2.5 text-sm gap-3 cursor-pointer transition-all duration-150",
                isLight
                  ? "text-s-70 data-[highlighted]:bg-[#eef3fb] data-[highlighted]:text-s-90"
                  : "text-s-60 data-[highlighted]:bg-white/8 data-[highlighted]:text-s-90",
              )}
            >
              <Pin className="w-4 h-4 opacity-70" />
              {convo.pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            <div className={cn("my-1.5 h-px", isLight ? "bg-[#e5e9f0]" : "bg-white/[0.06]")} />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onDelete(convo.id)
              }}
              className={cn(
                "rounded-lg px-3 py-2.5 text-sm gap-3 cursor-pointer transition-all duration-150",
                "text-red-400 data-[highlighted]:bg-red-500/10 data-[highlighted]:text-red-400",
              )}
            >
              <Trash2 className="w-4 h-4" />
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
          embedded
            ? "home-spotlight-shell relative z-10 h-full w-full min-h-0 flex flex-col overflow-hidden"
            : "home-spotlight-shell fixed left-0 top-0 bottom-0 z-30 m-0 w-72 flex flex-col overflow-hidden",
          panelClass,
        )}
        style={embedded && !isLight ? { boxShadow: "0 20px 60px -35px rgba(var(--accent-rgb), 0.35)" } : undefined}
      >
        <div ref={spotlightRef} className="home-global-spotlight" />
        {showShellHeader && (
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/home")}
                onMouseEnter={() => setOrbHovered(true)}
                onMouseLeave={() => setOrbHovered(false)}
                className="group relative h-11 w-11 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-110"
                aria-label="Go to home"
              >
                {userSettings ? (
                  <NovaOrbIndicator
                    palette={orbPalette}
                    size={30}
                    animated={pageActive}
                    className="transition-all duration-200"
                    style={{ filter: orbHovered ? orbHoverFilter : "none" }}
                  />
                ) : (
                  <div className="h-6.5 w-6.5 rounded-full" />
                )}
              </button>
              <div className="min-w-0">
                <div className="flex flex-col leading-tight">
                  <div className="flex items-baseline gap-3">
                    <h1 className="text-s-90 text-[30px] leading-none font-semibold tracking-tight">NovaOS</h1>
                    <p className="text-[11px] text-accent font-mono">{NOVA_VERSION}</p>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3">
                    <div className="inline-flex items-center gap-1.5">
                      <span className={cn("h-2.5 w-2.5 rounded-full animate-pulse", presence.dotClassName)} aria-hidden="true" />
                      <span className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", presence.textClassName)}>
                        {presence.label}
                      </span>
                    </div>
                    <p className="text-[13px] text-s-50 whitespace-nowrap">{hubLabel}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showNewChatButton && (
          <div className="px-4 pt-4 pb-2">
            <button
              onClick={onNew}
              className={cn(
                "group appearance-none w-full h-11 px-4 rounded-xl border border-transparent inline-flex items-center justify-center gap-2 text-sm font-semibold transition-all duration-150",
                spotlightCardClass,
                subPanelClass,
                "text-s-90 hover:text-accent",
              )}
            >
              <Plus className="w-4 h-4 transition-all group-hover:brightness-125" />
              New Conversation
            </button>
          </div>
        )}

        <div className="px-4 py-2">
          <div className={cn("px-2.5 inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] font-semibold", isLight ? "text-s-50" : "text-slate-400")}>
            <Pin className="h-3.5 w-3.5" />
            <span>Quick Actions</span>
          </div>
          <div className="mt-2 space-y-2">
            {quickActionConversations.length === 0 ? (
              <p className={cn("px-2.5 text-xs", isLight ? "text-s-40" : "text-slate-500")}>Pin chats to show quick actions.</p>
            ) : (
              quickActionConversations.map((convo) => (
                <button
                  key={`quick-${convo.id}`}
                  onClick={() => onSelect(convo.id)}
                  className={cn(
                    "w-full px-2.5 py-2 rounded-lg border inline-flex items-center justify-start gap-2 text-sm transition-colors text-left",
                    spotlightCardClass,
                    convo.id === activeId ? "bg-s-10 border-s-10 text-s-90 sidebar-selected-flat" : "text-s-50",
                    isLight
                      ? "border-[#d5dce8] bg-[#f4f7fd]"
                      : "border-white/10 bg-black/25 text-slate-100 hover:bg-white/8",
                  )}
                >
                  <Pin className="h-4 w-4 shrink-0 text-s-50" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-s-80">{convo.title}</span>
                    <span className="block text-xs text-s-40">{formatDate(convo.updatedAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {runningNowLabel && (
          <div className="px-4 py-2">
            <div className={cn("px-3 py-2 text-xs", spotlightCardClass, subPanelClass)}>
              <p className="uppercase tracking-[0.14em] text-[11px] text-s-50">Running Now</p>
              <p className="mt-1 truncate font-medium text-s-90" title={runningNowLabel}>
                {runningNowLabel}
              </p>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto py-2 px-4">
          <div className="mb-2">
            <button
              type="button"
              onClick={() => setChatsOpen((v) => !v)}
              className={cn(
                "w-full mb-2 h-8 px-2.5 rounded-lg inline-flex items-center justify-between text-xs uppercase tracking-[0.14em] transition-colors",
                "chat-sidebar-card home-spotlight-card",
                isLight ? "text-s-50 hover:bg-[#eef3fb]" : "text-slate-400 hover:bg-white/6",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <FolderOpen className="h-3.5 w-3.5" />
                Chat History
              </span>
              {chatsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {chatsOpen && (
              <>
                {activeConversations.length === 0 ? (
                  <p className={cn("text-xs px-2 py-2", isLight ? "text-s-40" : "text-slate-500")}>No chats yet.</p>
                ) : (
                  activeConversations.map(renderConversationRow)
                )}
              </>
            )}
          </div>

          <div className="mb-2">
            <button
              type="button"
              onClick={() => setArchivedOpen((v) => !v)}
              className={cn(
                "w-full mb-2 h-8 px-2.5 rounded-lg inline-flex items-center justify-between text-xs uppercase tracking-[0.14em] transition-colors",
                "chat-sidebar-card home-spotlight-card",
                isLight ? "text-s-50 hover:bg-[#eef3fb]" : "text-slate-400 hover:bg-white/6",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <FolderArchive className="h-3.5 w-3.5" />
                Archived Chats
              </span>
              {archivedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {archivedOpen && (
              <>
                {archivedConversations.length === 0 ? (
                  <p className={cn("text-xs px-2 py-2", isLight ? "text-s-40" : "text-slate-500")}>No archived chats.</p>
                ) : (
                  archivedConversations.map(renderConversationRow)
                )}
              </>
            )}
          </div>
        </div>

        <div className="px-4 py-3">
          <div
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 transition-colors",
              noGlowCardClass,
              subPanelClass,
            )}
          >
            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden", "border border-white/15 bg-white/5")}>
              {profile?.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
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
                {compactModelLabel}
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {onReplayBoot && (
                <button
                  onClick={onReplayBoot}
                  className={cn(
                    "appearance-none h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                    noGlowCardClass,
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
