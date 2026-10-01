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
  foto_profilo_path text,
  likes_count bigint,
  liked_by_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select t.id
    from public.tesseramenti t
    where t.auth_user_id = auth.uid()
       or lower(trim(coalesce(t.email,''))) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
    order by (t.auth_user_id = auth.uid()) desc
    limit 1
  ), likes as (
    select l.liked_tesseramento_id, count(*)::bigint as likes_count
    from public.student_profile_likes l
    group by l.liked_tesseramento_id
  )
  select
    t.id,
    t.nome,
    t.cognome,
    t.bio_ballerino,
    coalesce(t.balli_preferiti, '{}'::text[]),
    t.foto_profilo_path,
    coalesce(lk.likes_count, 0),
    exists (
      select 1 from public.student_profile_likes mine
      where mine.liker_tesseramento_id = (select id from me)
        and mine.liked_tesseramento_id = t.id
    ) as liked_by_me
  from public.tesseramenti t
  left join likes lk on lk.liked_tesseramento_id = t.id
  where t.is_corsista = true
    and t.tessera_attiva is distinct from false
    and t.profilo_community_pubblico = true
    and (
      trim(coalesce(p_search,'')) = ''
      or concat_ws(' ', t.nome, t.cognome, t.bio_ballerino, array_to_string(t.balli_preferiti, ' ')) ilike '%' || trim(p_search) || '%'
    )
  order by coalesce(lk.likes_count,0) desc, t.cognome nulls last, t.nome nulls last
  limit 120;
$$;

revoke all on function public.get_community_profiles(text) from public;
grant execute on function public.get_community_profiles(text) to authenticated;

create or replace function public.toggle_my_student_like(p_target_tesseramento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
  v_exists boolean := false;
  v_count bigint := 0;
begin
  select t.id into v_me
  from public.tesseramenti t
  where t.auth_user_id = auth.uid()
     or lower(trim(coalesce(t.email,''))) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
  order by (t.auth_user_id = auth.uid()) desc
  limit 1;

  if v_me is null then return jsonb_build_object('ok', false, 'message', 'Solo gli allievi possono mettere Mi piace.'); end if;
  if p_target_tesseramento_id is null or p_target_tesseramento_id = v_me then
    return jsonb_build_object('ok', false, 'message', 'Non puoi mettere Mi piace al tuo profilo.');
  end if;

  if not exists (
    select 1 from public.tesseramenti t
    where t.id = p_target_tesseramento_id
      and t.is_corsista = true
      and t.tessera_attiva is distinct from false
      and t.profilo_community_pubblico = true
  ) then
    return jsonb_build_object('ok', false, 'message', 'Profilo non disponibile.');
  end if;

  select exists (
    select 1 from public.student_profile_likes l
    where l.liker_tesseramento_id = v_me
      and l.liked_tesseramento_id = p_target_tesseramento_id
  ) into v_exists;

  if v_exists then
    delete from public.student_profile_likes
    where liker_tesseramento_id = v_me and liked_tesseramento_id = p_target_tesseramento_id;
    v_exists := false;
  else
    insert into public.student_profile_likes(liker_tesseramento_id, liked_tesseramento_id)
    values (v_me, p_target_tesseramento_id)
    on conflict do nothing;
    v_exists := true;
  end if;

  select count(*) into v_count
  from public.student_profile_likes
  where liked_tesseramento_id = p_target_tesseramento_id;

  return jsonb_build_object('ok', true, 'liked', v_exists, 'likes_count', v_count);
end;
$$;

revoke all on function public.toggle_my_student_like(uuid) from public;
grant execute on function public.toggle_my_student_like(uuid) to authenticated;

-- =========================================================
-- 2) CLASSIFICHE GENERICHE
-- =========================================================
create table if not exists public.app_rankings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  scoring_mode text not null default 'likes' check (scoring_mode in ('likes','teacher_scores','manual_points')),
  course_id uuid references public.corsi(id) on delete set null,
  starts_on date not null default current_date,
  ends_on date not null,
  visible boolean not null default true,
  show_scores_to_students boolean not null default true,
  first_place_reward_points integer not null default 0 check (first_place_reward_points >= 0),
  second_place_reward_points integer not null default 0 check (second_place_reward_points >= 0),
  third_place_reward_points integer not null default 0 check (third_place_reward_points >= 0),
  awards_granted_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_rankings_dates_ok check (ends_on >= starts_on)
);

create index if not exists app_rankings_dates_idx on public.app_rankings(starts_on desc, ends_on desc);
create index if not exists app_rankings_course_idx on public.app_rankings(course_id);

create table if not exists public.ranking_teacher_votes (
  id uuid primary key default gen_random_uuid(),
  ranking_id uuid not null references public.app_rankings(id) on delete cascade,
  tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  teacher_account_id uuid not null references public.app_teacher_accounts(id) on delete cascade,
  tempo smallint not null check (tempo between 1 and 5),
  tecnica smallint not null check (tecnica between 1 and 5),
  figura_completa smallint not null check (figura_completa between 1 and 5),
  feeling smallint not null check (feeling between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ranking_id, tesseramento_id, teacher_account_id)
);

create index if not exists ranking_teacher_votes_rank_idx on public.ranking_teacher_votes(ranking_id, tesseramento_id);

create table if not exists public.ranking_manual_points (
  id uuid primary key default gen_random_uuid(),
  ranking_id uuid not null references public.app_rankings(id) on delete cascade,
  tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  points integer not null,
  reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists ranking_manual_points_rank_idx on public.ranking_manual_points(ranking_id, tesseramento_id);

alter table public.app_rankings enable row level security;
alter table public.ranking_teacher_votes enable row level security;
alter table public.ranking_manual_points enable row level security;

grant select, insert, update, delete on public.app_rankings to authenticated;
grant select, insert, update, delete on public.ranking_teacher_votes to authenticated;
grant select, insert, update, delete on public.ranking_manual_points to authenticated;

drop policy if exists "Admin gestisce classifiche" on public.app_rankings;
create policy "Admin gestisce classifiche"
on public.app_rankings for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Utenti vedono classifiche pubblicate" on public.app_rankings;
create policy "Utenti vedono classifiche pubblicate"
on public.app_rankings for select to authenticated
using (visible = true);

drop policy if exists "Admin gestisce voti insegnanti" on public.ranking_teacher_votes;
create policy "Admin gestisce voti insegnanti"
on public.ranking_teacher_votes for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin gestisce punti classifiche" on public.ranking_manual_points;
create policy "Admin gestisce punti classifiche"
on public.ranking_manual_points for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- =========================================================
-- 3) ELENCO CLASSIFICHE DISPONIBILI PER IL PROFILO CORRENTE
-- =========================================================
create or replace function public.get_app_rankings()
returns table (
  id uuid,
  title text,
  description text,
  scoring_mode text,
  course_id uuid,
  course_name text,
  starts_on date,
  ends_on date,
  visible boolean,
  show_scores_to_students boolean,
  first_place_reward_points integer,
  second_place_reward_points integer,
  third_place_reward_points integer,
  awards_granted_at timestamptz,
  status text,
  can_teacher_vote boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with my_teacher as (
    select a.id as teacher_account_id, a.profile_id
    from public.app_teacher_accounts a
    where a.auth_user_id = auth.uid() and a.access_enabled = true
    limit 1
  )
  select
    r.id,
    r.title,
    r.description,
    r.scoring_mode,
    r.course_id,
    c.nome as course_name,
    r.starts_on,
    r.ends_on,
    r.visible,
    r.show_scores_to_students,
    r.first_place_reward_points,
    r.second_place_reward_points,
    r.third_place_reward_points,
    r.awards_granted_at,
    case when current_date < r.starts_on then 'upcoming'
         when current_date > r.ends_on then 'ended'
         else 'active' end as status,
    case when r.scoring_mode = 'teacher_scores' and r.course_id is not null and exists (
      select 1
      from my_teacher mt
      join public.app_teacher_profile_courses pc on pc.profile_id = mt.profile_id
      where pc.corso_id = r.course_id
    ) then true else false end as can_teacher_vote
  from public.app_rankings r
  left join public.corsi c on c.id = r.course_id
  where r.visible = true
     or public.is_admin()
     or (
       r.scoring_mode = 'teacher_scores'
       and r.course_id is not null
       and exists (
         select 1
         from my_teacher mt
         join public.app_teacher_profile_courses pc on pc.profile_id = mt.profile_id
         where pc.corso_id = r.course_id
       )
     )
  order by
    case when current_date between r.starts_on and r.ends_on then 0 when current_date < r.starts_on then 1 else 2 end,
    r.starts_on desc,
    r.created_at desc;
$$;

revoke all on function public.get_app_rankings() from public;
grant execute on function public.get_app_rankings() to authenticated;

-- =========================================================
-- 4) LEADERBOARD CALCOLATA
-- =========================================================
create or replace function public.get_ranking_leaderboard(p_ranking_id uuid, p_limit integer default 100)
returns table (
  "position" integer,
  tesseramento_id uuid,
  nome text,
  cognome text,
  foto_profilo_path text,
  balli_preferiti text[],
  score numeric,
  votes_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ranking public.app_rankings%rowtype;
  v_can_teacher boolean := false;
  v_show_score boolean := false;
begin
  select * into v_ranking from public.app_rankings where id = p_ranking_id;
  if v_ranking.id is null then return; end if;

  if v_ranking.scoring_mode = 'teacher_scores' and v_ranking.course_id is not null then
    select exists (
      select 1
      from public.app_teacher_accounts a
      join public.app_teacher_profile_courses pc on pc.profile_id = a.profile_id
      where a.auth_user_id = auth.uid()
        and a.access_enabled = true
        and pc.corso_id = v_ranking.course_id
    ) into v_can_teacher;
  end if;

  if not v_ranking.visible and not public.is_admin() and not v_can_teacher then
    return;
  end if;

  v_show_score := v_ranking.show_scores_to_students or public.is_admin() or v_can_teacher;

  return query
  with participants as (
    select distinct t.id, t.nome, t.cognome, case when t.profilo_community_pubblico then t.foto_profilo_path else null end as foto_profilo_path, coalesce(t.balli_preferiti, '{}'::text[]) as balli_preferiti
    from public.tesseramenti t
    where t.is_corsista = true
      and t.tessera_attiva is distinct from false
      and (
        case
          when v_ranking.course_id is null then
            case when v_ranking.scoring_mode = 'likes' then t.profilo_community_pubblico = true else true end
          else exists (
            select 1 from public.iscrizioni_corsi ic
            where ic.tesseramento_id = t.id
              and ic.corso_id = v_ranking.course_id
              and lower(coalesce(ic.stato,'attivo')) not in ('annullato','cancellato','rimosso','inactive','non_attivo')
              and coalesce(ic.rinnovo_attivo, true) = true
          )
        end
      )
  ), raw_scores as (
    select
      p.id,
      p.nome,
      p.cognome,
      p.foto_profilo_path,
      p.balli_preferiti,
      case
        when v_ranking.scoring_mode = 'likes' then (
          select count(*)::numeric
          from public.student_profile_likes l
          where l.liked_tesseramento_id = p.id
            and l.created_at::date between v_ranking.starts_on and v_ranking.ends_on
        )
        when v_ranking.scoring_mode = 'teacher_scores' then coalesce((
          select round(avg((v.tempo + v.tecnica + v.figura_completa + v.feeling)::numeric / 4.0), 2)
          from public.ranking_teacher_votes v
          where v.ranking_id = v_ranking.id and v.tesseramento_id = p.id
        ), 0)
        else coalesce((
          select sum(mp.points)::numeric
          from public.ranking_manual_points mp
          where mp.ranking_id = v_ranking.id and mp.tesseramento_id = p.id
        ), 0)
      end as raw_score,
      case
        when v_ranking.scoring_mode = 'teacher_scores' then (
          select count(*)::integer from public.ranking_teacher_votes v
          where v.ranking_id = v_ranking.id and v.tesseramento_id = p.id
        )
        else 0
      end as vote_count
    from participants p
  ), ordered as (
    select rs.*, row_number() over (order by rs.raw_score desc, rs.cognome nulls last, rs.nome nulls last, rs.id)::integer as pos
    from raw_scores rs
  )
  select
    o.pos,
    o.id,
    o.nome,
    o.cognome,
    o.foto_profilo_path,
    o.balli_preferiti,
    case when v_show_score then o.raw_score else null end,
    o.vote_count
  from ordered o
  order by o.pos
  limit greatest(1, least(coalesce(p_limit,100), 250));
end;
$$;

revoke all on function public.get_ranking_leaderboard(uuid, integer) from public;
grant execute on function public.get_ranking_leaderboard(uuid, integer) to authenticated;

-- =========================================================
-- 5) VOTAZIONE PRIVATA INSEGNANTI (1-5)
-- =========================================================
create or replace function public.get_teacher_ranking_candidates(p_ranking_id uuid)
returns table (
  tesseramento_id uuid,
  nome text,
  cognome text,
  foto_profilo_path text,
  tempo integer,
  tecnica integer,
  figura_completa integer,
  feeling integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ranking public.app_rankings%rowtype;
  v_teacher_account_id uuid;
  v_profile_id uuid;
begin
  select * into v_ranking from public.app_rankings where id = p_ranking_id;
  if v_ranking.id is null or v_ranking.scoring_mode <> 'teacher_scores' or v_ranking.course_id is null then return; end if;

  select a.id, a.profile_id into v_teacher_account_id, v_profile_id
  from public.app_teacher_accounts a
  where a.auth_user_id = auth.uid() and a.access_enabled = true
  limit 1;

  if v_teacher_account_id is null or not exists (
    select 1 from public.app_teacher_profile_courses pc
    where pc.profile_id = v_profile_id and pc.corso_id = v_ranking.course_id
  ) then
    return;
  end if;

  return query
  select distinct
    t.id,
    t.nome,
    t.cognome,
    t.foto_profilo_path,
    v.tempo::integer,
    v.tecnica::integer,
    v.figura_completa::integer,
    v.feeling::integer,
    v.updated_at
  from public.iscrizioni_corsi ic
  join public.tesseramenti t on t.id = ic.tesseramento_id
  left join public.ranking_teacher_votes v
    on v.ranking_id = v_ranking.id
   and v.tesseramento_id = t.id
   and v.teacher_account_id = v_teacher_account_id
  where ic.corso_id = v_ranking.course_id
    and lower(coalesce(ic.stato,'attivo')) not in ('annullato','cancellato','rimosso','inactive','non_attivo')
    and coalesce(ic.rinnovo_attivo, true) = true
  order by t.cognome nulls last, t.nome nulls last;
end;
$$;

revoke all on function public.get_teacher_ranking_candidates(uuid) from public;
grant execute on function public.get_teacher_ranking_candidates(uuid) to authenticated;

create or replace function public.submit_teacher_ranking_vote(
  p_ranking_id uuid,
  p_tesseramento_id uuid,
  p_tempo integer,
  p_tecnica integer,
  p_figura_completa integer,
  p_feeling integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ranking public.app_rankings%rowtype;
  v_teacher_account_id uuid;
  v_profile_id uuid;
begin
  if p_tempo not between 1 and 5 or p_tecnica not between 1 and 5 or p_figura_completa not between 1 and 5 or p_feeling not between 1 and 5 then
    return jsonb_build_object('ok', false, 'message', 'Ogni parametro deve essere compreso tra 1 e 5.');
  end if;

  select * into v_ranking from public.app_rankings where id = p_ranking_id;
  if v_ranking.id is null or v_ranking.scoring_mode <> 'teacher_scores' or v_ranking.course_id is null then
    return jsonb_build_object('ok', false, 'message', 'Classifica non valida.');
  end if;
  if current_date < v_ranking.starts_on or current_date > v_ranking.ends_on then
    return jsonb_build_object('ok', false, 'message', 'La votazione non è aperta in questo momento.');
  end if;

  select a.id, a.profile_id into v_teacher_account_id, v_profile_id
  from public.app_teacher_accounts a
  where a.auth_user_id = auth.uid() and a.access_enabled = true
  limit 1;

  if v_teacher_account_id is null or not exists (
    select 1 from public.app_teacher_profile_courses pc
    where pc.profile_id = v_profile_id and pc.corso_id = v_ranking.course_id
  ) then
    return jsonb_build_object('ok', false, 'message', 'Non sei abilitato a votare questa classifica.');
  end if;

  if not exists (
    select 1 from public.iscrizioni_corsi ic
    where ic.corso_id = v_ranking.course_id
      and ic.tesseramento_id = p_tesseramento_id
      and lower(coalesce(ic.stato,'attivo')) not in ('annullato','cancellato','rimosso','inactive','non_attivo')
      and coalesce(ic.rinnovo_attivo, true) = true
  ) then
    return jsonb_build_object('ok', false, 'message', 'L’allievo non risulta iscritto a questo corso.');
  end if;

  insert into public.ranking_teacher_votes(
    ranking_id, tesseramento_id, teacher_account_id, tempo, tecnica, figura_completa, feeling, updated_at
  ) values (
    p_ranking_id, p_tesseramento_id, v_teacher_account_id, p_tempo, p_tecnica, p_figura_completa, p_feeling, now()
  )
  on conflict (ranking_id, tesseramento_id, teacher_account_id)
  do update set
    tempo = excluded.tempo,
    tecnica = excluded.tecnica,
    figura_completa = excluded.figura_completa,
    feeling = excluded.feeling,
    updated_at = now();

  return jsonb_build_object('ok', true, 'message', 'Valutazione salvata.');
end;
$$;

revoke all on function public.submit_teacher_ranking_vote(uuid, uuid, integer, integer, integer, integer) from public;
grant execute on function public.submit_teacher_ranking_vote(uuid, uuid, integer, integer, integer, integer) to authenticated;

-- =========================================================
-- 6) PUNTI MANUALI CLASSIFICA (ADMIN)
-- =========================================================
create or replace function public.admin_search_ranking_students(p_ranking_id uuid, p_search text default '')
returns table (
  tesseramento_id uuid,
  nome text,
  cognome text,
  foto_profilo_path text,
  current_points integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ranking public.app_rankings%rowtype;
begin
  if not public.is_admin() then raise exception 'Operazione riservata agli amministratori'; end if;
  select * into v_ranking from public.app_rankings where id = p_ranking_id;
  if v_ranking.id is null then return; end if;

  return query
  select
    t.id,
    t.nome,
    t.cognome,
    t.foto_profilo_path,
    coalesce((select sum(mp.points)::integer from public.ranking_manual_points mp where mp.ranking_id = v_ranking.id and mp.tesseramento_id = t.id), 0)
  from public.tesseramenti t
  where t.is_corsista = true
    and t.tessera_attiva is distinct from false
    and (v_ranking.course_id is null or exists (
      select 1 from public.iscrizioni_corsi ic
      where ic.tesseramento_id = t.id and ic.corso_id = v_ranking.course_id
        and lower(coalesce(ic.stato,'attivo')) not in ('annullato','cancellato','rimosso','inactive','non_attivo')
        and coalesce(ic.rinnovo_attivo, true) = true
    ))
    and (
      trim(coalesce(p_search,'')) = ''
      or concat_ws(' ', t.nome, t.cognome, t.numero_tessera) ilike '%' || trim(p_search) || '%'
    )
  order by t.cognome nulls last, t.nome nulls last
  limit 100;
end;
$$;

revoke all on function public.admin_search_ranking_students(uuid, text) from public;
grant execute on function public.admin_search_ranking_students(uuid, text) to authenticated;

create or replace function public.admin_add_ranking_points(
  p_ranking_id uuid,
  p_tesseramento_id uuid,
  p_points integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_total integer;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'message', 'Operazione non consentita.'); end if;
  if coalesce(p_points,0) = 0 then return jsonb_build_object('ok', false, 'message', 'Inserisci punti diversi da zero.'); end if;

  select scoring_mode into v_mode from public.app_rankings where id = p_ranking_id;
  if v_mode <> 'manual_points' then return jsonb_build_object('ok', false, 'message', 'Questa classifica non usa punti manuali.'); end if;

  insert into public.ranking_manual_points(ranking_id, tesseramento_id, points, reason)
  values (p_ranking_id, p_tesseramento_id, p_points, nullif(trim(coalesce(p_reason,'')),''));

  select coalesce(sum(points),0)::integer into v_total
  from public.ranking_manual_points
  where ranking_id = p_ranking_id and tesseramento_id = p_tesseramento_id;

  return jsonb_build_object('ok', true, 'current_points', v_total);
end;
$$;

revoke all on function public.admin_add_ranking_points(uuid, uuid, integer, text) from public;
grant execute on function public.admin_add_ranking_points(uuid, uuid, integer, text) to authenticated;

-- =========================================================
-- 7) PREMIAZIONE TOP 3 CON ORCHIDEA POINTS (ADMIN)
-- =========================================================
create or replace function public.admin_grant_ranking_rewards(p_ranking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ranking public.app_rankings%rowtype;
  v_row record;
  v_points integer;
  v_result jsonb;
  v_awarded integer := 0;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'message', 'Operazione non consentita.'); end if;

  select * into v_ranking from public.app_rankings where id = p_ranking_id for update;
  if v_ranking.id is null then return jsonb_build_object('ok', false, 'message', 'Classifica non trovata.'); end if;
  if v_ranking.awards_granted_at is not null then return jsonb_build_object('ok', false, 'message', 'I premi di questa classifica sono già stati assegnati.'); end if;
  if current_date <= v_ranking.ends_on then return jsonb_build_object('ok', false, 'message', 'Puoi assegnare i premi solo dopo la fine della classifica.'); end if;
  for v_row in
    select * from public.get_ranking_leaderboard(p_ranking_id, 3) order by "position"
  loop
    v_points := case v_row."position"
      when 1 then v_ranking.first_place_reward_points
      when 2 then v_ranking.second_place_reward_points
      when 3 then v_ranking.third_place_reward_points
      else 0 end;

    if coalesce(v_points,0) > 0 then
      execute 'select public.admin_adjust_reward_points($1,$2,$3)'
        into v_result
        using v_row.tesseramento_id, v_points, 'Premio classifica: ' || v_ranking.title || ' · ' || v_row."position" || '° posto';
      if coalesce((v_result ->> 'ok')::boolean, true) = false then
        raise exception 'Impossibile assegnare il premio al %° classificato: %', v_row."position", coalesce(v_result ->> 'message', 'errore sconosciuto');
      end if;
      v_awarded := v_awarded + 1;
    end if;
  end loop;

  update public.app_rankings set awards_granted_at = now(), updated_at = now() where id = p_ranking_id;
  return jsonb_build_object('ok', true, 'awarded', v_awarded, 'message', 'Premi classifica assegnati.');
end;
$$;

revoke all on function public.admin_grant_ranking_rewards(uuid) from public;
grant execute on function public.admin_grant_ranking_rewards(uuid) to authenticated;

-- =========================================================
-- 8) CLASSIFICA LIKE INIZIALE (GESTIBILE/NASCONDIBILE/ELIMINABILE)
-- =========================================================
insert into public.app_rankings(
  title, description, scoring_mode, starts_on, ends_on, visible, show_scores_to_students,
  first_place_reward_points, second_place_reward_points, third_place_reward_points
)
select
  'Più apprezzati in Orchidea',
  'La classifica Community basata sui Mi piace ricevuti dagli altri allievi.',
  'likes',
  current_date,
  case when extract(month from current_date) >= 7
       then make_date(extract(year from current_date)::integer + 1, 6, 30)
       else make_date(extract(year from current_date)::integer, 6, 30) end,
  true,
  true,
  0, 0, 0
where not exists (select 1 from public.app_rankings where scoring_mode = 'likes');
