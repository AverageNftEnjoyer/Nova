/**
 * Transform Node Executors
 */

import { runInNewContext } from "node:vm"
import type { SetVariablesNode, CodeNode, FormatNode, FilterNode, SortNode, DedupeNode, NodeOutput, ExecutionContext } from "../../types/index"

const CODE_EXEC_TIMEOUT_MS = 500
const FILTER_EXEC_TIMEOUT_MS = 100

// ─── Set Variables ────────────────────────────────────────────────────────────

export async function executeSetVariables(
  node: SetVariablesNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const BLOCKED_VAR_NAMES = new Set(["__proto__", "prototype", "constructor"])
  const assignments = node.assignments || []
  for (const { name, value } of assignments) {
    if (!name || BLOCKED_VAR_NAMES.has(name) || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) continue
    const resolved = ctx.resolveExpr(value)
    ctx.variables[name] = resolved
  }
  const passthrough = [...ctx.nodeOutputs.values()].map((o) => o.text).filter(Boolean).at(-1) || ""
  return {
    ok: true,
    text: passthrough,
    data: { assigned: assignments.map((a) => a.name) },
  }
}

// ─── Code ─────────────────────────────────────────────────────────────────────

export async function executeCode(
  node: CodeNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const inputText = node.inputExpression
    ? ctx.resolveExpr(node.inputExpression)
    : ([...ctx.nodeOutputs.values()].map((o) => o.text).filter(Boolean).at(-1) || "")

  try {
    const nodesProxy: Record<string, { output: { text?: string; data?: unknown } }> = {}
    for (const [id, output] of ctx.nodeOutputs.entries()) {
      nodesProxy[id] = { output }
    }
    // Run in an isolated vm context — prevents access to process, require, global etc.
    const sandbox = Object.create(null) as Record<string, unknown>
    sandbox.$input = inputText
    sandbox.$vars = { ...ctx.variables }
    sandbox.$nodes = nodesProxy
    // Wrap user code in a function so `return` statements work as expected
    const wrapped = `(function($input,$vars,$nodes){\n${node.code}\n})($input,$vars,$nodes)`
    const result = runInNewContext(wrapped, sandbox, { timeout: CODE_EXEC_TIMEOUT_MS, filename: "mission-code.js" })
    const text = typeof result === "string" ? result : JSON.stringify(result)
    return { ok: true, text, data: result }
  } catch (err) {
    return { ok: false, error: `Code execution error: ${String(err)}` }
  }
}

// ─── Format ───────────────────────────────────────────────────────────────────

export async function executeFormat(
  node: FormatNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const template = node.template || ""
  const rendered = ctx.resolveExpr(template)
  return {
    ok: true,
    text: rendered,
    data: { text: rendered, format: node.outputFormat || "text" },
  }
}

// ─── Filter ───────────────────────────────────────────────────────────────────

export async function executeFilter(
  node: FilterNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  // Get upstream items
  const upstreamItems = [...ctx.nodeOutputs.values()].flatMap((o) => o.items || []).filter(Boolean)
  if (upstreamItems.length === 0) {
    const text = [...ctx.nodeOutputs.values()].map((o) => o.text).filter(Boolean).at(-1) || ""
    return { ok: true, text, data: { filtered: false, reason: "no items array" } }
  }

  try {
    const mode = node.mode || "keep"
    const filtered = upstreamItems.filter((item) => {
      const sandbox = Object.create(null) as Record<string, unknown>
      sandbox.$item = item
      sandbox.$vars = { ...ctx.variables }
      try {
        const result = runInNewContext(`(${node.expression})`, sandbox, { timeout: FILTER_EXEC_TIMEOUT_MS, filename: "mission-filter.js" })
        return mode === "keep" ? Boolean(result) : !Boolean(result)
      } catch {
        return mode === "keep" ? false : true
      }
    })
    return {
      ok: true,
      text: JSON.stringify(filtered),
      data: filtered,
      items: filtered,
    }
  } catch (err) {
    return { ok: false, error: `Filter error: ${String(err)}` }
  }
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

export async function executeSort(
  node: SortNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const upstreamItems = [...ctx.nodeOutputs.values()].flatMap((o) => o.items || []).filter(Boolean)
  if (upstreamItems.length === 0) {
    const text = [...ctx.nodeOutputs.values()].map((o) => o.text).filter(Boolean).at(-1) || ""
    return { ok: true, text, data: { sorted: false } }
  }

  const dir = node.direction || "asc"
  const field = node.field
  const sorted = [...upstreamItems].sort((a, b) => {
    const av = getField(a, field)
    const bv = getField(b, field)
    if (typeof av === "number" && typeof bv === "number") {
      return dir === "asc" ? av - bv : bv - av
    }
    const as = String(av ?? "")
    const bs = String(bv ?? "")
    return dir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as)
  })

  return { ok: true, text: JSON.stringify(sorted), data: sorted, items: sorted }
}

function getField(obj: unknown, field: string): unknown {
  if (!obj || typeof obj !== "object") return undefined
  return (obj as Record<string, unknown>)[field]
}

// ─── Dedupe ───────────────────────────────────────────────────────────────────

export async function executeDedupe(
  node: DedupeNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  const upstreamItems = [...ctx.nodeOutputs.values()].flatMap((o) => o.items || []).filter(Boolean)
  if (upstreamItems.length === 0) {
    const text = [...ctx.nodeOutputs.values()].map((o) => o.text).filter(Boolean).at(-1) || ""
    return { ok: true, text, data: { deduped: false } }
  }

  const seen = new Set<string>()
  const deduped = upstreamItems.filter((item) => {
    const key = String(getField(item, node.field) ?? JSON.stringify(item))
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { ok: true, text: JSON.stringify(deduped), data: deduped, items: deduped }
}
