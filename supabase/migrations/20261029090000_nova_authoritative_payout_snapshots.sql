-- Nova is authoritative for compensation figures; Orchidea Allievi never recalculates them.
-- A trusted Nova server endpoint writes these monthly snapshots using its service role.
create table if not exists public.nova_teacher_payout_snapshots (
  teacher_id uuid not null references public.insegnanti(id) on delete cascade,
  mese text not null check (mese ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  totale numeric(12,2) not null check (totale >= 0),
  breakdown jsonb not null default '[]'::jsonb check (jsonb_typeof(breakdown) = 'array'),
  synced_at timestamptz not null default now(),
  primary key (teacher_id, mese)
);

alter table public.nova_teacher_payout_snapshots enable row level security;
revoke all on public.nova_teacher_payout_snapshots from anon, authenticated;
-- No public read/write policy: only service_role writes; authenticated users read via scoped RPC.

create or replace function public.get_my_teacher_payout_snapshot(p_month text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_snapshot public.nova_teacher_payout_snapshots%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Autenticazione obbligatoria' using errcode='42501';
  end if;

  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Mese non valido';
  end if;

  v_teacher_id := public.resolve_my_teacher_compensation_id();
  if v_teacher_id is null then
    return jsonb_build_object('status','teacher_not_linked','mese',p_month);
  end if;

  select * into v_snapshot
  from public.nova_teacher_payout_snapshots
  where teacher_id = v_teacher_id and mese = p_month;

  if not found then
    return jsonb_build_object('status','not_synced','mese',p_month);
  end if;

  return jsonb_build_object(
    'status', 'synced',
    'mese', v_snapshot.mese,
    'totale', v_snapshot.totale,
    'breakdown', v_snapshot.breakdown,
    'synced_at', v_snapshot.synced_at
  );
end;
$$;

revoke all on function public.get_my_teacher_payout_snapshot(text) from public, anon;
grant execute on function public.get_my_teacher_payout_snapshot(text) to authenticated;

create or replace function public.get_my_teacher_payout_history(p_months integer default 12)
returns table(mese text, totale numeric, sincronizzato boolean, synced_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select
    to_char(m.mese, 'YYYY-MM') as mese,
    s.totale,
    (s.teacher_id is not null) as sincronizzato,
    s.synced_at
  from generate_series(
    date_trunc('month', (now() at time zone 'Europe/Rome')::date),
    date_trunc('month', (now() at time zone 'Europe/Rome')::date)
      - make_interval(months => greatest(1, least(coalesce(p_months,12),24)) - 1),
    interval '-1 month'
  ) m(mese)
  left join public.nova_teacher_payout_snapshots s
    on s.mese = to_char(m.mese, 'YYYY-MM')
   and s.teacher_id = public.resolve_my_teacher_compensation_id()
  where auth.uid() is not null
  order by m.mese desc;
$$;

revoke all on function public.get_my_teacher_payout_history(integer) from public, anon;
grant execute on function public.get_my_teacher_payout_history(integer) to authenticated;
