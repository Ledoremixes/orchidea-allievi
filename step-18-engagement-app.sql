-- Orchidea Allievi - Step 18
-- Funzioni engagement: notifiche, Rewards, richieste prova, profili insegnanti e modalità club.
-- Esegui una sola volta in Supabase > SQL Editor.

-- =========================================================
-- 1) PROFILI PUBBLICI INSEGNANTI
-- =========================================================
create table if not exists public.insegnanti (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text,
  telefono text,
  attivo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.insegnanti add column if not exists bio text;
alter table public.insegnanti add column if not exists foto_url text;
alter table public.insegnanti add column if not exists instagram_url text;
alter table public.insegnanti add column if not exists specialita text;
alter table public.insegnanti add column if not exists profilo_pubblico boolean not null default true;

alter table public.insegnanti enable row level security;
grant select on public.insegnanti to authenticated;

drop policy if exists "Allievi vedono profili insegnanti" on public.insegnanti;
create policy "Allievi vedono profili insegnanti"
on public.insegnanti for select to authenticated
using (attivo = true and profilo_pubblico = true);

-- La policy admin può già esistere dallo step insegnanti: la ricreiamo in modo sicuro.
drop policy if exists "Admin può gestire insegnanti" on public.insegnanti;
create policy "Admin può gestire insegnanti"
on public.insegnanti for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- Permette agli allievi di vedere quali insegnanti sono collegati ai corsi.
do $$
begin
  if to_regclass('public.insegnanti_corsi') is not null then
    execute 'grant select on public.insegnanti_corsi to authenticated';
    execute 'alter table public.insegnanti_corsi enable row level security';
    execute 'drop policy if exists "Allievi vedono insegnanti dei corsi" on public.insegnanti_corsi';
    execute $policy$
      create policy "Allievi vedono insegnanti dei corsi"
      on public.insegnanti_corsi for select to authenticated
      using (attivo = true)
    $policy$;
  end if;
end $$;

-- =========================================================
-- 2) NOTIFICHE APP
-- =========================================================
create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null default 'news' check (category in ('news','course','event','payment','video','important')),
  audience text not null default 'all' check (audience in ('all','corsisti','course')),
  course_id uuid references public.corsi(id) on delete cascade,
  link text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index if not exists app_notifications_dates_idx on public.app_notifications(starts_at desc, expires_at);
create index if not exists app_notifications_course_idx on public.app_notifications(course_id);

alter table public.app_notifications enable row level security;
grant select on public.app_notifications to authenticated;
grant insert, update, delete on public.app_notifications to authenticated;

drop policy if exists "Admin gestisce notifiche app" on public.app_notifications;
create policy "Admin gestisce notifiche app"
on public.app_notifications for all to authenticated
using (public.is_admin()) with check (public.is_admin());

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
        where (t.auth_user_id = auth.uid() or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email',''))))
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
          and ic.stato = 'attivo'
          and (t.auth_user_id = auth.uid() or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email',''))))
      )
    )
  )
);

create table if not exists public.app_notification_reads (
  id uuid primary key default gen_random_uuid(),
  tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  notification_key text not null,
  read_at timestamptz not null default now(),
  unique (tesseramento_id, notification_key)
);

alter table public.app_notification_reads enable row level security;
grant select, insert, delete on public.app_notification_reads to authenticated;

drop policy if exists "Allievo gestisce letture notifiche" on public.app_notification_reads;
create policy "Allievo gestisce letture notifiche"
on public.app_notification_reads for all to authenticated
using (
  exists (
    select 1 from public.tesseramenti t
    where t.id = app_notification_reads.tesseramento_id
      and (t.auth_user_id = auth.uid() or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email',''))))
  )
)
with check (
  exists (
    select 1 from public.tesseramenti t
    where t.id = app_notification_reads.tesseramento_id
      and (t.auth_user_id = auth.uid() or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email',''))))
  )
);

-- =========================================================
-- 3) ORCHIDEA REWARDS
-- =========================================================
create table if not exists public.reward_catalog (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  points_cost integer not null check (points_cost > 0),
  stock integer,
  active boolean not null default true,
  icon text default '✦',
  created_at timestamptz not null default now()
);

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.reward_catalog(id) on delete restrict,
  tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  points_spent integer not null,
  status text not null default 'requested' check (status in ('requested','approved','fulfilled','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reward_redemptions_student_idx on public.reward_redemptions(tesseramento_id, requested_at desc);

alter table public.reward_catalog enable row level security;
alter table public.reward_redemptions enable row level security;
grant select on public.reward_catalog to authenticated;
grant select on public.reward_redemptions to authenticated;
grant insert, update, delete on public.reward_catalog to authenticated;
grant update on public.reward_redemptions to authenticated;

drop policy if exists "Allievi vedono premi attivi" on public.reward_catalog;
create policy "Allievi vedono premi attivi"
on public.reward_catalog for select to authenticated using (active = true);

drop policy if exists "Admin gestisce catalogo premi" on public.reward_catalog;
create policy "Admin gestisce catalogo premi"
on public.reward_catalog for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Allievo vede i propri riscatti" on public.reward_redemptions;
create policy "Allievo vede i propri riscatti"
on public.reward_redemptions for select to authenticated
using (
  exists (
    select 1 from public.tesseramenti t
    where t.id = reward_redemptions.tesseramento_id
      and (t.auth_user_id = auth.uid() or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email',''))))
  )
);

drop policy if exists "Admin gestisce riscatti" on public.reward_redemptions;
create policy "Admin gestisce riscatti"
on public.reward_redemptions for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.get_my_reward_summary()
returns table (
  lessons_count integer,
  event_rsvps integer,
  earned_points integer,
  spent_points integer,
  balance_points integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  student_id uuid;
  lessons integer := 0;
  rsvps integer := 0;
  spent integer := 0;
begin
  select t.id into student_id
  from public.tesseramenti t
  where t.auth_user_id = auth.uid()
     or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
  order by (t.auth_user_id = auth.uid()) desc
  limit 1;

  if student_id is null then
    return query select 0,0,0,0,0;
    return;
  end if;

  select count(*)::integer into lessons from public.presenze_corsi p where p.tesseramento_id = student_id;
  select count(*)::integer into rsvps from public.event_partecipazioni ep where ep.tesseramento_id = student_id;
  select coalesce(sum(rr.points_spent),0)::integer into spent
  from public.reward_redemptions rr
  where rr.tesseramento_id = student_id and rr.status in ('requested','approved','fulfilled');

  return query
  select lessons, rsvps, (lessons * 10 + rsvps * 2), spent, greatest(0, lessons * 10 + rsvps * 2 - spent);
end;
$$;

grant execute on function public.get_my_reward_summary() to authenticated;

create or replace function public.claim_reward(p_reward_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  student_id uuid;
  reward_row public.reward_catalog%rowtype;
  earned integer := 0;
  spent integer := 0;
  balance integer := 0;
  used_stock integer := 0;
  redemption_id uuid;
begin
  select t.id into student_id
  from public.tesseramenti t
  where t.auth_user_id = auth.uid()
     or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email','')))
  order by (t.auth_user_id = auth.uid()) desc
  limit 1;

  if student_id is null then
    return jsonb_build_object('ok', false, 'message', 'Profilo allievo non trovato.');
  end if;

  select * into reward_row from public.reward_catalog where id = p_reward_id and active = true for update;
  if reward_row.id is null then
    return jsonb_build_object('ok', false, 'message', 'Premio non disponibile.');
  end if;

  if reward_row.stock is not null then
    select count(*)::integer into used_stock
    from public.reward_redemptions
    where reward_id = p_reward_id and status in ('requested','approved','fulfilled');
    if used_stock >= reward_row.stock then
      return jsonb_build_object('ok', false, 'message', 'Premio esaurito.');
    end if;
  end if;

  select count(*)::integer * 10 into earned from public.presenze_corsi where tesseramento_id = student_id;
  earned := earned + (select count(*)::integer * 2 from public.event_partecipazioni where tesseramento_id = student_id);
  select coalesce(sum(points_spent),0)::integer into spent
  from public.reward_redemptions
  where tesseramento_id = student_id and status in ('requested','approved','fulfilled');
  balance := greatest(0, earned - spent);

  if balance < reward_row.points_cost then
    return jsonb_build_object('ok', false, 'message', 'Non hai ancora abbastanza Orchidea Points.', 'balance', balance);
  end if;

  insert into public.reward_redemptions(reward_id, tesseramento_id, points_spent)
  values (p_reward_id, student_id, reward_row.points_cost)
  returning id into redemption_id;

  return jsonb_build_object('ok', true, 'message', 'Premio richiesto! La segreteria lo troverà nel pannello admin.', 'redemption_id', redemption_id, 'balance', balance - reward_row.points_cost);
end;
$$;

grant execute on function public.claim_reward(uuid) to authenticated;

-- Premi iniziali: puoi modificarli dal pannello admin.
insert into public.reward_catalog(title, description, points_cost, stock, icon)
select * from (values
  ('Guardaroba omaggio', 'Un utilizzo gratuito del guardaroba in una serata standard.', 120, null::integer, '🧥'),
  ('Acqua o bibita', 'Una consumazione analcolica selezionata al bar.', 180, null::integer, '🥤'),
  ('Ingresso serata', 'Un ingresso omaggio a una serata standard, eventi speciali esclusi.', 350, null::integer, '🎟')
) as seed(title, description, points_cost, stock, icon)
where not exists (select 1 from public.reward_catalog);

-- =========================================================
-- 4) RICHIESTE PROVA ALTRI CORSI
-- =========================================================
create table if not exists public.course_trial_requests (
  id uuid primary key default gen_random_uuid(),
  tesseramento_id uuid not null references public.tesseramenti(id) on delete cascade,
  corso_id uuid not null references public.corsi(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested','contacted','booked','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tesseramento_id, corso_id)
);

alter table public.course_trial_requests enable row level security;
grant select, insert, update on public.course_trial_requests to authenticated;

drop policy if exists "Allievo gestisce richieste prova" on public.course_trial_requests;
create policy "Allievo gestisce richieste prova"
on public.course_trial_requests for all to authenticated
using (
  exists (
    select 1 from public.tesseramenti t
    where t.id = course_trial_requests.tesseramento_id
      and (t.auth_user_id = auth.uid() or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email',''))))
  )
)
with check (
  exists (
    select 1 from public.tesseramenti t
    where t.id = course_trial_requests.tesseramento_id
      and (t.auth_user_id = auth.uid() or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email',''))))
  )
);

drop policy if exists "Admin gestisce richieste prova" on public.course_trial_requests;
create policy "Admin gestisce richieste prova"
on public.course_trial_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =========================================================
-- 5) IMPOSTAZIONI MODALITÀ CLUB
-- =========================================================
insert into public.app_settings(key, value, updated_at)
values ('bar_menu_url', '""'::jsonb, now())
on conflict (key) do nothing;
