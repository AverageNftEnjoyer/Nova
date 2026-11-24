import type { Metadata } from "next"

import { HistoryScreen } from "./components/history-screen"

export const metadata: Metadata = {
  title: "History - Nova",
  description: "Every conversation and run, newest first.",
}

export default function HistoryPage() {
  return <HistoryScreen />
}
