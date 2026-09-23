// Size-capped request body reading, dependency-free so it can be unit tested.

/** Whole-request cap for PUT /api/ui-storage: one value is capped at 8M chars (keys.ts), plus JSON overhead. */
export const MAX_UI_STORAGE_BODY_BYTES = 12 * 1024 * 1024

export class BodyTooLargeError extends Error {}
export class BodyParseError extends Error {}

/**
 * Reads a JSON body while enforcing `maxBytes`: rejects on an oversized Content-Length before touching the
 * body, and enforces the same cap while streaming when the header is absent or wrong.
 */
export async function readJsonBodyLimited(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError("Request body is too large.")

  let text = ""
  if (req.body) {
    const reader = req.body.getReader()
    const decoder = new TextDecoder()
    let received = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > maxBytes) throw new BodyTooLargeError("Request body is too large.")
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new BodyParseError("Invalid JSON body.")
  }
}
