import { NextResponse } from "next/server"

export const runtime = "nodejs"

// Local mode - no database
export async function GET() {
  return NextResponse.json({ ok: true, conversations: [] })
}

export async function POST() {
  const now = new Date().toISOString()
  return NextResponse.json({
    ok: true,
    conversation: {
      id: "local-" + Date.now(),
      title: "New Conversation", 
      messages: [],
      createdAt: now,
      updatedAt: now,
    },
  })
}
