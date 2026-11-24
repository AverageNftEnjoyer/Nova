"use client"

import { useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { PageHeader } from "@/components/ui"
import { PageContainer } from "@/components/shell"
import { useDeploymentsData } from "@/app/deployments/hooks/use-deployments-data"
import { useAgentTasks } from "../hooks/use-agent-tasks"
import { useHomeAnalyticsSummary } from "../hooks/use-home-analytics-summary"
import { useHomeConnections } from "../hooks/use-home-connections"
import { useHomeNotes } from "../hooks/use-home-notes"
import { useHomeRuntime } from "../hooks/use-home-runtime"
import { useHomeSchedule } from "../hooks/use-home-schedule"
import { useNow } from "../hooks/use-now"
import { HomeChats } from "./home-chats"
import { HomeComposer } from "./home-composer"
import { HomeDeployments } from "./home-deployments"
import { HomeIntegrations } from "./home-integrations"
import { HomeLiveWork } from "./home-live-work"
import { HomeNotes } from "./home-notes"
import { HomeSchedule } from "./home-schedule"
import { HomeUsage } from "./home-usage"
import { HomeWeather } from "./home-weather"

/** Query keys older links (the retired city rooms, redirects) may append to /home. Home reads none of them. */
const STALE_QUERY_KEYS = ["room", "section", "tab", "mode", "kind"] as const

function greeting(now: number): string {
  const hour = new Date(now).getHours()
  if (hour < 5) return "Good evening"
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

/** Home: the command center. Ask or deploy at the top, live work below it, the quieter context on the right. */
export function HomeMainScreen() {
  const now = useNow()
  // One mount each: useAgentTasks sends the native "task finished" notifications, useHomeRuntime holds the runtime
  // socket that feeds live budget events.
  const runtime = useHomeRuntime()
  const agentTasks = useAgentTasks()
  const deployments = useDeploymentsData()
  const usage = useHomeAnalyticsSummary()
  const connections = useHomeConnections()
  const schedule = useHomeSchedule()
  const notes = useHomeNotes()

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Replaced through the router (not history.replaceState) so Next's own URL state does not restore the old query.
  useEffect(() => {
    const stale = STALE_QUERY_KEYS.filter((key) => searchParams.has(key))
    if (stale.length === 0) return
    const next = new URLSearchParams(searchParams.toString())
    for (const key of stale) next.delete(key)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

  return (
    <PageContainer width="wide" className="@container">
      <PageHeader title={greeting(now)} description={<HomeWeather />} />

      <div className="grid grid-cols-1 items-start gap-6 @min-[68rem]:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] @min-[90rem]:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <HomeComposer modelLabel={connections.activeModelLabel} />
          <HomeLiveWork deployments={deployments} agentTasks={agentTasks} />
          <HomeDeployments deployments={deployments} nextMissionRun={schedule.nextMissionRun} now={now} />
        </div>

        <aside aria-label="Overview" className="@container/side min-w-0">
          <div className="grid grid-cols-1 items-start gap-6 @min-[40rem]/side:grid-cols-2">
            <HomeUsage usage={usage} />
            <HomeIntegrations state={connections} />
            <HomeSchedule schedule={schedule} now={now} />
            <HomeNotes notesState={notes} now={now} />
            <HomeChats conversations={runtime.conversations} now={now} />
          </div>
        </aside>
      </div>
    </PageContainer>
  )
}
