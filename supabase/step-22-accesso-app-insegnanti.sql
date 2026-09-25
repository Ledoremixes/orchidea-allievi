-- Orchidea Allievi - Step 22
-- Primo accesso direttamente dall'app + area insegnanti con compensi mensili.
-- Esegui una sola volta in Supabase > SQL Editor.

create extension if not exists pgcrypto;

-- =========================================================
-- 1) PRIMO ACCESSO ALLIEVI
-- =========================================================

alter table public.tesseramenti
  add column if not exists app_access_initialized_at timestamptz;

-- Segniamo come gia' inizializzati solo gli account che hanno realmente effettuato almeno un accesso.
update public.tesseramenti t
set app_access_initialized_at = coalesce(t.app_access_initialized_at, now())
from auth.users u
where t.auth_user_id = u.id
  and u.last_sign_in_at is not null
  and t.app_access_initialized_at is null;

create or replace function public.verify_student_first_access(p_email text, p_cf text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.tesseramenti%rowtype;
begin
  select * into v_row
  from public.tesseramenti t
  where lower(trim(t.email)) = lower(trim(coalesce(p_email, '')))
    and upper(regexp_replace(coalesce(t.cf, ''), '\s+', '', 'g')) = upper(regexp_replace(coalesce(p_cf, ''), '\s+', '', 'g'))
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'status', 'not_found');
  end if;

  if v_row.auth_user_id is not null or v_row.app_access_initialized_at is not null then
    return jsonb_build_object('ok', false, 'status', 'already_registered');
  end if;

  return jsonb_build_object('ok', true, 'status', 'eligible');
end;
$$;

revoke all on function public.verify_student_first_access(text, text) from public;
grant execute on function public.verify_student_first_access(text, text) to anon, authenticated;

-- Aggiorna il trigger gia' usato dall'app: quando il primo accesso crea auth.users,
-- colleghiamo il tesseramento e segniamo il setup password come completato.
create or replace function public.link_auth_user_to_orchidea_tesseramento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tesseramenti
  set auth_user_id = new.id,
      app_access_initialized_at = coalesce(app_access_initialized_at, now())
  where auth_user_id is null
    and lower(trim(email)) = lower(trim(new.email));

  return new;
end;
$$;

-- =========================================================
-- 2) ACCOUNT APP INSEGNANTI
-- =========================================================

create table if not exists public.app_teacher_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.app_teacher_profiles(id) on delete cascade,
  compensation_teacher_id uuid references public.insegnanti(id) on delete set null,
  email text not null,
  telefono text,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  access_enabled boolean not null default true,
  access_initialized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists app_teacher_accounts_email_unique
  on public.app_teacher_accounts (lower(trim(email)));
create index if not exists app_teacher_accounts_profile_idx
  on public.app_teacher_accounts(profile_id);
create index if not exists app_teacher_accounts_compensation_idx
  on public.app_teacher_accounts(compensation_teacher_id);
create index if not exists app_teacher_accounts_auth_idx
  on public.app_teacher_accounts(auth_user_id);

alter table public.app_teacher_accounts enable row level security;

grant select, insert, update, delete on public.app_teacher_accounts to authenticated;

drop policy if exists "Admin gestisce account app insegnanti" on public.app_teacher_accounts;
create policy "Admin gestisce account app insegnanti"
on public.app_teacher_accounts for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Insegnante vede il proprio account app" on public.app_teacher_accounts;
create policy "Insegnante vede il proprio account app"
on public.app_teacher_accounts for select to authenticated
using (auth.uid() = auth_user_id and access_enabled = true);

-- Rende la tabella gestionale insegnanti scrivibile solo dagli admin.
-- La lettura dei compensi per il docente passa invece dalle RPC security definer qui sotto.
drop policy if exists "Admin può gestire insegnanti" on public.insegnanti;
create policy "Admin può gestire insegnanti"
on public.insegnanti for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admin può gestire collegamenti insegnanti corsi" on public.insegnanti_corsi;
create policy "Admin può gestire collegamenti insegnanti corsi"
on public.insegnanti_corsi for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.link_auth_user_to_orchidea_teacher_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.app_teacher_accounts
  set auth_user_id = new.id,
      access_initialized_at = coalesce(access_initialized_at, now()),
      updated_at = now()
  where auth_user_id is null
    and access_enabled = true
    and lower(trim(email)) = lower(trim(new.email));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_link_orchidea_teacher on auth.users;
create trigger on_auth_user_created_link_orchidea_teacher
after insert on auth.users
for each row execute function public.link_auth_user_to_orchidea_teacher_account();

-- Collega eventuali account auth gia' esistenti.
update public.app_teacher_accounts a
set auth_user_id = u.id,
    access_initialized_at = case when u.last_sign_in_at is not null then coalesce(a.access_initialized_at, now()) else a.access_initialized_at end,
    updated_at = now()
from auth.users u
where a.auth_user_id is null
  and lower(trim(a.email)) = lower(trim(u.email));

create or replace function public.verify_teacher_first_access(p_email text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.app_teacher_accounts%rowtype;
  v_phone_input text;
  v_phone_saved text;
begin
  v_phone_input := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');

  select * into v_row
  from public.app_teacher_accounts a
  where lower(trim(a.email)) = lower(trim(coalesce(p_email, '')))
    and a.access_enabled = true
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'status', 'not_found');
  end if;

  v_phone_saved := regexp_replace(coalesce(v_row.telefono, ''), '[^0-9]', '', 'g');
  if v_phone_input = '' or v_phone_saved = '' or right(v_phone_input, 9) <> right(v_phone_saved, 9) then
    return jsonb_build_object('ok', false, 'status', 'not_found');
  end if;

  if v_row.auth_user_id is not null or v_row.access_initialized_at is not null then
    return jsonb_build_object('ok', false, 'status', 'already_registered');
  end if;

  return jsonb_build_object('ok', true, 'status', 'eligible');
end;
$$;

revoke all on function public.verify_teacher_first_access(text, text) from public;
grant execute on function public.verify_teacher_first_access(text, text) to anon, authenticated;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_teacher_accounts a
    where a.auth_user_id = auth.uid()
      and a.access_enabled = true
  );
$$;

grant execute on function public.is_teacher() to authenticated;

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
    p.bio
  from public.app_teacher_accounts a
  join public.app_teacher_profiles p on p.id = a.profile_id
  where a.auth_user_id = auth.uid()
    and a.access_enabled = true
  limit 1;
$$;

grant execute on function public.get_my_teacher_account() to authenticated;

-- =========================================================
-- 3) COMPENSI MESE PER MESE - SOLO IL PROPRIO DOCENTE
-- =========================================================

create or replace function public.get_my_teacher_compensation(p_month text default to_char(current_date, 'YYYY-MM'))
returns table (
  corso_id uuid,
  corso_nome text,
  corso_livello text,
  giorno_settimana text,
  ora_inizio time,
  ora_fine time,
  incasso_corso numeric,
  compenso numeric,
  quota_tipo text,
  quota_valore numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      to_date(coalesce(nullif(p_month, ''), to_char(current_date, 'YYYY-MM')) || '-01', 'YYYY-MM-DD')::date as month_start,
      (to_date(coalesce(nullif(p_month, ''), to_char(current_date, 'YYYY-MM')) || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date as month_end
  ),
  my_teacher as (
    select a.compensation_teacher_id as teacher_id
    from public.app_teacher_accounts a
    where a.auth_user_id = auth.uid()
      and a.access_enabled = true
      and a.compensation_teacher_id is not null
    limit 1
  ),
  revenue_by_course as (
    select
      p.corso_id,
      sum(
        case
          when coalesce(p.copertura_mesi, 1) > 1 then coalesce(p.importo, 0) / coalesce(nullif(p.copertura_mesi, 0), 1)
          else coalesce(p.importo, 0)
        end
      )::numeric as revenue
    from public.pagamenti p, params prm
    where p.stato = 'pagato'
      and p.tipo_quota = 'corso'
      and p.corso_id is not null
      and coalesce(p.periodo_inizio, p.scadenza, p.created_at::date) <= prm.month_end
      and coalesce(p.periodo_fine, p.scadenza, p.periodo_inizio, p.created_at::date) >= prm.month_start
    group by p.corso_id
  ),
  assignment_counts as (
    select corso_id, count(*)::numeric as teacher_count
    from public.insegnanti_corsi
    where attivo is distinct from false
    group by corso_id
  )
  select
    c.id as corso_id,
    c.nome as corso_nome,
    c.livello as corso_livello,
    c.giorno_settimana,
    c.ora_inizio,
    c.ora_fine,
    round(coalesce(r.revenue, 0), 2) as incasso_corso,
    round(
      case
        when ic.quota_tipo = 'importo' and coalesce(ic.quota_valore, 0) > 0
          then ic.quota_valore
        when ic.quota_tipo = 'percentuale' and coalesce(ic.quota_valore, 0) > 0
          then coalesce(r.revenue, 0) * (ic.quota_valore / 100.0)
        else coalesce(r.revenue, 0) * 0.40 / greatest(coalesce(ac.teacher_count, 1), 1)
      end,
      2
    ) as compenso,
    ic.quota_tipo,
    ic.quota_valore
  from public.insegnanti_corsi ic
  join my_teacher mt on mt.teacher_id = ic.insegnante_id
  join public.corsi c on c.id = ic.corso_id
  left join revenue_by_course r on r.corso_id = c.id
  left join assignment_counts ac on ac.corso_id = c.id
  where ic.attivo is distinct from false
  order by c.giorno_settimana nulls last, c.ora_inizio nulls last, c.nome;
$$;

grant execute on function public.get_my_teacher_compensation(text) to authenticated;

create or replace function public.get_my_teacher_compensation_history(p_months integer default 12)
returns table (
  mese text,
  totale numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count integer := greatest(1, least(coalesce(p_months, 12), 24));
  v_index integer;
  v_month date;
  v_total numeric;
begin
  for v_index in 0..(v_count - 1) loop
    v_month := (date_trunc('month', current_date) - make_interval(months => v_index))::date;

    select coalesce(sum(x.compenso), 0)
    into v_total
    from public.get_my_teacher_compensation(to_char(v_month, 'YYYY-MM')) x;

    mese := to_char(v_month, 'YYYY-MM');
    totale := round(coalesce(v_total, 0), 2);
    return next;
  end loop;
end;
$$;

grant execute on function public.get_my_teacher_compensation_history(integer) to authenticated;
