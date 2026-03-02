/**
 * Logic Node Executors
 */

import type { ConditionNode, ConditionRule, SwitchNode, LoopNode, MergeNode, SplitNode, WaitNode, NodeOutput, ExecutionContext } from "../../types/index"

// ─── Condition ────────────────────────────────────────────────────────────────

export function evaluateConditionRule(rule: ConditionRule, ctx: ExecutionContext): boolean {
  const fieldValue = ctx.resolveExpr(rule.field)
  const ruleValue = rule.value !== undefined ? ctx.resolveExpr(rule.value) : undefined

  switch (rule.operator) {
    case "exists":
      return fieldValue !== "" && fieldValue !== "undefined" && fieldValue !== "null"
    case "not_exists":
      return fieldValue === "" || fieldValue === "undefined" || fieldValue === "null"
    case "equals":
      return fieldValue === (ruleValue ?? "")
    case "not_equals":
      return fieldValue !== (ruleValue ?? "")
    case "contains":
      return fieldValue.toLowerCase().includes((ruleValue ?? "").toLowerCase())
    case "greater_than": {
      const a = Number(fieldValue)
      const b = Number(ruleValue ?? 0)
      return !Number.isNaN(a) && !Number.isNaN(b) && a > b
    }
    case "less_than": {
      const a = Number(fieldValue)
      const b = Number(ruleValue ?? 0)
      return !Number.isNaN(a) && !Number.isNaN(b) && a < b
    }
    case "regex": {
      const pat = String(ruleValue ?? "")
      if (!pat) return false
      if (pat.length > 500) return false
      // ReDoS guard — reject patterns known to cause catastrophic backtracking:
      if (/(\([^)]*[+*][^)]*\))[+*?{]/.test(pat)) return false  // (a+)+  nested quantifier
      if (/(\([^)]*\|[^)]*\))[+*?{]/.test(pat)) return false    // (a|b)+ alternation with outer quantifier
      if (/(\[[^\]]+\])[+*][+*]/.test(pat)) return false         // [a-z]++ or [a-z]+* mixed quantifiers
      if (/\.[+*][^|)]*\.[+*]/.test(pat)) return false           // .+.+ dotall sequences
      try {
        // Truncate input: ReDoS triggers on short strings, 2k chars is ample for legit use
        return new RegExp(pat, "i").test(fieldValue.slice(0, 2_000))
      } catch {
        return false
      }
    }
    default:
      return false
  }
}

export async function executeCondition(
  node: ConditionNode,
  ctx: ExecutionContext,
): Promise<NodeOutput & { port: "true" | "false" }> {
  const rules = node.rules || []
  const logic = node.logic || "all"

  const results = rules.map((rule) => evaluateConditionRule(rule, ctx))
  const passed = logic === "all" ? results.every(Boolean) : results.some(Boolean)

  return {
    ok: true,
    port: passed ? "true" : "false",
    text: `Condition evaluated: ${passed ? "true" : "false"} (logic: ${logic})`,
    data: { passed, ruleResults: results },
  }
}

// ─── Switch ───────────────────────────────────────────────────────────────────

export async function executeSwitch(
  node: SwitchNode,
  ctx: ExecutionContext,
): Promise<NodeOutput & { port: string }> {
  const value = ctx.resolveExpr(node.expression)
  const matchedCase = node.cases.find((c) => c.value === value)

  if (matchedCase) {
    return {
      ok: true,
      port: matchedCase.port,
      text: `Switch matched case: ${value} → ${matchedCase.port}`,
      data: { value, matchedPort: matchedCase.port },
    }
  }

  return {
    ok: true,
    port: "default",
    text: `Switch: no case matched for value "${value}", using default.`,
    data: { value, matchedPort: "default" },
  }
}

// ─── Loop ─────────────────────────────────────────────────────────────────────

export async function executeLoop(
  node: LoopNode,
  ctx: ExecutionContext,
): Promise<NodeOutput & { port: "item" | "done"; items?: unknown[] }> {
  const inputExpr = ctx.resolveExpr(node.inputExpression)
  let items: unknown[] = []

  try {
    const parsed = JSON.parse(inputExpr)
    if (Array.isArray(parsed)) items = parsed
  } catch {
    // Not JSON, try to split by newline
    items = inputExpr.split("\n").filter(Boolean)
  }

  const max = node.maxIterations ?? 100
  items = items.slice(0, max)

  if (items.length === 0) {
    return { ok: true, port: "done", text: "Loop: no items to iterate.", data: { items: [], count: 0 } }
  }

  return {
    ok: true,
    port: "item",
    items,
    text: `Loop: ${items.length} items to iterate.`,
    data: { items, count: items.length },
  }
}

// ─── Merge ────────────────────────────────────────────────────────────────────

export async function executeMerge(
  node: MergeNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  // In practice the DAG engine handles merge logic — this just combines data
  const mode = node.mode || "wait-all"
  const allTexts: string[] = []
  const allData: unknown[] = []

  for (const [, output] of ctx.nodeOutputs.entries()) {
    if (output.text) allTexts.push(output.text)
    if (output.data !== undefined) allData.push(output.data)
  }

  const combinedText = allTexts.join("\n\n---\n\n")
  return {
    ok: true,
    text: combinedText,
    data: { mode, inputs: allData, count: allData.length },
    items: allData,
  }
}

// ─── Split ────────────────────────────────────────────────────────────────────

export async function executeSplit(
  _node: SplitNode,
  ctx: ExecutionContext,
): Promise<NodeOutput> {
  // Pass through — the DAG engine fans out to all connected output ports
  const upstreamText = [...ctx.nodeOutputs.values()].map((o) => o.text).filter(Boolean).at(-1) || ""
  return {
    ok: true,
    text: upstreamText,
    data: { split: true },
  }
}

// ─── Wait ─────────────────────────────────────────────────────────────────────

export async function executeWait(
  node: WaitNode,
  _ctx: ExecutionContext,
): Promise<NodeOutput> {
  void _ctx
  if (node.waitMode === "duration" && node.durationMs) {
    const maxMs = Math.min(node.durationMs, 5 * 60 * 1000) // cap at 5min
    await new Promise<void>((resolve) => setTimeout(resolve, maxMs))
    return { ok: true, text: `Waited ${maxMs}ms.`, data: { waited: maxMs } }
  }

  // Other wait modes (until-time, webhook) are not async-blocked here
  return { ok: true, text: "Wait node processed.", data: { waitMode: node.waitMode } }
}
