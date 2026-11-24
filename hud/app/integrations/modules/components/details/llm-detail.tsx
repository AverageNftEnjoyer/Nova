"use client"

import { Badge, Button, Field, Select } from "@/components/ui"
import { SecretInput } from "../../../components/SecretInput"
import { SetupInstructions } from "../../../components/SetupInstructions"
import { TextInput } from "../../../components/TextInput"
import { FormActions, IntegrationDetail, SetupSection } from "../../../components/setup-parts"
import type { ProviderDefinition } from "../../types"
import { detailBase, type DetailProps } from "./shared"

/** OpenAI, Claude, Gemini and Grok: API key, base URL, default model, and which one Nova uses. */
export function LlmDetail({ props, definition }: { props: DetailProps; definition: ProviderDefinition }) {
  const { isSavingTarget, activeLlmProvider, saveActiveProvider } = props
  const busy = isSavingTarget !== null
  const isActive = activeLlmProvider === definition.provider
  const saveButton = (
    <Button onClick={() => void definition.onSave()} loading={definition.isSaving} disabled={busy && !definition.isSaving}>
      Save and verify
    </Button>
  )

  return (
    <IntegrationDetail
      {...detailBase(props, definition.provider)}
      meta={isActive ? <Badge tone="accent">Active</Badge> : null}
      actions={
        definition.isConnected ? (
          <>
            <Button variant="outline" onClick={() => void definition.onToggle()} disabled={busy}>
              Disconnect
            </Button>
            {!isActive ? (
              <Button onClick={() => void saveActiveProvider(definition.provider)} loading={isSavingTarget === "provider"} disabled={busy}>
                Make active
              </Button>
            ) : null}
          </>
        ) : null
      }
      tabs={[
        {
          id: "setup",
          content: (
            <SetupSection
              title="Credentials"
              description={`Nova stores the key encrypted on this computer and only shows its masked hint. Saving tests the key against the default model and turns ${definition.label} on when it answers.`}
            >
              <SecretInput
                label="API key"
                value={definition.apiKey}
                onChange={definition.onApiKeyChange}
                placeholder={definition.apiKeyPlaceholder}
                maskedValue={definition.apiKeyMasked}
                isConfigured={definition.apiKeyConfigured}
                name={definition.apiKeyInputName}
              />
              <TextInput
                label="API base URL"
                value={definition.baseUrl}
                onChange={definition.onBaseUrlChange}
                placeholder={definition.baseUrlPlaceholder}
                hint={definition.baseUrlHint}
              />
              <FormActions hint={isActive ? undefined : definition.isConnected ? `${definition.label} is connected. Make it active to use it for chat and agents.` : undefined}>
                {saveButton}
              </FormActions>
            </SetupSection>
          ),
        },
        {
          id: "settings",
          content: (
            <SetupSection title="Default model" description="Used for chat and agent tasks when this provider is active. Model choice sets quality and token cost.">
              <Field label="Model" aside={<span className="font-mono tabular-nums">Est. {definition.costEstimate}</span>} hint={definition.priceHint}>
                <Select
                  value={definition.model}
                  onValueChange={definition.onModelChange}
                  options={definition.modelOptions.map((option) => ({ value: option.value, label: option.label, description: option.priceHint }))}
                  mono
                />
              </Field>
              {definition.usageNote ? <p className="text-xs text-muted">{definition.usageNote}</p> : null}
              <FormActions hint="Saving checks that the model answers with your key.">{saveButton}</FormActions>
            </SetupSection>
          ),
        },
        {
          id: "instructions",
          content: <SetupInstructions title={`Connect ${definition.label}`} steps={definition.instructionSteps} />,
        },
      ]}
    />
  )
}
