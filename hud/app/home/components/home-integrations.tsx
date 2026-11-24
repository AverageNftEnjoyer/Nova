"use client"

import Link from "next/link"
import { Plug } from "lucide-react"

import { Button, EmptyState, Panel, SkeletonRows, StatusDot } from "@/components/ui"
import { buildIntegrationsHref } from "@/lib/integrations/navigation"
import type { HomeConnectionsState } from "../hooks/use-home-connections"

interface HomeIntegrationsProps {
  state: HomeConnectionsState
}

/** Connected integrations with their health, and how many are not connected yet. */
export function HomeIntegrations({ state }: HomeIntegrationsProps) {
  const { connections, loading, error, refresh } = state
  const connected = connections.filter((item) => item.connected)
  const notConnected = connections.length - connected.length
  // Problems first so they are never below the fold of the list.
  const ordered = [...connected].sort((a, b) => Number(Boolean(b.problem)) - Number(Boolean(a.problem)))

  return (
    <Panel
      title="Integrations"
      icon={<Plug />}
      flush
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link href="/integrations">Manage</Link>
        </Button>
      }
      footer={
        notConnected > 0 ? (
          <Link href="/integrations" className="text-muted hover:text-fg hover:underline">
            {notConnected} not connected
          </Link>
        ) : (
          <span>Everything is connected.</span>
        )
      }
    >
      {error && connected.length === 0 ? (
        <EmptyState
          size="compact"
          tone="danger"
          title="Could not load integrations"
          description={error}
          action={
            <Button size="sm" variant="outline" onClick={refresh}>
              Retry
            </Button>
          }
        />
      ) : loading && connected.length === 0 ? (
        <SkeletonRows rows={2} className="px-1 py-1" />
      ) : connected.length === 0 ? (
        <EmptyState
          size="compact"
          title="Nothing connected"
          description="Connect a model provider first so Nova can answer, then add the services it should use."
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href="/integrations">Connect an integration</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {ordered.map((item) => (
            <li key={item.key}>
              <Link
                href={buildIntegrationsHref(item.key)}
                className="flex items-center gap-2.5 px-4 py-2 text-sm transition-colors hover:bg-hover"
              >
                <StatusDot tone={item.problem ? "danger" : "success"} label={item.problem ? "Needs attention" : "Connected"} />
                <span className="min-w-0 flex-1 truncate text-fg">{item.label}</span>
                {item.problem ? (
                  <span className="max-w-[60%] truncate text-xs text-danger" title={item.problem}>
                    {item.problem}
                  </span>
                ) : (
                  <span className="text-xs text-faint">Connected</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
