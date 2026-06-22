-- Step 45 - Gestione insegnanti e ripartizione quote
-- Esegui questo script su Supabase prima di usare la nuova sezione Insegnanti.

create table if not exists public.insegnanti (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text,
  telefono text,
  attivo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.insegnanti_corsi (
  id uuid primary key default gen_random_uuid(),
  insegnante_id uuid not null references public.insegnanti(id) on delete cascade,
  corso_id uuid not null references public.corsi(id) on delete cascade,
  quota_tipo text not null default 'percentuale' check (quota_tipo in ('percentuale', 'importo')),
  quota_valore numeric(10,2),
  attivo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (insegnante_id, corso_id)
);

alter table public.insegnanti enable row level security;
alter table public.insegnanti_corsi enable row level security;

drop policy if exists "Admin può gestire insegnanti" on public.insegnanti;
create policy "Admin può gestire insegnanti"
on public.insegnanti
for all
using (true)
with check (true);

drop policy if exists "Admin può gestire collegamenti insegnanti corsi" on public.insegnanti_corsi;
create policy "Admin può gestire collegamenti insegnanti corsi"
on public.insegnanti_corsi
for all
using (true)
with check (true);

create index if not exists insegnanti_attivo_idx on public.insegnanti(attivo);
create index if not exists insegnanti_corsi_corso_idx on public.insegnanti_corsi(corso_id);
create index if not exists insegnanti_corsi_insegnante_idx on public.insegnanti_corsi(insegnante_id);
