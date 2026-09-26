import { requireLocalUser } from "@/lib/auth/local-user"
import { listDeploymentEvents, syncDeploymentRuns } from "@/lib/deployments/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const POLL_MS = 750
const STREAM_LIFETIME_MS = 25_000

export async function GET(req: Request) {
  const { userId } = await requireLocalUser()
  const url = new URL(req.url)
  const headerCursor = Number(req.headers.get("last-event-id") || 0)
  const queryCursor = Number(url.searchParams.get("after") || 0)
  let cursor = Math.max(0, Number.isFinite(headerCursor) ? headerCursor : 0, Number.isFinite(queryCursor) ? queryCursor : 0)
  const encoder = new TextEncoder()
  let cancelled = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const startedAt = Date.now()
      const write = (value: string) => {
        if (!cancelled) controller.enqueue(encoder.encode(value))
      }
      const tick = () => {
        if (cancelled) return
        try {
          syncDeploymentRuns(userId)
          const events = listDeploymentEvents(userId, cursor, 200)
          for (const event of events) {
            cursor = event.seq
            write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)
          }
          if (events.length === 0) write(`: keepalive ${Date.now()}\n\n`)
          if (Date.now() - startedAt >= STREAM_LIFETIME_MS) {
            cancelled = true
            controller.close()
            return
          }
          setTimeout(tick, POLL_MS)
        } catch (error) {
          write(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : "Event stream failed." })}\n\n`)
          cancelled = true
          controller.close()
        }
      }
      tick()
    },
    cancel() {
      cancelled = true
    },
  })

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
