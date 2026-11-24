import type { Metadata } from "next"
import { Suspense } from "react"

import { NewDeploymentScreen } from "../components/new-deployment-screen"

export const metadata: Metadata = { title: "New deployment - Nova" }

export default function NewDeploymentPage() {
  return (
    <Suspense>
      <NewDeploymentScreen />
    </Suspense>
  )
}
