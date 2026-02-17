/**
 * Path and Template Utilities
 *
 * Functions for traversing object paths and interpolating templates.
 */

/**
 * Get a value from a nested object using dot-notation path.
 * @example getByPath({ a: { b: 1 } }, "a.b") // => 1
 */
export function getByPath(input: unknown, path: string): unknown {
  const parts = String(path || "").split(".").map((p) => p.trim()).filter(Boolean)
  let cur: unknown = input
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/**
 * Safely convert a value to a number, returning null if not possible.
 */
export function toNumberSafe(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * Interpolate template variables ({{key}}) with values from context.
 */
export function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    const value = getByPath(context, key)
    if (value === null || typeof value === "undefined") return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value)
  })
}

/**
 * Convert data to a text payload for display/logging.
 */
export function toTextPayload(data: unknown): string {
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  if (!data) return ""
  try {
    const text = JSON.stringify(data, null, 2)
    return text.length > 8000 ? `${text.slice(0, 8000)}\n...` : text
  } catch {
    return String(data)
  }
}
