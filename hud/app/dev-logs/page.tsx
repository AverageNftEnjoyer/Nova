import type { Metadata } from "next"

import { DevLogsScreen } from "./components/dev-logs-screen"

export const metadata: Metadata = {
  title: "Dev logs - Nova",
  description: "Chat turn traces: routing, latency, tokens and quality.",
}

export default function DevLogsPage() {
  return <DevLogsScreen />
}
