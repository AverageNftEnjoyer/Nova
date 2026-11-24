import type { CSSProperties } from "react"
import { SetupPanelHeader } from "./SetupPanelHeader"
import { SecretInput } from "./SecretInput"
import { TextInput } from "./TextInput"
import { ModelSelector } from "./ModelSelector"
import { SetupInstructions } from "./SetupInstructions"
import type { FluidSelectOption } from "@/components/ui/fluid-select"

interface LlmSetupPanelProps {
  sectionRef: React.RefObject<HTMLElement | null>
  panelStyle: CSSProperties | undefined
  panelClass: string
  moduleHeightClass: string
  isLight: boolean
  subPanelClass: string
  title: string
  description: string
  isConnected: boolean
  isSaving: boolean
  isSavingAny: boolean
  onToggle: () => void
  onSave: () => void
  apiKey: string
  onApiKeyChange: (value: string) => void
  apiKeyPlaceholder: string
  apiKeyConfigured: boolean
  apiKeyMasked: string
  apiKeyInputName: string
  apiKeyPlaceholderWhenConfigured: string
  baseUrl: string
  onBaseUrlChange: (value: string) => void
  baseUrlPlaceholder: string
  baseUrlHint: string
  model: string
  onModelChange: (value: string) => void
  modelOptions: FluidSelectOption[]
  costEstimate: string
  priceHint: string
  usageNote?: string
  instructionSteps: string[]
}

export function LlmSetupPanel({
  sectionRef,
  panelStyle,
  panelClass,
  moduleHeightClass,
  isLight,
  subPanelClass,
  title,
  description,
  isConnected,
  isSaving,
  isSavingAny,
  onToggle,
  onSave,
  apiKey,
  onApiKeyChange,
  apiKeyPlaceholder,
  apiKeyConfigured,
  apiKeyMasked,
  apiKeyInputName,
  apiKeyPlaceholderWhenConfigured,
  baseUrl,
  onBaseUrlChange,
  baseUrlPlaceholder,
  baseUrlHint,
  model,
  onModelChange,
  modelOptions,
  costEstimate,
  priceHint,
  usageNote,
  instructionSteps,
}: LlmSetupPanelProps) {
  return (
    <section ref={sectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
      <SetupPanelHeader
        title={title}
        description={description}
        isConnected={isConnected}
        isSaving={isSaving}
        isSavingAny={isSavingAny}
        onToggle={onToggle}
        onSave={onSave}
        toggleLabel={{ enable: "Save to Activate", disable: "Disable" }}
        isLight={isLight}
      />

      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
        <SecretInput
          value={apiKey}
          onChange={onApiKeyChange}
          label="API Key"
          placeholder={apiKeyPlaceholder}
          placeholderWhenConfigured={apiKeyPlaceholderWhenConfigured}
          maskedValue={apiKeyMasked}
          isConfigured={apiKeyConfigured}
          name={apiKeyInputName}
          isLight={isLight}
          subPanelClass={subPanelClass}
        />

        <TextInput
          value={baseUrl}
          onChange={onBaseUrlChange}
          label="API Base URL"
          placeholder={baseUrlPlaceholder}
          hint={baseUrlHint}
          isLight={isLight}
          subPanelClass={subPanelClass}
        />

        <ModelSelector
          value={model}
          onChange={onModelChange}
          options={modelOptions}
          costEstimate={costEstimate}
          priceHint={priceHint}
          usageNote={usageNote}
          isLight={isLight}
          subPanelClass={subPanelClass}
        />

        <SetupInstructions
          steps={instructionSteps}
          isLight={isLight}
          subPanelClass={subPanelClass}
        />
      </div>
    </section>
  )
}
