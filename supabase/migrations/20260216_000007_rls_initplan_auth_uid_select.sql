-- RLS performance lint fix:
-- Replace direct auth.uid() calls with (select auth.uid()) so Postgres can initplan once per statement.

-- threads
drop policy if exists threads_owner_select on public.threads;
drop policy if exists threads_owner_insert on public.threads;
drop policy if exists threads_owner_update on public.threads;
drop policy if exists threads_owner_delete on public.threads;

create policy threads_owner_select on public.threads
for select using (user_id = (select auth.uid()));

create policy threads_owner_insert on public.threads
for insert with check (user_id = (select auth.uid()));

create policy threads_owner_update on public.threads
for update using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy threads_owner_delete on public.threads
for delete using (user_id = (select auth.uid()));

-- messages
drop policy if exists messages_owner_select on public.messages;
drop policy if exists messages_owner_insert on public.messages;
drop policy if exists messages_owner_update on public.messages;
drop policy if exists messages_owner_delete on public.messages;

create policy messages_owner_select on public.messages
for select using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = messages.thread_id and t.user_id = (select auth.uid())
  )
);

create policy messages_owner_insert on public.messages
for insert with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = messages.thread_id and t.user_id = (select auth.uid())
  )
);

create policy messages_owner_update on public.messages
for update using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = messages.thread_id and t.user_id = (select auth.uid())
  )
) with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = messages.thread_id and t.user_id = (select auth.uid())
  )
);

create policy messages_owner_delete on public.messages
for delete using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = messages.thread_id and t.user_id = (select auth.uid())
  )
);

-- memories
drop policy if exists memories_owner_select on public.memories;
drop policy if exists memories_owner_insert on public.memories;
drop policy if exists memories_owner_update on public.memories;
drop policy if exists memories_owner_delete on public.memories;

create policy memories_owner_select on public.memories
for select using (user_id = (select auth.uid()));

create policy memories_owner_insert on public.memories
for insert with check (user_id = (select auth.uid()));

create policy memories_owner_update on public.memories
for update using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy memories_owner_delete on public.memories
for delete using (user_id = (select auth.uid()));

-- thread_summaries
drop policy if exists thread_summaries_owner_select on public.thread_summaries;
drop policy if exists thread_summaries_owner_insert on public.thread_summaries;
drop policy if exists thread_summaries_owner_update on public.thread_summaries;
drop policy if exists thread_summaries_owner_delete on public.thread_summaries;

create policy thread_summaries_owner_select on public.thread_summaries
for select using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = thread_summaries.thread_id and t.user_id = (select auth.uid())
  )
);

create policy thread_summaries_owner_insert on public.thread_summaries
for insert with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = thread_summaries.thread_id and t.user_id = (select auth.uid())
  )
);

create policy thread_summaries_owner_update on public.thread_summaries
for update using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = thread_summaries.thread_id and t.user_id = (select auth.uid())
  )
) with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = thread_summaries.thread_id and t.user_id = (select auth.uid())
  )
);

create policy thread_summaries_owner_delete on public.thread_summaries
for delete using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = thread_summaries.thread_id and t.user_id = (select auth.uid())
  )
);

-- tool_runs
drop policy if exists tool_runs_owner_select on public.tool_runs;
drop policy if exists tool_runs_owner_insert on public.tool_runs;
drop policy if exists tool_runs_owner_update on public.tool_runs;
drop policy if exists tool_runs_owner_delete on public.tool_runs;

create policy tool_runs_owner_select on public.tool_runs
for select using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = tool_runs.thread_id and t.user_id = (select auth.uid())
  )
);

create policy tool_runs_owner_insert on public.tool_runs
for insert with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = tool_runs.thread_id and t.user_id = (select auth.uid())
  )
);

create policy tool_runs_owner_update on public.tool_runs
for update using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = tool_runs.thread_id and t.user_id = (select auth.uid())
  )
) with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = tool_runs.thread_id and t.user_id = (select auth.uid())
  )
);

create policy tool_runs_owner_delete on public.tool_runs
for delete using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.threads t
    where t.id = tool_runs.thread_id and t.user_id = (select auth.uid())
  )
);

-- integration_configs
drop policy if exists integration_configs_owner_select on public.integration_configs;
drop policy if exists integration_configs_owner_insert on public.integration_configs;
drop policy if exists integration_configs_owner_update on public.integration_configs;
drop policy if exists integration_configs_owner_delete on public.integration_configs;

create policy integration_configs_owner_select on public.integration_configs
for select using (user_id = (select auth.uid()));

create policy integration_configs_owner_insert on public.integration_configs
for insert with check (user_id = (select auth.uid()));

create policy integration_configs_owner_update on public.integration_configs
for update using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy integration_configs_owner_delete on public.integration_configs
for delete using (user_id = (select auth.uid()));

