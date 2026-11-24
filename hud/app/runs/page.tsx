import type { Metadata } from "next"
import { Suspense } from "react"

import { RunsScreen } from "./components/runs-screen"

export const metadata: Metadata = { title: "Runs - Nova" }

export default function RunsPage() {
  return (
    <Suspense>
      <RunsScreen />
    </Suspense>
  )
}
