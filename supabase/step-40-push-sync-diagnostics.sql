-- =========================================================
-- ORCHIDEA APP - STEP 40
-- Push: sincronizzazione robusta dispositivo/account + test personale.
-- Eseguire DOPO STEP 39.
-- =========================================================

-- 1) Sincronizza la subscription del browser con l'identità attualmente loggata.
--    Serve soprattutto quando sullo stesso telefono si cambia account/ruolo:
--    lo stesso endpoint push esiste già, ma deve essere riassociato in sicurezza.
create or replace function public.sync_my_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_expiration_time bigint default null,
  p_user_agent text default null,
  p_tesseramento_id uuid default null,
  p_teacher_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_student_ok boolean := false;
  v_teacher_ok boolean := false;
  v_row public.push_subscriptions%rowtype;
begin
  if v_uid is null then
    raise exception 'Sessione non valida.';
  end if;

  if nullif(trim(coalesce(p_endpoint, '')), '') is null
     or nullif(trim(coalesce(p_p256dh, '')), '') is null
     or nullif(trim(coalesce(p_auth, '')), '') is null then
    raise exception 'Subscription push incompleta.';
  end if;

  if p_tesseramento_id is not null then
    select public.is_my_tesseramento(p_tesseramento_id) into v_student_ok;
    if not coalesce(v_student_ok, false) then
      raise exception 'Tesseramento non appartenente all''utente loggato.';
    end if;
  end if;

  if p_teacher_account_id is not null then
    select exists (
      select 1
      from public.app_teacher_accounts a
      where a.id = p_teacher_account_id
        and a.auth_user_id = v_uid
        and a.access_enabled = true
    ) into v_teacher_ok;

    if not coalesce(v_teacher_ok, false) then
      raise exception 'Account insegnante non appartenente all''utente loggato.';
    end if;
  end if;

  if not coalesce(v_student_ok, false) and not coalesce(v_teacher_ok, false) then
    raise exception 'Nessun profilo Orchidea valido associato alla subscription.';
  end if;

  insert into public.push_subscriptions (
    tesseramento_id,
    teacher_account_id,
    endpoint,
    p256dh,
    auth,
    expiration_time,
    user_agent,
    enabled,
    created_at,
    updated_at,
    last_seen_at
  ) values (
    case when v_student_ok then p_tesseramento_id else null end,
    case when v_teacher_ok then p_teacher_account_id else null end,
    p_endpoint,
    p_p256dh,
    p_auth,
    p_expiration_time,
    p_user_agent,
    true,
    now(),
    now(),
    now()
  )
  on conflict (endpoint) do update
  set
    tesseramento_id = excluded.tesseramento_id,
    teacher_account_id = excluded.teacher_account_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    expiration_time = excluded.expiration_time,
    user_agent = excluded.user_agent,
    enabled = true,
    updated_at = now(),
    last_seen_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'subscription_id', v_row.id,
    'tesseramento_id', v_row.tesseramento_id,
    'teacher_account_id', v_row.teacher_account_id,
    'enabled', v_row.enabled,
    'last_seen_at', v_row.last_seen_at
  );
end;
$$;

revoke all on function public.sync_my_push_subscription(text,text,text,bigint,text,uuid,uuid) from public;
grant execute on function public.sync_my_push_subscription(text,text,text,bigint,text,uuid,uuid) to authenticated;

-- 2) Elimina in sicurezza la subscription del dispositivo corrente.
create or replace function public.remove_my_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if auth.uid() is null then return false; end if;

  delete from public.push_subscriptions s
  where s.endpoint = p_endpoint
    and (
      (s.tesseramento_id is not null and public.is_my_tesseramento(s.tesseramento_id))
      or exists (
        select 1 from public.app_teacher_accounts a
        where a.id = s.teacher_account_id
          and a.auth_user_id = auth.uid()
          and a.access_enabled = true
      )
    );

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.remove_my_push_subscription(text) from public;
grant execute on function public.remove_my_push_subscription(text) to authenticated;

-- 3) Genera una notifica personale di test per l'utente loggato.
--    Non può essere indirizzata ad altri utenti.
create or replace function public.create_my_push_test_notification()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_notification uuid;
begin
  if auth.uid() is null then
    raise exception 'Sessione non valida.';
  end if;

  select mt.id
  into v_target
  from public.get_my_tesseramento() mt
  limit 1;

  if v_target is null then
    select p.tesseramento_id
    into v_target
    from public.app_teacher_accounts a
    join public.app_teacher_profiles p on p.id = a.profile_id
    where a.auth_user_id = auth.uid()
      and a.access_enabled = true
      and p.tesseramento_id is not null
    limit 1;
  end if;

  if v_target is null then
    raise exception 'Il tuo account non è collegato a un tesseramento Orchidea.';
  end if;

  insert into public.app_notifications (
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
    'Test notifiche Orchidea ✓',
    'Se leggi questa notifica, le push sul tuo telefono funzionano correttamente.',
    'important',
    'student',
    v_target,
    '/profilo',
    now(),
    auth.uid(),
    'push_test'
  )
  returning id into v_notification;

  return v_notification;
end;
$$;

revoke all on function public.create_my_push_test_notification() from public;
grant execute on function public.create_my_push_test_notification() to authenticated;
