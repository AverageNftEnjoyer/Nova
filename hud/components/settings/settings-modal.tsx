"use client"

import { useState, useRef, useEffect, type CSSProperties } from "react"
import NextImage from "next/image"
import { X, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/shared/utils"
import { useTheme } from "@/lib/context/theme-context"
import { SettingsNav, SETTINGS_SECTIONS, type SettingsSectionId } from "@/components/settings/settings-nav"
import { useSettingsState } from "@/components/settings/use-settings-state"
import { SettingsProfilePanel } from "@/components/settings/panels/settings-profile-panel"
import { SettingsAppearancePanel } from "@/components/settings/panels/settings-appearance-panel"
import { SettingsAudioPanel } from "@/components/settings/panels/settings-audio-panel"
import { SettingsNotificationsPanel } from "@/components/settings/panels/settings-notifications-panel"
import { SettingsPersonalizationPanel } from "@/components/settings/panels/settings-personalization-panel"
import { SettingsBootupPanel } from "@/components/settings/panels/settings-bootup-panel"
import { SettingsAccountPanel } from "@/components/settings/panels/settings-account-panel"
import { SettingsSkillsPanel } from "@/components/settings/settings-skills-panel"

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("profile")
  const { theme } = useTheme()
  const isLight = theme === "light"
  const spotlightScopeRef = useRef<HTMLDivElement | null>(null)

  const state = useSettingsState(isOpen, onClose)

  // ─── Palette CSS vars ─────────────────────────────────────────────────────

  const paletteVars = {
    "--settings-bg": isLight ? "#f6f8fc" : "rgba(255,255,255,0.04)",
    "--settings-border": isLight ? "#d9e0ea" : "rgba(255,255,255,0.12)",
    "--settings-hover": isLight ? "#eef3fb" : "rgba(255,255,255,0.08)",
    "--settings-card-bg": isLight ? "#ffffff" : "rgba(0,0,0,0.2)",
    "--settings-card-hover": isLight ? "#f7faff" : "rgba(255,255,255,0.06)",
    "--settings-sub-bg": isLight ? "#f4f7fd" : "rgba(0,0,0,0.25)",
    "--settings-sub-border": isLight ? "#d5dce8" : "rgba(255,255,255,0.1)",
    "--settings-selected-bg": isLight ? "#edf3ff" : "rgba(255,255,255,0.08)",
  } as CSSProperties

  // ─── Spotlight effect ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !spotlightScopeRef.current || !(state.settings?.app.spotlightEnabled ?? true)) return
    const scope = spotlightScopeRef.current
    const spotlight = document.createElement("div")
    spotlight.className = "fx-spotlight-overlay"
    scope.appendChild(spotlight)

    const handleMouseMove = (e: MouseEvent) => {
      const rect = scope.getBoundingClientRect()
      scope.style.setProperty("--fx-overlay-x", `${e.clientX - rect.left}px`)
      scope.style.setProperty("--fx-overlay-y", `${e.clientY - rect.top}px`)
      scope.style.setProperty("--fx-overlay-opacity", "1")

      const cards = scope.querySelectorAll<HTMLElement>(".fx-spotlight-card")
      const proximity = 70
      const fadeDistance = 140
      cards.forEach((card) => {
        const cardRect = card.getBoundingClientRect()
        const centerX = cardRect.left + cardRect.width / 2
        const centerY = cardRect.top + cardRect.height / 2
        const distance = Math.hypot(e.clientX - centerX, e.clientY - centerY) - Math.max(cardRect.width, cardRect.height) / 2
        const effectiveDistance = Math.max(0, distance)
        let glowIntensity = 0
        if (effectiveDistance <= proximity) {
          glowIntensity = 1
        } else if (effectiveDistance <= fadeDistance) {
          glowIntensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity)
        }
        const relativeX = ((e.clientX - cardRect.left) / cardRect.width) * 100
        const relativeY = ((e.clientY - cardRect.top) / cardRect.height) * 100
        card.style.setProperty("--glow-x", `${relativeX}%`)
        card.style.setProperty("--glow-y", `${relativeY}%`)
        card.style.setProperty("--glow-intensity", glowIntensity.toString())
        card.style.setProperty("--glow-radius", "120px")
      })
    }

    const handleMouseLeave = () => {
      scope.style.setProperty("--fx-overlay-opacity", "0")
      scope.querySelectorAll<HTMLElement>(".fx-spotlight-card").forEach((card) =>
        card.style.setProperty("--glow-intensity", "0")
      )
    }

    scope.addEventListener("mousemove", handleMouseMove)
    scope.addEventListener("mouseleave", handleMouseLeave)
    return () => {
      scope.removeEventListener("mousemove", handleMouseMove)
      scope.removeEventListener("mouseleave", handleMouseLeave)
      spotlight.remove()
    }
  }, [isOpen, state.settings?.app.spotlightEnabled])

  if (!isOpen) return null

  const activeLabel = SETTINGS_SECTIONS.find((s) => s.id === activeSection)?.label ?? ""

  return (
    <div style={paletteVars} className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      {/* Backdrop */}
      <button
        className={cn("absolute inset-0 backdrop-blur-sm", isLight ? "bg-[#0a122433]" : "bg-black/45")}
        onClick={onClose}
        aria-label="Close settings"
      />

      {/* Modal shell */}
      <div
        ref={spotlightScopeRef}
        style={{ "--fx-overlay-x": "50%", "--fx-overlay-y": "50%", "--fx-overlay-opacity": "0" } as CSSProperties}
        className={cn(
          "fx-spotlight-shell relative z-10 w-full max-w-6xl h-[min(92vh,820px)] rounded-2xl border overflow-hidden",
          "flex flex-col md:flex-row",
          isLight
            ? "border-[#d9e0ea] bg-white shadow-[0_28px_68px_-30px_rgba(45,78,132,0.4)]"
            : "border-white/20 bg-white/6 backdrop-blur-2xl shadow-[0_20px_42px_-24px_rgba(120,170,255,0.45)]",
        )}
      >
        {/* Sidebar nav */}
        <SettingsNav
          isLight={isLight}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          onReset={state.handleReset}
        />

        {/* Right content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className={cn(
            "flex items-center justify-between px-4 sm:px-6 py-4 border-b",
            isLight ? "border-[#e2e8f2] bg-[#f9fbff]" : "border-white/10 bg-black/20"
          )}>
            <h3 className={cn("text-sm font-medium uppercase tracking-wider", isLight ? "text-s-50" : "text-slate-400")}>
              {activeLabel}
            </h3>
            <div className="flex items-center gap-2">
              <Button
                onClick={state.handleReset}
                variant="ghost"
                size="sm"
                className={cn(
                  "md:hidden fx-spotlight-card fx-border-glow gap-2",
                  isLight ? "text-s-40 hover:text-s-60 hover:bg-[#eef3fb]" : "text-slate-500 hover:text-slate-300 hover:bg-white/6"
                )}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </Button>
              <button
                onClick={onClose}
                className={cn(
                  "fx-spotlight-card fx-border-glow h-8 w-8 rounded-md border inline-flex items-center justify-center transition-colors",
                  isLight ? "border-[#d5dce8] bg-white text-s-70 hover:bg-[#eef3fb]" : "border-white/12 bg-black/20 text-slate-300 hover:bg-white/8"
                )}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Scrollable section content */}
          <div className="no-scrollbar flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
            {!state.settings ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {activeSection === "profile" && (
                  <SettingsProfilePanel
                    isLight={isLight}
                    settings={state.settings}
                    avatarError={state.avatarError}
                    setAvatarError={state.setAvatarError}
                    memoryMarkdown={state.memoryMarkdown}
                    setMemoryMarkdown={state.setMemoryMarkdown}
                    setMemoryDirty={state.setMemoryDirty}
                    setMemorySavedAt={state.setMemorySavedAt}
                    memoryLoading={state.memoryLoading}
                    memorySaving={state.memorySaving}
                    memoryDirty={state.memoryDirty}
                    memoryError={state.memoryError}
                    memorySavedAt={state.memorySavedAt}
                    loadMemoryMarkdown={state.loadMemoryMarkdown}
                    saveMemoryMarkdown={state.saveMemoryMarkdown}
                    updateProfile={state.updateProfile}
                    handleAvatarUpload={state.handleAvatarUpload}
                  />
                )}

                {activeSection === "appearance" && (
                  <SettingsAppearancePanel
                    isLight={isLight}
                    settings={state.settings}
                    setSettings={state.setSettings}
                    updateApp={state.updateApp}
                    backgroundVideoAssets={state.backgroundVideoAssets}
                    activeBackgroundVideoAssetId={state.activeBackgroundVideoAssetId}
                    backgroundVideoError={state.backgroundVideoError}
                    setBackgroundVideoError={state.setBackgroundVideoError}
                    handleBackgroundVideoUpload={state.handleBackgroundVideoUpload}
                    removeBackgroundVideo={state.removeBackgroundVideo}
                    selectBackgroundVideoAsset={state.selectBackgroundVideoAsset}
                  />
                )}

                {activeSection === "audio" && (
                  <SettingsAudioPanel
                    isLight={isLight}
                    settings={state.settings}
                    updateApp={state.updateApp}
                  />
                )}

                {activeSection === "notifications" && (
                  <SettingsNotificationsPanel
                    isLight={isLight}
                    settings={state.settings}
                    updateNotifications={state.updateNotifications}
                  />
                )}

                {activeSection === "personalization" && (
                  <SettingsPersonalizationPanel
                    isLight={isLight}
                    settings={state.settings}
                    updatePersonalization={state.updatePersonalization}
                    onNavigateToSkills={() => setActiveSection("skills")}
                  />
                )}

                {activeSection === "skills" && (
                  <SettingsSkillsPanel isLight={isLight} />
                )}

                {activeSection === "bootup" && (
                  <SettingsBootupPanel
                    isLight={isLight}
                    settings={state.settings}
                    updateApp={state.updateApp}
                    bootMusicAssets={state.bootMusicAssets}
                    activeBootMusicAssetId={state.activeBootMusicAssetId}
                    bootMusicError={state.bootMusicError}
                    setBootMusicError={state.setBootMusicError}
                    handleBootMusicUpload={state.handleBootMusicUpload}
                    removeBootMusic={state.removeBootMusic}
                    selectBootMusicAsset={state.selectBootMusicAsset}
                  />
                )}

                {activeSection === "access" && (
                  <SettingsAccountPanel
                    isLight={isLight}
                    settings={state.settings}
                    authConfigured={state.authConfigured}
                    authAuthenticated={state.authAuthenticated}
                    authEmail={state.authEmail}
                    authBusy={state.authBusy}
                    authError={state.authError}
                    accountBusy={state.accountBusy}
                    accountMessage={state.accountMessage}
                    emailModalOpen={state.emailModalOpen}
                    deleteModalOpen={state.deleteModalOpen}
                    pendingEmail={state.pendingEmail}
                    deletePassword={state.deletePassword}
                    setPendingEmail={state.setPendingEmail}
                    setDeletePassword={state.setDeletePassword}
                    setEmailModalOpen={state.setEmailModalOpen}
                    setDeleteModalOpen={state.setDeleteModalOpen}
                    navigateToLogin={state.navigateToLogin}
                    handleSignOut={state.handleSignOut}
                    handleSendPasswordReset={state.handleSendPasswordReset}
                    handleRequestEmailChange={state.handleRequestEmailChange}
                    handleDeleteAccount={state.handleDeleteAccount}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Avatar crop overlay */}
      {state.cropSource && state.imageSize && (
        <div className="absolute inset-0 z-60 flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className={cn(
            "w-90 rounded-2xl border p-4 backdrop-blur-xl",
            isLight ? "border-[#d9e0ea] bg-white/95" : "border-white/20 bg-white/6"
          )}>
            <h4 className={cn("text-sm font-medium", isLight ? "text-s-90" : "text-white")}>Adjust profile photo</h4>
            <p className={cn("mt-1 text-xs", isLight ? "text-s-40" : "text-slate-400")}>Drag to reposition. Use zoom to crop.</p>

            <div className="mt-4 flex justify-center">
              <div
                className={cn(
                  "relative h-60 w-60 overflow-hidden rounded-full border cursor-grab active:cursor-grabbing",
                  isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/25"
                )}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  state.setDragStart({ x: e.clientX, y: e.clientY, offsetX: state.cropOffset.x, offsetY: state.cropOffset.y })
                }}
                onPointerMove={(e) => {
                  if (!state.dragStart) return
                  const next = {
                    x: state.dragStart.offsetX + (e.clientX - state.dragStart.x),
                    y: state.dragStart.offsetY + (e.clientY - state.dragStart.y),
                  }
                  state.setCropOffset(state.clampOffset(next, state.cropZoom, state.imageSize))
                }}
                onPointerUp={(e) => {
                  e.currentTarget.releasePointerCapture(e.pointerId)
                  state.setDragStart(null)
                }}
                onPointerCancel={() => state.setDragStart(null)}
              >
                <NextImage
                  src={state.cropSource}
                  alt="Crop preview"
                  width={state.imageSize.width}
                  height={state.imageSize.height}
                  unoptimized
                  draggable={false}
                  className="absolute left-1/2 top-1/2 select-none"
                  style={{
                    width: `${state.imageSize.width * state.getBaseScale(state.imageSize) * state.cropZoom}px`,
                    height: `${state.imageSize.height * state.getBaseScale(state.imageSize) * state.cropZoom}px`,
                    transform: `translate(calc(-50% + ${state.cropOffset.x}px), calc(-50% + ${state.cropOffset.y}px))`,
                    maxWidth: "none",
                  }}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs text-s-50">Zoom</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={state.cropZoom}
                onChange={(e) => {
                  const nextZoom = Number(e.target.value)
                  state.setCropZoom(nextZoom)
                  state.setCropOffset((prev) => state.clampOffset(prev, nextZoom, state.imageSize))
                }}
                className="w-full accent-violet-500"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  state.setCropSource(null)
                  state.setImageSize(null)
                  state.setDragStart(null)
                }}
              >
                Cancel
              </Button>
              <Button onClick={() => void state.saveCroppedAvatar()}>Save Photo</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
