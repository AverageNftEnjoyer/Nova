-- Covers FK lookups for tool_runs.thread_id and improves thread-scoped scans.
create index if not exists idx_tool_runs_thread_created_at
  on public.tool_runs(thread_id, created_at desc);

