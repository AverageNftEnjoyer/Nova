import { Badge } from "@/components/ui"
import { PHASE_META, type RunPhase } from "../lib/run-rows"

/** Status of a run: tone dot plus label; a running run's dot pulses. */
export function RunStatusBadge({ phase }: { phase: RunPhase }) {
  const meta = PHASE_META[phase]
  return (
    <Badge tone={meta.tone} dot={meta.live ? "pulse" : true}>
      {meta.label}
    </Badge>
  )
}
