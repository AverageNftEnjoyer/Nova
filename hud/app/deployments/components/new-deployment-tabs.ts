import { Boxes, MessageSquareText, Workflow } from "lucide-react"

export type NewDeploymentTab = "describe" | "task" | "automation"

export const NEW_DEPLOYMENT_TABS: Array<{ id: NewDeploymentTab; label: string; icon: typeof Boxes; hint: string }> = [
  { id: "describe", label: "Describe it", icon: MessageSquareText, hint: "U.B Agents plans it and picks the tools" },
  { id: "task", label: "One-off task", icon: Boxes, hint: "You pick the model and limits" },
  { id: "automation", label: "Automation", icon: Workflow, hint: "Runs on a schedule or an event" },
]

/** `?mode=simple` opens Describe; `?mode=advanced&kind=task|automation` opens the Advanced tabs. */
export function newDeploymentTabFromParams(mode: string | null, kind: string | null): NewDeploymentTab {
  if (mode !== "advanced") return "describe"
  return kind === "automation" ? "automation" : "task"
}

export function newDeploymentTabHref(tab: NewDeploymentTab): string {
  return tab === "describe" ? "/deployments?mode=simple" : `/deployments?mode=advanced&kind=${tab}`
}
