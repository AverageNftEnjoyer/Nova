create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'New chat',
  pinned boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content text not null default '',
  tool_name text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  content text not null,
  embedding extensions.vector(1536),
  confidence numeric(5,4),
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists public.thread_summaries (
  thread_id uuid primary key references public.threads(id) on delete cascade,
  user_id uuid not null,
  summary text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.tool_runs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null,
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  status text not null default 'success',
  latency_ms int,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_thread_created_at
  on public.messages(thread_id, created_at);

create index if not exists idx_threads_user_updated_desc
  on public.threads(user_id, updated_at desc);

create index if not exists idx_memories_user_last_seen
  on public.memories(user_id, last_seen desc);

create index if not exists idx_memories_embedding_cosine
  on public.memories using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);

create or replace function public.match_memories(
  query_user_id uuid,
  query_embedding extensions.vector(1536),
  match_count int default 10
)
returns table (
  id uuid,
  user_id uuid,
  type text,
  content text,
  embedding extensions.vector(1536),
  confidence numeric,
  sources jsonb,
  created_at timestamptz,
  last_seen timestamptz,
  distance float
)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select
    m.id,
    m.user_id,
    m.type,
    m.content,
    m.embedding,
    m.confidence,
    m.sources,
    m.created_at,
    m.last_seen,
    (m.embedding <=> query_embedding) as distance
  from public.memories m
  where m.user_id = query_user_id
  order by m.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.thread_summaries enable row level security;
alter table public.tool_runs enable row level security;

drop policy if exists threads_owner_select on public.threads;
drop policy if exists threads_owner_insert on public.threads;
drop policy if exists threads_owner_update on public.threads;
drop policy if exists threads_owner_delete on public.threads;

create policy threads_owner_select on public.threads
for select using (user_id = auth.uid());
create policy threads_owner_insert on public.threads
for insert with check (user_id = auth.uid());
create policy threads_owner_update on public.threads
for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy threads_owner_delete on public.threads
for delete using (user_id = auth.uid());

drop policy if exists messages_owner_select on public.messages;
drop policy if exists messages_owner_insert on public.messages;
drop policy if exists messages_owner_update on public.messages;
drop policy if exists messages_owner_delete on public.messages;

create policy messages_owner_select on public.messages
for select using (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = messages.thread_id and t.user_id = auth.uid()
  )
);

create policy messages_owner_insert on public.messages
for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = messages.thread_id and t.user_id = auth.uid()
  )
);

create policy messages_owner_update on public.messages
for update using (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = messages.thread_id and t.user_id = auth.uid()
  )
) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = messages.thread_id and t.user_id = auth.uid()
  )
);

create policy messages_owner_delete on public.messages
for delete using (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = messages.thread_id and t.user_id = auth.uid()
  )
);

drop policy if exists memories_owner_select on public.memories;
drop policy if exists memories_owner_insert on public.memories;
drop policy if exists memories_owner_update on public.memories;
drop policy if exists memories_owner_delete on public.memories;

create policy memories_owner_select on public.memories
for select using (user_id = auth.uid());
create policy memories_owner_insert on public.memories
for insert with check (user_id = auth.uid());
create policy memories_owner_update on public.memories
for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy memories_owner_delete on public.memories
for delete using (user_id = auth.uid());

drop policy if exists thread_summaries_owner_select on public.thread_summaries;
drop policy if exists thread_summaries_owner_insert on public.thread_summaries;
drop policy if exists thread_summaries_owner_update on public.thread_summaries;
drop policy if exists thread_summaries_owner_delete on public.thread_summaries;

create policy thread_summaries_owner_select on public.thread_summaries
for select using (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = thread_summaries.thread_id and t.user_id = auth.uid()
  )
);
create policy thread_summaries_owner_insert on public.thread_summaries
for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = thread_summaries.thread_id and t.user_id = auth.uid()
  )
);
create policy thread_summaries_owner_update on public.thread_summaries
for update using (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = thread_summaries.thread_id and t.user_id = auth.uid()
  )
) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = thread_summaries.thread_id and t.user_id = auth.uid()
  )
);
create policy thread_summaries_owner_delete on public.thread_summaries
for delete using (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = thread_summaries.thread_id and t.user_id = auth.uid()
  )
);

drop policy if exists tool_runs_owner_select on public.tool_runs;
drop policy if exists tool_runs_owner_insert on public.tool_runs;
drop policy if exists tool_runs_owner_update on public.tool_runs;
drop policy if exists tool_runs_owner_delete on public.tool_runs;

create policy tool_runs_owner_select on public.tool_runs
for select using (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = tool_runs.thread_id and t.user_id = auth.uid()
  )
);
create policy tool_runs_owner_insert on public.tool_runs
for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = tool_runs.thread_id and t.user_id = auth.uid()
  )
);
create policy tool_runs_owner_update on public.tool_runs
for update using (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = tool_runs.thread_id and t.user_id = auth.uid()
  )
) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = tool_runs.thread_id and t.user_id = auth.uid()
  )
);
create policy tool_runs_owner_delete on public.tool_runs
for delete using (
  user_id = auth.uid()
  and exists (
    select 1 from public.threads t
    where t.id = tool_runs.thread_id and t.user_id = auth.uid()
  )
);

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('artifacts', 'artifacts', false)
on conflict (id) do nothing;

drop policy if exists attachments_owner_select on storage.objects;
drop policy if exists attachments_owner_insert on storage.objects;
drop policy if exists attachments_owner_update on storage.objects;
drop policy if exists attachments_owner_delete on storage.objects;

create policy attachments_owner_select on storage.objects
for select using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy attachments_owner_insert on storage.objects
for insert with check (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy attachments_owner_update on storage.objects
for update using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
) with check (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy attachments_owner_delete on storage.objects
for delete using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists artifacts_owner_select on storage.objects;
drop policy if exists artifacts_owner_insert on storage.objects;
drop policy if exists artifacts_owner_update on storage.objects;
drop policy if exists artifacts_owner_delete on storage.objects;

create policy artifacts_owner_select on storage.objects
for select using (
  bucket_id = 'artifacts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy artifacts_owner_insert on storage.objects
for insert with check (
  bucket_id = 'artifacts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy artifacts_owner_update on storage.objects
for update using (
  bucket_id = 'artifacts'
  and (storage.foldername(name))[1] = auth.uid()::text
) with check (
  bucket_id = 'artifacts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy artifacts_owner_delete on storage.objects
for delete using (
  bucket_id = 'artifacts'
  and (storage.foldername(name))[1] = auth.uid()::text
);
