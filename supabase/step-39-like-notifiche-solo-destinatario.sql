-- =========================================================
-- ORCHIDEA APP - STEP 39
-- Like Community: notifiche rigorosamente personali.
-- Eseguire DOPO STEP 32 (e successivi).
-- =========================================================

-- 1) Helper unico per capire se un tesseramento appartiene all'utente loggato.
--    Copre allievi, duplicati/stagioni con stessa email e docenti collegati
--    al proprio tesseramento reale tramite app_teacher_profiles.
create or replace function public.is_my_tesseramento(p_tesseramento_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tesseramenti t
    where t.id = p_tesseramento_id
      and (
        t.auth_user_id = auth.uid()
        or (
          nullif(trim(coalesce(t.email,'')), '') is not null
          and lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
        )
        or exists (
          select 1
          from public.app_teacher_accounts a
          join public.app_teacher_profiles p on p.id = a.profile_id
          where a.auth_user_id = auth.uid()
            and a.access_enabled = true
            and p.tesseramento_id = t.id
        )
      )
  );
$$;

revoke all on function public.is_my_tesseramento(uuid) from public;
grant execute on function public.is_my_tesseramento(uuid) to authenticated;

-- 2) Blindiamo la policy delle notifiche.
--    audience='student' e quindi anche i Like sono leggibili SOLO dal destinatario.
drop policy if exists "Allievi leggono notifiche pertinenti" on public.app_notifications;

create policy "Allievi leggono notifiche pertinenti"
on public.app_notifications
for select
to authenticated
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
        where public.is_my_tesseramento(t.id)
          and t.is_corsista = true
      )
    )
    or (
      audience = 'course'
      and course_id is not null
      and exists (
        select 1
        from public.iscrizioni_corsi ic
        where ic.corso_id = app_notifications.course_id
          and ic.stato = 'attivo'
          and public.is_my_tesseramento(ic.tesseramento_id)
      )
    )
    or (
      audience = 'student'
      and target_tesseramento_id is not null
      and public.is_my_tesseramento(target_tesseramento_id)
    )
  )
);

-- 3) Vincolo logico: una notifica Community Like NON può mai essere globale.
--    Se è community_like deve essere audience student + destinatario valorizzato.
alter table public.app_notifications
  drop constraint if exists app_notifications_community_like_personal_check;

alter table public.app_notifications
  add constraint app_notifications_community_like_personal_check
  check (
    notification_kind is distinct from 'community_like'
    or (
      audience = 'student'
      and target_tesseramento_id is not null
    )
  );

-- 4) Endpoint di lettura dedicato al Centro Notifiche.
--    Anche se l'utente fosse Admin, questa RPC restituisce soltanto le notifiche
--    pertinenti alla sua identità personale quando usa l'app.
drop function if exists public.get_my_app_notifications(integer);

create function public.get_my_app_notifications(p_limit integer default 40)
returns table (
  id uuid,
  title text,
  body text,
  category text,
  link text,
  starts_at timestamptz,
  created_at timestamptz,
  audience text,
  target_tesseramento_id uuid,
  notification_kind text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    n.id,
    n.title,
    n.body,
    n.category,
    n.link,
    n.starts_at,
    n.created_at,
    n.audience,
    n.target_tesseramento_id,
    n.notification_kind
  from public.app_notifications n
  where n.starts_at <= now()
    and (n.expires_at is null or n.expires_at >= now())
    and (
      n.audience = 'all'
      or (
        n.audience = 'corsisti'
        and exists (
          select 1
          from public.tesseramenti t
          where public.is_my_tesseramento(t.id)
            and t.is_corsista = true
        )
      )
      or (
        n.audience = 'course'
        and n.course_id is not null
        and exists (
          select 1
          from public.iscrizioni_corsi ic
          where ic.corso_id = n.course_id
            and ic.stato = 'attivo'
            and public.is_my_tesseramento(ic.tesseramento_id)
        )
      )
      or (
        n.audience = 'student'
        and n.target_tesseramento_id is not null
        and public.is_my_tesseramento(n.target_tesseramento_id)
      )
    )
  order by n.starts_at desc, n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 100));
$$;

revoke all on function public.get_my_app_notifications(integer) from public;
grant execute on function public.get_my_app_notifications(integer) to authenticated;

-- 5) Indice utile per le notifiche personali / like.
create index if not exists app_notifications_personal_kind_idx
  on public.app_notifications(target_tesseramento_id, notification_kind, starts_at desc)
  where audience = 'student';
