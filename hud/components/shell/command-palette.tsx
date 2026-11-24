"use client"

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import {
  CornerDownLeft,
  MessageSquare,
  MessageSquarePlus,
  Moon,
  PanelLeft,
  Rocket,
  Search,
  Settings,
  Sun,
  type LucideIcon,
} from "lucide-react"

import { Kbd, Portal, useModalBehavior } from "@/components/ui"
import { SETTINGS_SECTIONS } from "@/components/settings/settings-nav"
import {
  EXTRA_DESTINATIONS,
  NAV_ITEMS,
  NEW_CHAT_HREF,
  NEW_DEPLOYMENT_HREF,
  type NavItem,
} from "@/components/shell/nav-config"
import { openSettings } from "@/components/shell/shell-events"
import { getActiveUserId } from "@/lib/auth/active-user"
import { loadConversations, setActiveId, type Conversation } from "@/lib/chat/conversations"
import { useTheme } from "@/lib/context/theme-context"
import { readShellUiCache } from "@/lib/settings/shell-ui-cache"
import { cn } from "@/lib/shared/utils"

type GroupName = "Recent chats" | "Go to" | "Actions" | "Settings"
const GROUP_ORDER: GroupName[] = ["Recent chats", "Go to", "Actions", "Settings"]
const RECENT_LIMIT_IDLE = 5
const RECENT_LIMIT_QUERY = 8

interface PaletteItem {
  id: string
  group: GroupName
  label: string
  icon: LucideIcon
  keywords?: string
  /** Right-aligned meta (a shortcut or a date). */
  hint?: string
  /** Only listed when the user has typed something. */
  searchOnly?: boolean
  run: () => void
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  polymarketConnected: boolean
  onToggleSidebar: () => void
}

/**
 * Fuzzy score: contiguous matches beat scattered ones, matches at a word start beat mid-word ones.
 * Returns -1 when `query` is not a subsequence of `text`.
 */
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  const direct = t.indexOf(q)
  // Ties between direct matches go to the shorter text ("Settings" before "Settings: Profile").
  if (direct >= 0) return 1000 - direct * 2 - t.length * 0.5 + (direct === 0 || /\s/.test(t[direct - 1] ?? "") ? 200 : 0)
  let score = 0
  let ti = 0
  let previous = -2
  for (const char of q) {
    const found = t.indexOf(char, ti)
    if (found < 0) return -1
    score += found === previous + 1 ? 12 : 4
    if (found === 0 || /[\s/-]/.test(t[found - 1] ?? "")) score += 8
    previous = found
    ti = found + 1
  }
  return score - (t.length - q.length) * 0.1
}

function itemScore(query: string, item: PaletteItem): number {
  const label = fuzzyScore(query, item.label)
  const keywords = item.keywords ? fuzzyScore(query, item.keywords) : -1
  return Math.max(label, keywords >= 0 ? keywords * 0.6 : -1)
}

function recentConversations(): Conversation[] {
  if (!getActiveUserId()) return []
  const all = readShellUiCache().conversations ?? loadConversations()
  return all
    .filter((conversation) => !conversation.archived && conversation.messages.length > 0)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })

export function CommandPalette({ open, onOpenChange, polymarketConnected, onToggleSidebar }: CommandPaletteProps) {
  const router = useRouter()
  const { theme, setThemeSetting } = useTheme()
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const close = () => onOpenChange(false)
  useModalBehavior(open, panelRef, close, inputRef)

  // Each opening starts empty, with the conversation list read fresh from the local cache.
  const [openedFor, setOpenedFor] = useState(open)
  if (openedFor !== open) {
    setOpenedFor(open)
    if (open) {
      setQuery("")
      setActiveIndex(0)
    }
  }
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable on the client
    setConversations(recentConversations())
  }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    const go = (href: string) => () => router.push(href)
    const navItem = (item: NavItem): PaletteItem => ({
      id: `nav:${item.href}`,
      group: "Go to",
      label: item.label,
      icon: item.icon,
      keywords: item.keywords,
      run: go(item.href),
    })
    const chats: PaletteItem[] = conversations.map((conversation) => ({
      id: `chat:${conversation.id}`,
      group: "Recent chats",
      label: conversation.title || "Untitled chat",
      icon: MessageSquare,
      hint: Number.isFinite(Date.parse(conversation.updatedAt)) ? shortDate.format(new Date(conversation.updatedAt)) : undefined,
      run: () => {
        setActiveId(conversation.id)
        router.push(`/chat?thread=${encodeURIComponent(conversation.id)}`)
      },
    }))
    return [
      ...chats,
      ...NAV_ITEMS.filter((item) => item.requires !== "polymarket" || polymarketConnected).map(navItem),
      ...EXTRA_DESTINATIONS.map((item) => ({ ...navItem(item), searchOnly: true })),
      { id: "action:new-chat", group: "Actions", label: "New chat", icon: MessageSquarePlus, keywords: "start conversation", run: go(NEW_CHAT_HREF) },
      { id: "action:new-deployment", group: "Actions", label: "New deployment", icon: Rocket, keywords: "create task automation deploy", run: go(NEW_DEPLOYMENT_HREF) },
      { id: "action:settings", group: "Actions", label: "Settings", icon: Settings, keywords: "open preferences options", hint: "Ctrl ,", run: () => openSettings() },
      {
        id: "action:theme",
        group: "Actions",
        label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        icon: theme === "dark" ? Sun : Moon,
        keywords: "theme appearance dark light mode",
        run: () => setThemeSetting(theme === "dark" ? "light" : "dark"),
      },
      { id: "action:sidebar", group: "Actions", label: "Toggle sidebar", icon: PanelLeft, keywords: "collapse expand navigation", hint: "Ctrl B", run: onToggleSidebar },
      ...SETTINGS_SECTIONS.map((section) => ({
        id: `settings:${section.id}`,
        group: "Settings" as const,
        label: `Settings: ${section.label}`,
        icon: section.icon,
        keywords: section.label,
        searchOnly: true,
        run: () => openSettings(section.id),
      })),
    ]
  }, [conversations, onToggleSidebar, polymarketConnected, router, setThemeSetting, theme])

  const results = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      let chats = 0
      return items.filter((item) => {
        if (item.searchOnly) return false
        if (item.group !== "Recent chats") return true
        chats += 1
        return chats <= RECENT_LIMIT_IDLE
      })
    }
    const scored = items
      .map((item) => ({ item, score: itemScore(trimmed, item) }))
      .filter((entry) => entry.score >= 0)
    const grouped = GROUP_ORDER.flatMap((group) => {
      const inGroup = scored.filter((entry) => entry.item.group === group).sort((a, b) => b.score - a.score)
      return (group === "Recent chats" ? inGroup.slice(0, RECENT_LIMIT_QUERY) : inGroup).map((entry) => entry.item)
    })
    // The group holding the best match goes first so Enter runs what the user most likely meant.
    const best = scored.reduce<{ item: PaletteItem; score: number } | null>((top, entry) => (!top || entry.score > top.score ? entry : top), null)
    if (!best) return grouped
    return [...grouped.filter((item) => item.group === best.item.group), ...grouped.filter((item) => item.group !== best.item.group)]
  }, [items, query])

  const clampedIndex = Math.min(activeIndex, Math.max(0, results.length - 1))
  const activeItem = results[clampedIndex]
  const optionId = (index: number) => `${listboxId}-option-${index}`

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${clampedIndex}"]`)?.scrollIntoView({ block: "nearest" })
  }, [clampedIndex, open])

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return
    close()
    item.run()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((clampedIndex + 1) % results.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((clampedIndex - 1 + results.length) % results.length)
    } else if (event.key === "Home" && event.ctrlKey) {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === "End" && event.ctrlKey) {
      event.preventDefault()
      setActiveIndex(results.length - 1)
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault()
      runItem(activeItem)
    }
  }

  if (!open) return null

  const sections: Array<{ group: GroupName; entries: Array<{ item: PaletteItem; index: number }> }> = []
  results.forEach((item, index) => {
    const last = sections[sections.length - 1]
    if (last && last.group === item.group) last.entries.push({ item, index })
    else sections.push({ group: item.group, entries: [{ item, index }] })
  })

  return (
    <Portal>
      <div className="fixed inset-0 z-200 flex items-start justify-center p-4 pt-[14vh]">
        <div aria-hidden className="fixed inset-0 bg-scrim animate-overlay-in" onMouseDown={close} />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="relative flex w-full max-w-[38rem] flex-col overflow-hidden rounded-xl border border-border-strong bg-surface-2 shadow-overlay animate-pop-in"
        >
          <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-faint" aria-hidden />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded="true"
              aria-controls={results.length > 0 ? listboxId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={activeItem ? optionId(clampedIndex) : undefined}
              aria-label="Search pages, chats and actions"
              placeholder="Search pages, chats and actions"
              spellCheck={false}
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={onKeyDown}
              className="h-full min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-faint focus-visible:outline-none"
            />
            <Kbd>Esc</Kbd>
          </div>

          <div ref={listRef} className="max-h-[min(26rem,56vh)] overflow-y-auto p-1.5">
            {results.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <p className="text-sm text-fg">No matches for “{query.trim()}”</p>
                <p className="mt-1 text-xs text-muted">Try a page name such as Missions, an action such as New chat, or a chat title.</p>
              </div>
            ) : (
              <div id={listboxId} role="listbox" aria-label="Results">
                {sections.map((section, sectionIndex) => {
                  const headingId = `${listboxId}-group-${sectionIndex}`
                  return (
                    <div key={section.group} role="group" aria-labelledby={headingId}>
                      <p id={headingId} className={cn("px-2.5 pb-1 text-xs text-faint", sectionIndex === 0 ? "pt-1.5" : "pt-3")}>
                        {section.group}
                      </p>
                      {section.entries.map(({ item, index }) => {
                        const Icon = item.icon
                        const selected = index === clampedIndex
                        return (
                          <div
                            key={item.id}
                            id={optionId(index)}
                            role="option"
                            aria-selected={selected}
                            data-index={index}
                            onMouseMove={() => {
                              if (!selected) setActiveIndex(index)
                            }}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => runItem(item)}
                            className={cn(
                              "flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm select-none",
                              selected ? "bg-active text-fg" : "text-muted",
                            )}
                          >
                            <Icon className={cn("size-4 shrink-0", selected ? "text-fg" : "text-faint")} aria-hidden />
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {item.hint ? <span className="shrink-0 font-mono text-2xs text-faint tabular-nums">{item.hint}</span> : null}
                            {selected ? <CornerDownLeft className="size-3.5 shrink-0 text-faint" aria-hidden /> : null}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex h-9 shrink-0 items-center gap-4 border-t border-border px-4 text-xs text-faint">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              to move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>Enter</Kbd>
              to open
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
              to toggle
            </span>
          </div>
        </div>
      </div>
    </Portal>
  )
}
