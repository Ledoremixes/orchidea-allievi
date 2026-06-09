-- Orchidea Allievi - Step 3
-- Backfill numeri tessera mancanti + indice unico.
-- Esegui questo script se nella tabella tesseramenti la colonna numero_tessera è vuota.

alter table public.tesseramenti
add column if not exists numero_tessera text;

-- Genera numeri tipo ORC-2026-0001, ORC-2026-0002...
-- Usa l'ordine di creazione dei tesseramenti, così rimane stabile.
with missing as (
  select
    id,
    row_number() over (order by created_at nulls last, id) as rn,
    coalesce(nullif(trim(stagione), ''), '2026/2027') as stagione_value
  from public.tesseramenti
  where numero_tessera is null
     or trim(numero_tessera) = ''
), already_numbered as (
  select
    coalesce(
      max((regexp_match(numero_tessera, '(\d+)$'))[1]::integer),
      0
    ) as max_number
  from public.tesseramenti
  where numero_tessera is not null
    and trim(numero_tessera) <> ''
)
update public.tesseramenti t
set numero_tessera = 'ORC-' || substring(m.stagione_value from '\d{4}') || '-' || lpad((m.rn + a.max_number)::text, 4, '0')
from missing m
cross join already_numbered a
where t.id = m.id;

-- Evita doppioni futuri sui numeri tessera.
create unique index if not exists tesseramenti_numero_tessera_unique
on public.tesseramenti (upper(trim(numero_tessera)))
where numero_tessera is not null and trim(numero_tessera) <> '';

-- Controllo rapido: ti mostra quante tessere sono ancora senza numero.
select
  count(*) filter (where numero_tessera is null or trim(numero_tessera) = '') as tessere_senza_numero,
  count(*) as tesserati_totali
from public.tesseramenti;
