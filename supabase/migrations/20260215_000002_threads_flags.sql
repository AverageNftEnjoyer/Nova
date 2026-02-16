alter table public.threads
  add column if not exists pinned boolean not null default false;

alter table public.threads
  add column if not exists archived boolean not null default false;
