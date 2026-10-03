"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Plus,
  Trash2,
  Settings,
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
import { INTEGRATIONS_UPDATED_EVENT, loadIntegrationsSettings } from "@/lib/integrations/store/client-store"
import { formatCompactModelLabelFromIntegrations, formatCompactModelLabelFromRunningLabel } from "@/lib/integrations/llm/model-label"
import type { NovaState } from "@/lib/chat/hooks/useNovaState"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { SettingsModal } from "@/components/settings/settings-modal"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { NovaCatPortrait, resolveNovaCatState } from "./nova-cat-portrait"

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

function formatHeaderDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(value)
}

function formatHeaderTime(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value)
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
  const [headerNow, setHeaderNow] = useState(() => new Date())
  const [chatsOpen, setChatsOpen] = useState(true)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const pageActive = usePageActive()
  const orbPalette = ORB_COLORS[userSettings?.app.orbColor ?? "violet"]
  const spotlightEnabled = userSettings?.app.spotlightEnabled ?? true
  const spotlightActive = spotlightEnabled && isOpen

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

  useEffect(() => {
    const tick = () => setHeaderNow(new Date())
    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  if (!isOpen) return null

  const profile = userSettings?.profile
  const activeConversations = conversations.filter((c) => !c.archived)
  const archivedConversations = conversations.filter((c) => c.archived)
  const quickActionConversations = activeConversations.filter((c) => c.pinned).slice(0, 3)
  const panelClass = embedded ? "pixel-frame pc-side pc-side--embedded" : "pixel-frame pc-side"

  const presence = getNovaPresence({ agentConnected, novaState })
  const headerDateLabel = formatHeaderDate(headerNow)
  const headerTimeLabel = formatHeaderTime(headerNow)
  const hubLabel = pathname?.startsWith("/chat")
    ? "Communications Hub"
    : pathname?.startsWith("/home")
    ? "Home Page"
    : pathname?.startsWith("/missions")
    ? "Missions & Automations Hub"
    : pathname?.startsWith("/integrations")
    ? "Integrations Hub"
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
      className="pixel-card pc-convo group"
      data-active={convo.id === activeId ? "true" : undefined}
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
            className="pc-rename w-full h-7 px-2 text-sm outline-none"
          />
        ) : (
          <>
            <p className="pc-convo-title text-sm truncate">{convo.title}</p>
            <p className="pc-convo-date text-xs">{formatDate(convo.updatedAt)}</p>
          </>
        )}
      </div>
      {renamingId !== convo.id && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="pixel-btn pixel-btn--ghost pc-icon-btn pc-convo-options outline-none focus:outline-none focus-visible:outline-none"
              aria-label="Conversation options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="pc-menu">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                beginRename(convo)
              }}
              className="pc-menu-item"
            >
              <Pencil className="w-4 h-4 opacity-70" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onArchive?.(convo.id, !convo.archived)
              }}
              className="pc-menu-item"
            >
              <Archive className="w-4 h-4 opacity-70" />
              {convo.archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onPin?.(convo.id, !convo.pinned)
              }}
              className="pc-menu-item"
            >
              <Pin className="w-4 h-4 opacity-70" />
              {convo.pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            <div className="pc-menu-sep" />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onDelete(convo.id)
              }}
              className="pc-menu-item pc-menu-item--danger"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )

  const catState = resolveNovaCatState({ agentConnected, novaState })

  return (
    <>
      <div
        ref={sidebarRef}
        className={cn(
          "pixel-ui pixel-chat-side home-spotlight-shell",
          embedded
            ? "relative z-10 h-full w-full min-h-0 flex flex-col overflow-hidden"
            : "fixed left-0 top-0 bottom-0 z-30 m-0 w-72 flex flex-col overflow-hidden",
          panelClass,
        )}
      >
        <div ref={spotlightRef} className="home-global-spotlight" />
        {showShellHeader && (
          <div className="pixel-card pc-side-head">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/home")}
                className="pixel-card pc-home-btn"
                aria-label="Go to home"
              >
                {userSettings ? (
                  <NovaCatPortrait state={catState} scale={2} accent={orbPalette.circle1} paused={!pageActive} />
                ) : (
                  <div className="h-6.5 w-6.5" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col leading-tight">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h1 className="pc-wordmark">U.B Agents</h1>
                    <p className="pc-version">{NOVA_VERSION}</p>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <div className="inline-flex items-center gap-1.5">
                      <span className={cn("pc-presence-dot pc-blink", presence.dotClassName)} aria-hidden="true" />
                      <span className={cn("pc-presence-label", presence.textClassName)}>
                        {presence.label}
                      </span>
                    </div>
                    <div className="pc-clock">
                      <span className="pc-clock-date">{headerDateLabel}</span>
                      <span className="pc-clock-time">{headerTimeLabel}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <p className="pc-hub">{hubLabel}</p>
          </div>
        )}

        {showNewChatButton && (
          <div className="px-3 pt-3 pb-1">
            <button onClick={onNew} className="pixel-btn pixel-btn--teal pc-btn--block group">
              <Plus className="w-4 h-4" />
              New Conversation
            </button>
          </div>
        )}

        <div className="px-3 py-2">
          <div className="pc-section-label">
            <Pin className="h-3.5 w-3.5" />
            <span>Quick Actions</span>
          </div>
          <div className="mt-2 space-y-2">
            {quickActionConversations.length === 0 ? (
              <p className="pc-hint">Pin chats to show quick actions.</p>
            ) : (
              quickActionConversations.map((convo) => (
                <button
                  key={`quick-${convo.id}`}
                  onClick={() => onSelect(convo.id)}
                  className="pixel-card pc-convo pc-convo--quick text-left"
                  data-active={convo.id === activeId ? "true" : undefined}
                >
                  <Pin className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="pc-convo-title block truncate text-sm">{convo.title}</span>
                    <span className="pc-convo-date block text-xs">{formatDate(convo.updatedAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {runningNowLabel && (
          <div className="px-3 py-2">
            <div className="pixel-card pc-card text-xs">
              <p className="pc-card-label">Running Now</p>
              <p className="mt-1 truncate font-medium" title={runningNowLabel}>
                {runningNowLabel}
              </p>
            </div>
          </div>
        )}

        <div className="pc-side-scroll flex-1 min-h-0 overflow-y-auto py-2 px-3">
          <div className="mb-2">
            <button
              type="button"
              onClick={() => setChatsOpen((v) => !v)}
              className="pixel-btn pixel-btn--ghost pc-fold"
              aria-expanded={chatsOpen}
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
                  <p className="pc-hint">No chats yet.</p>
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
              className="pixel-btn pixel-btn--ghost pc-fold"
              aria-expanded={archivedOpen}
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
                  <p className="pc-hint">No archived chats.</p>
                ) : (
                  archivedConversations.map(renderConversationRow)
                )}
              </>
            )}
          </div>
        </div>

        <div className="px-3 py-3">
          <div className="pixel-card pc-profile">
            <div className="pc-profile-avatar">
              {profile?.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-4 h-4" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="pc-profile-name truncate">{profile?.name || "User"}</p>
              <p className="pc-profile-model truncate">{compactModelLabel}</p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => setSettingsOpen(true)} className="pixel-btn pixel-btn--ghost pc-icon-btn group/gear" aria-label="Settings">
                <Settings className="w-4 h-4 group-hover/gear:rotate-90 transition-transform duration-200" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
