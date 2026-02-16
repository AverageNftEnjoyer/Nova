alter function public.match_memories(uuid, extensions.vector(1536), int)
  set search_path = public, extensions, pg_temp;
