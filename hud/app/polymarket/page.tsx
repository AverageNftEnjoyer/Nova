import type { Metadata } from "next"
import { Suspense } from "react"

import { PolymarketScreen } from "./components/polymarket-screen"

export const metadata: Metadata = {
  title: "Polymarket - Nova",
  description: "Prediction markets, order books and wallet-signed trading.",
}

export default function PolymarketPage() {
  return (
    <Suspense fallback={null}>
      <PolymarketScreen />
    </Suspense>
  )
}
