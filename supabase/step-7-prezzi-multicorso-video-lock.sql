-- ============================================================
-- STEP 7 - Prezzi multicorso, All You Can Dance e blocco video
-- ============================================================
-- Esegui questo file dopo step-6-quote-mensili.sql.
-- Non cancella dati esistenti.

-- Prezzo base del corso: viene usato come default quando l'admin assegna il corso.
alter table public.corsi
add column if not exists prezzo_mensile numeric(10,2) default 0;

-- Iscrizioni: prezzo personalizzato e gestione pacchetto.
alter table public.iscrizioni_corsi
add column if not exists tariffa_mensile numeric(10,2);

alter table public.iscrizioni_corsi
add column if not exists tipo_pagamento text default 'mensile';

alter table public.iscrizioni_corsi
add column if not exists data_inizio date default current_date;

alter table public.iscrizioni_corsi
add column if not exists data_fine date;

alter table public.iscrizioni_corsi
add column if not exists rinnovo_attivo boolean default true;

alter table public.iscrizioni_corsi
add column if not exists genera_pagamento boolean default true;

alter table public.iscrizioni_corsi
add column if not exists pacchetto_nome text;

alter table public.iscrizioni_corsi
add column if not exists prezzo_personalizzato boolean default false;

-- Lasciamo i valori storici compatibili e aggiungiamo All You Can Dance.
do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'iscrizioni_corsi'
      and constraint_name = 'iscrizioni_corsi_tipo_pagamento_check'
  ) then
    alter table public.iscrizioni_corsi
    drop constraint iscrizioni_corsi_tipo_pagamento_check;
  end if;
end $$;

alter table public.iscrizioni_corsi
add constraint iscrizioni_corsi_tipo_pagamento_check
check (tipo_pagamento in ('mensile', 'trimestrale', 'annuale', 'all_you_can_dance'));

-- Riempie la tariffa mancante dal prezzo base del corso.
update public.iscrizioni_corsi ic
set tariffa_mensile = coalesce(ic.tariffa_mensile, c.prezzo_mensile, 0)
from public.corsi c
where c.id = ic.corso_id
  and ic.tariffa_mensile is null;

-- Pagamenti: mantiene compatibilità con i nuovi tipi.
do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'pagamenti'
      and constraint_name = 'pagamenti_billing_cycle_check'
  ) then
    alter table public.pagamenti
    drop constraint pagamenti_billing_cycle_check;
  end if;
end $$;

alter table public.pagamenti
add constraint pagamenti_billing_cycle_check
check (billing_cycle in ('una_tantum', 'mensile', 'trimestrale', 'annuale', 'all_you_can_dance'));

-- Quando un allievo è sospeso/terminato o rinnovo_attivo=false,
-- non deve vedere nuovi né vecchi video del corso.
drop policy if exists "Utente vede video dei propri corsi" on public.video_corsi;

create policy "Utente vede video dei propri corsi"
on public.video_corsi
for select
to authenticated
using (
  pubblicato = true
  and exists (
    select 1
    from public.iscrizioni_corsi ic
    join public.tesseramenti t on t.id = ic.tesseramento_id
    where ic.corso_id = video_corsi.corso_id
      and ic.stato = 'attivo'
      and coalesce(ic.rinnovo_attivo, true) = true
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
  )
);

-- Stessa regola anche per i file privati Supabase Storage.
drop policy if exists "Allievo legge storage video propri corsi" on storage.objects;

create policy "Allievo legge storage video propri corsi"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'course-videos'
  and exists (
    select 1
    from public.video_corsi v
    join public.iscrizioni_corsi ic on ic.corso_id = v.corso_id
    join public.tesseramenti t on t.id = ic.tesseramento_id
    where v.storage_path = storage.objects.name
      and v.pubblicato = true
      and ic.stato = 'attivo'
      and coalesce(ic.rinnovo_attivo, true) = true
      and (
        t.auth_user_id = auth.uid()
        or lower(trim(t.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      )
  )
);
