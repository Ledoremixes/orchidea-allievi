-- Orchidea Allievi - Step 15
-- Genere personalizzato, salvataggio ordine locandine e aggiornamento check-in.
-- Esegui in Supabase > SQL Editor dopo step-13 e step-14.

alter table public.tesseramenti
  add column if not exists sesso text;

update public.tesseramenti
set sesso = case
  when substring(upper(trim(cf)) from 10 for 2)::integer > 40 then 'F'
  else 'M'
end
where sesso is null
  and upper(trim(coalesce(cf, ''))) ~ '^[A-Z0-9]{16}$'
  and substring(upper(trim(cf)) from 10 for 2) ~ '^[0-9]{2}$'
  and substring(upper(trim(cf)) from 10 for 2)::integer between 1 and 71;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tesseramenti_sesso_check'
      and conrelid = 'public.tesseramenti'::regclass
  ) then
    alter table public.tesseramenti
      add constraint tesseramenti_sesso_check
      check (sesso is null or upper(sesso) in ('M', 'F'));
  end if;
end $$;

create or replace function public.orchidea_student_gender(p_sesso text, p_cf text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    case
      when upper(trim(coalesce(p_sesso, ''))) in ('M', 'F') then upper(trim(p_sesso))
      else null
    end,
    case
      when upper(trim(coalesce(p_cf, ''))) ~ '^[A-Z0-9]{16}$'
       and substring(upper(trim(p_cf)) from 10 for 2) ~ '^[0-9]{2}$'
       and substring(upper(trim(p_cf)) from 10 for 2)::integer between 1 and 71
      then case when substring(upper(trim(p_cf)) from 10 for 2)::integer > 40 then 'F' else 'M' end
      else null
    end
  );
$$;

insert into public.app_settings (key, value, updated_at)
values ('home_course_admin_order_ids', '[]'::jsonb, now())
on conflict (key) do nothing;

create or replace function public.registra_presenza_corso(
  p_identificativo text,
  p_corso_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  local_now timestamp := timezone('Europe/Rome', now());
  local_date date := (timezone('Europe/Rome', now()))::date;
  clean_identifier text := trim(coalesce(p_identificativo, ''));
  identifier_digits text := regexp_replace(coalesce(p_identificativo, ''), '[^0-9]', '', 'g');
  matched_count integer := 0;
  available_count integer := 0;
  current_course_count integer := 0;
  student_row public.tesseramenti%rowtype;
  course_row public.corsi%rowtype;
  attendance_id uuid;
  identification_method text := 'numero_tessera';
begin
  if not public.is_admin() then
    raise exception 'Permesso negato';
  end if;

  if length(clean_identifier) < 3 then
    return jsonb_build_object('status', 'invalid_identifier', 'message', 'Inserisci un numero tessera o un cellulare valido.');
  end if;

  select count(*)
  into matched_count
  from public.tesseramenti t
  where upper(trim(coalesce(t.numero_tessera, ''))) = upper(clean_identifier)
     or (
       length(identifier_digits) >= 9
       and right(
         regexp_replace(coalesce(t.telefono, ''), '[^0-9]', '', 'g'),
         least(10, length(identifier_digits))
       ) = right(identifier_digits, least(10, length(identifier_digits)))
     )
     or (
       length(identifier_digits) between 1 and 6
       and right(regexp_replace(coalesce(t.numero_tessera, ''), '[^0-9]', '', 'g'), length(identifier_digits)) = identifier_digits
     );

  if matched_count = 0 then
    return jsonb_build_object('status', 'not_found', 'message', 'Tessera o cellulare non riconosciuto. Rivolgiti alla segreteria.');
  end if;

  if matched_count > 1 then
    return jsonb_build_object('status', 'ambiguous', 'message', 'Il dato inserito corrisponde a più allievi. Usa il numero tessera completo.');
  end if;

  select t.*
  into student_row
  from public.tesseramenti t
  where upper(trim(coalesce(t.numero_tessera, ''))) = upper(clean_identifier)
     or (
       length(identifier_digits) >= 9
       and right(
         regexp_replace(coalesce(t.telefono, ''), '[^0-9]', '', 'g'),
         least(10, length(identifier_digits))
       ) = right(identifier_digits, least(10, length(identifier_digits)))
     )
     or (
       length(identifier_digits) between 1 and 6
       and right(regexp_replace(coalesce(t.numero_tessera, ''), '[^0-9]', '', 'g'), length(identifier_digits)) = identifier_digits
     )
  limit 1;

  if coalesce(student_row.tessera_attiva, true) = false then
    return jsonb_build_object(
      'status', 'inactive_membership',
      'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
      'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
      'message', 'La tessera non risulta attiva. Rivolgiti alla segreteria.'
    );
  end if;

  if length(identifier_digits) >= 9
     and right(
       regexp_replace(coalesce(student_row.telefono, ''), '[^0-9]', '', 'g'),
       least(10, length(identifier_digits))
     ) = right(identifier_digits, least(10, length(identifier_digits))) then
    identification_method := 'telefono';
  end if;

  -- Prima controlliamo se esistono lezioni compatibili con giorno e orario.
  select count(*)
  into current_course_count
  from public.corsi c
  where coalesce(c.attivo, true) = true
    and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
    and local_now::time >= (c.ora_inizio - interval '30 minutes')::time
    and local_now::time <= c.ora_fine;

  if current_course_count = 0 then
    return jsonb_build_object(
      'status', 'no_course',
      'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
      'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
      'message', 'In questo momento non risulta alcun corso disponibile per il check-in.'
    );
  end if;

  if p_corso_id is null then
    -- Quando ci sono più lezioni contemporanee, il sistema prova prima a
    -- riconoscere automaticamente il corso dall'iscrizione dell'allievo.
    select count(*)
    into available_count
    from public.corsi c
    where coalesce(c.attivo, true) = true
      and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
      and local_now::time >= (c.ora_inizio - interval '30 minutes')::time
      and local_now::time <= c.ora_fine
      and exists (
        select 1
        from public.iscrizioni_corsi ic
        where ic.tesseramento_id = student_row.id
          and ic.corso_id = c.id
          and ic.stato = 'attivo'
          and coalesce(ic.rinnovo_attivo, true) = true
          and coalesce(ic.data_inizio, ic.data_iscrizione, local_date) <= local_date
          and (ic.data_fine is null or ic.data_fine >= local_date)
      );

    if available_count = 0 then
      return jsonb_build_object(
        'status', 'not_enrolled',
        'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
        'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
        'message', 'Non risulti iscritto ai corsi attualmente in svolgimento. Rivolgiti alla segreteria.'
      );
    end if;

    if available_count > 1 then
      return jsonb_build_object(
        'status', 'choose_course',
        'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
        'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
        'message', 'Risulti iscritto a più lezioni in corso: seleziona quella che stai frequentando.'
      );
    end if;

    select c.*
    into course_row
    from public.corsi c
    where coalesce(c.attivo, true) = true
      and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
      and local_now::time >= (c.ora_inizio - interval '30 minutes')::time
      and local_now::time <= c.ora_fine
      and exists (
        select 1
        from public.iscrizioni_corsi ic
        where ic.tesseramento_id = student_row.id
          and ic.corso_id = c.id
          and ic.stato = 'attivo'
          and coalesce(ic.rinnovo_attivo, true) = true
          and coalesce(ic.data_inizio, ic.data_iscrizione, local_date) <= local_date
          and (ic.data_fine is null or ic.data_fine >= local_date)
      )
    order by c.ora_inizio
    limit 1;
  else
    select c.*
    into course_row
    from public.corsi c
    where c.id = p_corso_id
      and coalesce(c.attivo, true) = true
      and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
      and local_now::time >= (c.ora_inizio - interval '30 minutes')::time
      and local_now::time <= c.ora_fine
    limit 1;

    if course_row.id is null then
      return jsonb_build_object(
        'status', 'no_course',
        'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
        'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
        'message', 'Il corso selezionato non è disponibile per il check-in in questo momento.'
      );
    end if;

    if not exists (
      select 1
      from public.iscrizioni_corsi ic
      where ic.tesseramento_id = student_row.id
        and ic.corso_id = course_row.id
        and ic.stato = 'attivo'
        and coalesce(ic.rinnovo_attivo, true) = true
        and coalesce(ic.data_inizio, ic.data_iscrizione, local_date) <= local_date
        and (ic.data_fine is null or ic.data_fine >= local_date)
    ) then
      return jsonb_build_object(
        'status', 'not_enrolled',
        'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
        'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
        'course_name', course_row.nome,
        'course_level', course_row.livello,
        'message', 'Non risulti iscritto a questo corso. Rivolgiti alla segreteria.'
      );
    end if;
  end if;

  select p.id
  into attendance_id
  from public.presenze_corsi p
  where p.tesseramento_id = student_row.id
    and p.corso_id = course_row.id
    and p.data_lezione = local_date
  limit 1;

  if attendance_id is not null then
    return jsonb_build_object(
      'status', 'already_registered',
      'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
      'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
      'course_name', course_row.nome,
      'course_level', course_row.livello,
      'course_time', to_char(course_row.ora_inizio, 'HH24:MI'),
      'message', 'La tua presenza era già stata registrata.'
    );
  end if;

  insert into public.presenze_corsi (
    tesseramento_id,
    corso_id,
    data_lezione,
    checked_in_at,
    metodo_identificazione,
    sorgente,
    created_by
  ) values (
    student_row.id,
    course_row.id,
    local_date,
    now(),
    identification_method,
    'tablet',
    auth.uid()
  )
  returning id into attendance_id;

  return jsonb_build_object(
    'status', 'success',
    'attendance_id', attendance_id,
    'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
    'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
    'course_name', course_row.nome,
    'course_level', course_row.livello,
    'course_room', course_row.sala,
    'course_time', to_char(course_row.ora_inizio, 'HH24:MI'),
    'message', 'Presenza registrata con successo.'
  );
end;
$$;

grant execute on function public.get_checkin_courses() to authenticated;
grant execute on function public.registra_presenza_corso(text, uuid) to authenticated;

-- Facoltativo ma consigliato per aggiornamenti live del pannello admin.
do $$
begin
  alter publication supabase_realtime add table public.presenze_corsi;
exception
  when duplicate_object then null;
end $$;
