/**
 * Calendar Category Store
 * Persists user-defined calendar categories in localStorage.
 * Built-in categories (mission, agent, personal) cannot be removed.
 */

const STORAGE_KEY = "nova_calendar_categories"

export interface CalendarCategory {
  id: string
  label: string
  color: string       // hex color e.g. "#22D3EE"
  builtin?: boolean   // true for default categories that can't be deleted
}

export const BUILTIN_CATEGORIES: CalendarCategory[] = [
  { id: "mission",  label: "Agent Missions", color: "#22D3EE", builtin: true },
  { id: "agent",    label: "Agent Tasks",    color: "#A78BFA", builtin: true },
  { id: "personal", label: "Personal",       color: "#F59E0B", builtin: true },
]

export function loadCalendarCategories(): CalendarCategory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...BUILTIN_CATEGORIES]
    const custom = JSON.parse(raw) as CalendarCategory[]
    if (!Array.isArray(custom)) return [...BUILTIN_CATEGORIES]
    const builtinIds = new Set(BUILTIN_CATEGORIES.map((c) => c.id))
    const merged = [...BUILTIN_CATEGORIES]
    for (const cat of custom) {
      if (!cat.id || !cat.label || !cat.color) continue
      if (builtinIds.has(cat.id)) continue
      merged.push({ ...cat, builtin: false })
    }
    return merged
  } catch {
    return [...BUILTIN_CATEGORIES]
  }
}

export function saveCalendarCategories(categories: CalendarCategory[]): void {
  const custom = categories.filter((c) => !c.builtin)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))
}

export function addCalendarCategory(label: string, color: string): CalendarCategory {
  const categories = loadCalendarCategories()
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const newCat: CalendarCategory = { id, label, color, builtin: false }
  categories.push(newCat)
  saveCalendarCategories(categories)
  return newCat
}

export function removeCalendarCategory(id: string): void {
  const categories = loadCalendarCategories()
  const filtered = categories.filter((c) => c.id !== id || c.builtin)
  saveCalendarCategories(filtered)
}

export const PRESET_COLORS = [
  "#22D3EE", "#A78BFA", "#F59E0B", "#10B981", "#F43F5E",
  "#3B82F6", "#EC4899", "#8B5CF6", "#14B8A6", "#F97316",
  "#6366F1", "#84CC16", "#EF4444", "#06B6D4", "#D946EF",
]
