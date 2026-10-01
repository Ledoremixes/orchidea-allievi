-- =========================================================
-- ORCHIDEA APP - STEP 31
-- Privacy Community e classifiche
--
-- Obiettivi:
-- 1) Un profilo con profilo_community_pubblico = false NON compare
--    ad altri allievi nelle classifiche pubbliche.
-- 2) Admin e insegnanti autorizzati possono continuare a vedere gli
--    allievi nei contesti privati di gestione/votazione.
-- 3) Una classifica non mostra nomi a punteggio zero: per i Like
--    resta vuota finché non arriva il primo Mi piace.
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
  v_is_admin boolean := false;
  v_show_score boolean := false;
begin
  select * into v_ranking
  from public.app_rankings
  where id = p_ranking_id;

  if v_ranking.id is null then
    return;
  end if;

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

  if not v_ranking.visible and not v_is_admin and not v_can_teacher then
    return;
  end if;

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

      -- Privacy: un allievo con profilo privato non compare mai
      -- nelle classifiche viste dagli altri allievi.
      -- Admin e docente autorizzato mantengono accesso privato.
      and (
        t.profilo_community_pubblico = true
        or v_is_admin
        or v_can_teacher
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
          where v.ranking_id = v_ranking.id
            and v.tesseramento_id = p.id
        ), 0)
        else coalesce((
          select sum(mp.points)::numeric
          from public.ranking_manual_points mp
          where mp.ranking_id = v_ranking.id
            and mp.tesseramento_id = p.id
        ), 0)
      end as raw_score,
      case
        when v_ranking.scoring_mode = 'teacher_scores' then (
          select count(*)::integer
          from public.ranking_teacher_votes v
          where v.ranking_id = v_ranking.id
            and v.tesseramento_id = p.id
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
          select 1
          from public.ranking_teacher_votes v
          where v.ranking_id = v_ranking.id
            and v.tesseramento_id = p.id
        )
        else exists (
          select 1
          from public.ranking_manual_points mp
          where mp.ranking_id = v_ranking.id
            and mp.tesseramento_id = p.id
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
