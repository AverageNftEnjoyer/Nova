import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

export type ThreadRecord = {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

export type MessageRecord = {
  id: string
  thread_id: string
  user_id: string
  role: "user" | "assistant" | "tool" | "system"
  content: string
  tool_name: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export async function createThread(client: SupabaseClient, userId: string, title = "New chat"): Promise<ThreadRecord> {
  const { data, error } = await client
    .from("threads")
    .insert({ user_id: userId, title })
    .select("*")
    .single()
  if (error || !data) throw new Error(error?.message || "Failed to create thread.")
  return data as ThreadRecord
}

export async function listThreads(client: SupabaseClient, userId: string): Promise<ThreadRecord[]> {
  const { data, error } = await client
    .from("threads")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
  if (error) throw new Error(error.message || "Failed to list threads.")
  return (data || []) as ThreadRecord[]
}

export async function appendMessage(
  client: SupabaseClient,
  input: {
    threadId: string
    userId: string
    role: MessageRecord["role"]
    content: string
    toolName?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<MessageRecord> {
  const { data, error } = await client
    .from("messages")
    .insert({
      thread_id: input.threadId,
      user_id: input.userId,
      role: input.role,
      content: input.content,
      tool_name: input.toolName ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single()
  if (error || !data) throw new Error(error?.message || "Failed to append message.")

  await client
    .from("threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", input.threadId)
    .eq("user_id", input.userId)

  return data as MessageRecord
}

export async function getThreadMessages(client: SupabaseClient, threadId: string, userId: string): Promise<MessageRecord[]> {
  const { data, error } = await client
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
  if (error) throw new Error(error.message || "Failed to load thread messages.")
  return (data || []) as MessageRecord[]
}

export async function upsertThreadSummary(
  client: SupabaseClient,
  input: { threadId: string; userId: string; summary: string },
): Promise<void> {
  const { error } = await client.from("thread_summaries").upsert(
    {
      thread_id: input.threadId,
      user_id: input.userId,
      summary: input.summary,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "thread_id" },
  )
  if (error) throw new Error(error.message || "Failed to upsert thread summary.")
}

export async function insertToolRun(
  client: SupabaseClient,
  input: {
    threadId: string
    userId: string
    toolName: string
    inPayload: Record<string, unknown>
    outPayload: Record<string, unknown>
    status: string
    latencyMs?: number | null
  },
): Promise<void> {
  const { error } = await client.from("tool_runs").insert({
    thread_id: input.threadId,
    user_id: input.userId,
    tool_name: input.toolName,
    input: input.inPayload,
    output: input.outPayload,
    status: input.status,
    latency_ms: input.latencyMs ?? null,
  })
  if (error) throw new Error(error.message || "Failed to insert tool run.")
}
