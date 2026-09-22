/**
 * Agent Tasks execute in the long-lived `src` runtime process.
 *
 * These compatibility exports keep the API routes independent from runtime startup:
 * `nova.js` starts the durable SQLite-backed scheduler, while HUD-only development
 * can still create and inspect queued tasks without pretending to execute them.
 */

export async function tickTaskRunner(_userId: string): Promise<void> {
  // Runtime-owned. Intentionally no execution inside Next.js.
}

export function ensureTaskRunnerStarted(_userId: string): void {
  // Runtime-owned. The scheduler polls the durable SQLite queue.
}

export function stopTaskRunner(): void {
  // Runtime-owned.
}
