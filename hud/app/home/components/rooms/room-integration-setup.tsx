"use client"

import { IntegrationsMainPanel } from "@/app/integrations/modules/components/integrations-main-panel"
import { useIntegrationsController } from "@/app/integrations/modules/hooks/use-integrations-controller"
import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import type { LlmProvider } from "@/lib/integrations/store/client-store"
import { INTEGRATION_LABELS } from "../game/town-ui"

const LLM_PROVIDERS: readonly LlmProvider[] = ["openai", "claude", "grok", "gemini"]

function isLlmProvider(setup: IntegrationSetupKey): setup is LlmProvider {
  return (LLM_PROVIDERS as readonly string[]).includes(setup)
}

/**
 * A room's "Connect & settings" section: the integration's own setup panel from /integrations (API key fields, OAuth
 * buttons, enable / disable, test, settings), driven by the same controller the page uses, so saving, masking and
 * secret handling are exactly the page's. Mounted only while the section is open.
 */
export function RoomIntegrationSetup({ setup }: { setup: IntegrationSetupKey }) {
  const controller = useIntegrationsController(setup)
  const { saveStatus, settings, activeLlmProvider, isSavingTarget } = controller
  const label = INTEGRATION_LABELS[setup]

  return (
    <div className="room-setup flex flex-col gap-3">
      {saveStatus ? (
        <p role="status" className="room-setup-status pixel-plaque" data-tone={saveStatus.type === "success" ? "ok" : "bad"}>
          {saveStatus.message}
        </p>
      ) : null}

      {isLlmProvider(setup) ? (
        <div className="room-card flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="pixel-label pixel-label--off">Nova&apos;s live provider</p>
            <p className="room-card-value">
              {settings[activeLlmProvider].connected ? INTEGRATION_LABELS[activeLlmProvider] : `${INTEGRATION_LABELS[activeLlmProvider]} (not connected)`}
            </p>
          </div>
          <button
            type="button"
            className="pixel-btn pixel-btn--teal"
            disabled={activeLlmProvider === setup || !settings[setup].connected || isSavingTarget !== null}
            onClick={() => void controller.saveActiveProvider(setup)}
          >
            {!settings[setup].connected
              ? `Connect ${label} first`
              : activeLlmProvider === setup
                ? `${label} is live`
                : isSavingTarget === "provider"
                  ? "Switching..."
                  : `Make ${label} live`}
          </button>
        </div>
      ) : null}

      <IntegrationsMainPanel
        {...controller.panelProps}
        activeSetup={setup}
        panelStyle={undefined}
        panelClass="ig-panel"
        moduleHeightClass="room-setup-module"
        isLight={false}
        subPanelClass="ig-sub"
      />
    </div>
  )
}
