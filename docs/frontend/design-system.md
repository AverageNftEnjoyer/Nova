# Nova design system

Calm, dense, precise. Layered graphite (dark) or cool off-white (light) surfaces separated by 1px hairlines; one accent used sparingly; Geist Sans for UI and Geist Mono for data. Tokens live in `hud/app/styles/theme.css`, primitives in `hud/components/ui/` (import from `@/components/ui`). Every primitive in every variant renders at `/dev/design` (internal, not in navigation).

## Tokens

Use the Tailwind utilities, never hex values, `bg-black/..` or `text-white/..`.

| Role | Utilities | Notes |
| --- | --- | --- |
| Page background | `bg-canvas` (`bg-page` alias) | body already has it |
| Surfaces | `bg-surface`, `bg-surface-2`, `bg-surface-3` | panels/cards → controls/menus → chips/raised |
| States | `bg-hover`, `bg-active`, `bg-scrim` | hover wash, pressed/selected neutral, modal backdrop |
| Borders | `border-border`, `border-subtle`, `border-strong` | also `bg-border*` for 1px rules |
| Text | `text-fg`, `text-muted`, `text-faint` | faint = placeholders, disabled, tertiary meta only |
| Accent | `bg-accent`, `bg-accent-hover`, `text-accent-fg` (= `text-on-accent`), `bg-accent-muted`, `border-accent-border`, `text-accent-text`, `ring-ring` / `outline-ring` | `text-accent-text` for accent-coloured words/links (readable on every surface); `text-accent` only for icons/markers |
| Status | `text-success` `bg-success` `bg-success-muted`, same for `warning`, `danger`, `info`; `bg-danger-solid` / `text-danger-fg` for destructive buttons | status only, never decoration |
| Overlay shadow | `shadow-overlay` | menus, dialogs, sheets, toasts only |
| Charts | `--chart-1` … `--chart-5` | redefined under `.dark` so every hue stays in the dark lightness band; Recharts reads them via `useChartTokens()` |

Accent: the Settings accent (`AccentProvider`) sets `<html data-accent="...">`; theme.css maps every option to a restrained, contrast-checked hue per theme ("white"/"black" are neutral: graphite / ink in light, near-white / steel in dark). Read the resolved colour in JS with `getComputedStyle(document.documentElement).getPropertyValue("--accent")` (also `--accent-rgb` as `r, g, b`). Theme is the `dark` / `light` class on `<html>`; use the `dark:` variant only when a token cannot express it.

## Type

Geist Sans (`font-sans`, default) and Geist Mono (`font-mono`) for IDs, model names, token counts, costs, table timestamps, code, kbd. Add `tabular-nums` to any number that changes or lines up.

| Utility | px | Use |
| --- | --- | --- |
| `text-2xs` | 11 | dense meta, kbd |
| `text-xs` | 12 | meta, table headers, hints |
| `text-sm` | 13 | **body / UI default** (body is 13px) |
| `text-md` | 14 | section titles (`font-medium`) |
| `text-base` | 16 | rare: reading text |
| `text-xl` | 20 | page title (`font-semibold tracking-[-0.015em]`) |
| `text-2xl` / `text-3xl` | 24 / 30 | rare |

T-shirt names are deliberate: `cn()` (tailwind-merge) only recognises those as font sizes, so never add a non-t-shirt `text-*` size. Sentence case everywhere; no ALL-CAPS or letter-spaced labels, no `→` on buttons, no middle-dot meta strings.

Root size: 16px up to ~1440p, then `--root-scale` steps up (2200×1200 → 112.5%, 2800×1500 → 137.5%, 3200×1750 → 162.5%, 3600×2000 → 200%) so 4K at DPR 1 reads like 1080p. The text size setting multiplies it (`--font-scale`). Size everything in rem (Tailwind spacing already is).

## Spacing, radii, motion

- Spacing: Tailwind's 4px grid. Controls 28/32/36px tall (`sm`/`md`/`lg`), table rows 32/36px, panel padding 16px, page gutter 24-32px.
- Radii: `rounded-sm` 4 chips/badges, `rounded-md` 6 controls, `rounded-lg` 8 panels/cards/menus, `rounded-xl` 12 dialogs.
- Motion: default transition 140ms ease-out; `animate-pop-in`, `animate-overlay-in`, `animate-sheet-in`, `animate-toast-in` for things that answer an action; `animate-live-pulse` only for live indicators. `prefers-reduced-motion` disables all of it globally.
- Focus: every focusable gets a 2px `--ring` outline on `:focus-visible` (global). Controls use a border + `ring-accent-muted` instead.

## Primitives

```tsx
import { Button, IconButton, PageHeader, Panel, Table, THead, TBody, Tr, Th, Td, Badge, EmptyState, toast } from "@/components/ui"
```

| Primitive | Key props |
| --- | --- |
| `Button` | `variant` primary/secondary/outline/ghost/danger/link, `size` sm/md/lg/icon/icon-sm, `loading`, `asChild` |
| `IconButton` | required `aria-label`, `size` sm/md/lg, `variant` (default ghost). Wrap in `Tooltip` |
| `Input`, `Textarea`, `SearchInput` | `size`, `mono`, `invalid`; Textarea `autoGrow minRows maxRows`; SearchInput `value onValueChange shortcut` (Esc clears) |
| `Select` | `value options onValueChange placeholder size mono`; options `{ value, label, description?, disabled? }`. |
| `Field` | `label hint error inline aside required`: wires id / aria-describedby / aria-invalid into the control inside |
| `Switch`, `Checkbox` | `checked onCheckedChange`; Checkbox supports `"indeterminate"` and `label`. |
| `Tabs` + `TabsList` `TabsTrigger` `TabsContent` | `value onValueChange variant` underline (navigation) / segmented (view switch); trigger `count` |
| `Dialog` + `DialogHeader` `DialogTitle` `DialogDescription` `DialogBody` `DialogFooter` | `open onOpenChange size` sm/md/lg/xl, `dismissible`, `initialFocus`; `data-autofocus` on a child focuses it |
| `Sheet` | right drawer: `open onOpenChange title description actions footer size` |
| `DropdownMenu*` | Radix; `DropdownMenuItem variant="destructive"`, `DropdownMenuShortcut` |
| `Tooltip` | `content side align delay shortcut`; child must be one focusable element |
| `Badge` | `tone` neutral/accent/success/warning/danger/info, `variant` soft/outline, `dot` (true / "pulse"), `mono` |
| `StatusDot` | `tone` idle/running(pulse)/success/warning/danger/info, `label` |
| `Panel` | `title description actions icon footer flush` (flush for an edge-to-edge Table) |
| `Card` | `interactive padding`; for one self-contained object |
| `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td` | Table `density stickyHeader`; Tr `interactive selected`; Th/Td `numeric`; Td `mono muted` |
| `EmptyState` | `icon title description action size tone` (danger for load errors + Retry) |
| `Skeleton`, `SkeletonRows`, `Spinner` | size skeletons like the content they replace |
| `toast()` / `<Toaster/>` / `useToast()` | `toast("Saved")`, `toast.success/error/warning/info({ title, description, action, duration })`, `toast.dismiss(id)`; Toaster is mounted in the root layout |
| `PageHeader` | `title description actions meta tabs` |
| `SectionHeader` | `title description actions count as` |
| `Stat`, `StatGroup` | `label value delta deltaTone hint size`; StatGroup = one bordered strip with hairline dividers |
| `Separator`, `Kbd` | `orientation subtle`; one key per Kbd |
| `Portal`, `useModalBehavior`, `useAnchoredPosition` | building blocks for custom overlays |

```tsx
<PageHeader title="Runs" description="Agent tasks and automation runs." actions={<Button><Plus />New deployment</Button>} />
<Panel title="Waiting for approval" flush actions={<Badge tone="warning">{pending.length}</Badge>}>
  {pending.length === 0 ? (
    <EmptyState size="compact" title="Nothing waiting" description="Runs that need your approval show up here." />
  ) : (
    <Table>
      <THead><tr><Th>Run</Th><Th numeric>Cost</Th></tr></THead>
      <TBody>{pending.map((r) => (<Tr key={r.id}><Td>{r.name}</Td><Td numeric mono>{formatUsd(r.costUsd)}</Td></Tr>))}</TBody>
    </Table>
  )}
</Panel>
```

## Do / don't

- Do use lists and tables with row actions; reserve cards for distinct objects. Don't tile identical cards.
- Do give one column the weight (main content) and keep the side column quieter.
- Do use the accent only for the primary action, focus, selection, the active nav marker and live indicators.
- Do write empty/error copy that says what is missing and what to do. Don't invent data.
- Don't add glows, gradients, blur/glass panels, pixel fonts, animated backgrounds or shadows on in-page surfaces.
- Don't hand-roll a dialog, menu, select or toast: extend the primitive.
- There is no legacy skin left: `pixel-ui.css`, `spotlight.css`, `orb-animations.css`, `utilities.css` (`text-s-*`, `bg-accent-10`, ...), the shadcn alias tokens and the `FluidSelect` / `NovaSwitch` wrappers are deleted. Everything uses the tokens and primitives above.
