import type { Metadata } from "next"

import { HomeMainScreenClient } from "./components/home-main-screen-client"

export const metadata: Metadata = { title: "Home - Nova" }

export default function HomePage() {
  return <HomeMainScreenClient />
}
