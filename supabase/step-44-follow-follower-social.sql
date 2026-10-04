-- =========================================================
-- ORCHIDEA APP - STEP 44
-- Follow / follower Community in stile social.
-- Eseguire DOPO STEP 39/40 e STEP 32+.
-- =========================================================

-- 1) RELAZIONI FOLLOW
create table if not exists public.student_profile_follows (
  follower_tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  followed_tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_tesseramento_id, followed_tesseramento_id),
  constraint student_profile_follows_no_self check (follower_tesseramento_id <> followed_tesseramento_id)
);

create index if not exists student_profile_follows_followed_idx
  on public.student_profile_follows(followed_tesseramento_id, created_at desc);
create index if not exists student_profile_follows_follower_idx
  on public.student_profile_follows(follower_tesseramento_id, created_at desc);

alter table public.student_profile_follows enable row level security;
revoke all on table public.student_profile_follows from anon, authenticated;

-- 2) IL FOLLOW, COME IL LIKE, DEVE ESSERE SEMPRE PERSONALE
alter table public.app_notifications
  drop constraint if exists app_notifications_community_follow_personal_check;

alter table public.app_notifications
  add constraint app_notifications_community_follow_personal_check
  check (
    notification_kind is distinct from 'community_follow'
    or (
      audience = 'student'
      and target_tesseramento_id is not null
    )
  );

-- 3) COMMUNITY: aggiungiamo follower/seguiti e stato relazione col profilo loggato.
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
  with me as (
    select mt.id
    from public.get_my_tesseramento() mt
    limit 1
  ), teacher_links as (
    select distinct p.tesseramento_id, p.id as teacher_profile_id
    from public.app_teacher_profiles p
    join public.app_teacher_accounts a on a.profile_id = p.id
    where p.tesseramento_id is not null
      and a.access_enabled = true
  ), likes as (
    select l.liked_tesseramento_id, count(*)::bigint as likes_count
    from public.student_profile_likes l
    group by l.liked_tesseramento_id
  ), followers as (
    select f.followed_tesseramento_id, count(*)::bigint as followers_count
    from public.student_profile_follows f
    group by f.followed_tesseramento_id
  ), following as (
    select f.follower_tesseramento_id, count(*)::bigint as following_count
    from public.student_profile_follows f
    group by f.follower_tesseramento_id
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
      where mine.liker_tesseramento_id = (select id from me)
        and mine.liked_tesseramento_id = t.id
    ) as liked_by_me,
    coalesce(fr.followers_count, 0),
    coalesce(fg.following_count, 0),
    exists (
      select 1
      from public.student_profile_follows mine
      where mine.follower_tesseramento_id = (select id from me)
        and mine.followed_tesseramento_id = t.id
    ) as followed_by_me,
    exists (
      select 1
      from public.student_profile_follows them
      where them.follower_tesseramento_id = t.id
        and them.followed_tesseramento_id = (select id from me)
    ) as follows_me,
    (tl.teacher_profile_id is not null) as is_teacher,
    tl.teacher_profile_id,
    (t.id = (select id from me)) as is_me
  from public.tesseramenti t
  left join teacher_links tl on tl.tesseramento_id = t.id
  left join likes lk on lk.liked_tesseramento_id = t.id
  left join followers fr on fr.followed_tesseramento_id = t.id
  left join following fg on fg.follower_tesseramento_id = t.id
  where t.tessera_attiva is distinct from false
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

-- 4) FOLLOW / UNFOLLOW. Crea notifica soltanto quando parte un nuovo follow.
create or replace function public.toggle_my_profile_follow(p_target_tesseramento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
  v_exists boolean := false;
  v_target_allowed boolean := false;
  v_notification_id uuid := null;
  v_follower_name text := 'Qualcuno';
  v_target_followers bigint := 0;
  v_my_following bigint := 0;
begin
  select mt.id into v_me
  from public.get_my_tesseramento() mt
  limit 1;

  if v_me is null then
    return jsonb_build_object('ok', false, 'message', 'Il tuo account non è collegato a un tesseramento Orchidea.');
  end if;

  if p_target_tesseramento_id is null or p_target_tesseramento_id = v_me then
    return jsonb_build_object('ok', false, 'message', 'Non puoi seguire il tuo stesso profilo.');
  end if;

  select exists (
    select 1
    from public.tesseramenti t
    where t.id = p_target_tesseramento_id
      and t.tessera_attiva is distinct from false
      and t.profilo_community_pubblico = true
      and (
        t.is_corsista = true
        or exists (
          select 1
          from public.app_teacher_profiles p
          join public.app_teacher_accounts a on a.profile_id = p.id
          where p.tesseramento_id = t.id
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
    where f.follower_tesseramento_id = v_me
      and f.followed_tesseramento_id = p_target_tesseramento_id
  ) into v_exists;

  if v_exists then
    delete from public.student_profile_follows
    where follower_tesseramento_id = v_me
      and followed_tesseramento_id = p_target_tesseramento_id;
    v_exists := false;
  else
    insert into public.student_profile_follows(follower_tesseramento_id, followed_tesseramento_id)
    values (v_me, p_target_tesseramento_id)
    on conflict do nothing;

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
      p_target_tesseramento_id,
      '/profilo',
      now(),
      auth.uid(),
      'community_follow'
    )
    returning id into v_notification_id;
  end if;

  select count(*) into v_target_followers
  from public.student_profile_follows
  where followed_tesseramento_id = p_target_tesseramento_id;

  select count(*) into v_my_following
  from public.student_profile_follows
  where follower_tesseramento_id = v_me;

  return jsonb_build_object(
    'ok', true,
    'following', v_exists,
    'followers_count', v_target_followers,
    'my_following_count', v_my_following,
    'notification_id', v_notification_id
  );
end;
$$;

revoke all on function public.toggle_my_profile_follow(uuid) from public;
grant execute on function public.toggle_my_profile_follow(uuid) to authenticated;

-- 5) STATISTICHE SOCIAL DEL PROFILO LOGGATO.
create or replace function public.get_my_social_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select mt.id from public.get_my_tesseramento() mt limit 1
  )
  select jsonb_build_object(
    'followers_count', (select count(*) from public.student_profile_follows f where f.followed_tesseramento_id = (select id from me)),
    'following_count', (select count(*) from public.student_profile_follows f where f.follower_tesseramento_id = (select id from me)),
    'likes_count', (select count(*) from public.student_profile_likes l where l.liked_tesseramento_id = (select id from me))
  );
$$;

revoke all on function public.get_my_social_stats() from public;
grant execute on function public.get_my_social_stats() to authenticated;

-- 6) LISTE FOLLOWER / SEGUITI.
--    Se guardi il tuo profilo puoi vedere anche collegamenti che nel frattempo hanno
--    reso il profilo privato. Guardando un altro profilo vengono mostrati solo account pubblici.
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
  v_me uuid;
  v_target_public boolean := false;
  v_is_own boolean := false;
begin
  select mt.id into v_me
  from public.get_my_tesseramento() mt
  limit 1;

  if v_me is null or p_target_tesseramento_id is null then return; end if;
  v_is_own := v_me = p_target_tesseramento_id;

  select coalesce(t.profilo_community_pubblico, false)
  into v_target_public
  from public.tesseramenti t
  where t.id = p_target_tesseramento_id;

  if not v_is_own and not coalesce(v_target_public, false) then return; end if;

  if lower(coalesce(p_kind, 'followers')) = 'following' then
    return query
    select
      t.id,
      t.nome,
      t.cognome,
      t.foto_profilo_path,
      exists (
        select 1 from public.app_teacher_profiles tp
        join public.app_teacher_accounts ta on ta.profile_id = tp.id
        where tp.tesseramento_id = t.id and ta.access_enabled = true
      ),
      exists (
        select 1 from public.student_profile_follows x
        where x.follower_tesseramento_id = v_me and x.followed_tesseramento_id = t.id
      ),
      exists (
        select 1 from public.student_profile_follows x
        where x.follower_tesseramento_id = t.id and x.followed_tesseramento_id = v_me
      ),
      (t.id = v_me),
      f.created_at
    from public.student_profile_follows f
    join public.tesseramenti t on t.id = f.followed_tesseramento_id
    where f.follower_tesseramento_id = p_target_tesseramento_id
      and (v_is_own or t.profilo_community_pubblico = true)
      and t.tessera_attiva is distinct from false
    order by f.created_at desc;
  else
    return query
    select
      t.id,
      t.nome,
      t.cognome,
      t.foto_profilo_path,
      exists (
        select 1 from public.app_teacher_profiles tp
        join public.app_teacher_accounts ta on ta.profile_id = tp.id
        where tp.tesseramento_id = t.id and ta.access_enabled = true
      ),
      exists (
        select 1 from public.student_profile_follows x
        where x.follower_tesseramento_id = v_me and x.followed_tesseramento_id = t.id
      ),
      exists (
        select 1 from public.student_profile_follows x
        where x.follower_tesseramento_id = t.id and x.followed_tesseramento_id = v_me
      ),
      (t.id = v_me),
      f.created_at
    from public.student_profile_follows f
    join public.tesseramenti t on t.id = f.follower_tesseramento_id
    where f.followed_tesseramento_id = p_target_tesseramento_id
      and (v_is_own or t.profilo_community_pubblico = true)
      and t.tessera_attiva is distinct from false
    order by f.created_at desc;
  end if;
end;
$$;

revoke all on function public.get_profile_connections(uuid, text) from public;
grant execute on function public.get_profile_connections(uuid, text) to authenticated;

-- Indici notifiche personali social.
create index if not exists app_notifications_social_personal_idx
  on public.app_notifications(target_tesseramento_id, notification_kind, created_at desc)
  where notification_kind in ('community_like', 'community_follow') and audience = 'student';
