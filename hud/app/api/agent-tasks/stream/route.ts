import { ensureTaskRunnerStarted } from "@/lib/agents/task-runner"
import { subscribeTaskEvents } from "@/lib/agents/task-events"
import { getTaskStats, listTasks } from "@/lib/agents/task-store"
import type { AgentTaskEvent } from "@/lib/agents/types"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireLocalUser } from "@/lib/auth/local-user"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const HEARTBEAT_MS = 25_000

export async function GET(req: Request) {
  const { userId } = await requireLocalUser()
  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.agentTasksRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  ensureTaskRunnerStarted(userId)

  const encoder = new TextEncoder()
  let cleanup = () => {}

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let ready = false
      const buffered: AgentTaskEvent[] = []

      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }
      const sendEvent = (event: unknown) => send(`data: ${JSON.stringify(event)}\n\n`)

      // Subscribe before the snapshot read so no change is lost in between.
      // Events buffered before the snapshot are flushed after it; clients keep the newer updatedAt.
      const unsubscribe = subscribeTaskEvents(userId, (event) => {
        if (ready) sendEvent(event)
        else buffered.push(event)
      })
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS)

      cleanup = () => {
        if (closed) return
        closed = true
        unsubscribe()
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {
          // Already closed by the client.
        }
      }
      req.signal.addEventListener("abort", cleanup)
      if (req.signal.aborted) {
        cleanup()
        return
      }

      try {
        const [tasks, stats] = await Promise.all([listTasks(userId), getTaskStats(userId)])
        sendEvent({ type: "snapshot", tasks, stats })
        ready = true
        for (const event of buffered) sendEvent(event)
        buffered.length = 0
      } catch {
        cleanup()
      }
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}
