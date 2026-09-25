-- Orchidea Allievi - Step 23
-- Primo accesso insegnanti con verifica Email + Codice Fiscale.
-- Esegui UNA VOLTA dopo lo STEP 22 in Supabase > SQL Editor.

alter table public.app_teacher_accounts
  add column if not exists codice_fiscale text;

create index if not exists app_teacher_accounts_cf_idx
  on public.app_teacher_accounts (upper(regexp_replace(coalesce(codice_fiscale, ''), '\s+', '', 'g')));

-- La RPC mantiene lo stesso nome usato dal frontend, ma ora verifica il CF
-- invece del numero di telefono.
drop function if exists public.verify_teacher_first_access(text, text);

create function public.verify_teacher_first_access(p_email text, p_cf text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.app_teacher_accounts%rowtype;
  v_cf_input text;
  v_cf_saved text;
begin
  v_cf_input := upper(regexp_replace(coalesce(p_cf, ''), '\s+', '', 'g'));

  select * into v_row
  from public.app_teacher_accounts a
  where lower(trim(a.email)) = lower(trim(coalesce(p_email, '')))
    and a.access_enabled = true
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'status', 'not_found');
  end if;

  v_cf_saved := upper(regexp_replace(coalesce(v_row.codice_fiscale, ''), '\s+', '', 'g'));

  if v_cf_input = '' or v_cf_saved = '' or v_cf_input <> v_cf_saved then
    return jsonb_build_object('ok', false, 'status', 'not_found');
  end if;

  if v_row.auth_user_id is not null or v_row.access_initialized_at is not null then
    return jsonb_build_object('ok', false, 'status', 'already_registered');
  end if;

  return jsonb_build_object('ok', true, 'status', 'eligible');
end;
$$;

revoke all on function public.verify_teacher_first_access(text, text) from public;
grant execute on function public.verify_teacher_first_access(text, text) to anon, authenticated;
