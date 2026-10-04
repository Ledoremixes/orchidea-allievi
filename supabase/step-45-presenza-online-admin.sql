-- Orchidea App - STEP 45
-- Presenza utenti: heartbeat dall'app + elenco online/recenti visibile solo agli admin.

create table if not exists public.app_user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tesseramento_id uuid references public.tesseramenti(id) on delete set null,
  teacher_account_id uuid references public.app_teacher_accounts(id) on delete set null,
  display_name text,
  email text,
  user_type text not null default 'account',
  current_path text,
  app_visible boolean not null default true,
  session_started_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists app_user_presence_last_seen_idx
  on public.app_user_presence(last_seen desc);
create index if not exists app_user_presence_visible_idx
  on public.app_user_presence(app_visible, last_seen desc);

alter table public.app_user_presence enable row level security;

-- Nessun utente legge/scrive direttamente la tabella: si passa dalle RPC.
revoke all on public.app_user_presence from anon, authenticated;

drop policy if exists "Admin legge presenza app" on public.app_user_presence;
create policy "Admin legge presenza app"
on public.app_user_presence for select to authenticated
using (public.is_admin());

create or replace function public.app_presence_heartbeat(
  p_path text default '/',
  p_visible boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_student_id uuid;
  v_student_name text;
  v_student_email text;
  v_teacher_account_id uuid;
  v_teacher_name text;
  v_teacher_email text;
  v_profile_role text;
  v_profile_name text;
  v_profile_email text;
  v_type text := 'account';
  v_name text;
  v_email text;
begin
  if v_uid is null then
    raise exception 'Sessione non valida';
  end if;

  select mt.id,
         nullif(trim(concat_ws(' ', mt.nome, mt.cognome)), ''),
         mt.email
    into v_student_id, v_student_name, v_student_email
  from public.get_my_tesseramento() mt
  limit 1;

  select a.id,
         nullif(trim(concat_ws(' ', p.nome, p.cognome)), ''),
         a.email
    into v_teacher_account_id, v_teacher_name, v_teacher_email
  from public.app_teacher_accounts a
  join public.app_teacher_profiles p on p.id = a.profile_id
  where a.auth_user_id = v_uid
    and a.access_enabled = true
  limit 1;

  select pr.role, pr.display_name, pr.email
    into v_profile_role, v_profile_name, v_profile_email
  from public.profiles pr
  where pr.user_id = v_uid
  limit 1;

  if lower(coalesce(v_profile_role, '')) = 'admin' then
    v_type := 'admin';
    v_name := coalesce(nullif(trim(v_profile_name), ''), v_student_name, v_teacher_name, auth.jwt() ->> 'email', 'Admin Orchidea');
    v_email := coalesce(v_profile_email, v_student_email, v_teacher_email, auth.jwt() ->> 'email');
  elsif v_teacher_account_id is not null then
    v_type := 'teacher';
    v_name := coalesce(v_teacher_name, v_student_name, auth.jwt() ->> 'email', 'Insegnante Orchidea');
    v_email := coalesce(v_teacher_email, v_student_email, auth.jwt() ->> 'email');
  elsif v_student_id is not null then
    v_type := 'student';
    v_name := coalesce(v_student_name, auth.jwt() ->> 'email', 'Allievo Orchidea');
    v_email := coalesce(v_student_email, auth.jwt() ->> 'email');
  else
    v_type := 'account';
    v_name := coalesce(nullif(trim(v_profile_name), ''), auth.jwt() ->> 'email', 'Account Orchidea');
    v_email := coalesce(v_profile_email, auth.jwt() ->> 'email');
  end if;

  insert into public.app_user_presence (
    user_id, tesseramento_id, teacher_account_id, display_name, email,
    user_type, current_path, app_visible, session_started_at, last_seen
  ) values (
    v_uid, v_student_id, v_teacher_account_id, v_name, v_email,
    v_type, left(coalesce(nullif(trim(p_path), ''), '/'), 240), coalesce(p_visible, true), now(), now()
  )
  on conflict (user_id) do update set
    tesseramento_id = excluded.tesseramento_id,
    teacher_account_id = excluded.teacher_account_id,
    display_name = excluded.display_name,
    email = excluded.email,
    user_type = excluded.user_type,
    current_path = excluded.current_path,
    app_visible = excluded.app_visible,
    session_started_at = case
      when public.app_user_presence.last_seen < now() - interval '5 minutes' then now()
      else public.app_user_presence.session_started_at
    end,
    last_seen = now();

  return jsonb_build_object('ok', true, 'user_type', v_type, 'last_seen', now());
end;
$$;

grant execute on function public.app_presence_heartbeat(text, boolean) to authenticated;

create or replace function public.app_presence_set_offline()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  update public.app_user_presence
     set app_visible = false,
         last_seen = now()
   where user_id = auth.uid();
end;
$$;

grant execute on function public.app_presence_set_offline() to authenticated;

create or replace function public.get_app_presence_admin()
returns table (
  user_id uuid,
  tesseramento_id uuid,
  teacher_account_id uuid,
  display_name text,
  email text,
  user_type text,
  current_path text,
  app_visible boolean,
  session_started_at timestamptz,
  last_seen timestamptz,
  online boolean,
  seconds_ago integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Operazione riservata agli amministratori';
  end if;

  return query
  select p.user_id,
         p.tesseramento_id,
         p.teacher_account_id,
         p.display_name,
         p.email,
         p.user_type,
         p.current_path,
         p.app_visible,
         p.session_started_at,
         p.last_seen,
         (p.app_visible = true and p.last_seen >= now() - interval '90 seconds') as online,
         greatest(0, floor(extract(epoch from (now() - p.last_seen)))::integer) as seconds_ago
  from public.app_user_presence p
  where p.last_seen >= now() - interval '30 minutes'
  order by
    (p.app_visible = true and p.last_seen >= now() - interval '90 seconds') desc,
    p.last_seen desc;
end;
$$;

grant execute on function public.get_app_presence_admin() to authenticated;
