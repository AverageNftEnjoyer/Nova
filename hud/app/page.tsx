import { redirect } from "next/navigation"

/** The app opens on Home. */
export default function RootPage() {
  redirect("/home")
}
