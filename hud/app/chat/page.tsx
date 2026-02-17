import { ChatShellController } from "./components/chat-shell-controller"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Chat - AI Assistant",
  description: "Chat with our AI assistant powered by Gemini",
}

export default function ChatPage() {
  return <ChatShellController />
}
