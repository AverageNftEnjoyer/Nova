export type NewDeploymentTab = "describe" | "task" | "automation"

/** Describe is Simple mode; One-off task and Automation are Advanced. */
export const NEW_DEPLOYMENT_TABS: Array<{ id: NewDeploymentTab; label: string; mode: "simple" | "advanced"; hint: string }> = [
  { id: "describe", label: "Describe it", mode: "simple", hint: "Nova plans it and picks the tools." },
  { id: "task", label: "One-off task", mode: "advanced", hint: "You pick the provider, model, permissions and budget." },
  { id: "automation", label: "Automation", mode: "advanced", hint: "Runs on a schedule or an event, built in the Mission builder." },
]

export function isNewDeploymentTab(value: string | null | undefined): value is NewDeploymentTab {
  return NEW_DEPLOYMENT_TABS.some((entry) => entry.id === value)
}
