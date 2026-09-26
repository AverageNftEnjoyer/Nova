import { Suspense } from "react"

import { DeploymentsScreen } from "../deployments/components/deployments-screen"

export default function Page() {
  return (
    <Suspense fallback={null}>
      <DeploymentsScreen />
    </Suspense>
  )
}
