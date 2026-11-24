"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import "./globals.css"

/**
 * Last-resort boundary for when the root layout itself fails: no providers, shell or theme script are available,
 * so it renders its own <html> on the dark tokens.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Nova] App failed to start", error)
  }, [error])

  return (
    <html lang="en" className="dark">
      <body className="bg-canvas font-sans text-fg antialiased">
        <main className="flex min-h-dvh items-center justify-center p-6">
          <div className="flex w-full max-w-[28rem] flex-col gap-4 rounded-xl border border-border bg-surface p-6">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-xl font-semibold tracking-[-0.015em]">Nova couldn&apos;t load this window</h1>
              <p className="text-sm text-muted">
                Something failed while loading the app frame. Try again, or reload Nova. Your chats, settings and keys are
                stored on this computer and are not affected.
              </p>
            </div>
            {error.digest ? (
              <p className="text-xs text-faint">
                Error reference <span className="font-mono text-muted">{error.digest}</span>
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button onClick={reset}>Try again</Button>
              <Button variant="secondary" onClick={() => window.location.assign("/home")}>
                Reload Nova
              </Button>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
