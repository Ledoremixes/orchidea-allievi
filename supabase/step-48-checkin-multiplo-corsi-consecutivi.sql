-- Orchidea App - SQL STEP 48
-- Check-in multiplo per corsi consecutivi.
-- Obiettivo: un allievo iscritto a due (o più) lezioni consecutive può fare un solo check-in
-- e selezionare tutte le lezioni che frequenta, senza dover uscire dalla pista tra un'ora e l'altra.
--
-- Regole:
--   * resta valida la finestra standard: da 30 minuti prima dell'inizio fino alla fine del corso;
--   * se un corso è disponibile ora, vengono proposti anche gli eventuali corsi successivi
--     direttamente consecutivi (ora_inizio = ora_fine del precedente) a cui l'allievo è iscritto;
--   * il tablet registra una riga di presenza per ogni corso selezionato;
--   * le presenze già registrate non vengono duplicate;
--   * per un solo corso il flusso resta automatico come prima.
--
-- Eseguire dopo step-47-checkin-finestra-30-minuti.sql.

-- Corsi disponibili per UNO specifico allievo: corsi nella finestra attuale + catena di corsi consecutivi.
create or replace function public.orchidea_checkin_course_options(
  p_tesseramento_id uuid
)
returns table (
  id uuid,
  nome text,
  livello text,
  sala text,
  giorno_settimana text,
  ora_inizio time,
  ora_fine time,
  already_registered boolean,
  consecutive boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  local_now timestamp := timezone('Europe/Rome', now());
  local_date date := (timezone('Europe/Rome', now()))::date;
begin
  if not public.is_admin() then
    raise exception 'Permesso negato';
  end if;

  return query
  with recursive enrolled as (
    select
      c.id,
      c.nome,
      c.livello,
      c.sala,
      c.giorno_settimana,
      c.ora_inizio,
      c.ora_fine
    from public.corsi c
    join public.iscrizioni_corsi ic
      on ic.corso_id = c.id
     and ic.tesseramento_id = p_tesseramento_id
    where coalesce(c.attivo, true) = true
      and ic.stato = 'attivo'
      and coalesce(ic.rinnovo_attivo, true) = true
      and coalesce(ic.data_inizio, ic.data_iscrizione, local_date) <= local_date
      and (ic.data_fine is null or ic.data_fine >= local_date)
      and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
      and c.ora_inizio is not null
      and c.ora_fine is not null
      and c.ora_fine > c.ora_inizio
  ),
  seeds as (
    select
      e.*,
      0::integer as depth,
      false::boolean as is_consecutive
    from enrolled e
    where local_now::time >= (e.ora_inizio - interval '30 minutes')::time
      and local_now::time <= e.ora_fine
  ),
  chain as (
    select s.*
    from seeds s

    union

    select
      e.id,
      e.nome,
      e.livello,
      e.sala,
      e.giorno_settimana,
      e.ora_inizio,
      e.ora_fine,
      (ch.depth + 1)::integer as depth,
      true::boolean as is_consecutive
    from chain ch
    join enrolled e
      on e.ora_inizio = ch.ora_fine
     and e.ora_inizio > ch.ora_inizio
    where ch.depth < 4
  ),
  unique_courses as (
    select distinct on (ch.id)
      ch.id,
      ch.nome,
      ch.livello,
      ch.sala,
      ch.giorno_settimana,
      ch.ora_inizio,
      ch.ora_fine,
      ch.is_consecutive
    from chain ch
    order by ch.id, ch.is_consecutive asc, ch.ora_inizio
  )
  select
    u.id,
    u.nome,
    u.livello,
    u.sala,
    u.giorno_settimana,
    u.ora_inizio,
    u.ora_fine,
    exists (
      select 1
      from public.presenze_corsi p
      where p.tesseramento_id = p_tesseramento_id
        and p.corso_id = u.id
        and p.data_lezione = local_date
    ) as already_registered,
    exists (
      select 1
      from unique_courses adjacent
      where adjacent.id <> u.id
        and (
          adjacent.ora_inizio = u.ora_fine
          or adjacent.ora_fine = u.ora_inizio
        )
    ) as consecutive
  from unique_courses u
  order by u.ora_inizio, u.nome, u.livello;
end;
$$;

-- Core multi: registra in una sola transazione tutte le lezioni selezionate.
create or replace function public.orchidea_registra_presenze_multi_core(
  p_tesseramento_id uuid,
  p_corso_ids uuid[],
  p_metodo_identificazione text default 'numero_tessera'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  local_date date := (timezone('Europe/Rome', now()))::date;
  student_row public.tesseramenti%rowtype;
  option_row record;
  requested_ids uuid[] := coalesce(p_corso_ids, '{}'::uuid[]);
  allowed_ids uuid[] := '{}'::uuid[];
  clean_method text := left(trim(coalesce(p_metodo_identificazione, 'numero_tessera')), 60);
  attendance_id uuid;
  registered_count integer := 0;
  already_count integer := 0;
  selected_count integer := 0;
  invalid_count integer := 0;
  courses_json jsonb := '[]'::jsonb;
  first_start time := null;
  last_end time := null;
  course_names text[] := '{}'::text[];
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

  -- Deduplica eventuali id ripetuti.
  select coalesce(array_agg(x.id), '{}'::uuid[])
  into requested_ids
  from (
    select distinct unnest(requested_ids) as id
  ) x
  where x.id is not null;

  if coalesce(array_length(requested_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'status', 'invalid_courses',
      'first_name', student_row.nome,
      'message', 'Seleziona almeno un corso.'
    );
  end if;

  select coalesce(array_agg(o.id), '{}'::uuid[])
  into allowed_ids
  from public.orchidea_checkin_course_options(student_row.id) o;

  select count(*)
  into invalid_count
  from unnest(requested_ids) requested(id)
  where not (requested.id = any(allowed_ids));

  if invalid_count > 0 then
    return jsonb_build_object(
      'status', 'invalid_courses',
      'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
      'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
      'message', 'Uno dei corsi selezionati non è disponibile per il check-in in questo momento.'
    );
  end if;

  for option_row in
    select o.*
    from public.orchidea_checkin_course_options(student_row.id) o
    where o.id = any(requested_ids)
    order by o.ora_inizio, o.nome, o.livello
  loop
    selected_count := selected_count + 1;
    attendance_id := null;

    if first_start is null or option_row.ora_inizio < first_start then
      first_start := option_row.ora_inizio;
    end if;
    if last_end is null or option_row.ora_fine > last_end then
      last_end := option_row.ora_fine;
    end if;

    course_names := array_append(course_names, trim(coalesce(option_row.nome, '') || case when nullif(option_row.livello, '') is not null then ' ' || option_row.livello else '' end));

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
      option_row.id,
      local_date,
      now(),
      coalesce(nullif(clean_method, ''), 'numero_tessera'),
      'tablet',
      auth.uid()
    )
    on conflict (tesseramento_id, corso_id, data_lezione) do nothing
    returning id into attendance_id;

    if attendance_id is null then
      already_count := already_count + 1;
    else
      registered_count := registered_count + 1;
    end if;

    courses_json := courses_json || jsonb_build_array(
      jsonb_build_object(
        'id', option_row.id,
        'name', option_row.nome,
        'level', option_row.livello,
        'room', option_row.sala,
        'start', to_char(option_row.ora_inizio, 'HH24:MI'),
        'end', to_char(option_row.ora_fine, 'HH24:MI'),
        'status', case when attendance_id is null then 'already_registered' else 'registered' end
      )
    );
  end loop;

  if selected_count = 0 then
    return jsonb_build_object(
      'status', 'invalid_courses',
      'first_name', student_row.nome,
      'message', 'Nessun corso valido selezionato.'
    );
  end if;

  return jsonb_build_object(
    'status', case when registered_count > 0 then 'success' else 'already_registered' end,
    'tesseramento_id', student_row.id,
    'first_name', student_row.nome,
    'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
    'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
    'course_name', array_to_string(course_names, ' + '),
    'course_time', case
      when first_start is not null and last_end is not null
        then to_char(first_start, 'HH24:MI') || ' - ' || to_char(last_end, 'HH24:MI')
      else null
    end,
    'courses', courses_json,
    'registered_count', registered_count,
    'already_count', already_count,
    'message', case
      when registered_count > 1 then format('Presenza registrata per %s corsi con un solo check-in.', registered_count)
      when registered_count = 1 and already_count > 0 then 'Presenza completata: le altre lezioni selezionate erano già registrate.'
      when registered_count = 1 then 'Presenza registrata con successo.'
      else 'Le presenze selezionate erano già state registrate.'
    end
  );
end;
$$;

-- Sostituisce il core singolo mantenendo la firma usata dal tablet esistente.
-- Se ci sono almeno due lezioni ancora da registrare, restituisce le opzioni al frontend.
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
  student_row public.tesseramenti%rowtype;
  global_open_count integer := 0;
  option_count integer := 0;
  pending_count integer := 0;
  option_ids uuid[] := '{}'::uuid[];
  pending_ids uuid[] := '{}'::uuid[];
  options_json jsonb := '[]'::jsonb;
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
    return jsonb_build_object('status', 'not_found', 'message', 'Allievo non trovato. Rivolgiti alla segreteria.');
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

  if p_corso_id is not null then
    return public.orchidea_registra_presenze_multi_core(
      student_row.id,
      array[p_corso_id]::uuid[],
      p_metodo_identificazione
    );
  end if;

  select count(*)
  into global_open_count
  from public.corsi c
  where coalesce(c.attivo, true) = true
    and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
    and local_now::time >= (c.ora_inizio - interval '30 minutes')::time
    and local_now::time <= c.ora_fine;

  select
    count(*),
    count(*) filter (where not o.already_registered),
    coalesce(array_agg(o.id order by o.ora_inizio), '{}'::uuid[]),
    coalesce(array_agg(o.id order by o.ora_inizio) filter (where not o.already_registered), '{}'::uuid[]),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'nome', o.nome,
          'livello', o.livello,
          'sala', o.sala,
          'ora_inizio', to_char(o.ora_inizio, 'HH24:MI'),
          'ora_fine', to_char(o.ora_fine, 'HH24:MI'),
          'already_registered', o.already_registered,
          'consecutive', o.consecutive
        )
        order by o.ora_inizio, o.nome, o.livello
      ),
      '[]'::jsonb
    )
  into option_count, pending_count, option_ids, pending_ids, options_json
  from public.orchidea_checkin_course_options(student_row.id) o;

  if option_count = 0 then
    if global_open_count = 0 then
      return jsonb_build_object(
        'status', 'no_course',
        'first_name', student_row.nome,
        'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
        'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
        'message', 'In questo momento non risulta alcun corso disponibile per il check-in.'
      );
    end if;

    return jsonb_build_object(
      'status', 'not_enrolled',
      'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
      'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
      'message', 'Non risulti iscritto ai corsi disponibili in questo momento. Rivolgiti alla segreteria.'
    );
  end if;

  -- Se tutte le lezioni del blocco sono già registrate, restituiamo un solo esito riepilogativo.
  if pending_count = 0 then
    return public.orchidea_registra_presenze_multi_core(
      student_row.id,
      option_ids,
      p_metodo_identificazione
    );
  end if;

  -- Se ne manca una sola, la registriamo automaticamente senza chiedere una seconda scelta.
  if pending_count = 1 then
    return public.orchidea_registra_presenze_multi_core(
      student_row.id,
      pending_ids,
      p_metodo_identificazione
    );
  end if;

  -- Due o più corsi ancora da registrare: l'allievo li sceglie e conferma UNA volta sola.
  return jsonb_build_object(
    'status', 'choose_courses',
    'tesseramento_id', student_row.id,
    'first_name', student_row.nome,
    'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
    'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
    'courses', options_json,
    'message', 'Seleziona tutte le lezioni che frequenti: le registriamo insieme con un solo check-in.'
  );
end;
$$;

-- Conferma multi dopo la selezione nel tablet (vale sia per ricerca nome sia per tessera/cellulare).
create or replace function public.registra_presenze_corsi_per_allievo(
  p_tesseramento_id uuid,
  p_corso_ids uuid[]
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

  return public.orchidea_registra_presenze_multi_core(
    p_tesseramento_id,
    p_corso_ids,
    'selezione_multipla'
  );
end;
$$;

revoke execute on function public.orchidea_checkin_course_options(uuid) from public;
revoke execute on function public.orchidea_registra_presenze_multi_core(uuid, uuid[], text) from public;
revoke execute on function public.registra_presenze_corsi_per_allievo(uuid, uuid[]) from public;

grant execute on function public.orchidea_checkin_course_options(uuid) to authenticated;
grant execute on function public.registra_presenze_corsi_per_allievo(uuid, uuid[]) to authenticated;

-- Le funzioni già esistenti registra_presenza_corso(...) e registra_presenza_corso_per_allievo(...)
-- continuano a funzionare perché chiamano orchidea_registra_presenza_core con la stessa firma.
