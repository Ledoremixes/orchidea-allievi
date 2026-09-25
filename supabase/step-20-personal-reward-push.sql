-- Orchidea Allievi - Step 20
-- Notifiche push personali per Rewards: punti regalati e premi omaggio.
-- Esegui una volta in Supabase > SQL Editor.

-- =========================================================
-- 1) DESTINATARIO PERSONALE SULLE NOTIFICHE
-- =========================================================
alter table public.app_notifications
  add column if not exists target_tesseramento_id uuid
  references public.tesseramenti(id) on delete cascade;

create index if not exists app_notifications_target_student_idx
  on public.app_notifications(target_tesseramento_id, starts_at desc);

-- Estendiamo i destinatari ammessi con "student".
alter table public.app_notifications
  drop constraint if exists app_notifications_audience_check;

alter table public.app_notifications
  add constraint app_notifications_audience_check
  check (audience in ('all','corsisti','course','student'));

-- =========================================================
-- 2) RLS: UNA NOTIFICA PERSONALE È VISIBILE SOLO AL DESTINATARIO
-- =========================================================
drop policy if exists "Allievi leggono notifiche pertinenti" on public.app_notifications;

create policy "Allievi leggono notifiche pertinenti"
on public.app_notifications for select to authenticated
using (
  starts_at <= now()
  and (expires_at is null or expires_at >= now())
  and (
    audience = 'all'
    or (
      audience = 'corsisti'
      and exists (
        select 1
        from public.tesseramenti t
        where (t.auth_user_id = auth.uid()
          or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email',''))))
          and t.is_corsista = true
      )
    )
    or (
      audience = 'course'
      and course_id is not null
      and exists (
        select 1
        from public.iscrizioni_corsi ic
        join public.tesseramenti t on t.id = ic.tesseramento_id
        where ic.corso_id = app_notifications.course_id
          and ic.stato = 'attivo'
          and (t.auth_user_id = auth.uid()
            or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email',''))))
      )
    )
    or (
      audience = 'student'
      and target_tesseramento_id is not null
      and exists (
        select 1
        from public.tesseramenti t
        where t.id = app_notifications.target_tesseramento_id
          and (t.auth_user_id = auth.uid()
            or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email',''))))
      )
    )
  )
);
