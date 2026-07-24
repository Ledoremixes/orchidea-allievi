-- STEP 16 - Lettura eventi e serate nell'app Orchidea Allievi
-- Le tabelle events e posters alimentano già il sito pubblico.
-- Questo script garantisce la lettura anche agli utenti autenticati dell'app.

begin;

grant select on table public.events to anon, authenticated;
grant select on table public.posters to anon, authenticated;

alter table public.events enable row level security;
alter table public.posters enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'events'
      and policyname = 'events_visibili_nel_portale_allievi'
  ) then
    create policy events_visibili_nel_portale_allievi
      on public.events
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'posters'
      and policyname = 'posters_visibili_nel_portale_allievi'
  ) then
    create policy posters_visibili_nel_portale_allievi
      on public.posters
      for select
      to anon, authenticated
      using (true);
  end if;
end
$$;

commit;
