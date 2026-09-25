-- Orchidea Allievi - Step 19
-- Push notifications PWA (Android + iPhone Home Screen)
-- Esegui una volta in Supabase > SQL Editor.

-- =========================================================
-- 1) DISPOSITIVI / SUBSCRIPTION PUSH
-- =========================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time bigint,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_student_idx
  on public.push_subscriptions(tesseramento_id, enabled);

create index if not exists push_subscriptions_enabled_idx
  on public.push_subscriptions(enabled) where enabled = true;

alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Ogni allievo può gestire solo i propri dispositivi.
drop policy if exists "Allievo vede proprie subscription push" on public.push_subscriptions;
create policy "Allievo vede proprie subscription push"
on public.push_subscriptions for select to authenticated
using (
  exists (
    select 1
    from public.tesseramenti t
    where t.id = push_subscriptions.tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
      )
  )
);

drop policy if exists "Allievo inserisce propria subscription push" on public.push_subscriptions;
create policy "Allievo inserisce propria subscription push"
on public.push_subscriptions for insert to authenticated
with check (
  exists (
    select 1
    from public.tesseramenti t
    where t.id = push_subscriptions.tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
      )
  )
);

drop policy if exists "Allievo aggiorna propria subscription push" on public.push_subscriptions;
create policy "Allievo aggiorna propria subscription push"
on public.push_subscriptions for update to authenticated
using (
  exists (
    select 1
    from public.tesseramenti t
    where t.id = push_subscriptions.tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
      )
  )
)
with check (
  exists (
    select 1
    from public.tesseramenti t
    where t.id = push_subscriptions.tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
      )
  )
);

drop policy if exists "Allievo elimina propria subscription push" on public.push_subscriptions;
create policy "Allievo elimina propria subscription push"
on public.push_subscriptions for delete to authenticated
using (
  exists (
    select 1
    from public.tesseramenti t
    where t.id = push_subscriptions.tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
      )
  )
);

-- Gli admin possono ispezionare lo stato dei dispositivi se serve dal gestionale.
drop policy if exists "Admin vede subscription push" on public.push_subscriptions;
create policy "Admin vede subscription push"
on public.push_subscriptions for select to authenticated
using (public.is_admin());

-- =========================================================
-- 2) STATO INVIO SULLE NOTIFICHE
-- =========================================================
alter table public.app_notifications add column if not exists push_sent_at timestamptz;
alter table public.app_notifications add column if not exists push_recipient_count integer not null default 0;
alter table public.app_notifications add column if not exists push_failure_count integer not null default 0;

-- =========================================================
-- 3) FUNZIONE DI SUPPORTO: CONTEGGIO DISPOSITIVI ATTIVI
-- =========================================================
create or replace function public.admin_push_device_count()
returns integer
language sql
security definer
set search_path = public
as $$
  select case
    when public.is_admin() then (select count(*)::integer from public.push_subscriptions where enabled = true)
    else 0
  end;
$$;

grant execute on function public.admin_push_device_count() to authenticated;
