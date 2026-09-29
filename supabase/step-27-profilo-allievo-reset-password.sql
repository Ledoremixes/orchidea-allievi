-- Orchidea App - STEP 27
-- Profilo allievo con foto privata + recupero password verificato con Email + Codice Fiscale.
-- Esegui UNA VOLTA in Supabase > SQL Editor dopo gli step precedenti.

-- =========================================================
-- 1) FOTO PROFILO ALLIEVO
-- =========================================================

alter table public.tesseramenti
  add column if not exists foto_profilo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  false,
  5242880,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- L'utente non riceve UPDATE diretto sulla propria anagrafica: la foto viene
-- modificata esclusivamente tramite questa RPC, così gli altri campi restano protetti.
create or replace function public.set_my_profile_photo(p_path text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_path text := nullif(trim(coalesce(p_path, '')), '');
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessione non valida';
  end if;

  if v_path is not null and v_path not like v_uid::text || '/%' then
    raise exception 'Percorso foto non valido';
  end if;

  update public.tesseramenti t
  set foto_profilo_path = v_path
  where t.auth_user_id = v_uid
     or (v_email <> '' and lower(trim(coalesce(t.email, ''))) = v_email);

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.set_my_profile_photo(text) from public;
grant execute on function public.set_my_profile_photo(text) to authenticated;

-- Storage: ogni account può leggere/creare/modificare/eliminare solamente
-- i file nella cartella che porta il proprio auth.uid(). Gli admin possono leggere.
drop policy if exists "Utente legge propria foto profilo" on storage.objects;
drop policy if exists "Utente carica propria foto profilo" on storage.objects;
drop policy if exists "Utente aggiorna propria foto profilo" on storage.objects;
drop policy if exists "Utente elimina propria foto profilo" on storage.objects;

create policy "Utente legge propria foto profilo"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-photos'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

create policy "Utente carica propria foto profilo"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Utente aggiorna propria foto profilo"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Utente elimina propria foto profilo"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- =========================================================
-- 2) RECUPERO PASSWORD CON VERIFICA EMAIL + CODICE FISCALE
-- =========================================================
-- Valido sia per allievi sia per insegnanti. Il link di reset viene inviato dal
-- frontend soltanto quando questa funzione restituisce ok=true.

create or replace function public.verify_password_reset_identity(p_email text, p_cf text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_cf text := upper(regexp_replace(coalesce(p_cf, ''), '\s+', '', 'g'));
  v_student_match boolean := false;
  v_teacher_match boolean := false;
  v_auth_exists boolean := false;
begin
  if v_email = '' or v_cf = '' then
    return jsonb_build_object('ok', false, 'status', 'not_found');
  end if;

  select exists (
    select 1
    from public.tesseramenti t
    where lower(trim(coalesce(t.email, ''))) = v_email
      and upper(regexp_replace(coalesce(t.cf, ''), '\s+', '', 'g')) = v_cf
  ) into v_student_match;

  if to_regclass('public.app_teacher_accounts') is not null then
    select exists (
      select 1
      from public.app_teacher_accounts a
      where a.access_enabled = true
        and lower(trim(coalesce(a.email, ''))) = v_email
        and upper(regexp_replace(coalesce(a.codice_fiscale, ''), '\s+', '', 'g')) = v_cf
    ) into v_teacher_match;
  end if;

  if not v_student_match and not v_teacher_match then
    return jsonb_build_object('ok', false, 'status', 'not_found');
  end if;

  select exists (
    select 1
    from auth.users u
    where lower(trim(coalesce(u.email, ''))) = v_email
  ) into v_auth_exists;

  if not v_auth_exists then
    return jsonb_build_object('ok', false, 'status', 'first_access_required');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'verified',
    'account_type', case
      when v_student_match and v_teacher_match then 'student_teacher'
      when v_teacher_match then 'teacher'
      else 'student'
    end
  );
end;
$$;

revoke all on function public.verify_password_reset_identity(text, text) from public;
grant execute on function public.verify_password_reset_identity(text, text) to anon, authenticated;
