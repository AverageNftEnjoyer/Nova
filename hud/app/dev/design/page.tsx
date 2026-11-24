"use client"

import { useEffect, useState } from "react"
import { Bell, Copy, Inbox, MoreHorizontal, Pencil, Play, Plus, Plug, RefreshCw, Trash2 } from "lucide-react"
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  PageHeader,
  Panel,
  SearchInput,
  SectionHeader,
  Select,
  Separator,
  Sheet,
  Skeleton,
  SkeletonRows,
  Spinner,
  Stat,
  StatGroup,
  StatusDot,
  Switch,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  toast,
} from "@/components/ui"
import { ACCENT_COLORS, type AccentColor } from "@/lib/settings/userSettings"
import { cn } from "@/lib/shared/utils"

/**
 * Internal design-system specimen (not linked from navigation). Every primitive in every variant, so QA can screenshot it.
 * Text here is specimen copy, not product data. Theme/accent switches below only change this window, not the saved settings.
 */

const SURFACES = [
  { name: "canvas", className: "bg-canvas" },
  { name: "surface", className: "bg-surface" },
  { name: "surface-2", className: "bg-surface-2" },
  { name: "surface-3", className: "bg-surface-3" },
  { name: "hover", className: "bg-hover" },
  { name: "active", className: "bg-active" },
]
const BORDERS = [
  { name: "border-subtle", className: "bg-border-subtle" },
  { name: "border", className: "bg-border" },
  { name: "border-strong", className: "bg-border-strong" },
]
const TEXT = [
  { name: "fg", className: "text-fg" },
  { name: "muted", className: "text-muted" },
  { name: "faint", className: "text-faint" },
  { name: "accent-text", className: "text-accent-text" },
]
const SEMANTIC = ["success", "warning", "danger", "info"] as const
const SEMANTIC_CLASS: Record<(typeof SEMANTIC)[number], { solid: string; muted: string; text: string }> = {
  success: { solid: "bg-success", muted: "bg-success-muted", text: "text-success" },
  warning: { solid: "bg-warning", muted: "bg-warning-muted", text: "text-warning" },
  danger: { solid: "bg-danger", muted: "bg-danger-muted", text: "text-danger" },
  info: { solid: "bg-info", muted: "bg-info-muted", text: "text-info" },
}
const TYPE_SCALE = [
  { cls: "text-3xl font-semibold tracking-[-0.02em]", label: "text-3xl 30" },
  { cls: "text-2xl font-semibold tracking-[-0.02em]", label: "text-2xl 24" },
  { cls: "text-xl font-semibold tracking-[-0.015em]", label: "text-xl 20 page title" },
  { cls: "text-base", label: "text-base 16" },
  { cls: "text-md font-medium", label: "text-md 14 section title" },
  { cls: "text-sm", label: "text-sm 13 body" },
  { cls: "text-xs text-muted", label: "text-xs 12 meta" },
  { cls: "text-2xs text-muted", label: "text-2xs 11 dense" },
]
const SELECT_OPTIONS = [
  { value: "trivial", label: "Trivial calls only", description: "Route correction passes and parsing to the economy model" },
  { value: "cost-saving", label: "Cost saving", description: "Route standard calls too when it is cheaper" },
  { value: "off", label: "Off", description: "Every call uses the selected model" },
  { value: "disabled", label: "Unavailable option", disabled: true },
]

function Specimen({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid grid-cols-[11rem_1fr] gap-6 border-t border-border-subtle py-6", className)}>
      <h2 className="pt-1 text-xs font-medium text-muted">{title}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-3", className)}>{children}</div>
}

export default function DesignSystemPage() {
  const [theme, setTheme] = useState<"dark" | "light">("dark")
  const [accent, setAccent] = useState<string>("white")
  useEffect(() => {
    const root = document.documentElement
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(root.classList.contains("light") ? "light" : "dark")
    setAccent(root.dataset.accent ?? "white")
  }, [])
  const [tab, setTab] = useState("runs")
  const [segment, setSegment] = useState("7d")
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState("trivial")
  const [on, setOn] = useState(true)
  const [off, setOff] = useState(false)
  const [checks, setChecks] = useState({ a: true, b: false })
  const [notes, setNotes] = useState("")
  const [dialog, setDialog] = useState<null | "sm" | "md" | "lg">(null)
  const [confirm, setConfirm] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [selected, setSelected] = useState<string | null>("row-2")

  const applyTheme = (next: "dark" | "light") => {
    setTheme(next)
    document.documentElement.classList.remove("dark", "light")
    document.documentElement.classList.add(next)
  }
  const applyAccent = (next: string) => {
    setAccent(next)
    document.documentElement.dataset.accent = next
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-[72rem] px-8 py-10">
        <PageHeader
          title="Design system"
          description="Every primitive in hud/components/ui, in every variant. Internal page for QA screenshots."
          meta={<Badge mono>/dev/design</Badge>}
          actions={
            <>
              <Tabs value={theme} onValueChange={(v) => applyTheme(v as "dark" | "light")} variant="segmented">
                <TabsList aria-label="Theme">
                  <TabsTrigger value="dark">Dark</TabsTrigger>
                  <TabsTrigger value="light">Light</TabsTrigger>
                </TabsList>
              </Tabs>
              <Select
                aria-label="Accent"
                value={accent}
                onValueChange={applyAccent}
                options={(Object.keys(ACCENT_COLORS) as AccentColor[]).map((key) => ({ value: key, label: ACCENT_COLORS[key].name }))}
                className="w-36"
              />
            </>
          }
        />

        <Specimen title="Surfaces">
          <div className="grid grid-cols-6 gap-2">
            {SURFACES.map((s) => (
              <div key={s.name} className="flex flex-col gap-1.5">
                <div className={cn("h-14 rounded-md border border-border", s.className)} />
                <span className="font-mono text-2xs text-muted">{s.name}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-6 gap-2">
            {BORDERS.map((b) => (
              <div key={b.name} className="flex flex-col gap-1.5">
                <div className={cn("h-px", b.className)} />
                <span className="font-mono text-2xs text-muted">{b.name}</span>
              </div>
            ))}
          </div>
        </Specimen>

        <Specimen title="Text and accent">
          <Row className="gap-6">
            {TEXT.map((t) => (
              <span key={t.name} className={cn("text-md", t.className)}>
                {t.name}
              </span>
            ))}
          </Row>
          <Row className="mt-4">
            <span className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg">accent / accent-fg</span>
            <span className="inline-flex h-8 items-center rounded-md bg-accent-hover px-3 text-sm font-medium text-accent-fg">accent-hover</span>
            <span className="inline-flex h-8 items-center rounded-md border border-accent-border bg-accent-muted px-3 text-sm text-accent-text">
              accent-muted / accent-border
            </span>
            <span className="inline-flex h-8 items-center rounded-md px-3 text-sm text-fg outline-2 outline-offset-2 outline-ring">ring</span>
          </Row>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {SEMANTIC.map((name) => (
              <div key={name} className={cn("flex items-center gap-2 rounded-md px-2.5 py-2", SEMANTIC_CLASS[name].muted)}>
                <span className={cn("size-2 rounded-full", SEMANTIC_CLASS[name].solid)} />
                <span className={cn("text-sm font-medium", SEMANTIC_CLASS[name].text)}>{name}</span>
                <span className="ml-auto font-mono text-2xs text-muted">{name}-muted</span>
              </div>
            ))}
          </div>
        </Specimen>

        <Specimen title="Type scale">
          <div className="flex flex-col gap-3">
            {TYPE_SCALE.map((t) => (
              <div key={t.label} className="flex items-baseline gap-6">
                <span className="w-40 shrink-0 font-mono text-2xs text-faint">{t.label}</span>
                <span className={cn("text-fg", t.cls)}>Approve the run before it spends more</span>
              </div>
            ))}
            <div className="flex items-baseline gap-6">
              <span className="w-40 shrink-0 font-mono text-2xs text-faint">font-mono tabular-nums</span>
              <span className="font-mono text-sm tabular-nums text-fg">claude-sonnet-5 12,480 in 1,204 out $0.0412</span>
            </div>
          </div>
        </Specimen>

        <Specimen title="Button">
          <div className="flex flex-col gap-4">
            {(["primary", "secondary", "outline", "ghost", "danger", "link"] as const).map((variant) => (
              <Row key={variant}>
                <span className="w-20 font-mono text-2xs text-faint">{variant}</span>
                <Button variant={variant} size="sm">
                  Small
                </Button>
                <Button variant={variant}>
                  <Plus />
                  Medium
                </Button>
                <Button variant={variant} size="lg">
                  Large
                </Button>
                <Button variant={variant} disabled>
                  Disabled
                </Button>
                {variant !== "link" ? (
                  <Button variant={variant} loading>
                    Saving
                  </Button>
                ) : null}
              </Row>
            ))}
            <Row>
              <span className="w-20 font-mono text-2xs text-faint">asChild</span>
              <Button asChild variant="outline">
                <a href="#tables">Link styled as a button</a>
              </Button>
            </Row>
          </div>
        </Specimen>

        <Specimen title="IconButton and Tooltip">
          <Row>
            <Tooltip content="Run now" shortcut="R">
              <IconButton aria-label="Run now" variant="primary">
                <Play />
              </IconButton>
            </Tooltip>
            <Tooltip content="Edit">
              <IconButton aria-label="Edit" variant="secondary">
                <Pencil />
              </IconButton>
            </Tooltip>
            <Tooltip content="Copy ID" side="bottom">
              <IconButton aria-label="Copy ID" variant="outline">
                <Copy />
              </IconButton>
            </Tooltip>
            <Tooltip content="Refresh">
              <IconButton aria-label="Refresh">
                <RefreshCw />
              </IconButton>
            </Tooltip>
            <IconButton aria-label="Delete" variant="ghost" size="sm" className="hover:text-danger">
              <Trash2 />
            </IconButton>
            <IconButton aria-label="Notifications" size="lg">
              <Bell />
            </IconButton>
          </Row>
        </Specimen>

        <Specimen title="Inputs and Field">
          <div className="grid max-w-[40rem] grid-cols-2 gap-x-5 gap-y-5">
            <Field label="Name" hint="Shown in the run list.">
              <Input placeholder="Morning inbox digest" />
            </Field>
            <Field label="Cost budget" error="Enter a number between 0.10 and 100.">
              <Input defaultValue="-1" mono />
            </Field>
            <Field label="Model routing" hint="Applies to every new call.">
              <Select value={mode} onValueChange={setMode} options={SELECT_OPTIONS} />
            </Field>
            <Field label="Disabled">
              <Input placeholder="Not editable" disabled />
            </Field>
            <Field label="Sizes" className="col-span-2">
              <Row>
                <Input size="sm" placeholder="Small" className="w-40" />
                <Input placeholder="Medium" className="w-40" />
                <Input size="lg" placeholder="Large" className="w-40" />
              </Row>
            </Field>
            <Field label="Search" className="col-span-2">
              <SearchInput value={query} onValueChange={setQuery} placeholder="Search runs" shortcut="/" />
            </Field>
            <Field label="Instructions" hint="Grows with the text up to 8 rows." aside={`${notes.length} / 2000`} className="col-span-2">
              <Textarea autoGrow minRows={2} maxRows={8} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Describe what the task should do" />
            </Field>
          </div>
        </Specimen>

        <Specimen title="Switch and Checkbox">
          <div className="flex max-w-[30rem] flex-col gap-4">
            <Field label="Notify on approval requests" hint="A desktop notification when a run waits for you." inline>
              <Switch checked={on} onCheckedChange={setOn} />
            </Field>
            <Field label="Weekly cost summary" inline>
              <Switch checked={off} onCheckedChange={setOff} />
            </Field>
            <Row>
              <Switch size="sm" checked aria-label="Small on" onCheckedChange={() => undefined} />
              <Switch size="sm" checked={false} aria-label="Small off" onCheckedChange={() => undefined} />
              <Switch checked disabled aria-label="Disabled" />
            </Row>
            <Separator subtle />
            <Row className="gap-5">
              <Checkbox checked={checks.a} onCheckedChange={(v) => setChecks((c) => ({ ...c, a: v }))} label="Include tool calls" />
              <Checkbox checked={checks.b} onCheckedChange={(v) => setChecks((c) => ({ ...c, b: v }))} label="Include cached tokens" />
              <Checkbox checked="indeterminate" onCheckedChange={() => undefined} label="Some selected" />
              <Checkbox checked={false} disabled label="Disabled" />
            </Row>
          </div>
        </Specimen>

        <Specimen title="Tabs">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Underline tabs">
              <TabsTrigger value="runs" count={3}>
                Runs
              </TabsTrigger>
              <TabsTrigger value="deployments">Deployments</TabsTrigger>
              <TabsTrigger value="new">New</TabsTrigger>
              <TabsTrigger value="off" disabled>
                Disabled
              </TabsTrigger>
            </TabsList>
            <TabsContent value="runs" className="py-3 text-sm text-muted">
              Runs panel
            </TabsContent>
            <TabsContent value="deployments" className="py-3 text-sm text-muted">
              Deployments panel
            </TabsContent>
            <TabsContent value="new" className="py-3 text-sm text-muted">
              New panel
            </TabsContent>
          </Tabs>
          <Tabs value={segment} onValueChange={setSegment} variant="segmented" className="mt-3">
            <TabsList aria-label="Range">
              <TabsTrigger value="24h">24h</TabsTrigger>
              <TabsTrigger value="7d">7 days</TabsTrigger>
              <TabsTrigger value="30d">30 days</TabsTrigger>
              <TabsTrigger value="90d">90 days</TabsTrigger>
            </TabsList>
          </Tabs>
        </Specimen>

        <Specimen title="Badge and StatusDot">
          <div className="flex flex-col gap-3">
            <Row>
              {(["neutral", "accent", "success", "warning", "danger", "info"] as const).map((tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ))}
            </Row>
            <Row>
              <Badge tone="accent" dot="pulse">
                Running
              </Badge>
              <Badge tone="success" dot>
                Completed
              </Badge>
              <Badge tone="warning" dot>
                Needs approval
              </Badge>
              <Badge tone="danger" dot>
                Failed
              </Badge>
              <Badge variant="outline">outline</Badge>
              <Badge mono>gpt-5.6-terra</Badge>
            </Row>
            <Row className="gap-5">
              {(["idle", "running", "success", "warning", "danger", "info"] as const).map((tone) => (
                <span key={tone} className="inline-flex items-center gap-2 text-sm text-muted">
                  <StatusDot tone={tone} />
                  {tone}
                </span>
              ))}
            </Row>
          </div>
        </Specimen>

        <Specimen title="Stat">
          <StatGroup>
            <Stat label="Spend" value="$4.82" delta="+12%" deltaTone="negative" hint="Last 7 days" />
            <Stat label="Tokens" value="1.28M" delta="-4%" deltaTone="positive" hint="Input and output" />
            <Stat label="Cache hit rate" value="62%" hint="Of input tokens" />
            <Stat label="Runs" value="38" hint="3 waiting for approval" />
          </StatGroup>
          <Row className="mt-4 gap-10">
            <Stat size="sm" label="Budget left" value="$1.18" />
            <Stat size="sm" label="Median latency" value="2.4s" />
          </Row>
        </Specimen>

        <Specimen title="Panel and Card">
          <div className="grid grid-cols-[2fr_1fr] gap-4">
            <Panel
              title="Recent runs"
              description="Agent tasks and automation runs"
              icon={<Inbox />}
              actions={
                <>
                  <Button size="sm" variant="ghost">
                    View all
                  </Button>
                  <IconButton aria-label="More" size="sm">
                    <MoreHorizontal />
                  </IconButton>
                </>
              }
              footer={<span>Updated just now</span>}
            >
              <p className="text-sm text-muted">Panel body. Use flush for an edge-to-edge Table.</p>
            </Panel>
            <div className="flex flex-col gap-3">
              <Card>
                <p className="text-md font-medium text-fg">Card</p>
                <p className="mt-1 text-sm text-muted">One self-contained object.</p>
              </Card>
              <Card interactive padding="sm" tabIndex={0}>
                <div className="flex items-center gap-2.5">
                  <Plug className="size-4 text-muted" />
                  <span className="text-sm font-medium text-fg">Interactive card</span>
                  <Badge tone="success" dot className="ml-auto">
                    Connected
                  </Badge>
                </div>
              </Card>
            </div>
          </div>
        </Specimen>

        <Specimen title="Table" className="scroll-mt-6">
          <div id="tables" className="flex flex-col gap-4">
            <Panel title="Table in a flush panel" flush>
              <Table stickyHeader containerClassName="max-h-[15rem] overflow-y-auto">
                <THead>
                  <tr>
                    <Th className="w-8" />
                    <Th>Run</Th>
                    <Th>Status</Th>
                    <Th>Model</Th>
                    <Th numeric>Tokens</Th>
                    <Th numeric>Cost</Th>
                    <Th className="w-10" />
                  </tr>
                </THead>
                <TBody>
                  {[
                    { id: "row-1", name: "Specimen row one", status: "running", model: "claude-sonnet-5", tokens: "18,204", cost: "$0.0912" },
                    { id: "row-2", name: "Specimen row two (selected)", status: "approval", model: "gpt-5.6-terra", tokens: "4,118", cost: "$0.0130" },
                    { id: "row-3", name: "Specimen row three", status: "done", model: "gemini-3.8-flash", tokens: "52,960", cost: "$0.0207" },
                    { id: "row-4", name: "Specimen row four", status: "failed", model: "grok-4.3", tokens: "902", cost: "$0.0011" },
                    { id: "row-5", name: "Specimen row five", status: "done", model: "claude-sonnet-5", tokens: "7,440", cost: "$0.0381" },
                  ].map((row) => (
                    <Tr key={row.id} interactive selected={selected === row.id} onClick={() => setSelected(row.id)}>
                      <Td>
                        <Checkbox checked={selected === row.id} onCheckedChange={() => setSelected(row.id)} aria-label={`Select ${row.name}`} />
                      </Td>
                      <Td className="font-medium">{row.name}</Td>
                      <Td>
                        {row.status === "running" ? (
                          <Badge tone="accent" dot="pulse">Running</Badge>
                        ) : row.status === "approval" ? (
                          <Badge tone="warning" dot>Needs approval</Badge>
                        ) : row.status === "failed" ? (
                          <Badge tone="danger" dot>Failed</Badge>
                        ) : (
                          <Badge tone="success" dot>Completed</Badge>
                        )}
                      </Td>
                      <Td mono muted>{row.model}</Td>
                      <Td numeric mono>{row.tokens}</Td>
                      <Td numeric mono>{row.cost}</Td>
                      <Td>
                        <IconButton aria-label={`Actions for ${row.name}`} size="sm" className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100">
                          <MoreHorizontal />
                        </IconButton>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </Panel>
            <Panel title="Compact density" flush>
              <Table density="compact">
                <THead>
                  <tr>
                    <Th>Key</Th>
                    <Th>Value</Th>
                  </tr>
                </THead>
                <TBody>
                  <Tr>
                    <Td mono muted>NOVA_LLM_USAGE_RETENTION_DAYS</Td>
                    <Td mono>90</Td>
                  </Tr>
                  <Tr>
                    <Td mono muted>model-routing</Td>
                    <Td mono>trivial</Td>
                  </Tr>
                </TBody>
              </Table>
            </Panel>
          </div>
        </Specimen>

        <Specimen title="Empty, loading">
          <div className="grid grid-cols-2 gap-4">
            <Panel title="Empty">
              <EmptyState
                size="compact"
                icon={<Inbox />}
                title="No runs yet"
                description="Runs appear here when a deployment starts or you launch a task."
                action={
                  <Button size="sm">
                    <Plus />
                    New deployment
                  </Button>
                }
              />
            </Panel>
            <Panel title="Error">
              <EmptyState
                size="compact"
                tone="danger"
                icon={<RefreshCw />}
                title="Could not load runs"
                description="The local runtime did not answer. Check that Nova is running, then retry."
                action={
                  <Button size="sm" variant="secondary">
                    Retry
                  </Button>
                }
              />
            </Panel>
            <Panel title="Skeleton rows" flush>
              <SkeletonRows rows={4} />
            </Panel>
            <Panel title="Skeleton and Spinner">
              <div className="flex flex-col gap-2.5">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-2/3" />
                <Row className="mt-2 text-muted">
                  <Spinner size="xs" />
                  <Spinner size="sm" />
                  <Spinner />
                  <Spinner size="lg" label="Loading" />
                </Row>
              </div>
            </Panel>
          </div>
        </Specimen>

        <Specimen title="Overlays">
          <Row>
            <Button variant="secondary" onClick={() => setDialog("sm")}>
              Dialog sm
            </Button>
            <Button variant="secondary" onClick={() => setDialog("md")}>
              Dialog md
            </Button>
            <Button variant="secondary" onClick={() => setDialog("lg")}>
              Dialog lg
            </Button>
            <Button variant="outline" onClick={() => setConfirm(true)}>
              Confirm delete
            </Button>
            <Button variant="outline" onClick={() => setSheet(true)}>
              Open sheet
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  Menu
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Run</DropdownMenuLabel>
                <DropdownMenuItem>
                  <Play />
                  Run now
                  <DropdownMenuShortcut>R</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Copy />
                  Copy ID
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <Pencil />
                  Edit (disabled)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Row>
          <Row className="mt-3">
            <Button variant="ghost" onClick={() => toast("Settings saved")}>
              Toast
            </Button>
            <Button variant="ghost" onClick={() => toast.success({ title: "Deployment launched", description: "The first run starts in a few seconds." })}>
              Success toast
            </Button>
            <Button variant="ghost" onClick={() => toast.warning("Budget at 80%")}>
              Warning toast
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                toast.error({
                  title: "Could not reach Gmail",
                  description: "Reconnect it in Integrations.",
                  action: { label: "Open", onClick: () => undefined },
                })
              }
            >
              Error toast
            </Button>
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
              <span className="ml-1">Kbd</span>
            </span>
          </Row>
        </Specimen>

        <Specimen title="Section header">
          <SectionHeader
            title="Connected providers"
            count={4}
            description="Models Nova can call"
            actions={
              <Button size="sm" variant="outline">
                Manage
              </Button>
            }
          />
          <Separator />
        </Specimen>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)} size={dialog ?? "md"}>
        <DialogHeader>
          <DialogTitle>Rename deployment</DialogTitle>
          <DialogDescription>The name shows in the run list and notifications.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Name">
            <Input data-autofocus defaultValue="Morning inbox digest" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button onClick={() => setDialog(null)}>Save name</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={confirm} onOpenChange={setConfirm} size="sm" dismissible={false}>
        <DialogHeader hideClose>
          <DialogTitle>Delete this deployment?</DialogTitle>
          <DialogDescription>Its run history stays in Analytics. This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => setConfirm(false)}>
            Delete deployment
          </Button>
        </DialogFooter>
      </Dialog>

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Run details"
        description="Sheet: right-side drawer for detail views."
        actions={
          <IconButton aria-label="Copy run ID" size="sm">
            <Copy />
          </IconButton>
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setSheet(false)}>
              Close
            </Button>
            <Button onClick={() => setSheet(false)}>Approve</Button>
          </>
        }
      >
        <div className="flex flex-col gap-5 p-4">
          <StatGroup>
            <Stat size="sm" label="Tokens" value="4,118" />
            <Stat size="sm" label="Cost" value="$0.0130" />
          </StatGroup>
          <Field label="Reviewer note">
            <Textarea autoGrow minRows={3} placeholder="Optional" />
          </Field>
        </div>
      </Sheet>
    </div>
  )
}
