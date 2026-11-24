"use client"

import { Suspense, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { PageContainer } from "@/components/shell"
import { Badge, PageHeader } from "@/components/ui"
import { buildIntegrationsHref, readIntegrationSetupParam, type IntegrationSetupKey } from "@/lib/integrations/navigation"

import { IntegrationList } from "./components/integration-list"
import type { DetailTabId } from "./components/setup-parts"
import { INTEGRATION_CATALOG } from "./constants/catalog"
import { integrationStatus, isIntegrationConnected } from "./modules/integration-status"
import { IntegrationsMainPanel } from "./modules/components/integrations-main-panel"
import { useIntegrationsController } from "./modules/hooks/use-integrations-controller"

const DEFAULT_SETUP: IntegrationSetupKey = "openai"
const TAB_IDS: readonly DetailTabId[] = ["setup", "settings", "live", "instructions"]

function readTab(value: string | null): DetailTabId {
  return TAB_IDS.includes(value as DetailTabId) ? (value as DetailTabId) : "setup"
}

function integrationsHref(setup: IntegrationSetupKey, tab: DetailTabId): string {
  const base = buildIntegrationsHref(setup)
  return tab === "setup" ? base : `${base}&tab=${tab}`
}

function IntegrationsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // `?setup=<key>` selects an integration (other pages link with buildIntegrationsHref); `&tab=` opens one of its tabs.
  const activeSetup = readIntegrationSetupParam(searchParams.get("setup")) ?? DEFAULT_SETUP
  const tab = readTab(searchParams.get("tab"))

  const { settings, integrationsHydrated, activeLlmProvider, panelProps } = useIntegrationsController(activeSetup)

  const selectSetup = useCallback(
    (setup: IntegrationSetupKey) => router.replace(integrationsHref(setup, "setup"), { scroll: false }),
    [router],
  )
  const selectTab = useCallback(
    (next: DetailTabId) => router.replace(integrationsHref(activeSetup, next), { scroll: false }),
    [activeSetup, router],
  )

  const failedSetup = panelProps.lastError ? activeSetup : null
  const statusOf = useCallback(
    (setup: IntegrationSetupKey) => integrationStatus(settings, setup, failedSetup),
    [failedSetup, settings],
  )
  const connectedCount = INTEGRATION_CATALOG.filter((entry) => isIntegrationConnected(settings, entry.key)).length

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Integrations"
        description="Connect model providers, messaging, finance and media accounts. Keys stay encrypted on this computer."
        meta={
          integrationsHydrated ? (
            <Badge mono>
              {connectedCount} of {INTEGRATION_CATALOG.length} connected
            </Badge>
          ) : null
        }
      />
      <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)] xl:gap-8">
        <aside className="min-w-0 md:sticky md:top-6 md:self-start">
          <IntegrationList
            activeSetup={activeSetup}
            onSelect={selectSetup}
            statusOf={statusOf}
            activeLlm={activeLlmProvider}
            hydrated={integrationsHydrated}
          />
        </aside>
        <section aria-label="Integration detail" className="min-w-0 md:border-l md:border-border md:pl-6 xl:pl-8">
          <div className="max-w-[48rem]">
            <IntegrationsMainPanel {...panelProps} activeSetup={activeSetup} tab={tab} onTabChange={selectTab} />
          </div>
        </section>
      </div>
    </PageContainer>
  )
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={null}>
      <IntegrationsPageContent />
    </Suspense>
  )
}
