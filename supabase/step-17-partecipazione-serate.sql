-- STEP 17 - Partecipazione alle serate ("Ci sarò")
-- Esegui questo file in Supabase > SQL Editor dopo gli step precedenti.
-- Ogni allievo può gestire solo il proprio voto.
-- La funzione di lettura mostra soltanto se stesso e i compagni con almeno un corso attivo in comune.

begin;

create extension if not exists pgcrypto;

create table if not exists public.event_partecipazioni (
  id uuid primary key default gen_random_uuid(),
  event_source text not null check (event_source in ('events', 'posters')),
  event_source_id text not null,
  tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  unique (event_source, event_source_id, tesseramento_id)
);

create index if not exists event_partecipazioni_event_idx
  on public.event_partecipazioni (event_source, event_source_id);

create index if not exists event_partecipazioni_tesseramento_idx
  on public.event_partecipazioni (tesseramento_id);

alter table public.event_partecipazioni enable row level security;

grant select, insert, delete on table public.event_partecipazioni to authenticated;

drop policy if exists "Allievo vede la propria partecipazione" on public.event_partecipazioni;
drop policy if exists "Allievo inserisce la propria partecipazione" on public.event_partecipazioni;
drop policy if exists "Allievo elimina la propria partecipazione" on public.event_partecipazioni;

create policy "Allievo vede la propria partecipazione"
on public.event_partecipazioni
for select
to authenticated
using (
  exists (
    select 1
    from public.tesseramenti t
    where t.id = event_partecipazioni.tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
  )
);

create policy "Allievo inserisce la propria partecipazione"
on public.event_partecipazioni
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tesseramenti t
    where t.id = event_partecipazioni.tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
  )
);

create policy "Allievo elimina la propria partecipazione"
on public.event_partecipazioni
for delete
to authenticated
using (
  exists (
    select 1
    from public.tesseramenti t
    where t.id = event_partecipazioni.tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
  )
);

-- Restituisce le partecipazioni che l'utente può conoscere:
-- - la propria;
-- - quelle degli allievi con cui condivide almeno un corso attivo;
-- - per un admin, tutte.
create or replace function public.get_visible_event_partecipazioni()
returns table (
  event_source text,
  event_source_id text,
  tesseramento_id uuid,
  nome text,
  cognome text,
  is_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with current_student as (
    select t.id
    from public.tesseramenti t
    where t.auth_user_id = auth.uid()
       or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
    order by case when t.auth_user_id = auth.uid() then 0 else 1 end
    limit 1
  )
  select
    ep.event_source,
    ep.event_source_id,
    ep.tesseramento_id,
    coalesce(t.nome, '') as nome,
    coalesce(t.cognome, '') as cognome,
    (ep.tesseramento_id = cs.id) as is_me
  from public.event_partecipazioni ep
  join public.tesseramenti t on t.id = ep.tesseramento_id
  left join current_student cs on true
  where
    public.is_admin()
    or ep.tesseramento_id = cs.id
    or exists (
      select 1
      from public.iscrizioni_corsi mine
      join public.iscrizioni_corsi companion
        on companion.corso_id = mine.corso_id
       and companion.tesseramento_id = ep.tesseramento_id
       and companion.stato = 'attivo'
      where mine.tesseramento_id = cs.id
        and mine.stato = 'attivo'
    )
  order by is_me desc, lower(coalesce(t.nome, '')), lower(coalesce(t.cognome, ''));
$$;

grant execute on function public.get_visible_event_partecipazioni() to authenticated;

commit;
