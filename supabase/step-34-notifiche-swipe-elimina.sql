-- =========================================================
-- STEP 34 · Eliminazione personale notifiche
-- Swipe singolo + "Elimina tutte"
-- Non elimina mai app_notifications globali: memorizza solo ciò che
-- il singolo allievo / insegnante ha scelto di nascondere.
-- =========================================================

create table if not exists public.app_notification_dismissals (
  id uuid primary key default gen_random_uuid(),
  tesseramento_id uuid references public.tesseramenti(id) on delete cascade,
  teacher_account_id uuid references public.app_teacher_accounts(id) on delete cascade,
  notification_key text not null,
  dismissed_at timestamptz not null default now(),
  constraint app_notification_dismissals_owner_check
    check (num_nonnulls(tesseramento_id, teacher_account_id) = 1)
);

create unique index if not exists app_notification_dismissals_student_unique
  on public.app_notification_dismissals(tesseramento_id, notification_key);

create unique index if not exists app_notification_dismissals_teacher_unique
  on public.app_notification_dismissals(teacher_account_id, notification_key);

create index if not exists app_notification_dismissals_student_idx
  on public.app_notification_dismissals(tesseramento_id, dismissed_at desc);

create index if not exists app_notification_dismissals_teacher_idx
  on public.app_notification_dismissals(teacher_account_id, dismissed_at desc);

alter table public.app_notification_dismissals enable row level security;

grant select, insert, update, delete
on public.app_notification_dismissals
to authenticated;

-- Allievo: può leggere/scrivere esclusivamente le proprie eliminazioni.
drop policy if exists "Allievo gestisce notifiche eliminate" on public.app_notification_dismissals;
create policy "Allievo gestisce notifiche eliminate"
on public.app_notification_dismissals
for all
to authenticated
using (
  teacher_account_id is null
  and exists (
    select 1
    from public.tesseramenti t
    where t.id = app_notification_dismissals.tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
  )
)
with check (
  teacher_account_id is null
  and exists (
    select 1
    from public.tesseramenti t
    where t.id = app_notification_dismissals.tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
  )
);

-- Insegnante: può leggere/scrivere esclusivamente le proprie eliminazioni.
drop policy if exists "Insegnante gestisce notifiche eliminate" on public.app_notification_dismissals;
create policy "Insegnante gestisce notifiche eliminate"
on public.app_notification_dismissals
for all
to authenticated
using (
  tesseramento_id is null
  and exists (
    select 1
    from public.app_teacher_accounts a
    where a.id = app_notification_dismissals.teacher_account_id
      and a.auth_user_id = auth.uid()
      and a.access_enabled = true
  )
)
with check (
  tesseramento_id is null
  and exists (
    select 1
    from public.app_teacher_accounts a
    where a.id = app_notification_dismissals.teacher_account_id
      and a.auth_user_id = auth.uid()
      and a.access_enabled = true
  )
);
