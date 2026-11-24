"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { AlertTriangle, Compass } from "lucide-react"

import { Button, EmptyState } from "@/components/ui"
import { PageContainer } from "@/components/shell/page-container"
import { openCommandPalette } from "@/components/shell/shell-events"

/** Shown for unknown routes, inside the shell. */
export function NotFoundState() {
  const pathname = usePathname()
  return (
    <PageContainer className="flex min-h-full items-center justify-center">
      <EmptyState
        icon={<Compass />}
        title="This page doesn't exist"
        description={
          <>
            Nothing lives at <span className="font-mono text-fg">{pathname || "this address"}</span>. Go back Home, or search
            for the page you wanted.
          </>
        }
        action={
          <>
            <Button asChild>
              <Link href="/home">Go to Home</Link>
            </Button>
            <Button variant="secondary" onClick={openCommandPalette}>
              Search pages
            </Button>
          </>
        }
      />
    </PageContainer>
  )
}

/** Shown when a page throws while rendering. The message is the real error so it can be reported. */
export function RouteErrorState({ error, onRetry }: { error: Error & { digest?: string }; onRetry: () => void }) {
  const message = String(error?.message || "").trim()
  return (
    <PageContainer className="flex min-h-full items-center justify-center">
      <EmptyState
        tone="danger"
        icon={<AlertTriangle />}
        title="This page stopped working"
        description={
          <>
            Try again to reload just this page; the rest of Nova keeps running.
            {message ? <span className="mt-2 block font-mono text-xs break-words text-muted">{message}</span> : null}
            {error?.digest ? <span className="mt-1 block text-xs text-faint">Reference {error.digest}</span> : null}
          </>
        }
        action={
          <>
            <Button onClick={onRetry}>Try again</Button>
            <Button asChild variant="secondary">
              <Link href="/home">Go to Home</Link>
            </Button>
          </>
        }
      />
    </PageContainer>
  )
}
