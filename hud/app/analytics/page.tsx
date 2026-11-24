import type { Metadata } from "next"

import { AnalyticsScreen } from "./components/analytics-screen"

export const metadata: Metadata = {
  title: "Analytics - Nova",
  description: "LLM spend, tokens, caching and agent task budgets.",
}

export default function AnalyticsPage() {
  return <AnalyticsScreen />
}
