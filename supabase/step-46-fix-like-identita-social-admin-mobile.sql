-- =========================================================
-- ORCHIDEA APP - STEP 46
-- Fix identita social (like/follow tra tesseramenti duplicati)
-- + conteggi coerenti Community / Profilo / Classifica Like.
-- Eseguire DOPO STEP 44/45.
-- =========================================================

-- 1) Risolve un tesseramento nella sua identita social canonica.
--    Priorita: stesso auth_user_id oppure stesso codice fiscale.
--    Questo evita di usare l'email come chiave persona (puo essere condivisa).
create or replace function public.social_canonical_tesseramento_id(p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      t.id,
      t.auth_user_id,
      upper(trim(coalesce(t.cf, ''))) as cf_norm
    from public.tesseramenti t
    where t.id = p_id
  ), candidates as (
    select t.*
    from public.tesseramenti t
    cross join base b
    where t.id = b.id
       or (b.auth_user_id is not null and t.auth_user_id = b.auth_user_id)
       or (b.cf_norm <> '' and upper(trim(coalesce(t.cf, ''))) = b.cf_norm)
  )
  select coalesce((
    select c.id
    from candidates c
    order by
      (c.auth_user_id is not null) desc,
      (exists (
        select 1
        from public.app_teacher_profiles tp
        join public.app_teacher_accounts ta on ta.profile_id = tp.id
        where tp.tesseramento_id = c.id
          and ta.access_enabled = true
      )) desc,
      (c.tessera_attiva is distinct from false) desc,
      c.created_at desc nulls last,
      c.id desc
    limit 1
  ), p_id);
$$;

grant execute on function public.social_canonical_tesseramento_id(uuid) to authenticated;

-- 2) Ricerca Community: una sola scheda per persona e conteggi aggregati
--    su tutti gli eventuali tesseramenti storici della stessa persona.
drop function if exists public.get_community_profiles(text);

create function public.get_community_profiles(p_search text default '')
returns table (
  tesseramento_id uuid,
  nome text,
  cognome text,
  bio_ballerino text,
  balli_preferiti text[],
  foto_profilo_path text,
  likes_count bigint,
  liked_by_me boolean,
  followers_count bigint,
  following_count bigint,
  followed_by_me boolean,
  follows_me boolean,
  is_teacher boolean,
  teacher_profile_id uuid,
  is_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me_raw as (
    select mt.id
    from public.get_my_tesseramento() mt
    limit 1
  ), me as (
    select public.social_canonical_tesseramento_id((select id from me_raw)) as id
  ), profiles as (
    select
      t.*,
      public.social_canonical_tesseramento_id(t.id) as canonical_id
    from public.tesseramenti t
  ), teacher_links_raw as (
    select
      public.social_canonical_tesseramento_id(p.tesseramento_id) as canonical_id,
      p.id as teacher_profile_id
    from public.app_teacher_profiles p
    join public.app_teacher_accounts a on a.profile_id = p.id
    where p.tesseramento_id is not null
      and a.access_enabled = true
  ), teacher_links as (
    select distinct on (canonical_id)
      canonical_id,
      teacher_profile_id
    from teacher_links_raw
    where canonical_id is not null
    order by canonical_id, teacher_profile_id
  ), likes as (
    select
      public.social_canonical_tesseramento_id(l.liked_tesseramento_id) as canonical_id,
      count(distinct public.social_canonical_tesseramento_id(l.liker_tesseramento_id))::bigint as likes_count
    from public.student_profile_likes l
    group by public.social_canonical_tesseramento_id(l.liked_tesseramento_id)
  ), followers as (
    select
      public.social_canonical_tesseramento_id(f.followed_tesseramento_id) as canonical_id,
      count(distinct public.social_canonical_tesseramento_id(f.follower_tesseramento_id))::bigint as followers_count
    from public.student_profile_follows f
    group by public.social_canonical_tesseramento_id(f.followed_tesseramento_id)
  ), following as (
    select
      public.social_canonical_tesseramento_id(f.follower_tesseramento_id) as canonical_id,
      count(distinct public.social_canonical_tesseramento_id(f.followed_tesseramento_id))::bigint as following_count
    from public.student_profile_follows f
    group by public.social_canonical_tesseramento_id(f.follower_tesseramento_id)
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
      select 1
      from public.student_profile_likes mine
      where public.social_canonical_tesseramento_id(mine.liker_tesseramento_id) = (select id from me)
        and public.social_canonical_tesseramento_id(mine.liked_tesseramento_id) = t.id
    ) as liked_by_me,
    coalesce(fr.followers_count, 0),
    coalesce(fg.following_count, 0),
    exists (
      select 1
      from public.student_profile_follows mine
      where public.social_canonical_tesseramento_id(mine.follower_tesseramento_id) = (select id from me)
        and public.social_canonical_tesseramento_id(mine.followed_tesseramento_id) = t.id
    ) as followed_by_me,
    exists (
      select 1
      from public.student_profile_follows them
      where public.social_canonical_tesseramento_id(them.follower_tesseramento_id) = t.id
        and public.social_canonical_tesseramento_id(them.followed_tesseramento_id) = (select id from me)
    ) as follows_me,
    (tl.teacher_profile_id is not null) as is_teacher,
    tl.teacher_profile_id,
    (t.id = (select id from me)) as is_me
  from profiles t
  left join teacher_links tl on tl.canonical_id = t.id
  left join likes lk on lk.canonical_id = t.id
  left join followers fr on fr.canonical_id = t.id
  left join following fg on fg.canonical_id = t.id
  where t.id = t.canonical_id
    and t.tessera_attiva is distinct from false
    and t.profilo_community_pubblico = true
    and (t.is_corsista = true or tl.teacher_profile_id is not null)
    and (
      trim(coalesce(p_search,'')) = ''
      or concat_ws(' ', t.nome, t.cognome, t.bio_ballerino, array_to_string(t.balli_preferiti, ' '))
        ilike '%' || trim(p_search) || '%'
    )
  order by
    (tl.teacher_profile_id is not null) desc,
    coalesce(fr.followers_count,0) desc,
    coalesce(lk.likes_count,0) desc,
    t.cognome nulls last,
    t.nome nulls last
  limit 160;
$$;

revoke all on function public.get_community_profiles(text) from public;
grant execute on function public.get_community_profiles(text) to authenticated;

-- 3) Like: normalizza sempre mittente e destinatario sulla persona canonica.
create or replace function public.toggle_my_student_like(p_target_tesseramento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me_raw uuid;
  v_me uuid;
  v_target uuid;
  v_exists boolean := false;
  v_count bigint := 0;
  v_notification_id uuid := null;
  v_liker_name text := 'Qualcuno';
  v_target_allowed boolean := false;
begin
  select mt.id into v_me_raw
  from public.get_my_tesseramento() mt
  limit 1;

  v_me := public.social_canonical_tesseramento_id(v_me_raw);
  v_target := public.social_canonical_tesseramento_id(p_target_tesseramento_id);

  if v_me is null then
    return jsonb_build_object('ok', false, 'message', 'Il tuo account non è collegato a un tesseramento Orchidea.');
  end if;

  if v_target is null or v_target = v_me then
    return jsonb_build_object('ok', false, 'message', 'Non puoi mettere Mi piace al tuo profilo.');
  end if;

  select exists (
    select 1
    from public.tesseramenti t
    where t.id = v_target
      and t.tessera_attiva is distinct from false
      and t.profilo_community_pubblico = true
      and (
        t.is_corsista = true
        or exists (
          select 1
          from public.app_teacher_profiles p
          join public.app_teacher_accounts a on a.profile_id = p.id
          where public.social_canonical_tesseramento_id(p.tesseramento_id) = t.id
            and a.access_enabled = true
        )
      )
  ) into v_target_allowed;

  if not v_target_allowed then
    return jsonb_build_object('ok', false, 'message', 'Profilo non disponibile.');
  end if;

  select nullif(trim(concat_ws(' ', t.nome, t.cognome)), '')
  into v_liker_name
  from public.tesseramenti t
  where t.id = v_me;
  v_liker_name := coalesce(v_liker_name, 'Qualcuno');

  select exists (
    select 1
    from public.student_profile_likes l
    where public.social_canonical_tesseramento_id(l.liker_tesseramento_id) = v_me
      and public.social_canonical_tesseramento_id(l.liked_tesseramento_id) = v_target
  ) into v_exists;

  if v_exists then
    delete from public.student_profile_likes l
    where public.social_canonical_tesseramento_id(l.liker_tesseramento_id) = v_me
      and public.social_canonical_tesseramento_id(l.liked_tesseramento_id) = v_target;
    v_exists := false;
  else
    insert into public.student_profile_likes(liker_tesseramento_id, liked_tesseramento_id)
    values (v_me, v_target)
    on conflict (liker_tesseramento_id, liked_tesseramento_id) do nothing;
    v_exists := true;

    insert into public.app_notifications(
      title,
      body,
      category,
      audience,
      target_tesseramento_id,
      link,
      starts_at,
      created_by,
      notification_kind
    ) values (
      'Hai ricevuto un Mi piace ♥',
      v_liker_name || ' ha messo Mi piace al tuo profilo Orchidea.',
      'important',
      'student',
      v_target,
      '/profilo',
      now(),
      auth.uid(),
      'community_like'
    )
    returning id into v_notification_id;
  end if;

  select count(distinct public.social_canonical_tesseramento_id(l.liker_tesseramento_id))
  into v_count
  from public.student_profile_likes l
  where public.social_canonical_tesseramento_id(l.liked_tesseramento_id) = v_target;

  return jsonb_build_object(
    'ok', true,
    'liked', v_exists,
    'likes_count', coalesce(v_count,0),
    'notification_id', v_notification_id,
    'target_tesseramento_id', v_target
  );
end;
$$;

revoke all on function public.toggle_my_student_like(uuid) from public;
grant execute on function public.toggle_my_student_like(uuid) to authenticated;

-- 4) Statistiche del profilo loggato: aggrega eventuali tesseramenti storici.
create or replace function public.get_my_social_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me_raw as (
    select mt.id from public.get_my_tesseramento() mt limit 1
  ), me as (
    select public.social_canonical_tesseramento_id((select id from me_raw)) as id
  )
  select jsonb_build_object(
    'followers_count', (
      select count(distinct public.social_canonical_tesseramento_id(f.follower_tesseramento_id))
      from public.student_profile_follows f
      where public.social_canonical_tesseramento_id(f.followed_tesseramento_id) = (select id from me)
    ),
    'following_count', (
      select count(distinct public.social_canonical_tesseramento_id(f.followed_tesseramento_id))
      from public.student_profile_follows f
      where public.social_canonical_tesseramento_id(f.follower_tesseramento_id) = (select id from me)
    ),
    'likes_count', (
      select count(distinct public.social_canonical_tesseramento_id(l.liker_tesseramento_id))
      from public.student_profile_likes l
      where public.social_canonical_tesseramento_id(l.liked_tesseramento_id) = (select id from me)
    )
  );
$$;

revoke all on function public.get_my_social_stats() from public;
grant execute on function public.get_my_social_stats() to authenticated;

-- 5) Chi mi ha messo Mi piace: una sola riga per persona anche con tessere storiche.
drop function if exists public.get_my_profile_likers();

create function public.get_my_profile_likers()
returns table (
  tesseramento_id uuid,
  nome text,
  cognome text,
  foto_profilo_path text,
  liked_at timestamptz,
  is_teacher boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me_raw as (
    select mt.id from public.get_my_tesseramento() mt limit 1
  ), me as (
    select public.social_canonical_tesseramento_id((select id from me_raw)) as id
  ), liker_rows as (
    select
      public.social_canonical_tesseramento_id(l.liker_tesseramento_id) as liker_id,
      max(l.created_at) as liked_at
    from public.student_profile_likes l
    where public.social_canonical_tesseramento_id(l.liked_tesseramento_id) = (select id from me)
    group by public.social_canonical_tesseramento_id(l.liker_tesseramento_id)
  )
  select
    t.id,
    t.nome,
    t.cognome,
    t.foto_profilo_path,
    lr.liked_at,
    exists (
      select 1
      from public.app_teacher_profiles p
      join public.app_teacher_accounts a on a.profile_id = p.id
      where public.social_canonical_tesseramento_id(p.tesseramento_id) = t.id
        and a.access_enabled = true
    ) as is_teacher
  from liker_rows lr
  join public.tesseramenti t on t.id = lr.liker_id
  order by lr.liked_at desc;
$$;

revoke all on function public.get_my_profile_likers() from public;
grant execute on function public.get_my_profile_likers() to authenticated;

-- 6) Follow/unfollow normalizzato sulla stessa identita social.
create or replace function public.toggle_my_profile_follow(p_target_tesseramento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me_raw uuid;
  v_me uuid;
  v_target uuid;
  v_exists boolean := false;
  v_target_allowed boolean := false;
  v_notification_id uuid := null;
  v_follower_name text := 'Qualcuno';
  v_target_followers bigint := 0;
  v_my_following bigint := 0;
begin
  select mt.id into v_me_raw
  from public.get_my_tesseramento() mt
  limit 1;

  v_me := public.social_canonical_tesseramento_id(v_me_raw);
  v_target := public.social_canonical_tesseramento_id(p_target_tesseramento_id);

  if v_me is null then
    return jsonb_build_object('ok', false, 'message', 'Il tuo account non è collegato a un tesseramento Orchidea.');
  end if;

  if v_target is null or v_target = v_me then
    return jsonb_build_object('ok', false, 'message', 'Non puoi seguire il tuo stesso profilo.');
  end if;

  select exists (
    select 1
    from public.tesseramenti t
    where t.id = v_target
      and t.tessera_attiva is distinct from false
      and t.profilo_community_pubblico = true
      and (
        t.is_corsista = true
        or exists (
          select 1
          from public.app_teacher_profiles p
          join public.app_teacher_accounts a on a.profile_id = p.id
          where public.social_canonical_tesseramento_id(p.tesseramento_id) = t.id
            and a.access_enabled = true
        )
      )
  ) into v_target_allowed;

  if not v_target_allowed then
    return jsonb_build_object('ok', false, 'message', 'Profilo non disponibile.');
  end if;

  select exists (
    select 1
    from public.student_profile_follows f
    where public.social_canonical_tesseramento_id(f.follower_tesseramento_id) = v_me
      and public.social_canonical_tesseramento_id(f.followed_tesseramento_id) = v_target
  ) into v_exists;

  if v_exists then
    delete from public.student_profile_follows f
    where public.social_canonical_tesseramento_id(f.follower_tesseramento_id) = v_me
      and public.social_canonical_tesseramento_id(f.followed_tesseramento_id) = v_target;
    v_exists := false;
  else
    insert into public.student_profile_follows(follower_tesseramento_id, followed_tesseramento_id)
    values (v_me, v_target)
    on conflict (follower_tesseramento_id, followed_tesseramento_id) do nothing;
    v_exists := true;

    select nullif(trim(concat_ws(' ', t.nome, t.cognome)), '')
    into v_follower_name
    from public.tesseramenti t
    where t.id = v_me;
    v_follower_name := coalesce(v_follower_name, 'Qualcuno');

    insert into public.app_notifications(
      title,
      body,
      category,
      audience,
      target_tesseramento_id,
      link,
      starts_at,
      created_by,
      notification_kind
    ) values (
      'Hai un nuovo follower ✨',
      v_follower_name || ' ha iniziato a seguirti su Orchidea.',
      'important',
      'student',
      v_target,
      '/profilo',
      now(),
      auth.uid(),
      'community_follow'
    )
    returning id into v_notification_id;
  end if;

  select count(distinct public.social_canonical_tesseramento_id(f.follower_tesseramento_id))
  into v_target_followers
  from public.student_profile_follows f
  where public.social_canonical_tesseramento_id(f.followed_tesseramento_id) = v_target;

  select count(distinct public.social_canonical_tesseramento_id(f.followed_tesseramento_id))
  into v_my_following
  from public.student_profile_follows f
  where public.social_canonical_tesseramento_id(f.follower_tesseramento_id) = v_me;

  return jsonb_build_object(
    'ok', true,
    'following', v_exists,
    'followers_count', coalesce(v_target_followers,0),
    'my_following_count', coalesce(v_my_following,0),
    'notification_id', v_notification_id,
    'target_tesseramento_id', v_target
  );
end;
$$;

revoke all on function public.toggle_my_profile_follow(uuid) from public;
grant execute on function public.toggle_my_profile_follow(uuid) to authenticated;

-- 7) Liste follower/seguiti normalizzate e deduplicate.
drop function if exists public.get_profile_connections(uuid, text);

create function public.get_profile_connections(p_target_tesseramento_id uuid, p_kind text default 'followers')
returns table (
  tesseramento_id uuid,
  nome text,
  cognome text,
  foto_profilo_path text,
  is_teacher boolean,
  followed_by_me boolean,
  follows_me boolean,
  is_me boolean,
  connected_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me_raw uuid;
  v_me uuid;
  v_target uuid;
  v_target_public boolean := false;
  v_is_own boolean := false;
begin
  select mt.id into v_me_raw
  from public.get_my_tesseramento() mt
  limit 1;

  v_me := public.social_canonical_tesseramento_id(v_me_raw);
  v_target := public.social_canonical_tesseramento_id(p_target_tesseramento_id);

  if v_me is null or v_target is null then return; end if;
  v_is_own := v_me = v_target;

  select coalesce(t.profilo_community_pubblico, false)
  into v_target_public
  from public.tesseramenti t
  where t.id = v_target;

  if not v_is_own and not coalesce(v_target_public, false) then return; end if;

  if lower(coalesce(p_kind, 'followers')) = 'following' then
    return query
    with edges as (
      select
        public.social_canonical_tesseramento_id(f.follower_tesseramento_id) as follower_id,
        public.social_canonical_tesseramento_id(f.followed_tesseramento_id) as followed_id,
        max(f.created_at) as connected_at
      from public.student_profile_follows f
      group by
        public.social_canonical_tesseramento_id(f.follower_tesseramento_id),
        public.social_canonical_tesseramento_id(f.followed_tesseramento_id)
    )
    select
      t.id,
      t.nome,
      t.cognome,
      t.foto_profilo_path,
      exists (
        select 1
        from public.app_teacher_profiles tp
        join public.app_teacher_accounts ta on ta.profile_id = tp.id
        where public.social_canonical_tesseramento_id(tp.tesseramento_id) = t.id
          and ta.access_enabled = true
      ),
      exists (select 1 from edges x where x.follower_id = v_me and x.followed_id = t.id),
      exists (select 1 from edges x where x.follower_id = t.id and x.followed_id = v_me),
      (t.id = v_me),
      e.connected_at
    from edges e
    join public.tesseramenti t on t.id = e.followed_id
    where e.follower_id = v_target
      and e.followed_id <> e.follower_id
      and (v_is_own or t.profilo_community_pubblico = true)
      and t.tessera_attiva is distinct from false
    order by e.connected_at desc;
  else
    return query
    with edges as (
      select
        public.social_canonical_tesseramento_id(f.follower_tesseramento_id) as follower_id,
        public.social_canonical_tesseramento_id(f.followed_tesseramento_id) as followed_id,
        max(f.created_at) as connected_at
      from public.student_profile_follows f
      group by
        public.social_canonical_tesseramento_id(f.follower_tesseramento_id),
        public.social_canonical_tesseramento_id(f.followed_tesseramento_id)
    )
    select
      t.id,
      t.nome,
      t.cognome,
      t.foto_profilo_path,
      exists (
        select 1
        from public.app_teacher_profiles tp
        join public.app_teacher_accounts ta on ta.profile_id = tp.id
        where public.social_canonical_tesseramento_id(tp.tesseramento_id) = t.id
          and ta.access_enabled = true
      ),
      exists (select 1 from edges x where x.follower_id = v_me and x.followed_id = t.id),
      exists (select 1 from edges x where x.follower_id = t.id and x.followed_id = v_me),
      (t.id = v_me),
      e.connected_at
    from edges e
    join public.tesseramenti t on t.id = e.follower_id
    where e.followed_id = v_target
      and e.followed_id <> e.follower_id
      and (v_is_own or t.profilo_community_pubblico = true)
      and t.tessera_attiva is distinct from false
    order by e.connected_at desc;
  end if;
end;
$$;

revoke all on function public.get_profile_connections(uuid, text) from public;
grant execute on function public.get_profile_connections(uuid, text) to authenticated;

-- 8) Classifica Like: usa la persona canonica, non la singola tessera storica.
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
  v_is_admin boolean := false;
  v_show_score boolean := false;
begin
  select * into v_ranking
  from public.app_rankings
  where id = p_ranking_id;

  if v_ranking.id is null then return; end if;

  v_is_admin := public.is_admin();

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

  if not v_ranking.visible and not v_is_admin and not v_can_teacher then return; end if;
  v_show_score := v_ranking.show_scores_to_students or v_is_admin or v_can_teacher;

  return query
  with participants as (
    select distinct
      t.id,
      t.nome,
      t.cognome,
      t.foto_profilo_path,
      coalesce(t.balli_preferiti, '{}'::text[]) as balli_preferiti,
      t.profilo_community_pubblico
    from public.tesseramenti t
    where t.is_corsista = true
      and t.tessera_attiva is distinct from false
      and (t.profilo_community_pubblico = true or v_is_admin or v_can_teacher)
      and (
        v_ranking.scoring_mode <> 'likes'
        or t.id = public.social_canonical_tesseramento_id(t.id)
      )
      and (
        v_ranking.scoring_mode <> 'likes'
        or not exists (
          select 1
          from public.app_teacher_profiles tp
          where public.social_canonical_tesseramento_id(tp.tesseramento_id) = t.id
        )
      )
      and (
        v_ranking.course_id is null
        or exists (
          select 1
          from public.iscrizioni_corsi ic
          where ic.tesseramento_id = t.id
            and ic.corso_id = v_ranking.course_id
            and lower(coalesce(ic.stato, 'attivo')) not in ('annullato','cancellato','rimosso','inactive','non_attivo')
            and coalesce(ic.rinnovo_attivo, true) = true
        )
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
          select count(distinct public.social_canonical_tesseramento_id(l.liker_tesseramento_id))::numeric
          from public.student_profile_likes l
          where public.social_canonical_tesseramento_id(l.liked_tesseramento_id) = p.id
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
          select count(*)::integer
          from public.ranking_teacher_votes v
          where v.ranking_id = v_ranking.id and v.tesseramento_id = p.id
        )
        else 0
      end as vote_count,
      case
        when v_ranking.scoring_mode = 'likes' then exists (
          select 1
          from public.student_profile_likes l
          where public.social_canonical_tesseramento_id(l.liked_tesseramento_id) = p.id
            and l.created_at::date between v_ranking.starts_on and v_ranking.ends_on
        )
        when v_ranking.scoring_mode = 'teacher_scores' then exists (
          select 1 from public.ranking_teacher_votes v
          where v.ranking_id = v_ranking.id and v.tesseramento_id = p.id
        )
        else exists (
          select 1 from public.ranking_manual_points mp
          where mp.ranking_id = v_ranking.id and mp.tesseramento_id = p.id
        )
      end as has_activity
    from participants p
  ), ordered as (
    select
      rs.*,
      row_number() over (
        order by rs.raw_score desc, rs.cognome nulls last, rs.nome nulls last, rs.id
      )::integer as pos
    from raw_scores rs
    where rs.has_activity = true
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
  limit greatest(1, least(coalesce(p_limit, 100), 250));
end;
$$;

revoke all on function public.get_ranking_leaderboard(uuid, integer) from public;
grant execute on function public.get_ranking_leaderboard(uuid, integer) to authenticated;
