"use client"

import Link from "next/link"
import { ChevronDown, MessageSquarePlus, PanelLeft, Rocket, Search } from "lucide-react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  Tooltip,
} from "@/components/ui"
import { ConnectionStatus } from "@/components/shell/connection-status"
import { NEW_CHAT_HREF, NEW_DEPLOYMENT_HREF, breadcrumbFor } from "@/components/shell/nav-config"
import { WindowControls } from "@/components/window/window-controls"
import { cn } from "@/lib/shared/utils"

export interface TopBarProps {
  pathname: string
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onOpenPalette: () => void
}

/** 44px bar over the content: sidebar toggle, breadcrumb, command palette, runtime status, New. Doubles as the window drag region. */
export function TopBar({ pathname, sidebarCollapsed, onToggleSidebar, onOpenPalette }: TopBarProps) {
  const crumbs = breadcrumbFor(pathname)

  return (
    <header className="grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-border bg-canvas pl-2 [-webkit-app-region:drag]">
      <div className="flex min-w-0 items-center gap-1.5">
        <Tooltip content={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} shortcut="Ctrl B" side="bottom" align="start">
          <IconButton
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
            size="sm"
            onClick={onToggleSidebar}
            className="[-webkit-app-region:no-drag]"
          >
            <PanelLeft />
          </IconButton>
        </Tooltip>
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1.5 text-sm">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1
              return (
                <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
                  {index > 0 ? (
                    <span aria-hidden className="text-faint">
                      /
                    </span>
                  ) : null}
                  {crumb.href && !last ? (
                    <Link
                      href={crumb.href}
                      className="truncate rounded-sm text-muted transition-colors hover:text-fg [-webkit-app-region:no-drag]"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current={last ? "page" : undefined} className={cn("truncate", last ? "font-medium text-fg" : "text-muted")}>
                      {crumb.label}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Search and run commands"
        aria-keyshortcuts="Control+K"
        className="flex h-7 w-[clamp(11rem,28vw,22rem)] items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-faint transition-colors duration-150 ease-out hover:border-border-strong hover:text-muted [-webkit-app-region:no-drag]"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">Search or jump to</span>
        <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex h-full min-w-0 items-center justify-end gap-2 pr-2 has-[[data-window-controls]]:pr-0">
        <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
          <span className="hidden xl:flex">
            <ConnectionStatus />
          </span>
          <span className="flex xl:hidden">
            <ConnectionStatus compact />
          </span>
          <div className="flex items-center gap-px">
            <Button asChild variant="secondary" size="sm" className="rounded-r-none">
              <Link href={NEW_CHAT_HREF}>
                <MessageSquarePlus />
                New chat
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon-sm" className="w-6 rounded-l-none" aria-label="More new items">
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link href={NEW_CHAT_HREF}>
                    <MessageSquarePlus />
                    New chat
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={NEW_DEPLOYMENT_HREF}>
                    <Rocket />
                    New deployment
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <WindowControls className="ml-1" />
      </div>
    </header>
  )
}
