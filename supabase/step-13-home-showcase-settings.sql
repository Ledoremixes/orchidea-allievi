-- Orchidea Allievi - Step 13
-- Impostazioni pubbliche app: scelta locandine da mostrare nel carosello Home.
-- Esegui in Supabase > SQL Editor una sola volta.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  updated_at timestamp with time zone default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "Utenti leggono impostazioni app" on public.app_settings;
drop policy if exists "Admin gestisce impostazioni app" on public.app_settings;

create policy "Utenti leggono impostazioni app"
on public.app_settings
for select
to authenticated
using (true);

create policy "Admin gestisce impostazioni app"
on public.app_settings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into public.app_settings (key, value, updated_at)
values ('home_course_showcase_ids', '[]'::jsonb, now())
on conflict (key) do nothing;
