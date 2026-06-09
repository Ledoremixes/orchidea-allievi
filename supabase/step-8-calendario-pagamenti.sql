-- ============================================================
-- STEP 8 - Calendario pagamenti con copertura mensile
-- ============================================================
-- Esegui questo file dopo step-7-prezzi-multicorso-video-lock.sql.
-- Non cancella dati: aggiunge solo indici utili e garantisce le colonne usate dalla dashboard.

alter table public.pagamenti
add column if not exists iscrizione_id uuid references public.iscrizioni_corsi(id) on delete set null;

alter table public.pagamenti
add column if not exists tipo_quota text default 'extra';

alter table public.pagamenti
add column if not exists billing_cycle text default 'una_tantum';

alter table public.pagamenti
add column if not exists periodo_inizio date;

alter table public.pagamenti
add column if not exists periodo_fine date;

alter table public.pagamenti
add column if not exists copertura_mesi integer default 1;

alter table public.iscrizioni_corsi
add column if not exists tariffa_mensile numeric(10,2);

alter table public.iscrizioni_corsi
add column if not exists tipo_pagamento text default 'mensile';

alter table public.iscrizioni_corsi
add column if not exists rinnovo_attivo boolean default true;

alter table public.iscrizioni_corsi
add column if not exists genera_pagamento boolean default true;

-- Indici utili per dashboard pagamenti, ricerca coperture e area corsi allievo.
create index if not exists pagamenti_iscrizione_periodo_idx
on public.pagamenti (iscrizione_id, periodo_inizio, periodo_fine, stato);

create index if not exists pagamenti_tesseramento_periodo_idx
on public.pagamenti (tesseramento_id, periodo_inizio, periodo_fine, stato);

create index if not exists iscrizioni_corsi_tesseramento_stato_idx
on public.iscrizioni_corsi (tesseramento_id, stato, rinnovo_attivo);

-- Nota logica applicativa:
-- importo = totale incassato nel periodo, es. 120 euro per trimestrale.
-- copertura_mesi = durata della copertura, es. 3.
-- quota mese mostrata in calendario = importo / copertura_mesi, es. 40 euro.
