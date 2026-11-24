import { Suspense } from "react"

import { DeploymentsScreen } from "./components/deployments-screen"

export default function DeploymentsPage() {
  return (
    <Suspense fallback={null}>
      <DeploymentsScreen />
    </Suspense>
  )
}
