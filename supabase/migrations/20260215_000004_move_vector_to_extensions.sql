create schema if not exists extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    begin
      alter extension vector set schema extensions;
    exception
      when others then
        null;
    end;
  end if;
end
$$;

do $$
begin
  begin
    alter function public.match_memories(uuid, extensions.vector(1536), int)
      set search_path = public, extensions, pg_temp;
  exception
    when undefined_function then
      null;
  end;
end
$$;
