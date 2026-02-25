"use client"

import { memo } from "react"
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react"
import { cn } from "@/lib/shared/utils"
import type { NodeCatalogEntry } from "@/lib/missions/catalog"
import { FluidSelect } from "@/components/ui/fluid-select"

export interface MissionNodeData extends Record<string, unknown> {
  nodeConfig: Record<string, unknown>
  catalogEntry: NodeCatalogEntry
  isSelected?: boolean
  isRunning?: boolean
  hasError?: boolean
  hasCompleted?: boolean
  label: string
}

const FIELD_INPUT =
  "nodrag nopan w-full rounded-lg border border-white/14 bg-white/[0.07] px-2 py-1.5 text-[10px] text-white/90 placeholder:text-white/32 outline-none transition-colors focus:border-white/28 focus:bg-white/[0.10]"

const FIELD_SELECT_BTN = "h-7 border-white/14 bg-white/[0.07] px-2 text-[10px] text-white/90"

function FieldWrap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <span className="block text-[8.5px] font-semibold uppercase tracking-[0.14em] text-white/40">{label}</span>
      {children}
    </div>
  )
}

// ── Shared typed field helpers ─────────────────────────────────────────────

function PromptArea({ value, onChange, label = "Prompt", placeholder = "Describe what to do…" }: { value: string; onChange: (v: string) => void; label?: string; placeholder?: string }) {
  return (
    <FieldWrap label={label}>
      <textarea className={cn(FIELD_INPUT, "min-h-16 resize-y")} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </FieldWrap>
  )
}

function IntegrationSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <FieldWrap label="Model">
      <FluidSelect
        isLight={false}
        value={value || "claude"}
        options={[
          { value: "claude", label: "Claude" },
          { value: "openai", label: "OpenAI" },
          { value: "grok", label: "Grok" },
          { value: "gemini", label: "Gemini" },
        ]}
        onChange={onChange}
        buttonClassName={FIELD_SELECT_BTN}
      />
    </FieldWrap>
  )
}

function DetailLevelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <FieldWrap label="Detail">
      <FluidSelect
        isLight={false}
        value={value || "standard"}
        options={[
          { value: "concise", label: "Concise" },
          { value: "standard", label: "Standard" },
          { value: "detailed", label: "Detailed" },
        ]}
        onChange={onChange}
        buttonClassName={FIELD_SELECT_BTN}
      />
    </FieldWrap>
  )
}

function MessageTemplateArea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <FieldWrap label="Message">
      <textarea className={cn(FIELD_INPUT, "min-h-12 resize-y")} value={value} onChange={(e) => onChange(e.target.value)} placeholder="{{$nodes.AI.output.text}}" />
    </FieldWrap>
  )
}

function CsvField({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <FieldWrap label={label}>
      <input
        className={FIELD_INPUT}
        value={value.join(", ")}
        onChange={(e) => onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
        placeholder={placeholder}
      />
    </FieldWrap>
  )
}

// ── Type-specific field panels ─────────────────────────────────────────────

function TypeFields({ type, cfg, upd }: { type: string; cfg: Record<string, unknown>; upd: (u: Record<string, unknown>) => void }) {
  const str = (k: string, fb = "") => (cfg[k] !== undefined && cfg[k] !== null ? String(cfg[k]) : fb)
  const num = (k: string, fb: number) => (typeof cfg[k] === "number" ? (cfg[k] as number) : fb)
  const bool = (k: string, fb = false) => (typeof cfg[k] === "boolean" ? (cfg[k] as boolean) : fb)
  const arr = (k: string): string[] => (Array.isArray(cfg[k]) ? (cfg[k] as unknown[]).map(String) : [])

  switch (type) {
    // ── Triggers ────────────────────────────────────────────────────────────
    case "schedule-trigger": {
      const mode = str("triggerMode", "daily")
      return (
        <>
          <FieldWrap label="Schedule">
            <FluidSelect
              isLight={false}
              value={mode}
              options={[
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "interval", label: "Interval" },
                { value: "once", label: "Once" },
              ]}
              onChange={(v) => upd({ triggerMode: v })}
              buttonClassName={FIELD_SELECT_BTN}
            />
          </FieldWrap>
          {mode === "interval" ? (
            <FieldWrap label="Interval (min)">
              <input className={FIELD_INPUT} type="number" value={num("triggerIntervalMinutes", 30)} onChange={(e) => upd({ triggerIntervalMinutes: Number(e.target.value) || 30 })} placeholder="30" />
            </FieldWrap>
          ) : (
            <FieldWrap label="Time (HH:MM)">
              <input className={FIELD_INPUT} value={str("triggerTime", "09:00")} onChange={(e) => upd({ triggerTime: e.target.value })} placeholder="09:00" />
            </FieldWrap>
          )}
          {mode === "weekly" && (
            <FieldWrap label="Days (csv)">
              <input className={FIELD_INPUT} value={arr("triggerDays").join(", ")} onChange={(e) => upd({ triggerDays: e.target.value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) })} placeholder="mon, wed, fri" />
            </FieldWrap>
          )}
          <FieldWrap label="Timezone">
            <input className={FIELD_INPUT} value={str("triggerTimezone", "America/New_York")} onChange={(e) => upd({ triggerTimezone: e.target.value })} placeholder="America/New_York" />
          </FieldWrap>
        </>
      )
    }

    case "webhook-trigger": {
      const auth = str("authentication", "none")
      return (
        <>
          <FieldWrap label="Request">
            <div className="grid grid-cols-[72px_1fr] gap-1.5">
              <FluidSelect isLight={false} value={str("method", "POST")} options={[{ value: "POST", label: "POST" }, { value: "GET", label: "GET" }, { value: "PUT", label: "PUT" }]} onChange={(v) => upd({ method: v })} buttonClassName={FIELD_SELECT_BTN} />
              <input className={FIELD_INPUT} value={str("path")} onChange={(e) => upd({ path: e.target.value })} placeholder="/missions/webhook/:id" />
            </div>
          </FieldWrap>
          <FieldWrap label="Auth">
            <FluidSelect isLight={false} value={auth} options={[{ value: "none", label: "None" }, { value: "bearer", label: "Bearer" }, { value: "basic", label: "Basic" }]} onChange={(v) => upd({ authentication: v })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
        </>
      )
    }

    case "manual-trigger":
      return null

    case "event-trigger":
      return (
        <>
          <FieldWrap label="Event">
            <input className={FIELD_INPUT} value={str("eventName")} onChange={(e) => upd({ eventName: e.target.value })} placeholder="nova.message.received" />
          </FieldWrap>
          <FieldWrap label="Filter">
            <input className={FIELD_INPUT} value={str("filter")} onChange={(e) => upd({ filter: e.target.value })} placeholder="{{$event.type}} == 'message'" />
          </FieldWrap>
        </>
      )

    // ── Data ────────────────────────────────────────────────────────────────
    case "http-request": {
      const method = str("method", "GET")
      return (
        <>
          <FieldWrap label="Request">
            <div className="grid grid-cols-[72px_1fr] gap-1.5">
              <FluidSelect isLight={false} value={method} options={[{ value: "GET", label: "GET" }, { value: "POST", label: "POST" }, { value: "PUT", label: "PUT" }, { value: "PATCH", label: "PATCH" }, { value: "DELETE", label: "DELETE" }]} onChange={(v) => upd({ method: v })} buttonClassName={FIELD_SELECT_BTN} />
              <input className={FIELD_INPUT} value={str("url")} onChange={(e) => upd({ url: e.target.value })} placeholder="https://api.example.com" />
            </div>
          </FieldWrap>
          <FieldWrap label="Auth">
            <FluidSelect isLight={false} value={str("authentication", "none")} options={[{ value: "none", label: "None" }, { value: "bearer", label: "Bearer" }, { value: "basic", label: "Basic" }, { value: "api-key", label: "API Key" }]} onChange={(v) => upd({ authentication: v })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
          {(method === "POST" || method === "PUT" || method === "PATCH") && (
            <FieldWrap label="Body">
              <textarea className={cn(FIELD_INPUT, "min-h-12 resize-y")} value={str("body")} onChange={(e) => upd({ body: e.target.value })} placeholder='{"key":"value"}' />
            </FieldWrap>
          )}
          <FieldWrap label="Selector">
            <input className={FIELD_INPUT} value={str("selector")} onChange={(e) => upd({ selector: e.target.value })} placeholder="$.data.items or .class-name" />
          </FieldWrap>
        </>
      )
    }

    case "web-search":
      return (
        <>
          <FieldWrap label="Query">
            <textarea className={cn(FIELD_INPUT, "min-h-12 resize-y")} value={str("query")} onChange={(e) => upd({ query: e.target.value })} placeholder="Latest crypto market news" />
          </FieldWrap>
          <div className="grid grid-cols-2 gap-1.5">
            <FieldWrap label="Provider">
              <FluidSelect isLight={false} value={str("provider", "brave")} options={[{ value: "brave", label: "Brave" }, { value: "tavily", label: "Tavily" }]} onChange={(v) => upd({ provider: v })} buttonClassName={FIELD_SELECT_BTN} />
            </FieldWrap>
            <FieldWrap label="Max">
              <input className={FIELD_INPUT} type="number" value={num("maxResults", 5)} onChange={(e) => upd({ maxResults: Number(e.target.value) || 5 })} placeholder="5" />
            </FieldWrap>
          </div>
        </>
      )

    case "rss-feed":
      return (
        <>
          <FieldWrap label="Feed URL">
            <input className={FIELD_INPUT} value={str("url")} onChange={(e) => upd({ url: e.target.value })} placeholder="https://example.com/feed.xml" />
          </FieldWrap>
          <FieldWrap label="Max Items">
            <input className={FIELD_INPUT} type="number" value={num("maxItems", 10)} onChange={(e) => upd({ maxItems: Number(e.target.value) || 10 })} placeholder="10" />
          </FieldWrap>
          <CsvField label="Filter Keywords" value={arr("filterKeywords")} onChange={(v) => upd({ filterKeywords: v })} placeholder="bitcoin, ethereum" />
        </>
      )

    case "coinbase":
      return (
        <>
          <FieldWrap label="Intent">
            <FluidSelect isLight={false} value={str("intent", "report")} options={[{ value: "report", label: "Report" }, { value: "portfolio", label: "Portfolio" }, { value: "price", label: "Price" }, { value: "transactions", label: "Transactions" }, { value: "status", label: "Status" }]} onChange={(v) => upd({ intent: v })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
          <CsvField label="Assets" value={arr("assets")} onChange={(v) => upd({ assets: v })} placeholder="BTC, ETH, SOL" />
          <div className="grid grid-cols-2 gap-1.5">
            <FieldWrap label="Quote">
              <input className={FIELD_INPUT} value={str("quoteCurrency", "USD")} onChange={(e) => upd({ quoteCurrency: e.target.value })} placeholder="USD" />
            </FieldWrap>
            <FieldWrap label="Alert %">
              <input className={FIELD_INPUT} type="number" value={num("thresholdPct", 5)} onChange={(e) => upd({ thresholdPct: Number(e.target.value) || 5 })} placeholder="5" />
            </FieldWrap>
          </div>
        </>
      )

    case "file-read":
      return (
        <>
          <FieldWrap label="Path">
            <input className={FIELD_INPUT} value={str("path")} onChange={(e) => upd({ path: e.target.value })} placeholder="/data/report.csv" />
          </FieldWrap>
          <div className="grid grid-cols-2 gap-1.5">
            <FieldWrap label="Format">
              <FluidSelect isLight={false} value={str("format", "text")} options={[{ value: "text", label: "Text" }, { value: "json", label: "JSON" }, { value: "csv", label: "CSV" }]} onChange={(v) => upd({ format: v })} buttonClassName={FIELD_SELECT_BTN} />
            </FieldWrap>
            <FieldWrap label="Encoding">
              <FluidSelect isLight={false} value={str("encoding", "utf8")} options={[{ value: "utf8", label: "UTF-8" }, { value: "base64", label: "Base64" }]} onChange={(v) => upd({ encoding: v })} buttonClassName={FIELD_SELECT_BTN} />
            </FieldWrap>
          </div>
        </>
      )

    case "form-input": {
      const fields = Array.isArray(cfg.fields) ? (cfg.fields as Array<Record<string, unknown>>) : []
      const fieldsText = fields.map((f) => `${String(f.name || "")}:${String(f.label || f.name || "")}`).join("\n")
      return (
        <FieldWrap label="Fields (name:label per line)">
          <textarea
            className={cn(FIELD_INPUT, "min-h-16 resize-y font-mono")}
            value={fieldsText}
            onChange={(e) => {
              const parsed = e.target.value.split("\n").filter(Boolean).map((line) => {
                const [name, ...rest] = line.split(":")
                return { name: name.trim(), label: rest.join(":").trim() || name.trim(), type: "text" as const }
              })
              upd({ fields: parsed })
            }}
            placeholder={"query:Search Query\ndate:Target Date"}
          />
        </FieldWrap>
      )
    }

    // ── AI ──────────────────────────────────────────────────────────────────
    case "ai-summarize":
      return (
        <>
          <PromptArea value={str("prompt")} onChange={(v) => upd({ prompt: v })} />
          <IntegrationSelect value={str("integration")} onChange={(v) => upd({ integration: v })} />
          <DetailLevelSelect value={str("detailLevel")} onChange={(v) => upd({ detailLevel: v })} />
        </>
      )

    case "ai-classify":
      return (
        <>
          <PromptArea value={str("prompt")} onChange={(v) => upd({ prompt: v })} />
          <IntegrationSelect value={str("integration")} onChange={(v) => upd({ integration: v })} />
          <CsvField label="Categories" value={arr("categories")} onChange={(v) => upd({ categories: v })} placeholder="Important, Normal, Spam" />
        </>
      )

    case "ai-extract":
      return (
        <>
          <PromptArea value={str("prompt")} onChange={(v) => upd({ prompt: v })} />
          <IntegrationSelect value={str("integration")} onChange={(v) => upd({ integration: v })} />
          <FieldWrap label="Output Schema (JSON)">
            <textarea className={cn(FIELD_INPUT, "min-h-12 resize-y font-mono")} value={str("outputSchema", "{}")} onChange={(e) => upd({ outputSchema: e.target.value })} placeholder='{"title":"string","price":"number"}' />
          </FieldWrap>
        </>
      )

    case "ai-generate":
      return (
        <>
          <PromptArea value={str("prompt")} onChange={(v) => upd({ prompt: v })} />
          <IntegrationSelect value={str("integration")} onChange={(v) => upd({ integration: v })} />
          <DetailLevelSelect value={str("detailLevel")} onChange={(v) => upd({ detailLevel: v })} />
        </>
      )

    case "ai-chat": {
      const msgs = Array.isArray(cfg.messages) ? (cfg.messages as Array<Record<string, unknown>>) : []
      const sysMsg = msgs.find((m) => String(m.role) === "system")
      const userMsg = msgs.find((m) => String(m.role) === "user")
      const updateMessages = (sys: string, user: string) => {
        const next = []
        if (sys) next.push({ role: "system", content: sys })
        if (user) next.push({ role: "user", content: user })
        upd({ messages: next })
      }
      return (
        <>
          <IntegrationSelect value={str("integration")} onChange={(v) => upd({ integration: v })} />
          <FieldWrap label="System">
            <textarea className={cn(FIELD_INPUT, "min-h-12 resize-y")} value={String(sysMsg?.content || "")} onChange={(e) => updateMessages(e.target.value, String(userMsg?.content || ""))} placeholder="You are a helpful assistant." />
          </FieldWrap>
          <FieldWrap label="User Message">
            <textarea className={cn(FIELD_INPUT, "min-h-12 resize-y")} value={String(userMsg?.content || "")} onChange={(e) => updateMessages(String(sysMsg?.content || ""), e.target.value)} placeholder="{{$nodes.Fetch.output.text}}" />
          </FieldWrap>
        </>
      )
    }

    // ── Logic ────────────────────────────────────────────────────────────────
    case "condition": {
      const rules = Array.isArray(cfg.rules) ? (cfg.rules as Array<Record<string, unknown>>) : [{}]
      const rule = rules[0] || {}
      const op = String(rule.operator || "exists")
      return (
        <>
          <FieldWrap label="Field">
            <input className={FIELD_INPUT} value={String(rule.field || "")} onChange={(e) => upd({ rules: [{ ...rule, field: e.target.value, operator: op }] })} placeholder="{{$nodes.Step.output.text}}" />
          </FieldWrap>
          <FieldWrap label="Operator">
            <FluidSelect isLight={false} value={op} options={[{ value: "exists", label: "Exists" }, { value: "not_exists", label: "Not Exists" }, { value: "contains", label: "Contains" }, { value: "equals", label: "Equals" }, { value: "not_equals", label: "≠ Equals" }, { value: "greater_than", label: "> Than" }, { value: "less_than", label: "< Than" }, { value: "regex", label: "Regex" }]} onChange={(v) => upd({ rules: [{ ...rule, field: rule.field || "", operator: v }] })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
          {op !== "exists" && op !== "not_exists" && (
            <FieldWrap label="Value">
              <input className={FIELD_INPUT} value={String(rule.value || "")} onChange={(e) => upd({ rules: [{ ...rule, field: rule.field || "", operator: op, value: e.target.value }] })} placeholder="Expected value" />
            </FieldWrap>
          )}
          <FieldWrap label="Logic">
            <FluidSelect isLight={false} value={str("logic", "all")} options={[{ value: "all", label: "All rules" }, { value: "any", label: "Any rule" }]} onChange={(v) => upd({ logic: v })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
        </>
      )
    }

    case "switch": {
      const cases = Array.isArray(cfg.cases) ? (cfg.cases as Array<Record<string, unknown>>) : []
      const casesText = cases.map((c) => `${String(c.value || "")}→${String(c.port || "")}`).join("\n")
      return (
        <>
          <FieldWrap label="Expression">
            <input className={FIELD_INPUT} value={str("expression")} onChange={(e) => upd({ expression: e.target.value })} placeholder="{{$vars.status}}" />
          </FieldWrap>
          <FieldWrap label="Cases (value→port per line)">
            <textarea
              className={cn(FIELD_INPUT, "min-h-16 resize-y font-mono")}
              value={casesText}
              onChange={(e) => {
                const parsed = e.target.value.split("\n").filter(Boolean).map((line, i) => {
                  const arrow = line.lastIndexOf("→")
                  const val = arrow >= 0 ? line.slice(0, arrow) : line
                  const port = arrow >= 0 ? line.slice(arrow + 1) : ""
                  return { value: val.trim(), port: port.trim() || `case_${i}` }
                })
                upd({ cases: parsed })
              }}
              placeholder={"success→case_0\nerror→case_1"}
            />
          </FieldWrap>
        </>
      )
    }

    case "loop":
      return (
        <>
          <FieldWrap label="Items Expression">
            <input className={FIELD_INPUT} value={str("inputExpression")} onChange={(e) => upd({ inputExpression: e.target.value })} placeholder="{{$nodes.Fetch.output.items}}" />
          </FieldWrap>
          <div className="grid grid-cols-2 gap-1.5">
            <FieldWrap label="Batch Size">
              <input className={FIELD_INPUT} type="number" value={num("batchSize", 1)} onChange={(e) => upd({ batchSize: Number(e.target.value) || 1 })} placeholder="1" />
            </FieldWrap>
            <FieldWrap label="Max Iterations">
              <input className={FIELD_INPUT} type="number" value={num("maxIterations", 100)} onChange={(e) => upd({ maxIterations: Number(e.target.value) || 100 })} placeholder="100" />
            </FieldWrap>
          </div>
        </>
      )

    case "merge":
      return (
        <>
          <FieldWrap label="Mode">
            <FluidSelect isLight={false} value={str("mode", "wait-all")} options={[{ value: "wait-all", label: "Wait All" }, { value: "first-wins", label: "First Wins" }, { value: "append", label: "Append" }]} onChange={(v) => upd({ mode: v })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
          <FieldWrap label="Input Count">
            <input className={FIELD_INPUT} type="number" value={num("inputCount", 2)} onChange={(e) => upd({ inputCount: Number(e.target.value) || 2 })} placeholder="2" />
          </FieldWrap>
        </>
      )

    case "split":
      return (
        <FieldWrap label="Output Count">
          <input className={FIELD_INPUT} type="number" value={num("outputCount", 2)} onChange={(e) => upd({ outputCount: Number(e.target.value) || 2 })} placeholder="2" />
        </FieldWrap>
      )

    case "wait": {
      const waitMode = str("waitMode", "duration")
      return (
        <>
          <FieldWrap label="Mode">
            <FluidSelect isLight={false} value={waitMode} options={[{ value: "duration", label: "Duration" }, { value: "until-time", label: "Until Time" }, { value: "webhook", label: "Webhook" }]} onChange={(v) => upd({ waitMode: v })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
          {waitMode === "duration" && (
            <FieldWrap label="Duration (ms)">
              <input className={FIELD_INPUT} type="number" value={num("durationMs", 60000)} onChange={(e) => upd({ durationMs: Number(e.target.value) || 60000 })} placeholder="60000" />
            </FieldWrap>
          )}
          {waitMode === "until-time" && (
            <FieldWrap label="Until (HH:MM)">
              <input className={FIELD_INPUT} value={str("untilTime")} onChange={(e) => upd({ untilTime: e.target.value })} placeholder="14:00" />
            </FieldWrap>
          )}
          {waitMode === "webhook" && (
            <FieldWrap label="Webhook Path">
              <input className={FIELD_INPUT} value={str("webhookPath")} onChange={(e) => upd({ webhookPath: e.target.value })} placeholder="/missions/wait/:id" />
            </FieldWrap>
          )}
        </>
      )
    }

    // ── Transform ────────────────────────────────────────────────────────────
    case "set-variables": {
      const assignments = Array.isArray(cfg.assignments) ? (cfg.assignments as Array<Record<string, unknown>>) : []
      const assignText = assignments.map((a) => `${String(a.name || "")}=${String(a.value || "")}`).join("\n")
      return (
        <FieldWrap label="Assignments (name=value per line)">
          <textarea
            className={cn(FIELD_INPUT, "min-h-16 resize-y font-mono")}
            value={assignText}
            onChange={(e) => {
              const parsed = e.target.value.split("\n").filter(Boolean).map((line) => {
                const eq = line.indexOf("=")
                if (eq < 0) return { name: line.trim(), value: "" }
                return { name: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() }
              })
              upd({ assignments: parsed })
            }}
            placeholder={"greeting=Hello {{$vars.name}}\ncount=0"}
          />
        </FieldWrap>
      )
    }

    case "code":
      return (
        <>
          <FieldWrap label="Input Expression">
            <input className={FIELD_INPUT} value={str("inputExpression")} onChange={(e) => upd({ inputExpression: e.target.value })} placeholder="{{$nodes.Step.output.text}} (blank = last output)" />
          </FieldWrap>
          <FieldWrap label="Code (JS — use return)">
            <textarea
              className={cn(FIELD_INPUT, "min-h-[84px] resize-y font-mono text-[9.5px]")}
              value={str("code", "return $input;")}
              onChange={(e) => upd({ code: e.target.value })}
              placeholder={"// $input, $vars, $nodes available\nreturn $input.toUpperCase()"}
            />
          </FieldWrap>
        </>
      )

    case "format":
      return (
        <>
          <FieldWrap label="Template">
            <textarea className={cn(FIELD_INPUT, "min-h-16 resize-y")} value={str("template", "{{$nodes.AI.output.text}}")} onChange={(e) => upd({ template: e.target.value })} placeholder="{{$nodes.AI.output.text}}" />
          </FieldWrap>
          <FieldWrap label="Format">
            <FluidSelect isLight={false} value={str("outputFormat", "text")} options={[{ value: "text", label: "Text" }, { value: "markdown", label: "Markdown" }, { value: "json", label: "JSON" }, { value: "html", label: "HTML" }]} onChange={(v) => upd({ outputFormat: v })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
        </>
      )

    case "filter":
      return (
        <>
          <FieldWrap label="Expression (per item)">
            <input className={FIELD_INPUT} value={str("expression")} onChange={(e) => upd({ expression: e.target.value })} placeholder="$item.price > 100" />
          </FieldWrap>
          <FieldWrap label="Mode">
            <FluidSelect isLight={false} value={str("mode", "keep")} options={[{ value: "keep", label: "Keep matching" }, { value: "remove", label: "Remove matching" }]} onChange={(v) => upd({ mode: v })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
        </>
      )

    case "sort":
      return (
        <>
          <FieldWrap label="Field">
            <input className={FIELD_INPUT} value={str("field")} onChange={(e) => upd({ field: e.target.value })} placeholder="price" />
          </FieldWrap>
          <FieldWrap label="Direction">
            <FluidSelect isLight={false} value={str("direction", "asc")} options={[{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]} onChange={(v) => upd({ direction: v })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
        </>
      )

    case "dedupe":
      return (
        <FieldWrap label="Dedup Field">
          <input className={FIELD_INPUT} value={str("field")} onChange={(e) => upd({ field: e.target.value })} placeholder="id (blank = full item)" />
        </FieldWrap>
      )

    // ── Output ───────────────────────────────────────────────────────────────
    case "novachat-output":
      return <MessageTemplateArea value={str("messageTemplate")} onChange={(v) => upd({ messageTemplate: v })} />

    case "telegram-output":
      return (
        <>
          <CsvField label="Chat IDs" value={arr("chatIds")} onChange={(v) => upd({ chatIds: v })} placeholder="-100123456789" />
          <MessageTemplateArea value={str("messageTemplate")} onChange={(v) => upd({ messageTemplate: v })} />
          <FieldWrap label="Parse Mode">
            <FluidSelect isLight={false} value={str("parseMode", "markdown")} options={[{ value: "markdown", label: "Markdown" }, { value: "html", label: "HTML" }, { value: "plain", label: "Plain" }]} onChange={(v) => upd({ parseMode: v })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
        </>
      )

    case "discord-output":
      return (
        <>
          <CsvField label="Webhook URLs" value={arr("webhookUrls")} onChange={(v) => upd({ webhookUrls: v })} placeholder="https://discord.com/api/webhooks/..." />
          <MessageTemplateArea value={str("messageTemplate")} onChange={(v) => upd({ messageTemplate: v })} />
        </>
      )

    case "email-output":
      return (
        <>
          <CsvField label="Recipients" value={arr("recipients")} onChange={(v) => upd({ recipients: v })} placeholder="you@example.com" />
          <FieldWrap label="Subject">
            <input className={FIELD_INPUT} value={str("subject", "Mission Output")} onChange={(e) => upd({ subject: e.target.value })} placeholder="Daily Briefing: {{date}}" />
          </FieldWrap>
          <MessageTemplateArea value={str("messageTemplate")} onChange={(v) => upd({ messageTemplate: v })} />
          <FieldWrap label="Format">
            <FluidSelect isLight={false} value={str("format", "text")} options={[{ value: "text", label: "Plain Text" }, { value: "html", label: "HTML" }]} onChange={(v) => upd({ format: v })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
        </>
      )

    case "webhook-output": {
      const headers = typeof cfg.headers === "object" && cfg.headers !== null ? (cfg.headers as Record<string, string>) : {}
      const headersText = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n")
      return (
        <>
          <FieldWrap label="URL">
            <div className="grid grid-cols-[72px_1fr] gap-1.5">
              <FluidSelect isLight={false} value={str("method", "POST")} options={[{ value: "POST", label: "POST" }, { value: "PUT", label: "PUT" }]} onChange={(v) => upd({ method: v })} buttonClassName={FIELD_SELECT_BTN} />
              <input className={FIELD_INPUT} value={str("url")} onChange={(e) => upd({ url: e.target.value })} placeholder="https://example.com/webhook" />
            </div>
          </FieldWrap>
          <FieldWrap label="Headers (key: value per line)">
            <textarea
              className={cn(FIELD_INPUT, "min-h-12 resize-y font-mono text-[9.5px]")}
              value={headersText}
              onChange={(e) => {
                const parsed: Record<string, string> = {}
                for (const line of e.target.value.split("\n")) {
                  const colon = line.indexOf(":")
                  if (colon > 0) parsed[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
                }
                upd({ headers: parsed })
              }}
              placeholder={"Content-Type: application/json\nX-API-Key: secret"}
            />
          </FieldWrap>
          <FieldWrap label="Body Template">
            <textarea className={cn(FIELD_INPUT, "min-h-12 resize-y")} value={str("bodyTemplate")} onChange={(e) => upd({ bodyTemplate: e.target.value })} placeholder='{"text":"{{$nodes.AI.output.text}}"}' />
          </FieldWrap>
        </>
      )
    }

    case "slack-output":
      return (
        <>
          <FieldWrap label="Channel / Webhook URL">
            <input className={FIELD_INPUT} value={str("webhookUrl") || str("channel")} onChange={(e) => {
              const v = e.target.value
              upd(v.startsWith("http") ? { webhookUrl: v, channel: "" } : { channel: v, webhookUrl: "" })
            }} placeholder="#general or https://hooks.slack.com/..." />
          </FieldWrap>
          <MessageTemplateArea value={str("messageTemplate")} onChange={(v) => upd({ messageTemplate: v })} />
        </>
      )

    // ── Utility ──────────────────────────────────────────────────────────────
    case "sticky-note":
      return (
        <FieldWrap label="Content">
          <textarea className={cn(FIELD_INPUT, "min-h-[72px] resize-y")} value={str("content", "Notes…")} onChange={(e) => upd({ content: e.target.value })} placeholder="Notes…" />
        </FieldWrap>
      )

    case "sub-workflow":
      return (
        <>
          <FieldWrap label="Mission ID">
            <input className={FIELD_INPUT} value={str("missionId")} onChange={(e) => upd({ missionId: e.target.value })} placeholder="Paste the target mission ID" />
          </FieldWrap>
          <FieldWrap label="Wait for Completion">
            <FluidSelect isLight={false} value={bool("waitForCompletion", true) ? "yes" : "no"} options={[{ value: "yes", label: "Yes — block until done" }, { value: "no", label: "No — fire and forget" }]} onChange={(v) => upd({ waitForCompletion: v === "yes" })} buttonClassName={FIELD_SELECT_BTN} />
          </FieldWrap>
        </>
      )

    default:
      return null
  }
}

// ── InlineFields (the full inline config panel rendered inside each node) ──────

function InlineFields({
  nodeId,
  nodeConfig,
}: {
  nodeId: string
  nodeConfig: Record<string, unknown>
}) {
  const { setNodes } = useReactFlow()

  const updateNodeConfig = (updates: Record<string, unknown>) => {
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== nodeId) return node
        const currentData = (node.data || {}) as MissionNodeData
        const currentConfig = (currentData.nodeConfig || {}) as Record<string, unknown>
        const nextConfig = { ...currentConfig, ...updates }
        return {
          ...node,
          data: {
            ...currentData,
            label: typeof nextConfig.label === "string" ? nextConfig.label : currentData.label,
            nodeConfig: nextConfig,
          },
        }
      }),
    )
  }

  const type = String(nodeConfig.type || "")
  const label = typeof nodeConfig.label === "string" ? nodeConfig.label : ""

  return (
    <div className="mt-2 space-y-2 border-t border-white/[0.07] pt-2.5">
      <FieldWrap label="Name">
        <input
          className={FIELD_INPUT}
          value={label}
          onChange={(e) => updateNodeConfig({ label: e.target.value })}
          placeholder="Node name"
        />
      </FieldWrap>
      <TypeFields type={type} cfg={nodeConfig} upd={updateNodeConfig} />
    </div>
  )
}

// ── BaseNode ───────────────────────────────────────────────────────────────────

export const BaseNode = memo(function BaseNode({ id, data, selected }: NodeProps) {
  const { catalogEntry, isRunning, hasError, hasCompleted, label, nodeConfig } = data as MissionNodeData

  const statusRing = isRunning
    ? "ring-2 ring-white/28"
    : hasError
      ? "ring-2 ring-rose-300/55"
      : hasCompleted
        ? "ring-2 ring-emerald-300/55"
        : selected
          ? "ring-2 ring-white/24"
          : ""

  const statusTone = isRunning
    ? "border-white/24 bg-white/[0.08] text-white/82"
    : hasError
      ? "border-rose-300/34 bg-rose-500/14 text-rose-100"
      : hasCompleted
        ? "border-emerald-300/34 bg-emerald-500/14 text-emerald-100"
        : "border-white/12 bg-white/[0.04] text-white/55"

  const statusLabel = isRunning ? "Running" : hasError ? "Error" : hasCompleted ? "Done" : "Idle"

  return (
    <div
      className={cn(
        "relative min-w-[280px] max-w-[360px] rounded-2xl border px-3 py-3 shadow-[0_18px_44px_rgba(0,0,0,0.52)] backdrop-blur-xl transition-all",
        catalogEntry.borderColor,
        "bg-slate-950/85",
        statusRing,
      )}
    >
      {catalogEntry.inputs.map((port, i) => (
        <Handle
          key={`in-${port}`}
          type="target"
          position={Position.Left}
          id={port}
          style={{ top: `${50 + (i - (catalogEntry.inputs.length - 1) / 2) * 24}%` }}
          className="!h-3 !w-3 !rounded-full !border-2 !border-white/25 !bg-[hsl(var(--mission-flow-handle)/0.85)]"
        />
      ))}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={cn("rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]", catalogEntry.textColor, catalogEntry.borderColor)}>
            {catalogEntry.category}
          </span>
          <div className="mt-1.5 truncate text-[13px] font-semibold leading-tight text-white">{label}</div>
          <div className="mt-0.5 text-[10px] leading-tight text-white/40">{catalogEntry.label}</div>
        </div>
        <span className={cn("shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-medium", statusTone)}>{statusLabel}</span>
      </div>

      <InlineFields nodeId={id} nodeConfig={(nodeConfig || {}) as Record<string, unknown>} />

      {catalogEntry.outputs.length > 1 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {catalogEntry.outputs.map((port) => (
            <span key={port} className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-white/50">
              → {port}
            </span>
          ))}
        </div>
      )}

      {catalogEntry.outputs.map((port, i) => (
        <Handle
          key={`out-${port}`}
          type="source"
          position={Position.Right}
          id={port}
          style={{ top: `${50 + (i - (catalogEntry.outputs.length - 1) / 2) * 24}%` }}
          className="!h-3 !w-3 !rounded-full !border-2 !border-white/25 !bg-[hsl(var(--mission-flow-handle)/0.85)]"
        />
      ))}
    </div>
  )
})
