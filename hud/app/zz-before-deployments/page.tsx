"use client"

import {
  ArrowLeft,
  Bot,
  Boxes,
  Loader2,
  MessageSquare,
  Send,
  Workflow,
} from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { AdvancedTaskForm } from "./create-task-modal"
import { DeploymentActivity } from "./deployment-activity"
import { MissionCanvasModal } from "@/app/missions/components/mission-canvas-modal"
import type { CreateAgentTaskInput } from "@/lib/agents/types"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { useTheme } from "@/lib/context/theme-context"
import type { Deployment, DeploymentPlan, DeploymentRun } from "@/lib/deployments/types"
import { defaultMissionSettings, type Mission } from "@/lib/missions/types"
import { cn } from "@/lib/shared/utils"

type WorkspaceMode = "simple" | "advanced"
type AdvancedKind = "task" | "automation"

function createMissionDraft(): Mission {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    userId: "",
    label: "New Automation",
    description: "",
    category: "personal",
    tags: [],
    status: "draft",
    version: 1,
    nodes: [],
    connections: [],
    variables: [],
    settings: defaultMissionSettings(),
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    integration: "telegram",
    chatIds: [],
  }
}

function DeploymentsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { theme } = useTheme()
  const isLight = theme === "light"
  const initialMode = searchParams.get("mode") === "advanced" ? "advanced" : "simple"
  const [mode, setMode] = useState<WorkspaceMode>(initialMode)
  const [advancedKind, setAdvancedKind] = useState<AdvancedKind>(
    searchParams.get("kind") === "automation" ? "automation" : "task",
  )
  const [managerInput, setManagerInput] = useState("")
  const [managerRequests, setManagerRequests] = useState<string[]>([])
  const [plannedDeployment, setPlannedDeployment] = useState<Deployment | null>(null)
  const [managerPlan, setManagerPlan] = useState<DeploymentPlan | null>(null)
  const [managerBusy, setManagerBusy] = useState(false)
  const [pendingManagerRequest, setPendingManagerRequest] = useState<{ outcome: string; sentAt: number } | null>(null)
  const [launching, setLaunching] = useState(false)
  const [managerError, setManagerError] = useState("")
  const [conversationId] = useState(() => `deployment-manager-${crypto.randomUUID()}`)
  const [mission, setMission] = useState<Mission | null>(null)
  const [missionBusy, setMissionBusy] = useState(false)
  const [status, setStatus] = useState("")
  const {
    agentMessages,
    connected,
    sendToAgent,
    state: novaState,
    streamingAssistantId,
    thinkingStatus,
  } = useNovaState()
  const processedAssistantId = useRef("")

  const managerMessages = useMemo(
    () => agentMessages.filter((message) => message.conversationId === conversationId),
    [agentMessages, conversationId],
  )

  const panelClass = isLight
    ? "border-[#d9e0ea] bg-white text-s-90"
    : "border-white/10 bg-[#090d14]/92 text-slate-100"
  const mutedClass = isLight ? "text-s-50" : "text-slate-400"

  const selectMode = (value: WorkspaceMode) => {
    setMode(value)
    router.replace(`/deployments?mode=${value}&kind=${advancedKind}`, { scroll: false })
  }

  const selectAdvancedKind = (value: AdvancedKind) => {
    setAdvancedKind(value)
    router.replace(`/deployments?mode=advanced&kind=${value}`, { scroll: false })
  }

  const requestValidatedPlan = useCallback(async (outcome: string, proposal?: string) => {
    try {
      const response = await fetch("/api/deployments/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, conversationId, proposal }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        deployment?: Deployment
        plan?: DeploymentPlan
        error?: string
      }
      if (!response.ok || !data.ok || !data.deployment || !data.plan) {
        throw new Error(data.error || "Nova could not produce a valid deployment plan.")
      }
      setPlannedDeployment(data.deployment)
      setManagerPlan(data.plan)
    } catch (error) {
      setManagerError(error instanceof Error ? error.message : "Nova could not produce a deployment plan.")
    } finally {
      setManagerBusy(false)
      setPendingManagerRequest(null)
    }
  }, [conversationId])

  useEffect(() => {
    if (!pendingManagerRequest || streamingAssistantId) return
    const response = [...managerMessages]
      .reverse()
      .find((message) => message.role === "assistant" && message.ts >= pendingManagerRequest.sentAt)
    if (!response || response.id === processedAssistantId.current) return
    processedAssistantId.current = response.id
    void requestValidatedPlan(pendingManagerRequest.outcome, response.content)
  }, [managerMessages, pendingManagerRequest, requestValidatedPlan, streamingAssistantId])

  useEffect(() => {
    if (!pendingManagerRequest) return
    const timeout = window.setTimeout(() => {
      void requestValidatedPlan(pendingManagerRequest.outcome)
    }, 60_000)
    return () => window.clearTimeout(timeout)
  }, [pendingManagerRequest, requestValidatedPlan])

  const submitManagerRequest = (event: FormEvent) => {
    event.preventDefault()
    const outcome = managerInput.trim()
    if (!outcome || managerBusy) return
    setManagerRequests((current) => [...current, outcome])
    setManagerInput("")
    setManagerBusy(true)
    setManagerError("")
    setManagerPlan(null)
    setPlannedDeployment(null)
    if (!connected) {
      void requestValidatedPlan(outcome)
      return
    }
    const sentAt = Date.now()
    setPendingManagerRequest({ outcome, sentAt })
    sendToAgent(
      [
        "Create a deployment plan for the outcome below.",
        "Return exactly one JSON object with no markdown or prose.",
        'Schema: {"outcome":"string","acceptanceCriteria":["string"],"kind":"task|automation","specialists":["allowed Nova specialist id"],"tools":["tool_name"],"context":["string"],"risk":"low|medium|high","budgetEstimate":{"costUsd":number|null,"tokens":number|null,"confidence":"low|medium|high"},"reviewRequired":boolean,"rationale":"string"}.',
        "Choose automation only for recurring, scheduled, event-triggered, or reusable work.",
        `Outcome: ${outcome}`,
      ].join("\n"),
      false,
      "default",
      {
        conversationId,
        sessionKey: `deployments:${conversationId}`,
        sender: "deployment-manager",
        nlpBypass: true,
      },
    )
  }

  const launchPlannedDeployment = async () => {
    if (!plannedDeployment || launching) return
    setLaunching(true)
    setManagerError("")
    try {
      const response = await fetch("/api/deployment-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deploymentId: plannedDeployment.id,
          idempotencyKey: crypto.randomUUID(),
          approved: managerPlan?.reviewRequired === true,
        }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        run?: DeploymentRun
        outcome?: string
        error?: string
      }
      if (!response.ok || !data.ok || !data.run) throw new Error(data.error || "Deployment launch failed.")
      setStatus(data.outcome === "automation_deployed" ? "Automation deployed." : "Task queued.")
    } catch (error) {
      setManagerError(error instanceof Error ? error.message : "Deployment launch failed.")
    } finally {
      setLaunching(false)
    }
  }

  const createAdvancedTask = async (
    input: CreateAgentTaskInput,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const createResponse = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "task",
          status: "ready",
          title: input.name,
          outcome: input.prompt,
          config: {
            provider: input.agent,
            model: input.model,
            priority: input.priority,
            permissionMode: input.permissionMode,
            useWorktree: input.useWorktree,
            attachedFiles: input.attachedFiles,
            contextId: input.contextId,
            costBudgetUsd: input.costBudgetUsd,
            tokenBudget: input.tokenBudget,
          },
        }),
      })
      const created = (await createResponse.json()) as { ok?: boolean; deployment?: Deployment; error?: string }
      if (!createResponse.ok || !created.ok || !created.deployment) {
        throw new Error(created.error || "Failed to create deployment.")
      }
      const launchResponse = await fetch("/api/deployment-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deploymentId: created.deployment.id, idempotencyKey: crypto.randomUUID() }),
      })
      const launched = (await launchResponse.json()) as { ok?: boolean; error?: string }
      if (!launchResponse.ok || !launched.ok) throw new Error(launched.error || "Failed to queue deployment.")
      setStatus("Task queued.")
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Failed to queue deployment." }
    }
  }

  const saveMission = async (draft: Mission): Promise<Mission> => {
    const response = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mission: draft }),
    })
    const data = (await response.json()) as { ok?: boolean; mission?: Mission; error?: string }
    if (!response.ok || !data.ok || !data.mission) throw new Error(data.error || "Failed to save automation.")
    return data.mission
  }

  const handleMissionSave = async (draft: Mission): Promise<boolean> => {
    setMissionBusy(true)
    setStatus("")
    try {
      const saved = await saveMission(draft)
      const deploymentResponse = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "automation",
          status: "draft",
          title: saved.label,
          outcome: saved.description || saved.label,
          missionId: saved.id,
        }),
      })
      if (!deploymentResponse.ok) {
        const data = (await deploymentResponse.json()) as { error?: string }
        throw new Error(data.error || "Failed to create automation deployment.")
      }
      setMission(saved)
      setStatus(`Automation "${saved.label}" saved as a draft.`)
      return true
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save automation.")
      return false
    } finally {
      setMissionBusy(false)
    }
  }

  const handleMissionRun = async (draft: Mission) => {
    setMissionBusy(true)
    setStatus("")
    try {
      const saved = await saveMission(draft)
      setMission(saved)
      const deploymentResponse = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "automation",
          status: "ready",
          title: saved.label,
          outcome: saved.description || saved.label,
          missionId: saved.id,
        }),
      })
      const deploymentData = (await deploymentResponse.json()) as {
        ok?: boolean
        deployment?: Deployment
        error?: string
      }
      if (!deploymentResponse.ok || !deploymentData.ok || !deploymentData.deployment) {
        throw new Error(deploymentData.error || "Failed to create automation deployment.")
      }
      const launchResponse = await fetch("/api/deployment-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deploymentId: deploymentData.deployment.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
      const launchData = (await launchResponse.json()) as { ok?: boolean; error?: string }
      if (!launchResponse.ok || !launchData.ok) throw new Error(launchData.error || "Automation run failed.")
      setStatus("Automation queued.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to run automation.")
    } finally {
      setMissionBusy(false)
    }
  }

  return (
    <main className={cn("min-h-dvh px-4 py-5 lg:px-8", isLight ? "bg-[#f6f8fc]" : "bg-[#05070b]")}>
      <div className="mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-7xl flex-col gap-4">
        <header className={cn("flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-4 py-3", panelClass)}>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/home")}
              aria-label="Back to Home"
              className={cn("rounded-lg border p-2 transition-colors", isLight ? "border-[#d9e0ea] hover:bg-slate-50" : "border-white/10 hover:bg-white/5")}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <p className={cn("text-[10px] uppercase tracking-[0.2em]", mutedClass)}>Nova workspace</p>
              <h1 className="text-xl font-semibold tracking-tight">Deployments</h1>
            </div>
          </div>
          <div className={cn("inline-flex rounded-xl border p-1", isLight ? "border-[#d9e0ea] bg-[#f6f8fc]" : "border-white/10 bg-black/20")}>
            {(["simple", "advanced"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => selectMode(value)}
                aria-pressed={mode === value}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors",
                  mode === value
                    ? "bg-accent text-white shadow-sm"
                    : isLight ? "text-s-60 hover:text-s-90" : "text-slate-400 hover:text-slate-100",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </header>

        {mode === "simple" ? (
          <section className={cn("grid min-h-0 flex-1 overflow-hidden rounded-2xl border lg:grid-cols-[18rem_1fr]", panelClass)}>
            <aside className={cn("border-b p-5 lg:border-b-0 lg:border-r", isLight ? "border-[#d9e0ea]" : "border-white/10")}>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/12 text-accent">
                <Bot className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-base font-semibold">Nova Manager</h2>
              <p className={cn("mt-2 text-sm leading-6", mutedClass)}>
                Describe the result you want. Nova will decide whether it is a one-off task or a reusable automation,
                choose the right tools, and ask for review when the work is sensitive.
              </p>
              <div className={cn("mt-5 flex items-center gap-2 text-xs", connected ? "text-emerald-500" : "text-amber-500")}>
                <span className={cn("h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-amber-500")} />
                {connected ? "Manager online" : "Connecting to Nova"}
              </div>
            </aside>

            <div className="flex min-h-[34rem] flex-col">
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                {managerMessages.length === 0 && managerRequests.length === 0 ? (
                  <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
                    <MessageSquare className={cn("h-8 w-8", mutedClass)} />
                    <h2 className="mt-4 text-lg font-semibold">What should Nova deploy?</h2>
                    <p className={cn("mt-2 max-w-lg text-sm leading-6", mutedClass)}>
                      Try “Research three accounting tools, compare them against my requirements, and send me a recommendation.”
                    </p>
                  </div>
                ) : (
                  managerRequests.map((request, index) => (
                    <article
                      key={`${request}-${index}`}
                      className="ml-auto max-w-[85%] rounded-2xl bg-accent px-4 py-3 text-sm leading-6 text-white"
                    >
                      {request}
                    </article>
                  ))
                )}
                {managerBusy || novaState === "thinking" ? (
                  <div className={cn("flex items-center gap-2 text-sm", mutedClass)}>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {managerBusy ? "Nova is building and validating the deployment plan…" : thinkingStatus || "Nova is planning…"}
                  </div>
                ) : null}
                {managerPlan && plannedDeployment ? (
                  <article className={cn("max-w-[92%] rounded-2xl border p-4", isLight ? "border-[#d9e0ea] bg-[#f7f9fc]" : "border-white/10 bg-white/5")}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className={cn("text-[10px] uppercase tracking-[0.16em]", mutedClass)}>Validated manager plan</p>
                        <h3 className="mt-1 font-semibold">{plannedDeployment.title}</h3>
                      </div>
                      <span className="rounded-full bg-accent/12 px-2.5 py-1 text-xs font-medium capitalize text-accent">
                        {managerPlan.kind}
                      </span>
                    </div>
                    <ul className={cn("mt-3 space-y-1 text-sm", mutedClass)}>
                      {managerPlan.acceptanceCriteria.map((criterion) => <li key={criterion}>• {criterion}</li>)}
                    </ul>
                    <div className={cn("mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs", mutedClass)}>
                      <span>Risk: {managerPlan.risk}</span>
                      <span>Review: {managerPlan.reviewRequired ? "required" : "not required"}</span>
                      <span>Specialists: {managerPlan.specialists.join(", ")}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void launchPlannedDeployment()}
                      disabled={launching}
                      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {managerPlan.kind === "automation" ? "Deploy automation" : "Queue task"}
                    </button>
                  </article>
                ) : null}
                {managerError ? <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-500">{managerError}</p> : null}
              </div>
              <form onSubmit={submitManagerRequest} className={cn("border-t p-4", isLight ? "border-[#d9e0ea]" : "border-white/10")}>
                <div className={cn("flex items-end gap-2 rounded-xl border p-2", isLight ? "border-[#cfd8e6] bg-white" : "border-white/12 bg-black/30")}>
                  <textarea
                    value={managerInput}
                    onChange={(event) => setManagerInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        event.currentTarget.form?.requestSubmit()
                      }
                    }}
                    rows={3}
                    placeholder="Describe an outcome, not implementation steps…"
                    className="min-h-20 flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-slate-500"
                  />
                  <button
                    type="submit"
                    disabled={managerBusy || !managerInput.trim()}
                    aria-label="Send deployment request"
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : (
          <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[15rem_1fr]">
            <aside className={cn("rounded-2xl border p-3", panelClass)}>
              <p className={cn("px-2 py-2 text-[10px] uppercase tracking-[0.18em]", mutedClass)}>Deployment kind</p>
              {([
                { value: "task", label: "One-off task", icon: Boxes },
                { value: "automation", label: "Automation", icon: Workflow },
              ] as const).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => selectAdvancedKind(value)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors",
                    advancedKind === value
                      ? "bg-accent/12 font-medium text-accent"
                      : isLight ? "text-s-70 hover:bg-slate-50" : "text-slate-300 hover:bg-white/5",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => router.push("/missions?returnTo=/deployments")}
                className={cn("mt-4 w-full rounded-lg px-3 py-2 text-left text-xs transition-colors", mutedClass, isLight ? "hover:bg-slate-50" : "hover:bg-white/5")}
              >
                View existing automations
              </button>
            </aside>

            <div className="min-w-0">
              {advancedKind === "task" ? (
                <AdvancedTaskForm
                  open
                  mode="embedded"
                  isLight={isLight}
                  onClose={() => setStatus("Task queued.")}
                  onCreate={createAdvancedTask}
                />
              ) : (
                <div className={cn("flex min-h-[34rem] flex-col items-center justify-center rounded-2xl border p-8 text-center", panelClass)}>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/12 text-accent">
                    <Workflow className="h-6 w-6" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold">Build an automation</h2>
                  <p className={cn("mt-2 max-w-lg text-sm leading-6", mutedClass)}>
                    Use the existing mission graph for schedules, integrations, deterministic steps, reliability, and review.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => router.push("/missions?create=builder&returnTo=/deployments")}
                      className={cn("rounded-lg border px-4 py-2 text-sm font-medium", isLight ? "border-[#d9e0ea] hover:bg-slate-50" : "border-white/10 hover:bg-white/5")}
                    >
                      Use guided builder
                    </button>
                    <button
                      type="button"
                      onClick={() => setMission(createMissionDraft())}
                      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
                    >
                      Open automation canvas
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        <DeploymentActivity isLight={isLight} />
        {status ? <p className={cn("text-center text-sm", mutedClass)}>{status}</p> : null}
      </div>

      <MissionCanvasModal
        mission={mission}
        open={Boolean(mission)}
        onClose={() => setMission(null)}
        onSave={handleMissionSave}
        onRun={handleMissionRun}
        isSaving={missionBusy}
      />
    </main>
  )
}

export default function DeploymentsPage() {
  return (
    <Suspense fallback={null}>
      <DeploymentsPageContent />
    </Suspense>
  )
}
