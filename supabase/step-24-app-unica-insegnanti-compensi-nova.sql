-- Orchidea App - STEP 24
-- App insegnanti completa + compensi letti dalle stesse tabelle usate dal gestionale Nova.
-- Eseguire UNA SOLA VOLTA in Supabase > SQL Editor dopo gli step 21-23.

-- =========================================================
-- 1) L'insegnante puo' leggere il proprio profilo app/corsi
--    anche se il curriculum pubblico e' nascosto.
-- =========================================================

drop policy if exists "Allievi vedono profili app insegnanti" on public.app_teacher_profiles;
create policy "Profili app insegnanti leggibili"
on public.app_teacher_profiles
for select to authenticated
using (
  profilo_pubblico = true
  or public.is_admin()
  or exists (
    select 1
    from public.app_teacher_accounts a
    where a.profile_id = app_teacher_profiles.id
      and a.auth_user_id = auth.uid()
      and a.access_enabled = true
  )
);

drop policy if exists "Allievi vedono corsi profili app insegnanti" on public.app_teacher_profile_courses;
create policy "Corsi profili app insegnanti leggibili"
on public.app_teacher_profile_courses
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.app_teacher_profiles p
    where p.id = app_teacher_profile_courses.profile_id
      and p.profilo_pubblico = true
  )
  or exists (
    select 1
    from public.app_teacher_accounts a
    where a.profile_id = app_teacher_profile_courses.profile_id
      and a.auth_user_id = auth.uid()
      and a.access_enabled = true
  )
);

-- =========================================================
-- 2) Video: il docente vede i video pubblicati dei corsi
--    assegnati al suo profilo app.
-- =========================================================

drop policy if exists "Insegnante vede video dei propri corsi" on public.video_corsi;
create policy "Insegnante vede video dei propri corsi"
on public.video_corsi
for select to authenticated
using (
  pubblicato = true
  and exists (
    select 1
    from public.app_teacher_accounts a
    join public.app_teacher_profile_courses apc on apc.profile_id = a.profile_id
    where a.auth_user_id = auth.uid()
      and a.access_enabled = true
      and apc.corso_id = video_corsi.corso_id
  )
);

drop policy if exists "Insegnante legge storage video propri corsi" on storage.objects;
create policy "Insegnante legge storage video propri corsi"
on storage.objects
for select to authenticated
using (
  bucket_id = 'course-videos'
  and exists (
    select 1
    from public.video_corsi v
    join public.app_teacher_profile_courses apc on apc.corso_id = v.corso_id
    join public.app_teacher_accounts a on a.profile_id = apc.profile_id
    where v.storage_path = storage.objects.name
      and v.pubblicato = true
      and a.auth_user_id = auth.uid()
      and a.access_enabled = true
  )
);

-- =========================================================
-- 3) Risoluzione del profilo compensi Nova.
--    Evita il problema dei vecchi profili app collegati a un
--    insegnante duplicato senza corsi/quote.
-- =========================================================

create or replace function public.resolve_my_teacher_compensation_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account public.app_teacher_accounts%rowtype;
  v_profile public.app_teacher_profiles%rowtype;
  v_candidate uuid;
  v_name text;
begin
  select * into v_account
  from public.app_teacher_accounts a
  where a.auth_user_id = auth.uid()
    and a.access_enabled = true
  limit 1;

  if v_account.id is null then
    return null;
  end if;

  -- Se il collegamento configurato ha corsi attivi, e' quello corretto.
  if v_account.compensation_teacher_id is not null
     and exists (
       select 1 from public.insegnanti_corsi ic
       where ic.insegnante_id = v_account.compensation_teacher_id
         and ic.attivo is distinct from false
     ) then
    return v_account.compensation_teacher_id;
  end if;

  -- Fallback 1: stessa email del profilo Nova, privilegiando chi ha corsi attivi.
  select i.id into v_candidate
  from public.insegnanti i
  where i.attivo is distinct from false
    and lower(trim(coalesce(i.email, ''))) = lower(trim(coalesce(v_account.email, '')))
    and trim(coalesce(i.email, '')) <> ''
  order by (
    select count(*) from public.insegnanti_corsi ic
    where ic.insegnante_id = i.id and ic.attivo is distinct from false
  ) desc, i.created_at nulls last
  limit 1;

  if v_candidate is not null then
    return v_candidate;
  end if;

  select * into v_profile
  from public.app_teacher_profiles p
  where p.id = v_account.profile_id
  limit 1;

  v_name := lower(trim(regexp_replace(concat_ws(' ', v_profile.nome, v_profile.cognome), '\\s+', ' ', 'g')));

  -- Fallback 2: stesso nome/cognome del profilo Nova.
  select i.id into v_candidate
  from public.insegnanti i
  where i.attivo is distinct from false
    and lower(trim(regexp_replace(coalesce(i.nome, ''), '\\s+', ' ', 'g'))) = v_name
  order by (
    select count(*) from public.insegnanti_corsi ic
    where ic.insegnante_id = i.id and ic.attivo is distinct from false
  ) desc, i.created_at nulls last
  limit 1;

  if v_candidate is not null then
    return v_candidate;
  end if;

  -- Ultimo fallback: mantieni comunque il collegamento impostato dall'admin.
  return v_account.compensation_teacher_id;
end;
$$;

grant execute on function public.resolve_my_teacher_compensation_id() to authenticated;

-- Prova a correggere automaticamente i vecchi account app collegati a un
-- profilo insegnante duplicato senza corsi, usando email o nome del profilo.
with candidate as (
  select
    a.id as account_id,
    (
      select i.id
      from public.insegnanti i
      where i.attivo is distinct from false
        and exists (
          select 1 from public.insegnanti_corsi ic
          where ic.insegnante_id = i.id
            and ic.attivo is distinct from false
        )
        and (
          (
            trim(coalesce(a.email, '')) <> ''
            and lower(trim(coalesce(i.email, ''))) = lower(trim(a.email))
          )
          or lower(trim(regexp_replace(coalesce(i.nome, ''), '\s+', ' ', 'g'))) =
             lower(trim(regexp_replace(concat_ws(' ', p.nome, p.cognome), '\s+', ' ', 'g')))
        )
      order by (
        select count(*) from public.insegnanti_corsi ic2
        where ic2.insegnante_id = i.id and ic2.attivo is distinct from false
      ) desc
      limit 1
    ) as candidate_id
  from public.app_teacher_accounts a
  join public.app_teacher_profiles p on p.id = a.profile_id
  where a.access_enabled = true
    and (
      a.compensation_teacher_id is null
      or not exists (
        select 1 from public.insegnanti_corsi old_ic
        where old_ic.insegnante_id = a.compensation_teacher_id
          and old_ic.attivo is distinct from false
      )
    )
)
update public.app_teacher_accounts a
set compensation_teacher_id = c.candidate_id,
    updated_at = now()
from candidate c
where a.id = c.account_id
  and c.candidate_id is not null;

-- =========================================================
-- 4) Compensi mensili.
--    Replica la logica Nova/Admin:
--      - solo pagamenti corso pagati
--      - pagamento valido se copre il mese
--      - trimestrali/annuali divisi per i mesi di copertura
--      - quota importo / percentuale / default 40% diviso docenti
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
    select public.resolve_my_teacher_compensation_id() as teacher_id
  ),
  paid_payments as (
    select
      p.corso_id,
      p.importo,
      greatest(
        1,
        coalesce(
          nullif(p.copertura_mesi, 0),
          case p.billing_cycle
            when 'trimestrale' then 3
            when 'annuale' then 12
            else 1
          end,
          1
        )
      )::numeric as months_count
    from public.pagamenti p
    cross join params prm
    where p.stato = 'pagato'
      and p.tipo_quota = 'corso'
      and p.corso_id is not null
      and coalesce(p.periodo_inizio, p.scadenza, p.created_at::date) <= prm.month_end
      and coalesce(p.periodo_fine, p.scadenza, p.periodo_inizio, p.created_at::date) >= prm.month_start
  ),
  revenue_by_course as (
    select
      corso_id,
      sum(coalesce(importo, 0) / months_count)::numeric as revenue
    from paid_payments
    group by corso_id
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

-- Storico: usa la stessa funzione del mese, quindi non puo' divergere da Nova.
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

-- =========================================================
-- 5) Diagnostica utile per admin/docente.
--    Permette di controllare a quale profilo Nova e' collegato.
-- =========================================================

create or replace function public.get_my_teacher_compensation_source()
returns table (
  compensation_teacher_id uuid,
  compensation_teacher_name text,
  active_course_links bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.nome,
    count(ic.id)::bigint
  from public.insegnanti i
  left join public.insegnanti_corsi ic
    on ic.insegnante_id = i.id
   and ic.attivo is distinct from false
  where i.id = public.resolve_my_teacher_compensation_id()
  group by i.id, i.nome;
$$;

grant execute on function public.get_my_teacher_compensation_source() to authenticated;

-- =========================================================
-- 6) Notifiche push anche per gli insegnanti.
--    Le push "Tutti" arrivano anche ai docenti; quelle personali
--    allievo/corso continuano a usare tesseramento_id.
-- =========================================================

alter table public.push_subscriptions
  alter column tesseramento_id drop not null;
alter table public.push_subscriptions
  add column if not exists teacher_account_id uuid references public.app_teacher_accounts(id) on delete cascade;

create index if not exists push_subscriptions_teacher_idx
  on public.push_subscriptions(teacher_account_id, enabled);

grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop policy if exists "Insegnante vede proprie subscription push" on public.push_subscriptions;
create policy "Insegnante vede proprie subscription push"
on public.push_subscriptions for select to authenticated
using (
  exists (
    select 1 from public.app_teacher_accounts a
    where a.id = push_subscriptions.teacher_account_id
      and a.auth_user_id = auth.uid()
      and a.access_enabled = true
  )
);

drop policy if exists "Insegnante inserisce propria subscription push" on public.push_subscriptions;
create policy "Insegnante inserisce propria subscription push"
on public.push_subscriptions for insert to authenticated
with check (
  exists (
    select 1 from public.app_teacher_accounts a
    where a.id = push_subscriptions.teacher_account_id
      and a.auth_user_id = auth.uid()
      and a.access_enabled = true
  )
);

drop policy if exists "Insegnante aggiorna propria subscription push" on public.push_subscriptions;
create policy "Insegnante aggiorna propria subscription push"
on public.push_subscriptions for update to authenticated
using (
  exists (
    select 1 from public.app_teacher_accounts a
    where a.id = push_subscriptions.teacher_account_id
      and a.auth_user_id = auth.uid()
      and a.access_enabled = true
  )
)
with check (
  exists (
    select 1 from public.app_teacher_accounts a
    where a.id = push_subscriptions.teacher_account_id
      and a.auth_user_id = auth.uid()
      and a.access_enabled = true
  )
);

drop policy if exists "Insegnante elimina propria subscription push" on public.push_subscriptions;
create policy "Insegnante elimina propria subscription push"
on public.push_subscriptions for delete to authenticated
using (
  exists (
    select 1 from public.app_teacher_accounts a
    where a.id = push_subscriptions.teacher_account_id
      and a.auth_user_id = auth.uid()
      and a.access_enabled = true
  )
);

-- Stato letto/non letto delle notifiche anche per i docenti.
alter table public.app_notification_reads
  alter column tesseramento_id drop not null;
alter table public.app_notification_reads
  add column if not exists teacher_account_id uuid references public.app_teacher_accounts(id) on delete cascade;

create unique index if not exists app_notification_reads_teacher_unique
  on public.app_notification_reads(teacher_account_id, notification_key);

drop policy if exists "Insegnante gestisce letture notifiche" on public.app_notification_reads;
create policy "Insegnante gestisce letture notifiche"
on public.app_notification_reads for all to authenticated
using (
  exists (
    select 1 from public.app_teacher_accounts a
    where a.id = app_notification_reads.teacher_account_id
      and a.auth_user_id = auth.uid()
      and a.access_enabled = true
  )
)
with check (
  exists (
    select 1 from public.app_teacher_accounts a
    where a.id = app_notification_reads.teacher_account_id
      and a.auth_user_id = auth.uid()
      and a.access_enabled = true
  )
);
