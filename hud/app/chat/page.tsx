import { Suspense } from "react"
import type { Metadata } from "next"
import { ChatShellController } from "./components/chat-shell-controller"

export const metadata: Metadata = {
  title: "Chat - Nova",
  description: "Chat with Nova and its tool-using agents.",
}

export default function ChatPage() {
  // useSearchParams (thread / new / prompt) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <ChatShellController />
    </Suspense>
  )
}
