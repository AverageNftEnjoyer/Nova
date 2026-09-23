import type { NovaState } from "@/lib/chat/hooks/useNovaState"

type NovaPresence = {
  label: "IDLE" | "LISTENING" | "THINKING" | "SPEAKING" | "DOWN"
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
      label: "DOWN",
      dotClassName: "bg-red-400",
      textClassName: "text-red-300",
    }
  }

  if (novaState === "speaking") {
    return {
      label: "SPEAKING",
      dotClassName: "bg-amber-400",
      textClassName: "text-amber-300",
    }
  }

  if (novaState === "thinking") {
    return {
      label: "THINKING",
      dotClassName: "bg-amber-400",
      textClassName: "text-amber-300",
    }
  }

  if (novaState === "listening") {
    return {
      label: "LISTENING",
      dotClassName: "bg-sky-400",
      textClassName: "text-sky-300",
    }
  }

  return {
    label: "IDLE",
    dotClassName: "bg-emerald-400",
    textClassName: "text-emerald-300",
  }
}
