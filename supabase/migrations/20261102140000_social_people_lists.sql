-- Social lists must use one consistent identity and privacy rule.
-- Read-only: no changes to followers, likes, membership or privacy settings.
create or replace function public.get_profile_social_people(
  p_target_tesseramento_id uuid,
  p_kind text default 'followers'
)
returns table(
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
set search_path = ''
as $function$
declare
  v_me_raw uuid;
  v_me uuid;
  v_target uuid;
  v_own boolean;
  v_kind text := lower(trim(coalesce(p_kind, '')));
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto' using errcode = '42501';
  end if;
  if v_kind not in ('followers','following','likes') then
    raise exception 'Tipo di elenco non valido';
  end if;
  if p_target_tesseramento_id is null then
    return;
  end if;

  select mt.id into v_me_raw from public.get_my_tesseramento() mt limit 1;
  if v_me_raw is null then
    select tp.tesseramento_id into v_me_raw
    from public.app_teacher_accounts a
    join public.app_teacher_profiles tp on tp.id = a.profile_id
    where a.auth_user_id = auth.uid()
      and a.access_enabled = true
      and tp.tesseramento_id is not null
    limit 1;
  end if;

  v_me := public.community_current_tesseramento_id(v_me_raw);
  v_target := public.community_current_tesseramento_id(p_target_tesseramento_id);
  if v_me is null or v_target is null then return; end if;
  v_own := v_me = v_target;

  -- A private profile cannot have its social lists inspected by other users.
  if not exists (
    select 1 from public.tesseramenti target
    where target.id = v_target
      and (v_own or target.profilo_community_pubblico is true)
  ) then return; end if;

  return query
  with raw_people as (
    select
      case when v_kind = 'following'
        then public.community_current_tesseramento_id(f.followed_tesseramento_id)
        else public.community_current_tesseramento_id(f.follower_tesseramento_id)
      end as person_id,
      f.created_at as happened_at
    from public.student_profile_follows f
    where (v_kind = 'followers'
           and public.community_current_tesseramento_id(f.followed_tesseramento_id) = v_target)
       or (v_kind = 'following'
           and public.community_current_tesseramento_id(f.follower_tesseramento_id) = v_target)

    union all

    select
      public.community_current_tesseramento_id(l.liker_tesseramento_id) as person_id,
      l.created_at as happened_at
    from public.student_profile_likes l
    where v_kind = 'likes'
      and public.community_current_tesseramento_id(l.liked_tesseramento_id) = v_target
  ),
  distinct_people as (
    select r.person_id, max(r.happened_at) as last_action_at
    from raw_people r
    where r.person_id is not null and r.person_id <> v_target
    group by r.person_id
  )
  select
    t.id,
    t.nome,
    t.cognome,
    t.foto_profilo_path,
    exists (
      select 1 from public.app_teacher_profiles tp
      join public.app_teacher_accounts a on a.profile_id = tp.id and a.access_enabled = true
      where tp.tesseramento_id is not null
        and public.community_current_tesseramento_id(tp.tesseramento_id) = t.id
    ) as is_teacher,
    exists (
      select 1 from public.student_profile_follows mine
      where public.community_current_tesseramento_id(mine.follower_tesseramento_id) = v_me
        and public.community_current_tesseramento_id(mine.followed_tesseramento_id) = t.id
    ) as followed_by_me,
    exists (
      select 1 from public.student_profile_follows theirs
      where public.community_current_tesseramento_id(theirs.follower_tesseramento_id) = t.id
        and public.community_current_tesseramento_id(theirs.followed_tesseramento_id) = v_me
    ) as follows_me,
    t.id = v_me as is_me,
    p.last_action_at
  from distinct_people p
  join public.tesseramenti t on t.id = p.person_id
  where v_own or t.profilo_community_pubblico is true
  order by p.last_action_at desc, t.id
  limit 1000;
end;
$function$;

revoke all on function public.get_profile_social_people(uuid,text) from public,anon;
grant execute on function public.get_profile_social_people(uuid,text) to authenticated;
notify pgrst,'reload schema';