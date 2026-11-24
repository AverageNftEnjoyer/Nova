"use client"

import type { ReactNode } from "react"
import { Trash2, X } from "lucide-react"

import { Button, Field, IconButton, Input, Select, Textarea, type SelectOption } from "@/components/ui"
import type { NodeCatalogEntry } from "@/lib/missions/catalog"
import { getRuntimeTimezone } from "@/lib/shared/timezone"
import { AGENT_NODE_NOTE, CATEGORY_ICON, CATEGORY_TONE } from "./category-tone"

type Config = Record<string, unknown>
type Update = (updates: Config) => void

interface NodeConfigPanelProps {
  nodeId: string
  nodeConfig: Config
  catalogEntry: NodeCatalogEntry
  onUpdate: (nodeId: string, updates: Config) => void
  onDelete: (nodeId: string) => void
  onClose: () => void
}

const YES_NO: SelectOption[] = [{ value: "true", label: "Yes" }, { value: "false", label: "No" }]
const AI_PROVIDERS: SelectOption[] = [
  { value: "claude", label: "Claude" },
  { value: "openai", label: "OpenAI" },
  { value: "grok", label: "Grok" },
  { value: "gemini", label: "Gemini" },
]
const DETAIL_LEVELS: SelectOption[] = [
  { value: "concise", label: "Concise" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
]
const WORKER_ROLES: SelectOption[] = [
  { value: "routing-council", label: "Routing council" },
  { value: "policy-council", label: "Policy council" },
  { value: "memory-council", label: "Memory council" },
  { value: "planning-council", label: "Planning council" },
  { value: "media-manager", label: "Media manager" },
  { value: "finance-manager", label: "Finance manager" },
  { value: "productivity-manager", label: "Productivity manager" },
  { value: "comms-manager", label: "Comms manager" },
  { value: "system-manager", label: "System manager" },
  { value: "worker-agent", label: "Worker agent" },
]

const opts = (...values: Array<[string, string]>): SelectOption[] => values.map(([value, label]) => ({ value, label }))

function mappingToText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ""
  return Object.entries(value as Record<string, unknown>).map(([key, mapValue]) => `${key}=${String(mapValue || "")}`).join("\n")
}

function textToMapping(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const index = line.indexOf("=")
        if (index < 0) return []
        const key = line.slice(0, index).trim()
        const mapValue = line.slice(index + 1).trim()
        return key && mapValue ? [[key, mapValue] as const] : []
      }),
  )
}

const splitCsv = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean)

/** Typed readers + small field builders over one node config. */
function fieldKit(cfg: Config, upd: Update) {
  const str = (k: string, fb = "") => (cfg[k] !== undefined && cfg[k] !== null ? String(cfg[k]) : fb)
  const num = (k: string, fb: number) => (typeof cfg[k] === "number" ? (cfg[k] as number) : fb)
  const bool = (k: string, fb = false) => (typeof cfg[k] === "boolean" ? (cfg[k] as boolean) : fb)
  const arr = (k: string): string[] => (Array.isArray(cfg[k]) ? (cfg[k] as unknown[]).map(String) : [])

  const text = (label: string, k: string, placeholder?: string, options?: { mono?: boolean; fallback?: string; hint?: ReactNode }) => (
    <Field label={label} hint={options?.hint}>
      <Input mono={options?.mono} value={str(k, options?.fallback)} placeholder={placeholder} onChange={(e) => upd({ [k]: e.target.value })} />
    </Field>
  )
  const area = (label: string, k: string, placeholder?: string, options?: { mono?: boolean; fallback?: string; rows?: number }) => (
    <Field label={label}>
      <Textarea mono={options?.mono} autoGrow minRows={options?.rows ?? 3} maxRows={14} value={str(k, options?.fallback)} placeholder={placeholder} onChange={(e) => upd({ [k]: e.target.value })} />
    </Field>
  )
  const number = (label: string, k: string, fb: number, options?: { step?: string; min?: number }) => (
    <Field label={label}>
      <Input
        mono
        type="number"
        step={options?.step}
        value={num(k, fb)}
        onChange={(e) => {
          const parsed = Number(e.target.value)
          upd({ [k]: Number.isFinite(parsed) && (options?.min === undefined || parsed >= options.min) ? parsed : fb })
        }}
      />
    </Field>
  )
  const select = (label: string, k: string, options: SelectOption[], fb: string) => (
    <Field label={label}>
      <Select value={str(k, fb)} options={options} onValueChange={(v) => upd({ [k]: v })} />
    </Field>
  )
  const csv = (label: string, k: string, placeholder: string, hint = "Comma-separated.") => (
    <Field label={label} hint={hint}>
      <Input value={arr(k).join(", ")} placeholder={placeholder} onChange={(e) => upd({ [k]: splitCsv(e.target.value) })} />
    </Field>
  )
  const yesNo = (label: string, k: string, fb: boolean) => (
    <Field label={label}>
      <Select value={bool(k, fb) ? "true" : "false"} options={YES_NO} onValueChange={(v) => upd({ [k]: v === "true" })} />
    </Field>
  )
  return { str, num, bool, arr, text, area, number, select, csv, yesNo }
}

function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>
}

function AgentDeclarationFields({ cfg, upd, type }: { cfg: Config; upd: Update; type: string }) {
  const f = fieldKit(cfg, upd)
  const retry = (cfg.retryPolicy as Record<string, unknown> | undefined) || {}
  const isHandoff = type === "agent-handoff"
  return (
    <>
      {f.text("Agent ID", "agentId", "operator", { mono: true })}
      {type === "agent-worker" ? f.select("Role", "role", WORKER_ROLES, "worker-agent") : null}
      {type === "agent-audit" ? (
        <Field label="Role" hint="Audit nodes always use the audit council role.">
          <Input mono value="audit-council" readOnly />
        </Field>
      ) : null}
      {!isHandoff ? f.area("Goal", "goal", "Describe this role's objective and constraints.") : null}
      {f.csv("Reads", "reads", "brief, context.summary", "State keys, comma-separated.")}
      {f.csv("Writes", "writes", "analysis, final_report", "State keys, comma-separated.")}
      <Field label="Input mapping" hint="One key=value per line.">
        <Textarea mono minRows={2} value={mappingToText(cfg.inputMapping)} placeholder={"brief={{$nodes.Trigger.output.text}}"} onChange={(e) => upd({ inputMapping: textToMapping(e.target.value) })} />
      </Field>
      {f.area("Output schema", "outputSchema", '{"result":"string"}', { mono: true, fallback: '{"result":"string"}', rows: 2 })}
      <Row>
        {f.number("Timeout (ms)", "timeoutMs", 120000, { min: 0 })}
        <Field label="Retry attempts">
          <Input
            mono
            type="number"
            value={Number(retry.maxAttempts || 1)}
            onChange={(e) => upd({ retryPolicy: { maxAttempts: Math.max(1, Number(e.target.value) || 1), backoffMs: Math.max(0, Number(retry.backoffMs || 0)) } })}
          />
        </Field>
      </Row>
      <Field label="Retry backoff (ms)">
        <Input
          mono
          type="number"
          value={Number(retry.backoffMs || 0)}
          onChange={(e) => upd({ retryPolicy: { maxAttempts: Math.max(1, Number(retry.maxAttempts || 1)), backoffMs: Math.max(0, Number(e.target.value) || 0) } })}
        />
      </Field>
      {isHandoff ? (
        <>
          {f.text("From agent", "fromAgentId", "operator", { mono: true })}
          {f.text("To agent", "toAgentId", "routing-council-1", { mono: true })}
          {f.text("Reason", "reason", "Why this handoff happens")}
        </>
      ) : null}
    </>
  )
}

function TypeFields({ type, cfg, upd }: { type: string; cfg: Config; upd: Update }) {
  const f = fieldKit(cfg, upd)
  switch (type) {
    case "schedule-trigger": {
      const mode = f.str("triggerMode", "daily")
      return (
        <>
          {f.select("Schedule", "triggerMode", opts(["daily", "Daily"], ["weekly", "Weekly"], ["interval", "Interval"], ["once", "Once"]), "daily")}
          {mode === "interval"
            ? f.number("Interval (minutes)", "triggerIntervalMinutes", 30, { min: 1 })
            : f.text("Time", "triggerTime", "09:00", { mono: true, fallback: "09:00", hint: "24-hour HH:MM." })}
          {mode === "weekly" ? (
            <Field label="Days" hint="Comma-separated, for example mon, wed, fri.">
              <Input value={f.arr("triggerDays").join(", ")} placeholder="mon, wed, fri" onChange={(e) => upd({ triggerDays: splitCsv(e.target.value.toLowerCase()) })} />
            </Field>
          ) : null}
          {f.text("Timezone", "triggerTimezone", "Asia/Hong_Kong", { mono: true, fallback: getRuntimeTimezone(), hint: "IANA timezone name." })}
        </>
      )
    }
    case "webhook-trigger":
      return (
        <>
          <Row>
            {f.select("Method", "method", opts(["POST", "POST"], ["GET", "GET"], ["PUT", "PUT"]), "POST")}
            {f.select("Auth", "authentication", opts(["none", "None"], ["bearer", "Bearer"], ["basic", "Basic"]), "none")}
          </Row>
          {f.text("Path", "path", "/missions/webhook/:id", { mono: true })}
        </>
      )
    case "manual-trigger":
      return <p className="text-xs text-muted">Runs when you press Run, or when started through the API. Nothing to configure.</p>
    case "event-trigger":
      return (
        <>
          {f.text("Event", "eventName", "nova.message.received", { mono: true })}
          {f.text("Filter", "filter", "{{$event.type}} == 'message'", { mono: true })}
        </>
      )
    case "http-request": {
      const method = f.str("method", "GET")
      return (
        <>
          <Row>
            {f.select("Method", "method", opts(["GET", "GET"], ["POST", "POST"], ["PUT", "PUT"], ["PATCH", "PATCH"], ["DELETE", "DELETE"]), "GET")}
            {f.select("Auth", "authentication", opts(["none", "None"], ["bearer", "Bearer"], ["basic", "Basic"], ["api-key", "API key"]), "none")}
          </Row>
          {f.text("URL", "url", "https://api.example.com", { mono: true })}
          {method === "POST" || method === "PUT" || method === "PATCH" ? f.area("Body", "body", '{"key":"value"}', { mono: true, rows: 2 }) : null}
          {f.text("Selector", "selector", "$.data.items or .class-name", { mono: true })}
        </>
      )
    }
    case "web-search":
      return (
        <>
          {f.area("Query", "query", "Latest crypto market news", { rows: 2 })}
          <Row>
            {f.select("Provider", "provider", opts(["brave", "Brave"], ["tavily", "Tavily"]), "brave")}
            {f.number("Max results", "maxResults", 5, { min: 1 })}
          </Row>
        </>
      )
    case "rss-feed":
      return (
        <>
          {f.text("Feed URL", "url", "https://example.com/feed.xml", { mono: true })}
          {f.number("Max items", "maxItems", 10, { min: 1 })}
          {f.csv("Filter keywords", "filterKeywords", "bitcoin, ethereum")}
        </>
      )
    case "coinbase":
      return (
        <>
          {f.select("Intent", "intent", opts(["report", "Report"], ["portfolio", "Portfolio"], ["price", "Price"], ["transactions", "Transactions"], ["status", "Status"]), "report")}
          {f.csv("Assets", "assets", "BTC, ETH, SOL")}
          <Row>
            {f.text("Quote currency", "quoteCurrency", "USD", { mono: true, fallback: "USD" })}
            {f.number("Alert %", "thresholdPct", 5)}
          </Row>
        </>
      )
    case "polymarket-price-trigger":
      return (
        <>
          {f.text("Token ID", "tokenId", "token id", { mono: true })}
          {f.text("Market slug", "marketSlug", "will-btc-hit-120k", { mono: true, hint: "Optional." })}
          <Row>
            {f.select("Direction", "direction", opts(["above", "Above"], ["below", "Below"]), "above")}
            {f.number("Threshold (0 to 1)", "threshold", 0.5, { step: "0.01" })}
          </Row>
        </>
      )
    case "polymarket-monitor":
      return (
        <>
          {f.text("Query", "query", "fed rate cut odds")}
          {f.text("Tag slug", "tagSlug", "politics", { mono: true, hint: "Optional." })}
          <Row>
            {f.select("Range", "range", opts(["1h", "1 hour"], ["6h", "6 hours"], ["1d", "1 day"], ["1w", "1 week"], ["1m", "1 month"], ["all", "All time"]), "1d")}
            {f.number("Swing %", "changeThresholdPct", 5, { step: "0.1" })}
          </Row>
          {f.number("Max markets", "maxMarkets", 6, { min: 1 })}
        </>
      )
    case "polymarket-data-fetch":
      return (
        <>
          {f.select("Query type", "queryType", opts(["search", "Search"], ["market", "Market"], ["prices", "Prices"], ["events", "Events"], ["leaderboard", "Leaderboard"]), "search")}
          <Field label="Query or slug">
            <Input value={f.str("query") || f.str("slug")} placeholder="market search or slug" onChange={(e) => upd({ query: e.target.value, slug: e.target.value })} />
          </Field>
          {f.csv("Token IDs", "tokenIds", "token1, token2")}
        </>
      )
    case "file-read":
      return (
        <>
          {f.text("Path", "path", "/data/report.csv", { mono: true })}
          <Row>
            {f.select("Format", "format", opts(["text", "Text"], ["json", "JSON"], ["csv", "CSV"]), "text")}
            {f.select("Encoding", "encoding", opts(["utf8", "UTF-8"], ["base64", "Base64"]), "utf8")}
          </Row>
        </>
      )
    case "form-input": {
      const fields = Array.isArray(cfg.fields) ? (cfg.fields as Array<Record<string, unknown>>) : []
      return (
        <Field label="Fields" hint="One name:label per line.">
          <Textarea
            mono
            minRows={3}
            value={fields.map((field) => `${String(field.name || "")}:${String(field.label || field.name || "")}`).join("\n")}
            placeholder={"query:Search query\ndate:Target date"}
            onChange={(e) => {
              const parsed = e.target.value.split("\n").filter(Boolean).map((line) => {
                const [name, ...rest] = line.split(":")
                return { name: name.trim(), label: rest.join(":").trim() || name.trim(), type: "text" as const }
              })
              upd({ fields: parsed })
            }}
          />
        </Field>
      )
    }
    case "ai-summarize":
    case "ai-generate":
      return (
        <>
          {f.area("Prompt", "prompt", "Describe what to do.")}
          <Row>
            {f.select("Provider", "integration", AI_PROVIDERS, "claude")}
            {f.select("Detail", "detailLevel", DETAIL_LEVELS, "standard")}
          </Row>
        </>
      )
    case "ai-classify":
      return (
        <>
          {f.area("Prompt", "prompt", "Describe what to do.")}
          {f.select("Provider", "integration", AI_PROVIDERS, "claude")}
          {f.csv("Categories", "categories", "Important, Normal, Spam")}
        </>
      )
    case "ai-extract":
      return (
        <>
          {f.area("Prompt", "prompt", "Describe what to do.")}
          {f.select("Provider", "integration", AI_PROVIDERS, "claude")}
          {f.area("Output schema (JSON)", "outputSchema", '{"title":"string","price":"number"}', { mono: true, fallback: "{}", rows: 2 })}
        </>
      )
    case "ai-chat": {
      const msgs = Array.isArray(cfg.messages) ? (cfg.messages as Array<Record<string, unknown>>) : []
      const sys = String(msgs.find((m) => String(m.role) === "system")?.content || "")
      const user = String(msgs.find((m) => String(m.role) === "user")?.content || "")
      const write = (nextSys: string, nextUser: string) => {
        const next: Array<{ role: string; content: string }> = []
        if (nextSys) next.push({ role: "system", content: nextSys })
        if (nextUser) next.push({ role: "user", content: nextUser })
        upd({ messages: next })
      }
      return (
        <>
          {f.select("Provider", "integration", AI_PROVIDERS, "claude")}
          <Field label="System message">
            <Textarea minRows={2} value={sys} placeholder="You are a helpful assistant." onChange={(e) => write(e.target.value, user)} />
          </Field>
          <Field label="User message">
            <Textarea minRows={2} value={user} placeholder="{{$nodes.Fetch.output.text}}" onChange={(e) => write(sys, e.target.value)} />
          </Field>
        </>
      )
    }
    case "agent-supervisor":
    case "agent-worker":
    case "agent-audit":
    case "agent-handoff":
      return <AgentDeclarationFields cfg={cfg} upd={upd} type={type} />
    case "condition": {
      const rules = Array.isArray(cfg.rules) ? (cfg.rules as Array<Record<string, unknown>>) : [{}]
      const rule = rules[0] || {}
      const op = String(rule.operator || "exists")
      return (
        <>
          <Field label="Field">
            <Input mono value={String(rule.field || "")} placeholder="{{$nodes.Step.output.text}}" onChange={(e) => upd({ rules: [{ ...rule, field: e.target.value, operator: op }] })} />
          </Field>
          <Field label="Operator">
            <Select
              value={op}
              options={opts(["exists", "Exists"], ["not_exists", "Does not exist"], ["contains", "Contains"], ["equals", "Equals"], ["not_equals", "Does not equal"], ["greater_than", "Greater than"], ["less_than", "Less than"], ["regex", "Regex"])}
              onValueChange={(v) => upd({ rules: [{ ...rule, field: rule.field || "", operator: v }] })}
            />
          </Field>
          {op !== "exists" && op !== "not_exists" ? (
            <Field label="Value">
              <Input value={String(rule.value || "")} placeholder="Expected value" onChange={(e) => upd({ rules: [{ ...rule, field: rule.field || "", operator: op, value: e.target.value }] })} />
            </Field>
          ) : null}
          {f.select("Logic", "logic", opts(["all", "All rules"], ["any", "Any rule"]), "all")}
        </>
      )
    }
    case "switch": {
      const cases = Array.isArray(cfg.cases) ? (cfg.cases as Array<Record<string, unknown>>) : []
      return (
        <>
          {f.text("Expression", "expression", "{{$vars.status}}", { mono: true })}
          <Field label="Cases" hint="One value→port per line.">
            <Textarea
              mono
              minRows={3}
              value={cases.map((c) => `${String(c.value || "")}→${String(c.port || "")}`).join("\n")}
              placeholder={"success→case_0\nerror→case_1"}
              onChange={(e) => {
                const parsed = e.target.value.split("\n").filter(Boolean).map((line, i) => {
                  const arrow = line.lastIndexOf("→")
                  const val = arrow >= 0 ? line.slice(0, arrow) : line
                  const port = arrow >= 0 ? line.slice(arrow + 1) : ""
                  return { value: val.trim(), port: port.trim() || `case_${i}` }
                })
                upd({ cases: parsed })
              }}
            />
          </Field>
        </>
      )
    }
    case "loop":
      return (
        <>
          {f.text("Items expression", "inputExpression", "{{$nodes.Fetch.output.items}}", { mono: true })}
          <Row>
            {f.number("Batch size", "batchSize", 1, { min: 1 })}
            {f.number("Max iterations", "maxIterations", 100, { min: 1 })}
          </Row>
        </>
      )
    case "merge":
      return (
        <>
          {f.select("Mode", "mode", opts(["wait-all", "Wait for all"], ["first-wins", "First wins"], ["append", "Append"]), "wait-all")}
          {f.number("Input count", "inputCount", 2, { min: 2 })}
        </>
      )
    case "split":
      return f.number("Output count", "outputCount", 2, { min: 2 })
    case "wait": {
      const waitMode = f.str("waitMode", "duration")
      return (
        <>
          {f.select("Mode", "waitMode", opts(["duration", "Duration"], ["until-time", "Until a time"], ["webhook", "Webhook"]), "duration")}
          {waitMode === "duration" ? f.number("Duration (ms)", "durationMs", 60000, { min: 0 }) : null}
          {waitMode === "until-time" ? f.text("Until", "untilTime", "14:00", { mono: true, hint: "24-hour HH:MM." }) : null}
          {waitMode === "webhook" ? f.text("Webhook path", "webhookPath", "/missions/wait/:id", { mono: true }) : null}
        </>
      )
    }
    case "set-variables": {
      const assignments = Array.isArray(cfg.assignments) ? (cfg.assignments as Array<Record<string, unknown>>) : []
      return (
        <Field label="Assignments" hint="One name=value per line.">
          <Textarea
            mono
            minRows={3}
            value={assignments.map((a) => `${String(a.name || "")}=${String(a.value || "")}`).join("\n")}
            placeholder={"greeting=Hello {{$vars.name}}\ncount=0"}
            onChange={(e) => {
              const parsed = e.target.value.split("\n").filter(Boolean).map((line) => {
                const eq = line.indexOf("=")
                if (eq < 0) return { name: line.trim(), value: "" }
                return { name: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() }
              })
              upd({ assignments: parsed })
            }}
          />
        </Field>
      )
    }
    case "code":
      return (
        <>
          {f.text("Input expression", "inputExpression", "{{$nodes.Step.output.text}}", { mono: true, hint: "Leave empty to use the previous output." })}
          <Field label="Code" hint="JavaScript. $input, $vars and $nodes are available; use return.">
            <Textarea mono autoGrow minRows={6} maxRows={20} value={f.str("code", "return $input;")} onChange={(e) => upd({ code: e.target.value })} />
          </Field>
        </>
      )
    case "format":
      return (
        <>
          {f.area("Template", "template", "{{$nodes.AI.output.text}}", { fallback: "{{$nodes.AI.output.text}}" })}
          {f.select("Format", "outputFormat", opts(["text", "Text"], ["markdown", "Markdown"], ["json", "JSON"], ["html", "HTML"]), "text")}
        </>
      )
    case "filter":
      return (
        <>
          {f.text("Expression", "expression", "$item.price > 100", { mono: true, hint: "Evaluated per item." })}
          {f.select("Mode", "mode", opts(["keep", "Keep matching"], ["remove", "Remove matching"]), "keep")}
        </>
      )
    case "sort":
      return (
        <>
          {f.text("Field", "field", "price", { mono: true })}
          {f.select("Direction", "direction", opts(["asc", "Ascending"], ["desc", "Descending"]), "asc")}
        </>
      )
    case "dedupe":
      return f.text("Field", "field", "id", { mono: true, hint: "Leave empty to compare whole items." })
    case "agent-state-read":
      return (
        <>
          {f.text("State key", "key", "task.plan", { mono: true })}
          {f.yesNo("Required", "required", true)}
        </>
      )
    case "agent-state-write":
      return (
        <>
          {f.text("State key", "key", "task.result", { mono: true })}
          {f.text("Value expression", "valueExpression", "{{$input}}", { mono: true, fallback: "{{$input}}" })}
          {f.select("Write mode", "writeMode", opts(["replace", "Replace"], ["merge", "Merge"], ["append", "Append"]), "replace")}
        </>
      )
    case "provider-selector":
      return (
        <>
          {f.csv("Allowed providers", "allowedProviders", "claude, openai")}
          {f.text("Default provider", "defaultProvider", "claude", { mono: true, fallback: "claude" })}
          {f.select("Strategy", "strategy", opts(["policy", "Policy"], ["latency", "Latency"], ["cost", "Cost"], ["quality", "Quality"]), "policy")}
        </>
      )
    case "agent-subworkflow":
      return (
        <>
          {f.text("Mission ID", "missionId", "child-mission-id", { mono: true })}
          <Field label="Input mapping" hint="One key=value per line.">
            <Textarea mono minRows={2} value={mappingToText(cfg.inputMapping)} placeholder={"brief={{$nodes.Operator.output.text}}"} onChange={(e) => upd({ inputMapping: textToMapping(e.target.value) })} />
          </Field>
          {f.yesNo("Wait for completion", "waitForCompletion", true)}
        </>
      )
    case "telegram-output":
      return (
        <>
          {f.csv("Chat IDs", "chatIds", "-100123456789")}
          {f.area("Message", "messageTemplate", "{{$nodes.AI.output.text}}", { rows: 2 })}
          {f.select("Parse mode", "parseMode", opts(["markdown", "Markdown"], ["html", "HTML"], ["plain", "Plain"]), "markdown")}
        </>
      )
    case "discord-output":
      return (
        <>
          {f.csv("Webhook URLs", "webhookUrls", "https://discord.com/api/webhooks/...")}
          {f.area("Message", "messageTemplate", "{{$nodes.AI.output.text}}", { rows: 2 })}
        </>
      )
    case "email-output":
      return (
        <>
          {f.csv("Recipients", "recipients", "you@example.com")}
          {f.text("Subject", "subject", "Daily briefing: {{date}}", { fallback: "Mission Output" })}
          {f.area("Message", "messageTemplate", "{{$nodes.AI.output.text}}", { rows: 2 })}
          {f.select("Format", "format", opts(["text", "Plain text"], ["html", "HTML"]), "text")}
        </>
      )
    case "webhook-output": {
      const headers = typeof cfg.headers === "object" && cfg.headers !== null ? (cfg.headers as Record<string, string>) : {}
      return (
        <>
          <Row>
            {f.select("Method", "method", opts(["POST", "POST"], ["PUT", "PUT"]), "POST")}
            <span />
          </Row>
          {f.text("URL", "url", "https://example.com/webhook", { mono: true })}
          <Field label="Headers" hint="One key: value per line.">
            <Textarea
              mono
              minRows={2}
              value={Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n")}
              placeholder={"Content-Type: application/json"}
              onChange={(e) => {
                const parsed: Record<string, string> = {}
                for (const line of e.target.value.split("\n")) {
                  const colon = line.indexOf(":")
                  if (colon > 0) parsed[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
                }
                upd({ headers: parsed })
              }}
            />
          </Field>
          {f.area("Body template", "bodyTemplate", '{"text":"{{$nodes.AI.output.text}}"}', { mono: true, rows: 2 })}
        </>
      )
    }
    case "slack-output":
      return (
        <>
          {f.text("Channel", "channel", "#general", { hint: "Optional. Uses the connected default when empty." })}
          {f.area("Message", "messageTemplate", "{{$nodes.AI.output.text}}", { rows: 2 })}
        </>
      )
    case "sticky-note":
      return f.area("Note", "content", "Notes", { rows: 4 })
    default:
      return null
  }
}

/** Right panel of the canvas: every setting of the selected node. */
export function NodeConfigPanel({ nodeId, nodeConfig, catalogEntry, onUpdate, onDelete, onClose }: NodeConfigPanelProps) {
  const Icon = CATEGORY_ICON[catalogEntry.category]
  const upd: Update = (updates) => onUpdate(nodeId, updates)
  const type = String(nodeConfig.type || catalogEntry.type)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-2.5 border-b border-border px-4 py-3">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" style={{ color: CATEGORY_TONE[catalogEntry.category] }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-md font-medium text-fg">{catalogEntry.label}</p>
          <p className="line-clamp-2 text-xs text-muted">{catalogEntry.description}</p>
        </div>
        <IconButton aria-label="Close node settings" size="sm" onClick={onClose} className="-mr-1.5">
          <X />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {catalogEntry.category === "agents" ? (
          <p className="rounded-md bg-surface-3 px-3 py-2 text-xs text-muted">{AGENT_NODE_NOTE}</p>
        ) : null}
        <Field label="Name">
          <Input value={typeof nodeConfig.label === "string" ? nodeConfig.label : ""} placeholder="Node name" onChange={(e) => upd({ label: e.target.value })} />
        </Field>
        <TypeFields type={type} cfg={nodeConfig} upd={upd} />
        <p className="font-mono text-2xs text-faint">{nodeId}</p>
      </div>
      <div className="border-t border-border px-4 py-3">
        <Button variant="ghost" size="sm" onClick={() => onDelete(nodeId)} className="text-danger hover:text-danger">
          <Trash2 />
          Delete node
        </Button>
      </div>
    </div>
  )
}
