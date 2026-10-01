-- =========================================================
-- ORCHIDEA APP - STEP 32
-- Community unica Allievi + Insegnanti, Like personali, notifiche e
-- collegamento del profilo grafico insegnante al tesseramento reale.
--
-- Eseguire DOPO STEP 31.
-- =========================================================

-- ---------------------------------------------------------
-- 1) COLLEGAMENTO PROFILO GRAFICO INSEGNANTE <-> TESSERATO
-- ---------------------------------------------------------
alter table public.app_teacher_profiles
  add column if not exists tesseramento_id uuid
  references public.tesseramenti(id) on delete set null;

-- Proviamo a collegare automaticamente i profili docenti già esistenti usando
-- prima il codice fiscale e poi l'email dell'account insegnante.
update public.app_teacher_profiles p
set tesseramento_id = (
  select t.id
  from public.app_teacher_accounts a
  join public.tesseramenti t
    on (
      nullif(trim(coalesce(a.codice_fiscale,'')), '') is not null
      and upper(trim(coalesce(t.cf,''))) = upper(trim(a.codice_fiscale))
    )
    or (
      nullif(trim(coalesce(a.email,'')), '') is not null
      and lower(trim(coalesce(t.email,''))) = lower(trim(a.email))
    )
  where a.profile_id = p.id
  order by
    (upper(trim(coalesce(t.cf,''))) = upper(trim(coalesce(a.codice_fiscale,'')))) desc,
    (lower(trim(coalesce(t.email,''))) = lower(trim(coalesce(a.email,'')))) desc,
    t.created_at desc nulls last
  limit 1
)
where p.tesseramento_id is null
  and exists (
    select 1
    from public.app_teacher_accounts a
    join public.tesseramenti t
      on (
        nullif(trim(coalesce(a.codice_fiscale,'')), '') is not null
        and upper(trim(coalesce(t.cf,''))) = upper(trim(a.codice_fiscale))
      )
      or (
        nullif(trim(coalesce(a.email,'')), '') is not null
        and lower(trim(coalesce(t.email,''))) = lower(trim(a.email))
      )
    where a.profile_id = p.id
  );

create index if not exists app_teacher_profiles_tesseramento_idx
  on public.app_teacher_profiles(tesseramento_id);

-- Tipo della notifica, usato anche dalla Edge Function per autorizzare
-- in sicurezza l'invio della push generata da un Mi piace.
alter table public.app_notifications
  add column if not exists notification_kind text;

create index if not exists app_notifications_kind_idx
  on public.app_notifications(notification_kind, created_at desc);

-- ---------------------------------------------------------
-- 2) RISOLUZIONE TESSERAMENTO: SUPPORTA ANCHE IL DOCENTE
--    COLLEGATO DALL'ADMIN AL PROPRIO TESSERATO.
-- ---------------------------------------------------------
create or replace function public.get_my_tesseramento()
returns setof public.tesseramenti
language sql
stable
security definer
set search_path = public
as $$
  select t.*
  from public.tesseramenti t
  where t.auth_user_id = auth.uid()
     or lower(trim(coalesce(t.email,''))) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
     or t.id = (
       select p.tesseramento_id
       from public.app_teacher_accounts a
       join public.app_teacher_profiles p on p.id = a.profile_id
       where a.auth_user_id = auth.uid()
         and a.access_enabled = true
         and p.tesseramento_id is not null
       limit 1
     )
  order by
    (t.auth_user_id = auth.uid()) desc,
    (t.id = (
       select p2.tesseramento_id
       from public.app_teacher_accounts a2
       join public.app_teacher_profiles p2 on p2.id = a2.profile_id
       where a2.auth_user_id = auth.uid()
         and a2.access_enabled = true
         and p2.tesseramento_id is not null
       limit 1
    )) desc,
    t.created_at desc nulls last
  limit 1;
$$;

grant execute on function public.get_my_tesseramento() to authenticated;

-- Il contesto docente continua a usare foto/specialità amministrative,
-- ma la bio viene presa dal profilo ballerino scritto dal docente.
create or replace function public.get_my_teacher_account()
returns table (
  account_id uuid,
  profile_id uuid,
  compensation_teacher_id uuid,
  email text,
  telefono text,
  nome text,
  cognome text,
  specialita text,
  foto_url text,
  bio text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.profile_id,
    a.compensation_teacher_id,
    a.email,
    a.telefono,
    p.nome,
    p.cognome,
    p.specialita,
    p.foto_url,
    t.bio_ballerino
  from public.app_teacher_accounts a
  join public.app_teacher_profiles p on p.id = a.profile_id
  left join public.tesseramenti t on t.id = p.tesseramento_id
  where a.auth_user_id = auth.uid()
    and a.access_enabled = true
  limit 1;
$$;

grant execute on function public.get_my_teacher_account() to authenticated;

-- ---------------------------------------------------------
-- 3) COMMUNITY: ALLIEVI + INSEGNANTI NELLA RICERCA
-- ---------------------------------------------------------
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
    select p.tesseramento_id, p.id as teacher_profile_id
    from public.app_teacher_profiles p
    join public.app_teacher_accounts a on a.profile_id = p.id
    where p.tesseramento_id is not null
      and a.access_enabled = true
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
      select 1
      from public.student_profile_likes mine
      where mine.liker_tesseramento_id = (select id from me)
        and mine.liked_tesseramento_id = t.id
    ) as liked_by_me,
    (tl.teacher_profile_id is not null) as is_teacher,
    tl.teacher_profile_id,
    (t.id = (select id from me)) as is_me
  from public.tesseramenti t
  left join teacher_links tl on tl.tesseramento_id = t.id
  left join likes lk on lk.liked_tesseramento_id = t.id
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
    coalesce(lk.likes_count,0) desc,
    t.cognome nulls last,
    t.nome nulls last
  limit 160;
$$;

revoke all on function public.get_community_profiles(text) from public;
grant execute on function public.get_community_profiles(text) to authenticated;

-- ---------------------------------------------------------
-- 4) LIKE: ORA VALE ANCHE PER GLI INSEGNANTI E CREA UNA
--    NOTIFICA PERSONALE. LA PUSH VIENE INVIATA DAL CLIENT
--    TRAMITE send-push USANDO notification_id.
-- ---------------------------------------------------------
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
  v_notification_id uuid := null;
  v_liker_name text := 'Qualcuno';
  v_target_allowed boolean := false;
begin
  select mt.id into v_me
  from public.get_my_tesseramento() mt
  limit 1;

  if v_me is null then
    return jsonb_build_object('ok', false, 'message', 'Il tuo account non è collegato a un tesseramento Orchidea.');
  end if;

  if p_target_tesseramento_id is null or p_target_tesseramento_id = v_me then
    return jsonb_build_object('ok', false, 'message', 'Non puoi mettere Mi piace al tuo profilo.');
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

  select trim(concat_ws(' ', t.nome, t.cognome))
  into v_liker_name
  from public.tesseramenti t
  where t.id = v_me;

  if coalesce(v_liker_name, '') = '' then v_liker_name := 'Qualcuno'; end if;

  select exists (
    select 1
    from public.student_profile_likes l
    where l.liker_tesseramento_id = v_me
      and l.liked_tesseramento_id = p_target_tesseramento_id
  ) into v_exists;

  if v_exists then
    delete from public.student_profile_likes
    where liker_tesseramento_id = v_me
      and liked_tesseramento_id = p_target_tesseramento_id;
    v_exists := false;
  else
    insert into public.student_profile_likes(liker_tesseramento_id, liked_tesseramento_id)
    values (v_me, p_target_tesseramento_id)
    on conflict do nothing;

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
      p_target_tesseramento_id,
      '/profilo',
      now(),
      auth.uid(),
      'community_like'
    )
    returning id into v_notification_id;
  end if;

  select count(*) into v_count
  from public.student_profile_likes
  where liked_tesseramento_id = p_target_tesseramento_id;

  return jsonb_build_object(
    'ok', true,
    'liked', v_exists,
    'likes_count', v_count,
    'notification_id', v_notification_id
  );
end;
$$;

revoke all on function public.toggle_my_student_like(uuid) from public;
grant execute on function public.toggle_my_student_like(uuid) to authenticated;

-- ---------------------------------------------------------
-- 5) CHI MI HA MESSO MI PIACE
-- ---------------------------------------------------------
create or replace function public.get_my_profile_likers()
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
  with me as (
    select mt.id
    from public.get_my_tesseramento() mt
    limit 1
  )
  select
    t.id,
    t.nome,
    t.cognome,
    t.foto_profilo_path,
    l.created_at,
    exists (
      select 1
      from public.app_teacher_profiles p
      join public.app_teacher_accounts a on a.profile_id = p.id
      where p.tesseramento_id = t.id
        and a.access_enabled = true
    ) as is_teacher
  from public.student_profile_likes l
  join public.tesseramenti t on t.id = l.liker_tesseramento_id
  where l.liked_tesseramento_id = (select id from me)
  order by l.created_at desc;
$$;

revoke all on function public.get_my_profile_likers() from public;
grant execute on function public.get_my_profile_likers() to authenticated;

-- ---------------------------------------------------------
-- 6) PROFILI INSEGNANTI NELLA PAGINA CORSI:
--    FOTO/SPECIALITÀ/INSTAGRAM RESTANO GESTITI DALL'ADMIN,
--    IL CURRICULUM ARRIVA DAL TESSERAMENTO DEL DOCENTE.
-- ---------------------------------------------------------
create or replace function public.get_app_teacher_profiles_for_courses(p_course_ids uuid[])
returns table (
  profile_id uuid,
  tesseramento_id uuid,
  nome text,
  cognome text,
  specialita text,
  instagram_url text,
  foto_url text,
  profilo_pubblico boolean,
  ordine integer,
  corso_id uuid,
  corso_nome text,
  corso_livello text,
  bio_ballerino text,
  balli_preferiti text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.tesseramento_id,
    p.nome,
    p.cognome,
    p.specialita,
    p.instagram_url,
    p.foto_url,
    p.profilo_pubblico,
    p.ordine,
    pc.corso_id,
    c.nome,
    c.livello,
    t.bio_ballerino,
    coalesce(t.balli_preferiti, '{}'::text[])
  from public.app_teacher_profile_courses pc
  join public.app_teacher_profiles p on p.id = pc.profile_id
  join public.corsi c on c.id = pc.corso_id
  left join public.tesseramenti t on t.id = p.tesseramento_id
  where p.profilo_pubblico = true
    and pc.corso_id = any(coalesce(p_course_ids, '{}'::uuid[]))
  order by p.ordine, p.cognome, p.nome, c.nome;
$$;

revoke all on function public.get_app_teacher_profiles_for_courses(uuid[]) from public;
grant execute on function public.get_app_teacher_profiles_for_courses(uuid[]) to authenticated;

-- ---------------------------------------------------------
-- 7) NOTIFICHE PERSONALI: IL DOCENTE COLLEGATO AL TESSERATO
--    DEVE POTER LEGGERE ANCHE LE NOTIFICHE LIKE.
-- ---------------------------------------------------------
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
          and lower(coalesce(ic.stato,'attivo')) not in ('annullato','cancellato','rimosso','inactive','non_attivo')
          and (
            t.auth_user_id = auth.uid()
            or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
          )
      )
    )
    or (
      audience = 'student'
      and target_tesseramento_id is not null
      and (
        exists (
          select 1
          from public.tesseramenti t
          where t.id = app_notifications.target_tesseramento_id
            and (
              t.auth_user_id = auth.uid()
              or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
            )
        )
        or exists (
          select 1
          from public.app_teacher_accounts a
          join public.app_teacher_profiles p on p.id = a.profile_id
          where a.auth_user_id = auth.uid()
            and a.access_enabled = true
            and p.tesseramento_id = app_notifications.target_tesseramento_id
        )
      )
    )
  )
);

-- ---------------------------------------------------------
-- 8) CLASSIFICA GENERALE LIKE: ESCLUDE SEMPRE GLI INSEGNANTI
-- ---------------------------------------------------------
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
      -- La classifica Like è la classifica generale ALLIEVI: i docenti
      -- restano ricercabili e ricevono Like, ma non competono qui.
      and (
        v_ranking.scoring_mode <> 'likes'
        or not exists (
          select 1
          from public.app_teacher_profiles tp
          where tp.tesseramento_id = t.id
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
          where l.liked_tesseramento_id = p.id
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
