import { useState } from "react"
import { Activity, Bot, Pause, Play, RotateCcw, Timer } from "lucide-react"

import type { AgentHealthRow, AgentStatus } from "../types"

interface AgentRosterPanelProps {
  agents: AgentHealthRow[]
  isLight: boolean
}

const statusClass: Record<AgentStatus, string> = {
  active: "text-emerald-300",
  idle: "text-amber-300",
  paused: "text-slate-400",
}

export function AgentRosterPanel({ agents, isLight }: AgentRosterPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>(() =>
    agents.reduce((acc, agent) => ({ ...acc, [agent.id]: agent.status }), {}),
  )

  const activeCount = Object.values(statuses).filter((status) => status === "active").length

  return (
    <section className={`home-spotlight-shell rounded-2xl border p-4 ${isLight ? "border-[#d9e0ea] bg-white" : "border-white/10 bg-white/[0.03] backdrop-blur-xl"}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <Bot className="h-4 w-4 text-accent" />
          <h3 className={`text-sm uppercase tracking-[0.22em] font-semibold ${isLight ? "text-s-90" : "text-slate-200"}`}>Agent Roster</h3>
        </div>
        <span className="rounded-md border border-accent-30 bg-accent-10 px-2 py-1 text-xs font-mono text-accent">{activeCount}/{agents.length} active</span>
      </div>

      <div className="space-y-2">
        {agents.map((agent) => {
          const status = statuses[agent.id] || agent.status
          const isOpen = expanded === agent.id
          return (
            <div key={agent.id} className={`home-spotlight-card rounded-xl border ${isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/25"}`}>
              <button
                type="button"
                onClick={() => setExpanded((prev) => (prev === agent.id ? null : agent.id))}
                className="flex w-full items-center gap-3 px-3 py-2 text-left"
              >
                <Bot className="h-4 w-4 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm ${isLight ? "text-s-90" : "text-slate-100"}`}>{agent.name}</p>
                  <p className="text-xs text-s-50">{agent.role}</p>
                </div>
                <span className={`text-xs font-semibold uppercase tracking-[0.1em] ${statusClass[status]}`}>{status}</span>
              </button>

              {isOpen && (
                <div className={`border-t px-3 py-3 ${isLight ? "border-[#d5dce8]" : "border-white/10"}`}>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <div className="rounded-md border border-white/10 bg-black/10 px-2 py-1.5 text-xs">
                      <span className="text-s-50">Latency</span>
                      <p className="font-mono">{agent.avgLatencyMs}ms</p>
                    </div>
                    <div className="rounded-md border border-white/10 bg-black/10 px-2 py-1.5 text-xs">
                      <span className="text-s-50">Uptime</span>
                      <p className="font-mono">{agent.uptime}</p>
                    </div>
                    <div className="rounded-md border border-white/10 bg-black/10 px-2 py-1.5 text-xs">
                      <span className="text-s-50">Tasks</span>
                      <p className="font-mono">{agent.tasksCompleted.toLocaleString()}</p>
                    </div>
                    <div className="rounded-md border border-white/10 bg-black/10 px-2 py-1.5 text-xs">
                      <span className="text-s-50">Error</span>
                      <p className="font-mono">{agent.errorRatePct.toFixed(2)}%</p>
                    </div>
                  </div>

                  <p className="mb-2 text-xs text-s-50">Last task: {agent.lastTask}</p>

                  <div className="flex flex-wrap gap-2">
                    <button className="inline-flex items-center gap-1 rounded-md border border-accent-30 bg-accent-10 px-2 py-1 text-xs text-accent" onClick={() => setStatuses((prev) => ({ ...prev, [agent.id]: "active" }))}><Play className="h-3 w-3" /> Activate</button>
                    <button className="inline-flex items-center gap-1 rounded-md border border-amber-300/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300" onClick={() => setStatuses((prev) => ({ ...prev, [agent.id]: "idle" }))}><Timer className="h-3 w-3" /> Idle</button>
                    <button className="inline-flex items-center gap-1 rounded-md border border-slate-300/30 bg-slate-500/10 px-2 py-1 text-xs text-slate-300" onClick={() => setStatuses((prev) => ({ ...prev, [agent.id]: "paused" }))}><Pause className="h-3 w-3" /> Pause</button>
                    <button className="inline-flex items-center gap-1 rounded-md border border-cyan-300/30 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200" onClick={() => setStatuses((prev) => ({ ...prev, [agent.id]: "active" }))}><RotateCcw className="h-3 w-3" /> Restart</button>
                    <span className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-s-50"><Activity className="h-3 w-3" /> {agent.model || "N/A"}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
