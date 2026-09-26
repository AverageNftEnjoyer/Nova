"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"

import { useNovaState, type NovaState } from "@/lib/chat/hooks/useNovaState"
import type { Deployment, DeploymentPlan, DeploymentRun } from "@/lib/deployments/types"

/** How long the manager waits for Nova's streamed proposal before asking the server to plan on its own. */
const PROPOSAL_TIMEOUT_MS = 60_000

function buildPlanningPrompt(outcome: string): string {
  return [
    "Create a deployment plan for the outcome below.",
    "Return exactly one JSON object with no markdown or prose.",
    'Schema: {"outcome":"string","acceptanceCriteria":["string"],"kind":"task|automation","specialists":["allowed Nova specialist id"],"tools":["tool_name"],"context":["string"],"risk":"low|medium|high","budgetEstimate":{"costUsd":number|null,"tokens":number|null,"confidence":"low|medium|high"},"reviewRequired":boolean,"rationale":"string"}.',
    "Choose automation only for recurring, scheduled, event-triggered, or reusable work.",
    `Outcome: ${outcome}`,
  ].join("\n")
}

export interface DeploymentManager {
  connected: boolean
  novaState: NovaState
  thinkingStatus: string
  input: string
  setInput: (value: string) => void
  requests: string[]
  busy: boolean
  plan: DeploymentPlan | null
  plannedDeployment: Deployment | null
  launching: boolean
  error: string
  submit: (event: FormEvent) => void
  launch: () => Promise<void>
}

/**
 * Simple mode: sends a strict planning request over Nova's WebSocket, then has the server validate the
 * streamed proposal into a versioned deployment (`/api/deployments/plan`) before anything can launch.
 */
export function useDeploymentManager(onStatus: (message: string) => void): DeploymentManager {
  const [input, setInput] = useState("")
  const [requests, setRequests] = useState<string[]>([])
  const [plannedDeployment, setPlannedDeployment] = useState<Deployment | null>(null)
  const [plan, setPlan] = useState<DeploymentPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ outcome: string; sentAt: number } | null>(null)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState("")
  const [conversationId] = useState(() => `deployment-manager-${crypto.randomUUID()}`)
  const { agentMessages, connected, sendToAgent, state: novaState, streamingAssistantId, thinkingStatus } = useNovaState()
  const processedAssistantId = useRef("")

  const managerMessages = useMemo(
    () => agentMessages.filter((message) => message.conversationId === conversationId),
    [agentMessages, conversationId],
  )

  const requestValidatedPlan = useCallback(
    async (outcome: string, proposal?: string) => {
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
        setPlan(data.plan)
      } catch (planError) {
        setError(planError instanceof Error ? planError.message : "Nova could not produce a deployment plan.")
      } finally {
        setBusy(false)
        setPending(null)
      }
    },
    [conversationId],
  )

  useEffect(() => {
    if (!pending || streamingAssistantId) return
    const response = [...managerMessages]
      .reverse()
      .find((message) => message.role === "assistant" && message.ts >= pending.sentAt)
    if (!response || response.id === processedAssistantId.current) return
    processedAssistantId.current = response.id
    void requestValidatedPlan(pending.outcome, response.content)
  }, [managerMessages, pending, requestValidatedPlan, streamingAssistantId])

  useEffect(() => {
    if (!pending) return
    const timeout = window.setTimeout(() => void requestValidatedPlan(pending.outcome), PROPOSAL_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [pending, requestValidatedPlan])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const outcome = input.trim()
    if (!outcome || busy) return
    setRequests((current) => [...current, outcome])
    setInput("")
    setBusy(true)
    setError("")
    setPlan(null)
    setPlannedDeployment(null)
    if (!connected) {
      void requestValidatedPlan(outcome)
      return
    }
    const sentAt = Date.now()
    setPending({ outcome, sentAt })
    sendToAgent(buildPlanningPrompt(outcome), false, "default", {
      conversationId,
      sessionKey: `deployments:${conversationId}`,
      sender: "deployment-manager",
      nlpBypass: true,
    })
  }

  const launch = async () => {
    if (!plannedDeployment || launching) return
    setLaunching(true)
    setError("")
    try {
      const response = await fetch("/api/deployment-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deploymentId: plannedDeployment.id,
          idempotencyKey: crypto.randomUUID(),
          approved: plan?.reviewRequired === true,
        }),
      })
      const data = (await response.json()) as { ok?: boolean; run?: DeploymentRun; outcome?: string; error?: string }
      if (!response.ok || !data.ok || !data.run) throw new Error(data.error || "Deployment launch failed.")
      onStatus(data.outcome === "automation_deployed" ? "Automation deployed." : "Task queued.")
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : "Deployment launch failed.")
    } finally {
      setLaunching(false)
    }
  }

  return {
    connected,
    novaState,
    thinkingStatus,
    input,
    setInput,
    requests,
    busy,
    plan,
    plannedDeployment,
    launching,
    error,
    submit,
    launch,
  }
}
