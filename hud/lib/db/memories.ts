import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

export type MemoryRecord = {
  id: string
  user_id: string
  type: string
  content: string
  embedding: number[] | null
  confidence: number | null
  sources: unknown
  created_at: string
  last_seen: string
}

export async function upsertMemory(
  client: SupabaseClient,
  input: {
    userId: string
    type: string
    content: string
    embedding: number[]
    confidence?: number | null
    sources?: unknown
  },
): Promise<MemoryRecord> {
  const { data, error } = await client
    .from("memories")
    .insert({
      user_id: input.userId,
      type: input.type,
      content: input.content,
      embedding: input.embedding,
      confidence: input.confidence ?? null,
      sources: input.sources ?? [],
      last_seen: new Date().toISOString(),
    })
    .select("*")
    .single()
  if (error || !data) throw new Error(error?.message || "Failed to insert memory.")
  return data as MemoryRecord
}

export async function retrieveMemories(
  client: SupabaseClient,
  input: {
    userId: string
    queryEmbedding: number[]
    k?: number
  },
): Promise<MemoryRecord[]> {
  const limit = Math.max(1, Math.min(50, input.k ?? 10))
  const vector = `[${input.queryEmbedding.join(",")}]`
  const { data, error } = await client.rpc("match_memories", {
    query_user_id: input.userId,
    query_embedding: vector,
    match_count: limit,
  })

  if (error) throw new Error(error.message || "Failed to retrieve memories.")
  return ((data || []) as Array<MemoryRecord & { distance?: number }>).map(({ distance: _distance, ...row }) => row)
}
