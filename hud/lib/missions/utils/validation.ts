/**
 * Validation Utilities
 *
 * Functions for validating workflow data and conditions.
 */

/**
 * Check if context data has usable content.
 */
export function hasUsableContextData(data: unknown): boolean {
  if (data === null || typeof data === "undefined") return false
  if (typeof data === "string") return data.trim().length > 0
  if (Array.isArray(data)) return data.length > 0
  if (typeof data === "object") {
    const record = data as Record<string, unknown>
    if (typeof record.error === "string" && record.error.trim()) return false
    if ("payload" in record) {
      const payload = record.payload
      if (payload === null || typeof payload === "undefined") return false
      if (typeof payload === "string") return payload.trim().length > 0
      if (Array.isArray(payload)) return payload.length > 0
      if (typeof payload === "object") {
        const payloadRecord = payload as Record<string, unknown>
        if (Array.isArray(payloadRecord.results)) {
          const viable = payloadRecord.results.some((item) => {
            if (!item || typeof item === "object") {
              const row = item as Record<string, unknown>
              const snippet = String(row?.snippet || "").trim()
              const pageText = String(row?.pageText || "").trim()
              return snippet.length > 0 || pageText.length > 0
            }
            return false
          })
          if (viable) return true
        }
        if (typeof payloadRecord.text === "string" && payloadRecord.text.trim().length > 0) return true
        return Object.keys(payloadRecord).length > 0
      }
      return true
    }
    return Object.keys(record).length > 0
  }
  return true
}

/**
 * Check if a condition field path is invalid (has template expressions, brackets, etc.).
 */
export function isInvalidConditionFieldPath(value: string): boolean {
  const field = String(value || "").trim()
  if (!field) return true
  if (field.includes("{{") || field.includes("}}")) return true
  if (field.includes("[") || field.includes("]")) return true
  return false
}

/**
 * Check if a recipient string is a template placeholder.
 */
export function isTemplateRecipient(value: string): boolean {
  const text = String(value || "").trim()
  return /^\{\{\s*[^}]+\s*\}\}$/.test(text)
}

/**
 * Check if text represents "no data" response.
 */
export function isNoDataText(value: string): boolean {
  return /^no[_\s-]?data\.?$/i.test(String(value || "").trim())
}
