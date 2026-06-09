-- Step 12 - Pacchetti multicorso con ripartizione proporzionale
-- Esegui questo script prima di avviare la nuova versione dell'app.

alter table public.iscrizioni_corsi
add column if not exists pacchetto_id uuid;

alter table public.iscrizioni_corsi
add column if not exists pacchetto_totale_mensile numeric(10,2);

alter table public.iscrizioni_corsi
add column if not exists pacchetto_base_totale numeric(10,2);

alter table public.iscrizioni_corsi
add column if not exists quota_pacchetto_percentuale numeric(7,4);

alter table public.pagamenti
add column if not exists pacchetto_id uuid;

alter table public.pagamenti
add column if not exists pacchetto_nome text;

alter table public.pagamenti
add column if not exists pacchetto_totale_mensile numeric(10,2);

alter table public.pagamenti
add column if not exists quota_pacchetto_percentuale numeric(7,4);

create index if not exists iscrizioni_corsi_pacchetto_id_idx
on public.iscrizioni_corsi (pacchetto_id);

create index if not exists pagamenti_pacchetto_id_idx
on public.pagamenti (pacchetto_id);

create index if not exists pagamenti_pacchetto_periodo_idx
on public.pagamenti (pacchetto_id, tesseramento_id, periodo_inizio);
