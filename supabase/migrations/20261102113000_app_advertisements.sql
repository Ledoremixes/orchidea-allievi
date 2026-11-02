-- Public-facing startup promotions for Orchidea Allievi.
-- The admin may maintain many drafts but only one promotion can be active at a time.
create table if not exists public.app_advertisements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text check (description is null or char_length(description) <= 800),
  image_path text,
  cta_label text check (cta_label is null or char_length(cta_label) <= 45),
  cta_url text check (cta_url is null or char_length(cta_url) <= 2000),
  starts_on date,
  ends_on date,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_dates_valid check (starts_on is null or ends_on is null or starts_on <= ends_on),
  constraint ad_cta_url_allowed check (
    cta_url is null or cta_url = '' or
    cta_url ~ '^https://[^[:space:]]+$' or
    (left(cta_url, 1) = '/' and left(cta_url, 2) <> '//')
  )
);

create unique index if not exists one_active_orchidea_advertisement
  on public.app_advertisements (is_active) where is_active = true;

alter table public.app_advertisements enable row level security;

grant select, insert, update, delete on public.app_advertisements to authenticated;

drop policy if exists "Admin gestisce pubblicita app" on public.app_advertisements;
create policy "Admin gestisce pubblicita app"
  on public.app_advertisements for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "App vede pubblicita attiva nel periodo" on public.app_advertisements;
create policy "App vede pubblicita attiva nel periodo"
  on public.app_advertisements for select to authenticated
  using (
    is_active = true
    and (starts_on is null or starts_on <= (now() at time zone 'Europe/Rome')::date)
    and (ends_on is null or ends_on >= (now() at time zone 'Europe/Rome')::date)
  );

-- This function is SECURITY INVOKER: admin RLS policies still apply.
-- Switching promotions is atomic and avoids violating the unique active index.
create or replace function public.admin_set_active_advertisement(p_id uuid default null)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo un amministratore puo modificare la pubblicita'
      using errcode = '42501';
  end if;

  if p_id is not null and not exists (
    select 1 from public.app_advertisements where id = p_id
  ) then
    raise exception 'Pubblicita non trovata';
  end if;

  update public.app_advertisements
     set is_active = false, updated_at = now()
   where is_active = true;

  if p_id is not null then
    update public.app_advertisements
       set is_active = true, updated_at = now()
     where id = p_id;
  end if;
end;
$$;

revoke all on function public.admin_set_active_advertisement(uuid) from public, anon;
grant execute on function public.admin_set_active_advertisement(uuid) to authenticated;

-- Uploaded images are intentionally public: ad creative is public information.
-- Upload/delete requires authenticated admin and is confined to this bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-advertisements', 'app-advertisements', true, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Admin carica immagini pubblicita app" on storage.objects;
create policy "Admin carica immagini pubblicita app"
on storage.objects for insert to authenticated
with check (bucket_id = 'app-advertisements' and (select public.is_admin()));

drop policy if exists "Admin aggiorna immagini pubblicita app" on storage.objects;
create policy "Admin aggiorna immagini pubblicita app"
on storage.objects for update to authenticated
using (bucket_id = 'app-advertisements' and (select public.is_admin()))
with check (bucket_id = 'app-advertisements' and (select public.is_admin()));

drop policy if exists "Admin elimina immagini pubblicita app" on storage.objects;
create policy "Admin elimina immagini pubblicita app"
on storage.objects for delete to authenticated
using (bucket_id = 'app-advertisements' and (select public.is_admin()));

drop policy if exists "Admin legge oggetti pubblicita app" on storage.objects;
create policy "Admin legge oggetti pubblicita app"
on storage.objects for select to authenticated
using (bucket_id = 'app-advertisements' and (select public.is_admin()));

notify pgrst, 'reload schema';