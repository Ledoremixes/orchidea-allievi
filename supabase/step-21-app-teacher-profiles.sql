-- Orchidea Allievi - Step 21
-- Profili insegnanti SOLO estetici per l'app Allievi.
-- Questa struttura e' separata da public.insegnanti / Nova e non modifica quote,
-- contratti o anagrafiche gestionali.

create table if not exists public.app_teacher_profiles (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cognome text not null default '',
  specialita text,
  bio text,
  instagram_url text,
  foto_url text,
  foto_path text,
  profilo_pubblico boolean not null default true,
  ordine integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_teacher_profile_courses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.app_teacher_profiles(id) on delete cascade,
  corso_id uuid not null references public.corsi(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, corso_id)
);

create index if not exists app_teacher_profiles_public_idx
  on public.app_teacher_profiles(profilo_pubblico, ordine, cognome, nome);
create index if not exists app_teacher_profile_courses_course_idx
  on public.app_teacher_profile_courses(corso_id);
create index if not exists app_teacher_profile_courses_profile_idx
  on public.app_teacher_profile_courses(profile_id);

alter table public.app_teacher_profiles enable row level security;
alter table public.app_teacher_profile_courses enable row level security;

grant select on public.app_teacher_profiles to authenticated;
grant insert, update, delete on public.app_teacher_profiles to authenticated;
grant select on public.app_teacher_profile_courses to authenticated;
grant insert, update, delete on public.app_teacher_profile_courses to authenticated;

drop policy if exists "Allievi vedono profili app insegnanti" on public.app_teacher_profiles;
create policy "Allievi vedono profili app insegnanti"
on public.app_teacher_profiles for select to authenticated
using (profilo_pubblico = true or public.is_admin());

drop policy if exists "Admin gestisce profili app insegnanti" on public.app_teacher_profiles;
create policy "Admin gestisce profili app insegnanti"
on public.app_teacher_profiles for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Allievi vedono corsi profili app insegnanti" on public.app_teacher_profile_courses;
create policy "Allievi vedono corsi profili app insegnanti"
on public.app_teacher_profile_courses for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.app_teacher_profiles p
    where p.id = app_teacher_profile_courses.profile_id
      and p.profilo_pubblico = true
  )
);

drop policy if exists "Admin gestisce corsi profili app insegnanti" on public.app_teacher_profile_courses;
create policy "Admin gestisce corsi profili app insegnanti"
on public.app_teacher_profile_courses for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Bucket pubblico: contiene soltanto fotografie profilo compresse in WebP.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'teacher-profiles',
  'teacher-profiles',
  true,
  3145728,
  array['image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Le immagini sono pubbliche in lettura tramite il bucket; scrittura solo admin.
drop policy if exists "Admin carica foto insegnanti app" on storage.objects;
create policy "Admin carica foto insegnanti app"
on storage.objects for insert to authenticated
with check (bucket_id = 'teacher-profiles' and public.is_admin());

drop policy if exists "Admin aggiorna foto insegnanti app" on storage.objects;
create policy "Admin aggiorna foto insegnanti app"
on storage.objects for update to authenticated
using (bucket_id = 'teacher-profiles' and public.is_admin())
with check (bucket_id = 'teacher-profiles' and public.is_admin());

drop policy if exists "Admin elimina foto insegnanti app" on storage.objects;
create policy "Admin elimina foto insegnanti app"
on storage.objects for delete to authenticated
using (bucket_id = 'teacher-profiles' and public.is_admin());
