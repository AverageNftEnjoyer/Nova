"use client"

import { useState } from "react"
import { Button, Input, Select, Textarea } from "@/components/ui"
import { SettingRow, SettingsGroup } from "@/components/settings/settings-primitives"
import { isBlockedAssistantName, MAX_ASSISTANT_NAME_LENGTH, MAX_PREFERRED_CITY_LENGTH, type UserSettings } from "@/lib/settings/userSettings"

interface Props {
  settings: UserSettings
  updatePersonalization: (key: string, value: string | string[]) => void
  onNavigateToSkills: () => void
}

interface ChoiceRow {
  key: "communicationStyle" | "tone" | "proactivity" | "humor_level" | "structure_preference" | "challenge_level" | "risk_tolerance"
  label: string
  hint: string
  options: { value: string; label: string; description?: string }[]
}

const STYLE_ROWS: ChoiceRow[] = [
  {
    key: "communicationStyle",
    label: "Formality",
    hint: "How formal replies are.",
    options: [
      { value: "formal", label: "Formal" },
      { value: "professional", label: "Professional" },
      { value: "friendly", label: "Friendly" },
      { value: "casual", label: "Casual" },
    ],
  },
  {
    key: "tone",
    label: "Tone",
    hint: "The overall voice of replies.",
    options: [
      { value: "neutral", label: "Neutral" },
      { value: "enthusiastic", label: "Enthusiastic" },
      { value: "calm", label: "Calm" },
      { value: "direct", label: "Direct" },
      { value: "relaxed", label: "Relaxed" },
    ],
  },
  {
    key: "structure_preference",
    label: "Structure",
    hint: "Prose, lists, or a mix of both.",
    options: [
      { value: "freeform", label: "Freeform", description: "Flowing prose" },
      { value: "mixed", label: "Mixed", description: "Prose and structure as needed" },
      { value: "structured", label: "Structured", description: "Bullets, headers and lists" },
    ],
  },
]

const BEHAVIOUR_ROWS: ChoiceRow[] = [
  {
    key: "proactivity",
    label: "Proactivity",
    hint: "Whether it offers next steps you didn't ask for.",
    options: [
      { value: "reactive", label: "Reactive", description: "Only answers what is asked" },
      { value: "balanced", label: "Balanced", description: "Suggests when clearly helpful" },
      { value: "proactive", label: "Proactive", description: "Surfaces next steps and issues" },
    ],
  },
  {
    key: "challenge_level",
    label: "Pushback",
    hint: "How readily it disagrees with you.",
    options: [
      { value: "supportive", label: "Supportive", description: "Validates and encourages" },
      { value: "neutral", label: "Neutral", description: "Balanced perspective" },
      { value: "challenger", label: "Challenger", description: "Pushes back on weak ideas" },
    ],
  },
  {
    key: "risk_tolerance",
    label: "Risk tolerance",
    hint: "How bold its recommendations are.",
    options: [
      { value: "conservative", label: "Conservative", description: "Highlights risks, prefers safe defaults" },
      { value: "balanced", label: "Balanced", description: "Weighs opportunity and risk" },
      { value: "bold", label: "Bold", description: "Favours ambitious, decisive options" },
    ],
  },
  {
    key: "humor_level",
    label: "Humour",
    hint: "How much wit shows up in replies.",
    options: [
      { value: "none", label: "None", description: "Strictly professional" },
      { value: "subtle", label: "Subtle", description: "Light wit when it fits" },
      { value: "playful", label: "Playful", description: "Banter welcome" },
    ],
  },
]

export function SettingsPersonalizationPanel({ settings, updatePersonalization, onNavigateToSkills }: Props) {
  const p = settings.personalization
  const [assistantNameDraft, setAssistantNameDraft] = useState(p.assistantName)
  const [assistantNameError, setAssistantNameError] = useState("")

  const changeAssistantName = (value: string) => {
    setAssistantNameDraft(value)
    if (isBlockedAssistantName(value.trim())) {
      setAssistantNameError("That name is not allowed. Choose a different one.")
      return
    }
    setAssistantNameError("")
    updatePersonalization("assistantName", value)
  }

  const renderChoice = (row: ChoiceRow) => (
    <SettingRow key={row.key} label={row.label} hint={row.hint}>
      <Select
        value={p[row.key]}
        options={row.options}
        onValueChange={(value) => updatePersonalization(row.key, value)}
        className="w-52"
      />
    </SettingRow>
  )

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup title="About you" description="Nova uses these details to address you and tailor answers.">
        <SettingRow label="Assistant name" hint="What you call your assistant. Empty means Nova." error={assistantNameError || undefined}>
          <Input
            value={assistantNameDraft}
            onChange={(e) => changeAssistantName(e.target.value)}
            onBlur={() => setAssistantNameDraft(settings.personalization.assistantName)}
            placeholder="Nova"
            maxLength={MAX_ASSISTANT_NAME_LENGTH}
            className="w-52"
          />
        </SettingRow>
        <SettingRow label="Nickname" hint="What Nova calls you.">
          <Input value={p.nickname} onChange={(e) => updatePersonalization("nickname", e.target.value)} placeholder="Your first name" className="w-52" />
        </SettingRow>
        <SettingRow label="Occupation" hint="Your role, so examples fit your work.">
          <Input value={p.occupation} onChange={(e) => updatePersonalization("occupation", e.target.value)} placeholder="Software developer" className="w-52" />
        </SettingRow>
        <SettingRow label="Weather city" hint="Used for the weather on Home. You can also say it in chat.">
          <Input
            value={p.preferredCity}
            onChange={(e) => updatePersonalization("preferredCity", e.target.value)}
            placeholder="Austin, TX"
            maxLength={MAX_PREFERRED_CITY_LENGTH}
            className="w-52"
          />
        </SettingRow>
        <SettingRow label="Language" hint="The language Nova replies in.">
          <Input value={p.preferredLanguage} onChange={(e) => updatePersonalization("preferredLanguage", e.target.value)} placeholder="English" className="w-52" />
        </SettingRow>
        <SettingRow stacked label="Things to know about you" hint="Traits and preferences, e.g. prefers concise answers, works late.">
          <Textarea
            value={p.characteristics}
            onChange={(e) => updatePersonalization("characteristics", e.target.value)}
            autoGrow
            minRows={3}
            maxRows={8}
            placeholder="Detail-oriented, prefers short answers with the command first"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Reply style">{STYLE_ROWS.map(renderChoice)}</SettingsGroup>

      <SettingsGroup title="Behaviour">{BEHAVIOUR_ROWS.map(renderChoice)}</SettingsGroup>

      <SettingsGroup>
        <SettingRow label="Custom behaviour" hint="Detailed instructions for specific kinds of requests live in skills.">
          <Button variant="secondary" size="sm" onClick={onNavigateToSkills}>
            Open skills
          </Button>
        </SettingRow>
      </SettingsGroup>
    </div>
  )
}
