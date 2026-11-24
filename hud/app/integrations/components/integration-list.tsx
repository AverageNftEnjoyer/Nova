"use client"

import { useMemo, useState } from "react"

import { Badge, EmptyState, SearchInput } from "@/components/ui"
import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import { cn } from "@/lib/shared/utils"
import { INTEGRATION_CATALOG, INTEGRATION_CATEGORIES, IntegrationIcon } from "../constants/catalog"
import { IntegrationStatusBadge, type IntegrationStatus } from "./SetupPanelHeader"

interface IntegrationListProps {
  activeSetup: IntegrationSetupKey
  onSelect: (setup: IntegrationSetupKey) => void
  statusOf: (setup: IntegrationSetupKey) => IntegrationStatus
  /** The model provider Nova uses for chat and agents. */
  activeLlm: IntegrationSetupKey
  /** False until the saved config has loaded (statuses are hidden until then). */
  hydrated: boolean
}

/** Every integration grouped by category, with search and each one's status. */
export function IntegrationList({ activeSetup, onSelect, statusOf, activeLlm, hydrated }: IntegrationListProps) {
  const [query, setQuery] = useState("")
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return INTEGRATION_CATEGORIES.map((category) => ({
      ...category,
      items: INTEGRATION_CATALOG.filter(
        (entry) =>
          entry.category === category.id &&
          (!needle || entry.label.toLowerCase().includes(needle) || entry.purpose.toLowerCase().includes(needle)),
      ),
    })).filter((group) => group.items.length > 0)
  }, [query])

  return (
    <nav aria-label="Integrations" className="flex min-w-0 flex-col gap-3">
      <SearchInput value={query} onValueChange={setQuery} placeholder="Search integrations" aria-label="Search integrations" />
      {groups.length === 0 ? (
        <EmptyState size="compact" title="No matches" description={`Nothing matches "${query.trim()}".`} />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`integrations-group-${group.id}`} className="flex flex-col gap-0.5">
              <h2 id={`integrations-group-${group.id}`} className="px-2 pb-1 text-xs font-medium text-muted">
                {group.label}
              </h2>
              <ul className="flex flex-col gap-px">
                {group.items.map((entry) => {
                  const selected = activeSetup === entry.key
                  return (
                    <li key={entry.key}>
                      <button
                        type="button"
                        onClick={() => onSelect(entry.key)}
                        aria-current={selected ? "page" : undefined}
                        className={cn(
                          "relative flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-fg transition-colors duration-150 ease-out hover:bg-hover",
                          selected && "bg-active",
                        )}
                      >
                        {selected ? <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" /> : null}
                        <span className="grid size-5 shrink-0 place-items-center" aria-hidden="true">
                          <IntegrationIcon setup={entry.key} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        {entry.key === activeLlm && hydrated ? <Badge tone="accent">Active</Badge> : null}
                        {hydrated ? <IntegrationStatusBadge status={statusOf(entry.key)} /> : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </nav>
  )
}
