import type { Metadata } from "next"
import { Suspense } from "react"

import { DeploymentListScreen } from "./components/deployment-list-screen"

export const metadata: Metadata = { title: "Deployments - Nova" }

export default function DeploymentsPage() {
  return (
    <Suspense>
      <DeploymentListScreen />
    </Suspense>
  )
}
