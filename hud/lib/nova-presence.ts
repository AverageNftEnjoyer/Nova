import type { NovaState } from "@/lib/useNovaState"

type NovaPresence = {
  label: "NOVA ONLINE" | "NOVA THINKING" | "NOVA DISCONNECTED"
  dotClassName: string
  textClassName: string
}

export function getNovaPresence(params: {
  agentConnected?: boolean
  novaState?: NovaState
}): NovaPresence {
  const { agentConnected, novaState } = params

  if (!agentConnected) {
    return {
      label: "NOVA DISCONNECTED",
      dotClassName: "bg-red-400",
      textClassName: "text-red-300",
    }
  }

  if (novaState === "thinking") {
    return {
      label: "NOVA THINKING",
      dotClassName: "bg-amber-400",
      textClassName: "text-amber-300",
    }
  }

  return {
    label: "NOVA ONLINE",
    dotClassName: "bg-emerald-400",
    textClassName: "text-emerald-300",
  }
}

