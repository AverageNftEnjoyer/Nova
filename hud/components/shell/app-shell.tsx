"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"

import { SettingsModal } from "@/components/settings/settings-modal"
import type { SettingsSectionId } from "@/components/settings/settings-nav"
import { CommandPalette } from "@/components/shell/command-palette"
import { activeNavItem } from "@/components/shell/nav-config"
import { OPEN_COMMAND_PALETTE_EVENT, OPEN_SETTINGS_EVENT, type OpenSettingsDetail } from "@/components/shell/shell-events"
import { Sidebar } from "@/components/shell/sidebar"
import { TopBar } from "@/components/shell/top-bar"
import { useRunCounts } from "@/components/shell/use-run-counts"
import { usePolymarketConnected, useShellProfile } from "@/components/shell/use-shell-data"
import { useSidebarState } from "@/components/shell/use-sidebar-state"

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

/**
 * The frame every page lives in: persistent sidebar, 44px top bar, and one scrollable content region (`<main>`).
 * Owns the global shortcuts (Ctrl K palette, Ctrl B / [ sidebar, Ctrl , settings) and the single Settings dialog.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/"
  const sidebar = useSidebarState()
  const runCounts = useRunCounts()
  const polymarketConnected = usePolymarketConnected()
  const profile = useShellProfile()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settings, setSettings] = useState<{ open: boolean; section: SettingsSectionId }>({ open: false, section: "profile" })

  const { toggle: toggleSidebar, closeOverlay, overlayOpen } = sidebar
  const active = activeNavItem(pathname)

  // Navigating closes the overlay sidebar (narrow windows).
  const [routeFor, setRouteFor] = useState(pathname)
  if (routeFor !== pathname) {
    setRouteFor(pathname)
    if (overlayOpen) closeOverlay()
  }

  const openSettingsDialog = useCallback((section?: SettingsSectionId) => {
    setSettings({ open: true, section: section ?? "profile" })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (mod && !event.altKey && !event.shiftKey && key === "k") {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (mod && !event.altKey && !event.shiftKey && key === "b") {
        event.preventDefault()
        toggleSidebar()
        return
      }
      if (mod && !event.altKey && key === ",") {
        event.preventDefault()
        openSettingsDialog()
        return
      }
      if (!mod && !event.altKey && event.key === "[" && !isEditableTarget(event.target)) {
        event.preventDefault()
        toggleSidebar()
        return
      }
      if (event.key === "Escape" && overlayOpen) closeOverlay()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [closeOverlay, openSettingsDialog, overlayOpen, toggleSidebar])

  useEffect(() => {
    const onOpenSettings = (event: Event) => openSettingsDialog((event as CustomEvent<OpenSettingsDetail>).detail?.section)
    const onOpenPalette = () => setPaletteOpen(true)
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpenSettings)
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenPalette)
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, onOpenSettings)
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenPalette)
    }
  }, [openSettingsDialog])

  const sidebarProps = {
    activeId: active?.id ?? null,
    runCounts,
    polymarketConnected,
    profile,
    onNavigate: closeOverlay,
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas">
      <a
        href="#main-content"
        className="fixed top-2 left-2 z-300 -translate-y-16 rounded-md bg-surface-3 px-3 py-1.5 text-sm text-fg shadow-overlay focus-visible:translate-y-0"
      >
        Skip to content
      </a>

      <Sidebar collapsed={sidebar.collapsed} floating={false} {...sidebarProps} />

      {sidebar.narrow && overlayOpen ? (
        <>
          <div aria-hidden className="fixed inset-0 z-90 bg-scrim animate-overlay-in" onMouseDown={closeOverlay} />
          <div className="fixed inset-y-0 left-0 z-100 animate-overlay-in">
            <Sidebar collapsed={false} floating {...sidebarProps} />
          </div>
        </>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          pathname={pathname}
          sidebarCollapsed={sidebar.collapsed}
          onToggleSidebar={toggleSidebar}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <main id="main-content" tabIndex={-1} className="relative min-h-0 flex-1 overflow-auto focus-visible:outline-none">
          {children}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        polymarketConnected={polymarketConnected}
        onToggleSidebar={toggleSidebar}
      />
      <SettingsModal
        isOpen={settings.open}
        initialSection={settings.section}
        onClose={() => setSettings((current) => ({ ...current, open: false }))}
      />
    </div>
  )
}
