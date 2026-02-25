"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/shared/utils"
import { isBlockedAssistantName, MAX_ASSISTANT_NAME_LENGTH } from "@/lib/settings/userSettings"
import {
  SettingInput,
  SettingTextarea,
  SettingSelect,
  getSettingsCardClass,
  playClickSound,
} from "@/components/settings/settings-primitives"
import type { UserSettings } from "@/lib/settings/userSettings"

interface Props {
  isLight: boolean
  settings: UserSettings
  updatePersonalization: (key: string, value: string | string[]) => void
  onNavigateToSkills: () => void
}

export function SettingsPersonalizationPanel({ isLight, settings, updatePersonalization, onNavigateToSkills }: Props) {
  const [assistantNameValidation, setAssistantNameValidation] = useState("")

  const handleAssistantNameChange = useCallback((value: string) => {
    const candidate = String(value || "").trim()
    if (isBlockedAssistantName(candidate)) {
      setAssistantNameValidation("That name is not allowed. Please choose a different assistant name.")
    } else if (candidate.length > MAX_ASSISTANT_NAME_LENGTH) {
      setAssistantNameValidation(`Assistant name must be ${MAX_ASSISTANT_NAME_LENGTH} characters or fewer.`)
    } else {
      setAssistantNameValidation("")
    }
    updatePersonalization("assistantName", value)
  }, [updatePersonalization])

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl bg-accent-10 border border-accent-30 transition-colors duration-150 hover:bg-accent-15 mb-4">
        <p className="text-sm text-accent-secondary">
          Help Nova understand you better by filling in these details.
          This information helps personalize your experience.
        </p>
      </div>

      <SettingInput
        label="Assistant Name"
        description="What do you want to call your assistant?"
        value={settings.personalization.assistantName}
        onChange={handleAssistantNameChange}
        placeholder="e.g., Nova, Atlas..."
        errorText={assistantNameValidation || undefined}
        isLight={isLight}
      />

      <SettingInput
        label="Nickname"
        description="What should Nova call you?"
        value={settings.personalization.nickname}
        onChange={(v) => updatePersonalization("nickname", v)}
        placeholder="e.g., Boss, Chief, Captain..."
        isLight={isLight}
      />

      <SettingInput
        label="Occupation"
        description="Your profession or role"
        value={settings.personalization.occupation}
        onChange={(v) => updatePersonalization("occupation", v)}
        placeholder="e.g., Software Developer, Designer..."
        isLight={isLight}
      />

      <SettingInput
        label="Preferred Language"
        description="Your preferred language for responses"
        value={settings.personalization.preferredLanguage}
        onChange={(v) => updatePersonalization("preferredLanguage", v)}
        isLight={isLight}
      />

      <SettingSelect
        label="Communication Style"
        description="How formal should Nova be?"
        isLight={isLight}
        value={settings.personalization.communicationStyle}
        options={[
          { value: "formal", label: "Formal" },
          { value: "professional", label: "Professional" },
          { value: "friendly", label: "Friendly" },
          { value: "casual", label: "Casual" },
        ]}
        onChange={(v) => updatePersonalization("communicationStyle", v)}
      />

      <SettingSelect
        label="Response Tone"
        description="Nova's conversational tone"
        isLight={isLight}
        value={settings.personalization.tone}
        options={[
          { value: "neutral", label: "Neutral" },
          { value: "enthusiastic", label: "Enthusiastic" },
          { value: "calm", label: "Calm" },
          { value: "direct", label: "Direct" },
          { value: "relaxed", label: "Relaxed" },
        ]}
        onChange={(v) => updatePersonalization("tone", v)}
      />

      <SettingTextarea
        label="Your Characteristics"
        description="Describe yourself - personality traits, preferences, quirks"
        value={settings.personalization.characteristics}
        onChange={(v) => updatePersonalization("characteristics", v)}
        placeholder="e.g., I'm detail-oriented, prefer concise answers, work late nights..."
        rows={3}
        isLight={isLight}
      />

      <div className={cn("flex items-center gap-3 pt-1 pb-0.5")}>
        <div className={cn("h-px flex-1", isLight ? "bg-[#d5dce8]" : "bg-white/10")} />
        <span className={cn("text-xs font-semibold tracking-widest uppercase", isLight ? "text-s-40" : "text-slate-500")}>
          Behavior Tuning
        </span>
        <div className={cn("h-px flex-1", isLight ? "bg-[#d5dce8]" : "bg-white/10")} />
      </div>

      <SettingSelect
        label="Proactivity"
        description="How often should Nova volunteer suggestions unprompted?"
        isLight={isLight}
        value={settings.personalization.proactivity}
        options={[
          { value: "reactive", label: "Reactive — only answer what's asked" },
          { value: "balanced", label: "Balanced — suggest when clearly helpful" },
          { value: "proactive", label: "Proactive — surface next steps and issues" },
        ]}
        onChange={(v) => updatePersonalization("proactivity", v)}
      />

      <SettingSelect
        label="Humor"
        description="How much personality and wit in responses?"
        isLight={isLight}
        value={settings.personalization.humor_level}
        options={[
          { value: "none", label: "None — strictly professional" },
          { value: "subtle", label: "Subtle — light wit when it fits" },
          { value: "playful", label: "Playful — banter welcome" },
        ]}
        onChange={(v) => updatePersonalization("humor_level", v)}
      />

      <SettingSelect
        label="Response Structure"
        description="Preferred format for answers"
        isLight={isLight}
        value={settings.personalization.structure_preference}
        options={[
          { value: "freeform", label: "Freeform — flowing prose" },
          { value: "mixed", label: "Mixed — prose and structure as needed" },
          { value: "structured", label: "Structured — bullets, headers, lists" },
        ]}
        onChange={(v) => updatePersonalization("structure_preference", v)}
      />

      <SettingSelect
        label="Challenge Mode"
        description="Should Nova push back or stay supportive?"
        isLight={isLight}
        value={settings.personalization.challenge_level}
        options={[
          { value: "supportive", label: "Supportive — validate and encourage" },
          { value: "neutral", label: "Neutral — balanced perspective" },
          { value: "challenger", label: "Challenger — push back on weak ideas" },
        ]}
        onChange={(v) => updatePersonalization("challenge_level", v)}
      />

      <SettingSelect
        label="Risk Tolerance"
        description="How bold should Nova be in recommendations?"
        isLight={isLight}
        value={settings.personalization.risk_tolerance}
        options={[
          { value: "conservative", label: "Conservative — highlight risks, prefer safe defaults" },
          { value: "balanced", label: "Balanced — weigh opportunity and risk" },
          { value: "bold", label: "Bold — favor ambitious, decisive options" },
        ]}
        onChange={(v) => updatePersonalization("risk_tolerance", v)}
      />

      <div className={cn(getSettingsCardClass(isLight), "p-4")}>
        <p className={cn("text-sm mb-0.5", isLight ? "text-s-70" : "text-slate-200")}>Skill-Based Behavior</p>
        <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>
          Behavior customization now lives in Skills. Create and edit
          <code className="mx-1">SKILL.md</code>
          templates in the Skills section.
        </p>
        <Button
          onClick={() => { playClickSound(); onNavigateToSkills() }}
          variant="outline"
          size="sm"
          className={cn(
            "fx-spotlight-card fx-border-glow",
            isLight
              ? "text-s-50 border-[#d5dce8] hover:border-accent-30 hover:text-accent hover:bg-accent-10"
              : "text-slate-300 border-white/15 hover:border-accent-30 hover:text-accent hover:bg-accent-10",
          )}
        >
          Open Skills
        </Button>
      </div>
    </div>
  )
}
