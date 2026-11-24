"use client"

import { useState } from "react"
import NextImage from "next/image"
import {
  Button,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui"
import { SettingsNav, SETTINGS_SECTIONS, type SettingsSectionId } from "@/components/settings/settings-nav"
import { SettingsLoading } from "@/components/settings/settings-primitives"
import { useSettingsState } from "@/components/settings/use-settings-state"
import { SettingsProfilePanel } from "@/components/settings/panels/settings-profile-panel"
import { SettingsAppearancePanel } from "@/components/settings/panels/settings-appearance-panel"
import { SettingsAudioPanel } from "@/components/settings/panels/settings-audio-panel"
import { SettingsNotificationsPanel } from "@/components/settings/panels/settings-notifications-panel"
import { SettingsPersonalizationPanel } from "@/components/settings/panels/settings-personalization-panel"
import { SettingsSkillsPanel } from "@/components/settings/settings-skills-panel"
import { SettingsAgentBudgetsPanel } from "@/components/settings/panels/settings-agent-budgets-panel"
import { SettingsModelRoutingPanel } from "@/components/settings/panels/settings-model-routing-panel"
import { SettingsLocalDataPanel } from "@/components/settings/panels/settings-local-data-panel"

export type { SettingsSectionId } from "@/components/settings/settings-nav"

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  /** Section shown when the modal opens (e.g. "skills"). Default: Profile. */
  initialSection?: SettingsSectionId
}

/** The one Settings dialog (mounted by the app shell): grouped section nav on the left, the section on the right. */
export function SettingsModal({ isOpen, onClose, initialSection = "profile" }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection)
  // Each time the modal opens, start on the requested section.
  const [openedFor, setOpenedFor] = useState<{ isOpen: boolean; section: SettingsSectionId }>({ isOpen, section: initialSection })
  if (openedFor.isOpen !== isOpen || openedFor.section !== initialSection) {
    setOpenedFor({ isOpen, section: initialSection })
    if (isOpen) setActiveSection(initialSection)
  }

  const state = useSettingsState(isOpen)
  const section = SETTINGS_SECTIONS.find((s) => s.id === activeSection) ?? SETTINGS_SECTIONS[0]
  const cropOpen = Boolean(state.cropSource && state.imageSize)

  const closeCrop = () => {
    state.setCropSource(null)
    state.setImageSize(null)
    state.setDragStart(null)
  }

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        size="xl"
        className="h-[min(80vh,52rem)] max-h-[min(80vh,52rem)] max-w-[60rem] flex-row"
      >
        <SettingsNav activeSection={activeSection} onSectionChange={setActiveSection} />

        <div className="flex min-w-0 flex-1 flex-col">
          <DialogHeader className="border-b border-border px-6 pt-5 pb-4">
            <DialogTitle className="text-base">{section.label}</DialogTitle>
            <DialogDescription className="text-xs">{section.description}</DialogDescription>
          </DialogHeader>

          <DialogBody key={activeSection} className="overscroll-contain px-6 pt-5 pb-8">
            {!state.settings ? (
              <SettingsLoading label="Loading settings" />
            ) : (
              <div className="max-w-[44rem]">
                {activeSection === "profile" && (
                  <SettingsProfilePanel
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
                    loadMemoryMarkdown={state.loadMemoryMarkdown}
                    saveMemoryMarkdown={state.saveMemoryMarkdown}
                    updateProfile={state.updateProfile}
                    handleAvatarUpload={state.handleAvatarUpload}
                  />
                )}
                {activeSection === "personalization" && (
                  <SettingsPersonalizationPanel
                    settings={state.settings}
                    updatePersonalization={state.updatePersonalization}
                    onNavigateToSkills={() => setActiveSection("skills")}
                  />
                )}
                {activeSection === "appearance" && (
                  <SettingsAppearancePanel settings={state.settings} setSettings={state.setSettings} updateApp={state.updateApp} />
                )}
                {activeSection === "audio" && <SettingsAudioPanel settings={state.settings} updateApp={state.updateApp} />}
                {activeSection === "notifications" && (
                  <SettingsNotificationsPanel settings={state.settings} updateNotifications={state.updateNotifications} />
                )}
                {activeSection === "agent-budgets" && <SettingsAgentBudgetsPanel />}
                {activeSection === "model-routing" && (
                  <SettingsModelRoutingPanel onNavigateToAgentBudgets={() => setActiveSection("agent-budgets")} />
                )}
                {activeSection === "skills" && <SettingsSkillsPanel />}
                {activeSection === "local-data" && <SettingsLocalDataPanel onReset={state.handleReset} />}
              </div>
            )}
          </DialogBody>
        </div>
      </Dialog>

      <Dialog open={isOpen && cropOpen} onOpenChange={(open) => (!open ? closeCrop() : undefined)} size="sm" dismissible={false}>
        <DialogHeader>
          <DialogTitle>Adjust profile photo</DialogTitle>
          <DialogDescription>Drag to reposition, use the slider to zoom.</DialogDescription>
        </DialogHeader>
        {state.cropSource && state.imageSize ? (
          <DialogBody className="flex flex-col items-center gap-4 pt-1">
            {/* Fixed pixel frame: the crop maths in use-settings-state works in these pixels. */}
            <div
              className="relative cursor-grab touch-none overflow-hidden rounded-full border border-border bg-surface-2 active:cursor-grabbing"
              style={{ width: state.CROP_FRAME, height: state.CROP_FRAME }}
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
                className="absolute top-1/2 left-1/2 select-none"
                style={{
                  width: `${state.imageSize.width * state.getBaseScale(state.imageSize) * state.cropZoom}px`,
                  height: `${state.imageSize.height * state.getBaseScale(state.imageSize) * state.cropZoom}px`,
                  transform: `translate(calc(-50% + ${state.cropOffset.x}px), calc(-50% + ${state.cropOffset.y}px))`,
                  maxWidth: "none",
                }}
              />
            </div>
            <label className="flex w-full items-center gap-3 text-xs text-muted">
              Zoom
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
                className="flex-1 accent-accent"
              />
            </label>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={closeCrop}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void state.saveCroppedAvatar()}>
            Save photo
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  )
}
