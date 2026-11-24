import {
  BarChart3,
  CalendarDays,
  History,
  Home,
  MessageSquare,
  Play,
  Plug,
  Rocket,
  ScrollText,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from "lucide-react"

/** Where "New chat" goes. The chat page reads `?new=1` and opens a fresh conversation. */
export const NEW_CHAT_HREF = "/chat?new=1"
export const NEW_DEPLOYMENT_HREF = "/deployments/new"

export type NavItemId =
  | "home"
  | "chat"
  | "runs"
  | "deployments"
  | "missions"
  | "integrations"
  | "analytics"
  | "history"
  | "polymarket"
  | "dev-logs"

export interface NavItem {
  id: NavItemId
  label: string
  href: string
  icon: LucideIcon
  /** Extra words the command palette matches on. */
  keywords?: string
  /** Only shown when this condition holds (see `useNavVisibility`). */
  requires?: "polymarket"
}

export interface NavGroup {
  id: "workspace" | "insights" | "developer"
  /** Visible group label; the first group has none. */
  label?: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    items: [
      { id: "home", label: "Home", href: "/home", icon: Home, keywords: "overview start" },
      { id: "chat", label: "Chat", href: "/chat", icon: MessageSquare, keywords: "conversation assistant talk" },
      { id: "runs", label: "Runs", href: "/runs", icon: Play, keywords: "agent tasks approvals queue" },
      { id: "deployments", label: "Deployments", href: "/deployments", icon: Rocket, keywords: "deploy automation task" },
      { id: "missions", label: "Missions", href: "/missions", icon: Workflow, keywords: "workflows automations graph" },
      { id: "integrations", label: "Integrations", href: "/integrations", icon: Plug, keywords: "connections providers api keys" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    items: [
      { id: "analytics", label: "Analytics", href: "/analytics", icon: BarChart3, keywords: "cost tokens usage spend" },
      { id: "history", label: "History", href: "/history", icon: History, keywords: "past chats archive" },
      { id: "polymarket", label: "Polymarket", href: "/polymarket", icon: TrendingUp, keywords: "markets odds", requires: "polymarket" },
    ],
  },
  {
    id: "developer",
    label: "Developer",
    items: [{ id: "dev-logs", label: "Dev logs", href: "/dev-logs", icon: ScrollText, keywords: "traces debug latency errors" }],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)

/** Pages reachable from the palette that are not primary nav items. */
export const EXTRA_DESTINATIONS: NavItem[] = [
  { id: "missions", label: "Mission calendar", href: "/missions/calendar", icon: CalendarDays, keywords: "schedule calendar" },
]

interface Crumb {
  label: string
  href?: string
}

/** Sub-pages below a nav item, by exact path. */
const SUB_PAGES: Record<string, string> = {
  "/missions/calendar": "Calendar",
  "/deployments/new": "New deployment",
}

const INTERNAL_PAGES: Record<string, string> = {
  "/dev/design": "Design system",
}

function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** The nav item a path belongs to (longest matching prefix), if any. */
export function activeNavItem(pathname: string): NavItem | null {
  let best: NavItem | null = null
  for (const item of NAV_ITEMS) {
    if (matchesPath(pathname, item.href) && (!best || item.href.length > best.href.length)) best = item
  }
  return best
}

/** Breadcrumb for the top bar: the section, then the sub-page when there is one. */
export function breadcrumbFor(pathname: string): Crumb[] {
  const internal = INTERNAL_PAGES[pathname]
  if (internal) return [{ label: internal }]
  const item = activeNavItem(pathname)
  if (!item) return [{ label: "Nova" }]
  const sub = SUB_PAGES[pathname]
  return sub ? [{ label: item.label, href: item.href }, { label: sub }] : [{ label: item.label }]
}
