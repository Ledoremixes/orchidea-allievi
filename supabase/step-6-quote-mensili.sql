-- ============================================================
-- ORCHIDEA ALLIEVI - STEP 6
-- Quote mensili / trimestrali / annuali e situazione segreteria
-- ============================================================

-- 1) Iscrizioni: ogni corso dell'allievo può avere una formula pagamento
alter table public.iscrizioni_corsi
add column if not exists tariffa_mensile numeric(10,2),
add column if not exists tipo_pagamento text default 'mensile',
add column if not exists data_inizio date default current_date,
add column if not exists data_fine date,
add column if not exists rinnovo_attivo boolean default true,
add column if not exists updated_at timestamp with time zone default now();

alter table public.iscrizioni_corsi
drop constraint if exists iscrizioni_corsi_tipo_pagamento_check;

alter table public.iscrizioni_corsi
add constraint iscrizioni_corsi_tipo_pagamento_check
check (tipo_pagamento in ('mensile', 'trimestrale', 'annuale'));

-- Backfill: se avevi già iscrizioni, prendiamo il prezzo del corso come tariffa mensile
update public.iscrizioni_corsi ic
set
  tariffa_mensile = coalesce(ic.tariffa_mensile, c.prezzo_mensile, 0),
  tipo_pagamento = coalesce(ic.tipo_pagamento, 'mensile'),
  data_inizio = coalesce(ic.data_inizio, ic.data_iscrizione, ic.created_at::date, current_date),
  rinnovo_attivo = coalesce(ic.rinnovo_attivo, ic.stato = 'attivo')
from public.corsi c
where c.id = ic.corso_id;

-- 2) Pagamenti: colleghiamo la quota al corso/iscrizione e alla copertura temporale
alter table public.pagamenti
add column if not exists corso_id uuid references public.corsi(id) on delete set null,
add column if not exists iscrizione_id uuid references public.iscrizioni_corsi(id) on delete set null,
add column if not exists tipo_quota text default 'extra',
add column if not exists billing_cycle text default 'una_tantum',
add column if not exists periodo_inizio date,
add column if not exists periodo_fine date,
add column if not exists copertura_mesi integer default 1,
add column if not exists note text,
add column if not exists updated_at timestamp with time zone default now();

alter table public.pagamenti
drop constraint if exists pagamenti_tipo_quota_check;

alter table public.pagamenti
add constraint pagamenti_tipo_quota_check
check (tipo_quota in ('corso', 'tessera', 'extra', 'evento'));

alter table public.pagamenti
drop constraint if exists pagamenti_billing_cycle_check;

alter table public.pagamenti
add constraint pagamenti_billing_cycle_check
check (billing_cycle in ('mensile', 'trimestrale', 'annuale', 'una_tantum'));

alter table public.pagamenti
drop constraint if exists pagamenti_copertura_mesi_check;

alter table public.pagamenti
add constraint pagamenti_copertura_mesi_check
check (copertura_mesi >= 1);

-- Backfill pagamenti vecchi: li lasciamo come extra/manuali, senza rompere nulla
update public.pagamenti
set
  tipo_quota = coalesce(tipo_quota, 'extra'),
  billing_cycle = coalesce(billing_cycle, 'una_tantum'),
  periodo_inizio = coalesce(periodo_inizio, scadenza, created_at::date),
  periodo_fine = coalesce(periodo_fine, scadenza, created_at::date),
  copertura_mesi = coalesce(copertura_mesi, 1)
where tipo_quota is null
   or billing_cycle is null
   or periodo_inizio is null
   or periodo_fine is null
   or copertura_mesi is null;

-- 3) Indici utili per la dashboard pagamenti
create index if not exists idx_iscrizioni_corsi_pagamenti_admin
on public.iscrizioni_corsi (stato, rinnovo_attivo, data_inizio, data_fine, tesseramento_id, corso_id);

create index if not exists idx_pagamenti_mese_admin
on public.pagamenti (tesseramento_id, corso_id, iscrizione_id, periodo_inizio, periodo_fine, stato);

-- Evita doppioni della stessa quota corso per la stessa copertura
create unique index if not exists pagamenti_quota_corso_periodo_unique
on public.pagamenti (iscrizione_id, periodo_inizio, periodo_fine, tipo_quota)
where tipo_quota = 'corso'
  and iscrizione_id is not null
  and periodo_inizio is not null
  and periodo_fine is not null;

-- 4) Trigger updated_at, utile quando sospendi/riattivi iscrizioni e pagamenti
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_iscrizioni_corsi_updated_at on public.iscrizioni_corsi;
create trigger trg_iscrizioni_corsi_updated_at
before update on public.iscrizioni_corsi
for each row
execute function public.set_updated_at();

drop trigger if exists trg_pagamenti_updated_at on public.pagamenti;
create trigger trg_pagamenti_updated_at
before update on public.pagamenti
for each row
execute function public.set_updated_at();
