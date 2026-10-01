-- Orchidea App - STEP 30
-- Community allievi + profilo ballerino + Like + classifiche generiche + voti insegnanti.
-- Esegui UNA VOLTA in Supabase > SQL Editor dopo gli step precedenti.

-- =========================================================
-- 1) PROFILO COMMUNITY ALLIEVO
-- =========================================================
alter table public.tesseramenti
  add column if not exists bio_ballerino text,
  add column if not exists balli_preferiti text[] not null default '{}'::text[],
  add column if not exists profilo_community_pubblico boolean not null default true;

create table if not exists public.student_profile_likes (
  id uuid primary key default gen_random_uuid(),
  liker_tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  liked_tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint student_profile_likes_no_self check (liker_tesseramento_id <> liked_tesseramento_id),
  constraint student_profile_likes_unique unique (liker_tesseramento_id, liked_tesseramento_id)
);

create index if not exists student_profile_likes_target_idx
  on public.student_profile_likes(liked_tesseramento_id, created_at desc);
create index if not exists student_profile_likes_liker_idx
  on public.student_profile_likes(liker_tesseramento_id, created_at desc);

alter table public.student_profile_likes enable row level security;
revoke all on public.student_profile_likes from anon;
grant select on public.student_profile_likes to authenticated;

-- Gli allievi lavorano tramite RPC; l'admin può comunque ispezionare/moderare.
drop policy if exists "Admin gestisce like profili" on public.student_profile_likes;
create policy "Admin gestisce like profili"
on public.student_profile_likes for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Le foto restano in bucket privato, ma gli utenti autenticati possono leggere
-- quelle che l'app espone nella Community. Upload/modifica/eliminazione restano personali.
drop policy if exists "Community legge foto profilo" on storage.objects;
create policy "Community legge foto profilo"
on storage.objects for select to authenticated
using (bucket_id = 'profile-photos');

create or replace function public.update_my_community_profile(
  p_bio text default null,
  p_balli text[] default '{}'::text[],
  p_pubblico boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_bio text := nullif(trim(coalesce(p_bio, '')), '');
  v_ball text;
  v_balli text[] := '{}'::text[];
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'Sessione non valida'; end if;
  if length(coalesce(v_bio, '')) > 1200 then raise exception 'La biografia può contenere al massimo 1200 caratteri'; end if;

  foreach v_ball in array coalesce(p_balli, '{}'::text[]) loop
    v_ball := trim(v_ball);
    if v_ball <> '' and length(v_ball) <= 40 and not (v_ball = any(v_balli)) then
      v_balli := array_append(v_balli, v_ball);
    end if;
    exit when cardinality(v_balli) >= 12;
  end loop;

  update public.tesseramenti t
  set bio_ballerino = v_bio,
      balli_preferiti = v_balli,
      profilo_community_pubblico = coalesce(p_pubblico, true),
      updated_at = now()
  where t.auth_user_id = v_uid
     or (v_email <> '' and lower(trim(coalesce(t.email, ''))) = v_email);

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.update_my_community_profile(text, text[], boolean) from public;
grant execute on function public.update_my_community_profile(text, text[], boolean) to authenticated;

create or replace function public.get_community_profiles(p_search text default '')
returns table (
  tesseramento_id uuid,
  nome text,
  cognome text,
  bio_ballerino text,
  balli_preferiti text[],