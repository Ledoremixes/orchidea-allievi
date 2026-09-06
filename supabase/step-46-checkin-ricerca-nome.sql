-- Orchidea Allievi - Step 46
-- Check-in tablet con ricerca per nome/cognome e selezione del profilo.
-- Restituisce al frontend esclusivamente nome, cognome e numero tessera
-- (oltre all'UUID tecnico non mostrato a schermo).
-- Esegui in Supabase > SQL Editor dopo step-14 e step-15.

-- Funzione interna condivisa dai diversi metodi di identificazione.
create or replace function public.orchidea_registra_presenza_core(
  p_tesseramento_id uuid,
  p_corso_id uuid default null,
  p_metodo_identificazione text default 'numero_tessera'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  local_now timestamp := timezone('Europe/Rome', now());
  local_date date := (timezone('Europe/Rome', now()))::date;
  available_count integer := 0;
  current_course_count integer := 0;
  student_row public.tesseramenti%rowtype;
  course_row public.corsi%rowtype;
  attendance_id uuid;
  clean_method text := left(trim(coalesce(p_metodo_identificazione, 'numero_tessera')), 60);
begin
  if not public.is_admin() then
    raise exception 'Permesso negato';
  end if;

  select t.*
  into student_row
  from public.tesseramenti t
  where t.id = p_tesseramento_id
  limit 1;

  if student_row.id is null then
    return jsonb_build_object(
      'status', 'not_found',
      'message', 'Allievo non trovato. Rivolgiti alla segreteria.'
    );
  end if;

  if coalesce(student_row.tessera_attiva, true) = false then
    return jsonb_build_object(
      'status', 'inactive_membership',
      'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
      'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
      'message', 'La tessera non risulta attiva. Rivolgiti alla segreteria.'
    );
  end if;

  select count(*)
  into current_course_count
  from public.corsi c
  where coalesce(c.attivo, true) = true
    and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
    and local_now::time >= (c.ora_inizio - interval '45 minutes')::time
    and local_now::time <= (c.ora_fine + interval '45 minutes')::time;

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
    select count(*)
    into available_count
    from public.corsi c
    where coalesce(c.attivo, true) = true
      and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
      and local_now::time >= (c.ora_inizio - interval '45 minutes')::time
      and local_now::time <= (c.ora_fine + interval '45 minutes')::time
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
      and local_now::time >= (c.ora_inizio - interval '45 minutes')::time
      and local_now::time <= (c.ora_fine + interval '45 minutes')::time
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
    order by c.ora_inizio, c.nome, c.livello
    limit 1;
  else
    select c.*
    into course_row
    from public.corsi c
    where c.id = p_corso_id
      and coalesce(c.attivo, true) = true
      and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
      and local_now::time >= (c.ora_inizio - interval '45 minutes')::time
      and local_now::time <= (c.ora_fine + interval '45 minutes')::time
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

  begin
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
      coalesce(nullif(clean_method, ''), 'numero_tessera'),
      'tablet',
      auth.uid()
    )
    returning id into attendance_id;
  exception
    when unique_violation then
      select p.id
      into attendance_id
      from public.presenze_corsi p
      where p.tesseramento_id = student_row.id
        and p.corso_id = course_row.id
        and p.data_lezione = local_date
      limit 1;

      return jsonb_build_object(
        'status', 'already_registered',
        'attendance_id', attendance_id,
        'first_name', student_row.nome,
        'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
        'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
        'course_name', course_row.nome,
        'course_level', course_row.livello,
        'course_time', to_char(course_row.ora_inizio, 'HH24:MI'),
        'message', 'La tua presenza era già stata registrata.'
      );
  end;

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

-- Mantiene compatibile il check-in già esistente con tessera o cellulare.
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
  clean_identifier text := trim(coalesce(p_identificativo, ''));
  identifier_digits text := regexp_replace(coalesce(p_identificativo, ''), '[^0-9]', '', 'g');
  matched_count integer := 0;
  matched_student_id uuid;
  identification_method text := 'numero_tessera';
begin
  if not public.is_admin() then
    raise exception 'Permesso negato';
  end if;

  if length(clean_identifier) < 3 then
    return jsonb_build_object(
      'status', 'invalid_identifier',
      'message', 'Inserisci un numero tessera o un cellulare valido.'
    );
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
    return jsonb_build_object(
      'status', 'not_found',
      'message', 'Tessera o cellulare non riconosciuto. Rivolgiti alla segreteria.'
    );
  end if;

  if matched_count > 1 then
    return jsonb_build_object(
      'status', 'ambiguous',
      'message', 'Il dato inserito corrisponde a più allievi. Usa il numero tessera completo.'
    );
  end if;

  select t.id
  into matched_student_id
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

  if length(identifier_digits) >= 9
     and exists (
       select 1
       from public.tesseramenti t
       where t.id = matched_student_id
         and right(
           regexp_replace(coalesce(t.telefono, ''), '[^0-9]', '', 'g'),
           least(10, length(identifier_digits))
         ) = right(identifier_digits, least(10, length(identifier_digits)))
     ) then
    identification_method := 'telefono';
  end if;

  return public.orchidea_registra_presenza_core(
    matched_student_id,
    p_corso_id,
    identification_method
  );
end;
$$;

-- Ricerca sicura per il tablet.
-- Prima restituisce gli iscritti alle lezioni attualmente in corso; se non trova
-- corrispondenze, estende automaticamente la ricerca a tutti i corsisti attivi.
create or replace function public.cerca_allievi_checkin(
  p_query text,
  p_corso_id uuid default null
)
returns table (
  tesseramento_id uuid,
  nome text,
  cognome text,
  numero_tessera text,
  ambito text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  local_now timestamp := timezone('Europe/Rome', now());
  local_date date := (timezone('Europe/Rome', now()))::date;
  clean_query text := lower(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'));
  query_pattern text;
  current_result_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Permesso negato';
  end if;

  clean_query := replace(replace(clean_query, '%', ''), '_', '');

  if length(clean_query) < 2 then
    return;
  end if;

  query_pattern := '%' || replace(clean_query, ' ', '%') || '%';

  return query
  with candidates as (
    select
      t.id as tesseramento_id,
      t.nome,
      t.cognome,
      t.numero_tessera,
      case
        when lower(trim(coalesce(t.nome, ''))) = clean_query then 0
        when lower(trim(coalesce(t.cognome, ''))) = clean_query then 0
        when lower(trim(coalesce(t.nome, '') || ' ' || coalesce(t.cognome, ''))) = clean_query then 0
        when lower(trim(coalesce(t.cognome, '') || ' ' || coalesce(t.nome, ''))) = clean_query then 0
        when lower(trim(coalesce(t.nome, ''))) like clean_query || '%' then 1
        when lower(trim(coalesce(t.cognome, ''))) like clean_query || '%' then 1
        else 2
      end as search_rank
    from public.tesseramenti t
    where (
      lower(trim(coalesce(t.nome, ''))) like query_pattern
      or lower(trim(coalesce(t.cognome, ''))) like query_pattern
      or lower(trim(coalesce(t.nome, '') || ' ' || coalesce(t.cognome, ''))) like query_pattern
      or lower(trim(coalesce(t.cognome, '') || ' ' || coalesce(t.nome, ''))) like query_pattern
      or lower(trim(coalesce(t.numero_tessera, ''))) like query_pattern
    )
      and exists (
        select 1
        from public.iscrizioni_corsi ic
        join public.corsi c on c.id = ic.corso_id
        where ic.tesseramento_id = t.id
          and ic.stato = 'attivo'
          and coalesce(ic.rinnovo_attivo, true) = true
          and coalesce(ic.data_inizio, ic.data_iscrizione, local_date) <= local_date
          and (ic.data_fine is null or ic.data_fine >= local_date)
          and coalesce(c.attivo, true) = true
          and (p_corso_id is null or c.id = p_corso_id)
          and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
          and local_now::time >= (c.ora_inizio - interval '45 minutes')::time
          and local_now::time <= (c.ora_fine + interval '45 minutes')::time
      )
  )
  select
    c.tesseramento_id,
    c.nome,
    c.cognome,
    c.numero_tessera,
    'corso_attivo'::text as ambito
  from candidates c
  order by c.search_rank, lower(coalesce(c.cognome, '')), lower(coalesce(c.nome, '')), c.numero_tessera
  limit 10;

  get diagnostics current_result_count = row_count;
  if current_result_count > 0 then
    return;
  end if;

  return query
  with candidates as (
    select
      t.id as tesseramento_id,
      t.nome,
      t.cognome,
      t.numero_tessera,
      case
        when lower(trim(coalesce(t.nome, ''))) = clean_query then 0
        when lower(trim(coalesce(t.cognome, ''))) = clean_query then 0
        when lower(trim(coalesce(t.nome, '') || ' ' || coalesce(t.cognome, ''))) = clean_query then 0
        when lower(trim(coalesce(t.cognome, '') || ' ' || coalesce(t.nome, ''))) = clean_query then 0
        when lower(trim(coalesce(t.nome, ''))) like clean_query || '%' then 1
        when lower(trim(coalesce(t.cognome, ''))) like clean_query || '%' then 1
        else 2
      end as search_rank
    from public.tesseramenti t
    where (
      lower(trim(coalesce(t.nome, ''))) like query_pattern
      or lower(trim(coalesce(t.cognome, ''))) like query_pattern
      or lower(trim(coalesce(t.nome, '') || ' ' || coalesce(t.cognome, ''))) like query_pattern
      or lower(trim(coalesce(t.cognome, '') || ' ' || coalesce(t.nome, ''))) like query_pattern
      or lower(trim(coalesce(t.numero_tessera, ''))) like query_pattern
    )
      and exists (
        select 1
        from public.iscrizioni_corsi ic
        join public.corsi c on c.id = ic.corso_id
        where ic.tesseramento_id = t.id
          and ic.stato = 'attivo'
          and coalesce(ic.rinnovo_attivo, true) = true
          and coalesce(ic.data_inizio, ic.data_iscrizione, local_date) <= local_date
          and (ic.data_fine is null or ic.data_fine >= local_date)
          and coalesce(c.attivo, true) = true
      )
  )
  select
    c.tesseramento_id,
    c.nome,
    c.cognome,
    c.numero_tessera,
    'tutti_corsisti'::text as ambito
  from candidates c
  order by c.search_rank, lower(coalesce(c.cognome, '')), lower(coalesce(c.nome, '')), c.numero_tessera
  limit 10;
end;
$$;

-- Check-in diretto dopo il clic sul profilo trovato per nome/cognome.
create or replace function public.registra_presenza_corso_per_allievo(
  p_tesseramento_id uuid,
  p_corso_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Permesso negato';
  end if;

  return public.orchidea_registra_presenza_core(
    p_tesseramento_id,
    p_corso_id,
    'ricerca_nome'
  );
end;
$$;

revoke execute on function public.orchidea_registra_presenza_core(uuid, uuid, text) from public;
revoke execute on function public.cerca_allievi_checkin(text, uuid) from public;
revoke execute on function public.registra_presenza_corso_per_allievo(uuid, uuid) from public;

grant execute on function public.registra_presenza_corso(text, uuid) to authenticated;
grant execute on function public.cerca_allievi_checkin(text, uuid) to authenticated;
grant execute on function public.registra_presenza_corso_per_allievo(uuid, uuid) to authenticated;
