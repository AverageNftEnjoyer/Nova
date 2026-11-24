import type { AgentPermissionMode } from "@/lib/agents/types"

export const PERMISSION_MODE_LABELS: Record<AgentPermissionMode, string> = {
  default: "Default",
  "accept-edits": "Accept edits",
  "plan-mode": "Plan mode",
  "dont-ask": "Don't ask",
  bypass: "Bypass",
}
