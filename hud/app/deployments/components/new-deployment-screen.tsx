"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"

import { PageHeader, Tabs, TabsList, TabsTrigger, toast } from "@/components/ui"
import { PageContainer } from "@/components/shell"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import type { DeploymentLaunch } from "../hooks/use-deployment-actions"
import { NewDeploymentFlow } from "./new-deployment-flow"
import { NEW_DEPLOYMENT_TABS, isNewDeploymentTab, type NewDeploymentTab } from "./new-deployment-tabs"

/**
 * /deployments/new?tab=describe|task|automation[&prompt=...]: an invalid tab falls back to Describe; `prompt` prefills
 * Describe once (it is never submitted on its own). Launching goes to the new run on /runs.
 */
export function NewDeploymentScreen() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get("tab")
  const [tab, setTab] = useState<NewDeploymentTab>(isNewDeploymentTab(requestedTab) ? requestedTab : "describe")
  const [initialPrompt] = useState(() => searchParams.get("prompt") ?? "")
  const [status, setStatus] = useState("")
  const [canvasOpen, setCanvasOpen] = useState(false)
  const nova = useNovaState()
  const current = NEW_DEPLOYMENT_TABS.find((entry) => entry.id === tab) ?? NEW_DEPLOYMENT_TABS[0]

  const selectTab = (value: string) => {
    if (!isNewDeploymentTab(value)) return
    setTab(value)
    setStatus("")
    // Keep the tab shareable; drops the one-shot prompt and any legacy params.
    router.replace(`${pathname}?tab=${value}`, { scroll: false })
  }

  const onLaunched = (message: string, launch: DeploymentLaunch) => {
    toast.success({ title: "Deployment launched", description: `${message}. Its run is open.` })
    router.push(`/runs?run=${encodeURIComponent(launch.runId)}`)
  }

  const simple = NEW_DEPLOYMENT_TABS.filter((entry) => entry.mode === "simple")
  const advanced = NEW_DEPLOYMENT_TABS.filter((entry) => entry.mode === "advanced")

  return (
    <PageContainer data-escape-owner={canvasOpen ? "canvas" : undefined}>
      <Tabs value={tab} onValueChange={selectTab}>
        <PageHeader
          title="New deployment"
          description={current.hint}
          tabs={
            <TabsList aria-label="How to deploy">
              {simple.map((entry) => (
                <TabsTrigger key={entry.id} value={entry.id}>
                  {entry.label}
                </TabsTrigger>
              ))}
              <span aria-hidden className="my-2.5 w-px bg-border" />
              <span className="self-center text-xs text-faint">Advanced</span>
              {advanced.map((entry) => (
                <TabsTrigger key={entry.id} value={entry.id}>
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          }
        />
      </Tabs>
      {status ? (
        <p role="status" className="mb-4 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
          {status}
        </p>
      ) : null}
      <div role="tabpanel" aria-label={current.label}>
        <NewDeploymentFlow
          nova={nova}
          tab={tab}
          initialPrompt={initialPrompt}
          onStatus={setStatus}
          onLaunched={onLaunched}
          onCanvasOpenChange={setCanvasOpen}
          builderHref={`/missions?create=builder&returnTo=${encodeURIComponent("/deployments/new?tab=automation")}`}
        />
      </div>
    </PageContainer>
  )
}
