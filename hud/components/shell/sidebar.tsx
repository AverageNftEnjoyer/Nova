"use client"

import Link from "next/link"
import { ChevronsUpDown, Monitor, Moon, Settings, Sun } from "lucide-react"

import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui"
import { NAV_GROUPS, type NavItem } from "@/components/shell/nav-config"
import { openSettings } from "@/components/shell/shell-events"
import type { RunCounts } from "@/components/shell/use-run-counts"
import { initialsFor, type ShellProfile } from "@/components/shell/use-shell-data"
import { useTheme } from "@/lib/context/theme-context"
import { NOVA_VERSION } from "@/lib/meta/version"
import { cn } from "@/lib/shared/utils"

export interface SidebarProps {
  collapsed: boolean
  /** Drawn over the content (narrow window); gets the overlay shadow. */
  floating: boolean
  activeId: NavItem["id"] | null
  runCounts: RunCounts | null
  polymarketConnected: boolean
  profile: ShellProfile | null
  onNavigate: () => void
}

/** Nova's mark: a four-point star (a nova), drawn in the current text colour. */
export function NovaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn("size-4 shrink-0", className)}>
      <path fill="currentColor" d="M8 0.5 9.6 6.4 15.5 8 9.6 9.6 8 15.5 6.4 9.6 0.5 8 6.4 6.4Z" />
    </svg>
  )
}

function runsBadge(counts: RunCounts | null): { tone: "warning" | "accent"; value: number; label: string } | null {
  if (!counts) return null
  if (counts.awaitingApproval > 0) {
    const n = counts.awaitingApproval
    return { tone: "warning", value: n, label: `${n} ${n === 1 ? "run is" : "runs are"} waiting for approval` }
  }
  if (counts.running > 0) {
    const n = counts.running
    return { tone: "accent", value: n, label: `${n} ${n === 1 ? "run" : "runs"} in progress` }
  }
  return null
}

function NavLink({
  item,
  active,
  collapsed,
  badge,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  badge: ReturnType<typeof runsBadge>
  onNavigate: () => void
}) {
  const Icon = item.icon
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? (badge ? `${item.label}, ${badge.label}` : item.label) : undefined}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-md text-sm transition-colors duration-150 ease-out",
        collapsed ? "w-10 justify-center" : "px-2.5",
        active ? "bg-active font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      {active ? <span aria-hidden className="absolute top-1.5 bottom-1.5 -left-2 w-0.5 rounded-r-sm bg-accent" /> : null}
      <span className="relative flex">
        <Icon className={cn("size-4", active ? "text-fg" : "text-muted group-hover:text-fg")} aria-hidden />
        {collapsed && badge ? (
          <span
            aria-hidden
            className={cn(
              "absolute -top-1 -right-1 size-2 rounded-full ring-2 ring-canvas",
              badge.tone === "warning" ? "bg-warning" : "bg-accent",
            )}
          />
        ) : null}
      </span>
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {badge ? (
            <Badge tone={badge.tone} className="tabular-nums" title={badge.label} aria-label={badge.label}>
              {badge.value}
            </Badge>
          ) : null}
        </>
      )}
    </Link>
  )
  return collapsed ? (
    <Tooltip content={badge ? `${item.label}: ${badge.label}` : item.label} side="right" delay={200}>
      {link}
    </Tooltip>
  ) : (
    link
  )
}

function ProfileMenu({ collapsed, profile }: { collapsed: boolean; profile: ShellProfile | null }) {
  const { themeSetting, setThemeSetting } = useTheme()
  const name = profile?.name || ""
  const initials = initialsFor(name)
  const avatar = (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-3 text-2xs font-medium text-fg"
    >
      {profile?.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element -- user avatar can be a data URL
        <img src={profile.avatar} alt="" className="size-full object-cover" />
      ) : (
        initials || <span className="size-2 rounded-full bg-faint" />
      )}
    </span>
  )

  return (
    <DropdownMenu>
      <Tooltip content="Profile and settings" side="right" delay={200} disabled={!collapsed}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={name ? `${name}: profile and settings` : "Profile and settings"}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-md text-muted transition-colors duration-150 ease-out hover:bg-hover hover:text-fg data-[state=open]:bg-active",
              collapsed ? "w-10 justify-center" : "w-full px-2",
            )}
          >
            {avatar}
            {collapsed ? null : (
              <>
                <span className="min-w-0 flex-1 truncate text-left text-sm text-fg">{name || "Your profile"}</span>
                <ChevronsUpDown className="size-3.5 text-faint" aria-hidden />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side={collapsed ? "right" : "top"} align={collapsed ? "end" : "start"} className="w-60">
        <div className="flex items-center gap-2.5 px-2 py-2">
          {avatar}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{name || "Your profile"}</p>
            <p className="text-xs text-muted">Local profile on this computer</p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openSettings()}>
          <Settings />
          Settings
          <DropdownMenuShortcut>Ctrl ,</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={themeSetting}
          onValueChange={(value) => {
            if (value === "dark" || value === "light" || value === "system") setThemeSetting(value)
          }}
        >
          <DropdownMenuRadioItem value="dark" onSelect={(event) => event.preventDefault()}>
            <Moon />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light" onSelect={(event) => event.preventDefault()}>
            <Sun />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" onSelect={(event) => event.preventDefault()}>
            <Monitor />
            Match system
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p className="px-2 pt-1 pb-1.5 font-mono text-2xs text-faint">{NOVA_VERSION}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Sidebar({ collapsed, floating, activeId, runCounts, polymarketConnected, profile, onNavigate }: SidebarProps) {
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.requires !== "polymarket" || polymarketConnected || activeId === item.id,
    ),
  })).filter((group) => group.items.length > 0)

  return (
    <aside
      aria-label="Main"
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-canvas transition-[width] duration-150 ease-out",
        collapsed ? "w-14" : "w-56",
        floating && "shadow-overlay",
      )}
    >
      <div
        className={cn(
          "flex h-11 shrink-0 items-center [-webkit-app-region:drag]",
          collapsed ? "justify-center" : "gap-2 px-4",
        )}
      >
        <Link
          href="/home"
          onClick={onNavigate}
          aria-label="Nova home"
          className="flex items-center gap-2 rounded-md text-fg [-webkit-app-region:no-drag]"
        >
          <NovaMark />
          {collapsed ? null : <span className="text-md font-semibold tracking-[-0.01em]">Nova</span>}
        </Link>
      </div>

      <nav aria-label="Primary" className="no-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-2 pb-3">
        {groups.map((group) => (
          <div key={group.id} className={cn("flex flex-col gap-0.5", group.id === "developer" && "mt-auto")}>
            {group.label ? (
              collapsed ? (
                <div aria-hidden className="mx-2 mb-1.5 h-px bg-border-subtle" />
              ) : (
                <p className="px-2.5 pb-1 text-xs text-faint">{group.label}</p>
              )
            ) : null}
            <ul className={cn("flex flex-col gap-0.5", collapsed && "items-center")} aria-label={group.label}>
              {group.items.map((item) => (
                <li key={item.id}>
                  <NavLink
                    item={item}
                    active={activeId === item.id}
                    collapsed={collapsed}
                    badge={item.id === "runs" ? runsBadge(runCounts) : null}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn("shrink-0 border-t border-border p-2", collapsed && "flex justify-center")}>
        <ProfileMenu collapsed={collapsed} profile={profile} />
      </div>
    </aside>
  )
}
