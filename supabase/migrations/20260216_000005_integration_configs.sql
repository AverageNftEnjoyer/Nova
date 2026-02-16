create table if not exists public.integration_configs (
  user_id uuid primary key,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.integration_configs enable row level security;

drop policy if exists integration_configs_owner_select on public.integration_configs;
drop policy if exists integration_configs_owner_insert on public.integration_configs;
drop policy if exists integration_configs_owner_update on public.integration_configs;
drop policy if exists integration_configs_owner_delete on public.integration_configs;

create policy integration_configs_owner_select on public.integration_configs
for select using (user_id = auth.uid());

create policy integration_configs_owner_insert on public.integration_configs
for insert with check (user_id = auth.uid());

create policy integration_configs_owner_update on public.integration_configs
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy integration_configs_owner_delete on public.integration_configs
for delete using (user_id = auth.uid());

create index if not exists idx_integration_configs_updated_at
  on public.integration_configs(updated_at desc);
