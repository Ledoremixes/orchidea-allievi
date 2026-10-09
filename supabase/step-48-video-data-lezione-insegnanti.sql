-- =========================================================
-- ORCHIDEA APP - STEP 48
-- VIDEO: DATA LEZIONE MANUALE + UPLOAD INSEGNANTI
-- Eseguire una volta PRIMA del deploy della nuova app.
-- =========================================================

-- 1) Separiamo la data reale della lezione dalla data tecnica di caricamento.
alter table public.video_corsi
  add column if not exists lesson_date date;

-- Per i video storici manteniamo come data lezione la vecchia data di caricamento.
update public.video_corsi
set lesson_date = (created_at at time zone 'Europe/Rome')::date
where lesson_date is null;

alter table public.video_corsi
  alter column lesson_date set default current_date;

alter table public.video_corsi
  alter column lesson_date set not null;

create index if not exists video_corsi_course_lesson_date_idx
  on public.video_corsi(corso_id, lesson_date desc, created_at desc);

-- Assicura i privilegi SQL; la vera autorizzazione resta nelle policy RLS.
grant select, insert on public.video_corsi to authenticated;

-- 2) L'insegnante può pubblicare un ripasso SOLTANTO per un corso
--    collegato al proprio profilo app.
drop policy if exists "Insegnante carica video dei propri corsi" on public.video_corsi;
create policy "Insegnante carica video dei propri corsi"
on public.video_corsi
for insert
to authenticated
with check (
  pubblicato = true
  and lesson_date is not null
  and exists (
    select 1
    from public.app_teacher_accounts a
    join public.app_teacher_profile_courses pc
      on pc.profile_id = a.profile_id
    where a.auth_user_id = auth.uid()
      and a.access_enabled = true
      and pc.corso_id = video_corsi.corso_id
  )
);

-- 3) Il file fisico nello Storage deve essere caricato nella cartella
--    <corso_id>/... e quel corso deve appartenere all'insegnante.
drop policy if exists "Insegnante carica storage video propri corsi" on storage.objects;
create policy "Insegnante carica storage video propri corsi"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'course-videos'
  and exists (
    select 1
    from public.app_teacher_accounts a
    join public.app_teacher_profile_courses pc
      on pc.profile_id = a.profile_id
    where a.auth_user_id = auth.uid()
      and a.access_enabled = true
      and split_part(storage.objects.name, '/', 1) = pc.corso_id::text
  )
);

-- 4) Manteniamo esplicitamente la lettura dei video per i corsi insegnati.
drop policy if exists "Insegnante vede video dei propri corsi" on public.video_corsi;
create policy "Insegnante vede video dei propri corsi"
on public.video_corsi
for select
to authenticated
using (
  pubblicato = true
  and exists (
    select 1
    from public.app_teacher_accounts a
    join public.app_teacher_profile_courses pc
      on pc.profile_id = a.profile_id
    where a.auth_user_id = auth.uid()
      and a.access_enabled = true
      and pc.corso_id = video_corsi.corso_id
  )
);

notify pgrst, 'reload schema';
