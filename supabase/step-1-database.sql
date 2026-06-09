-- Orchidea Allievi - Step 1 database condiviso sito/app
-- Esegui in Supabase > SQL Editor.
-- Versione corretta: l'admin viene letto dalla tabella public.profiles già esistente.
-- NON crea app_admins e NON duplica l'admin.

create extension if not exists pgcrypto;

-- =========================================================
-- 1) TESSERATI ESISTENTI: NON DUPLICHIAMO LE PERSONE
-- =========================================================

alter table public.tesseramenti
add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

alter table public.tesseramenti
add column if not exists is_corsista boolean default false;

alter table public.tesseramenti
add column if not exists stagione text default '2026/2027';

alter table public.tesseramenti
add column if not exists numero_tessera text;

alter table public.tesseramenti
add column if not exists tessera_attiva boolean default true;

-- Attenzione: se hai duplicati già presenti, questi indici possono dare errore.
-- In quel caso puliamo prima i duplicati e poi li rilanciamo.
create unique index if not exists tesseramenti_cf_unique
on public.tesseramenti (upper(trim(cf)))
where cf is not null and trim(cf) <> '';

create unique index if not exists tesseramenti_email_unique
on public.tesseramenti (lower(trim(email)))
where email is not null and trim(email) <> '';

-- =========================================================
-- 2) ADMIN APP: USA LA TABELLA PROFILES ESISTENTE
-- =========================================================
-- La tua tabella public.profiles contiene già:
-- user_id uuid, email text, display_name text, role text, is_active bool, membership_status text
-- Quindi consideriamo admin chi ha:
-- role = 'admin' e is_active = true

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.role = 'admin'
      and coalesce(p.is_active, false) = true
      and (
        p.user_id = auth.uid()
        or lower(trim(p.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
  );
$$;

-- =========================================================
-- 3) TABELLE APP ALLIEVI
-- =========================================================

create table if not exists public.corsi (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  livello text,
  giorno_settimana text,
  ora_inizio time,
  ora_fine time,
  sala text,
  prezzo_mensile numeric(10,2),
  attivo boolean default true,
  created_at timestamp with time zone default now()
);

create table if not exists public.iscrizioni_corsi (
  id uuid primary key default gen_random_uuid(),
  tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  corso_id uuid not null references public.corsi(id) on delete cascade,
  data_iscrizione date default current_date,
  stato text default 'attivo' check (stato in ('attivo', 'sospeso', 'terminato')),
  note text,
  created_at timestamp with time zone default now(),
  unique (tesseramento_id, corso_id)
);

create table if not exists public.pagamenti (
  id uuid primary key default gen_random_uuid(),
  tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  descrizione text not null,
  importo numeric(10,2) not null,
  periodo text,
  scadenza date,
  stato text default 'da_pagare' check (stato in ('da_pagare', 'in_attesa', 'pagato', 'annullato')),
  metodo text,
  pagato_il timestamp with time zone,
  sumup_checkout_id text,
  sumup_payment_url text,
  created_at timestamp with time zone default now()
);

create table if not exists public.video_corsi (
  id uuid primary key default gen_random_uuid(),
  corso_id uuid not null references public.corsi(id) on delete cascade,
  titolo text not null,
  descrizione text,
  video_url text,
  storage_path text,
  thumbnail_url text,
  pubblicato boolean default true,
  created_at timestamp with time zone default now(),
  constraint video_corsi_source_check check (
    (video_url is not null and trim(video_url) <> '')
    or
    (storage_path is not null and trim(storage_path) <> '')
  )
);

-- =========================================================
-- 4) COLLEGAMENTO ACCOUNT AUTH <-> TESSERATO
-- =========================================================
-- Non tocchiamo profiles: esiste già ed è già collegata agli admin/utenti del sito.
-- Qui colleghiamo solo auth.users al tesseramento esistente tramite email.

create or replace function public.link_auth_user_to_orchidea_tesseramento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tesseramenti
  set auth_user_id = new.id
  where auth_user_id is null
    and lower(trim(email)) = lower(trim(new.email));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_link_orchidea on auth.users;
drop trigger if exists on_auth_user_created_link_orchidea_tesseramento on auth.users;

create trigger on_auth_user_created_link_orchidea_tesseramento
after insert on auth.users
for each row
execute function public.link_auth_user_to_orchidea_tesseramento();

-- Collega anche eventuali account già esistenti.
update public.tesseramenti t
set auth_user_id = u.id
from auth.users u
where t.auth_user_id is null
  and lower(trim(t.email)) = lower(trim(u.email));

create or replace function public.get_my_tesseramento()
returns setof public.tesseramenti
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.tesseramenti t
  where t.auth_user_id = auth.uid()
     or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  limit 1;
$$;

-- =========================================================
-- 5) STORAGE PRIVATO PER VIDEO CORSI
-- =========================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-videos',
  'course-videos',
  false,
  1073741824,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- =========================================================
-- 6) ROW LEVEL SECURITY
-- =========================================================

alter table public.tesseramenti enable row level security;
alter table public.corsi enable row level security;
alter table public.iscrizioni_corsi enable row level security;
alter table public.pagamenti enable row level security;
alter table public.video_corsi enable row level security;

-- Drop policy safe, così puoi rilanciare lo script senza impazzire.
drop policy if exists "Admin gestisce tesseramenti" on public.tesseramenti;
drop policy if exists "Utente vede il proprio tesseramento" on public.tesseramenti;
drop policy if exists "Admin gestisce corsi" on public.corsi;
drop policy if exists "Utente vede corsi attivi" on public.corsi;
drop policy if exists "Admin gestisce iscrizioni" on public.iscrizioni_corsi;
drop policy if exists "Utente vede le proprie iscrizioni" on public.iscrizioni_corsi;
drop policy if exists "Admin gestisce pagamenti" on public.pagamenti;
drop policy if exists "Utente vede i propri pagamenti" on public.pagamenti;
drop policy if exists "Admin gestisce video" on public.video_corsi;
drop policy if exists "Utente vede video dei propri corsi" on public.video_corsi;

-- Compatibilità: se avevi già lanciato il primo script, rimuove solo la policy su app_admins se la tabella esiste.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'app_admins'
  ) then
    execute 'drop policy if exists "Admin vede admins" on public.app_admins';
  end if;
end $$;

create policy "Admin gestisce tesseramenti"
on public.tesseramenti
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Utente vede il proprio tesseramento"
on public.tesseramenti
for select
to authenticated
using (
  auth.uid() = auth_user_id
  or lower(trim(email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
);

create policy "Admin gestisce corsi"
on public.corsi
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Utente vede corsi attivi"
on public.corsi
for select
to authenticated
using (attivo = true);

create policy "Admin gestisce iscrizioni"
on public.iscrizioni_corsi
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Utente vede le proprie iscrizioni"
on public.iscrizioni_corsi
for select
to authenticated
using (
  exists (
    select 1
    from public.tesseramenti t
    where t.id = iscrizioni_corsi.tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
  )
);

create policy "Admin gestisce pagamenti"
on public.pagamenti
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Utente vede i propri pagamenti"
on public.pagamenti
for select
to authenticated
using (
  exists (
    select 1
    from public.tesseramenti t
    where t.id = pagamenti.tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
  )
);

create policy "Admin gestisce video"
on public.video_corsi
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Utente vede video dei propri corsi"
on public.video_corsi
for select
to authenticated
using (
  pubblicato = true
  and exists (
    select 1
    from public.iscrizioni_corsi ic
    join public.tesseramenti t on t.id = ic.tesseramento_id
    where ic.corso_id = video_corsi.corso_id
      and ic.stato = 'attivo'
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
  )
);

-- Storage policies
drop policy if exists "Admin gestisce storage video corsi" on storage.objects;
drop policy if exists "Allievo legge storage video propri corsi" on storage.objects;

create policy "Admin gestisce storage video corsi"
on storage.objects
for all
to authenticated
using (bucket_id = 'course-videos' and public.is_admin())
with check (bucket_id = 'course-videos' and public.is_admin());

create policy "Allievo legge storage video propri corsi"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'course-videos'
  and exists (
    select 1
    from public.video_corsi v
    join public.iscrizioni_corsi ic on ic.corso_id = v.corso_id
    join public.tesseramenti t on t.id = ic.tesseramento_id
    where v.storage_path = storage.objects.name
      and v.pubblicato = true
      and ic.stato = 'attivo'
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
  )
);

-- =========================================================
-- 7) NOTA ADMIN
-- =========================================================
-- Non inseriamo nessun admin qui.
-- L'accesso admin viene letto da public.profiles.
-- Per abilitare un admin deve esistere una riga in profiles con:
-- role = 'admin'
-- is_active = true
-- user_id = id utente Supabase Auth
