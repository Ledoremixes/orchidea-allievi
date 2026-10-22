-- =========================================================
-- ORCHIDEA APP - STEP 50
-- CHECK-IN GIORNALIERO: DA 30 MIN PRIMA DELLA PRIMA LEZIONE FINO ALLE 23:59
--
-- Obiettivo:
--   * il tablet apre 30 minuti prima della prima lezione Orchidea della giornata;
--   * per ogni allievo il check-in diventa valido 30 minuti prima della SUA prima lezione del giorno;
--   * una volta aperto, resta valido fino alle 23:59 dello stesso giorno;
--   * l'allievo può selezionare uno o più corsi che frequenta quel giorno;
--   * i corsi consecutivi restano preselezionabili insieme con un unico check-in;
--   * le presenze già registrate non vengono duplicate.
--
-- Eseguire dopo gli step check-in precedenti.
-- =========================================================

-- 1) Corsi della giornata mostrati al tablet.
-- Prima dell'apertura globale non restituisce nulla; dopo restituisce tutti i corsi di oggi.
create or replace function public.get_checkin_courses()
returns table (
  id uuid,
  nome text,
  livello text,
  sala text,
  giorno_settimana text,
  ora_inizio time,
  ora_fine time
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  local_now timestamp := timezone('Europe/Rome', now());
  first_start time;
begin
  if not public.is_admin() then
    raise exception 'Permesso negato';
  end if;

  select min(c.ora_inizio)
  into first_start
  from public.corsi c
  where coalesce(c.attivo, true) = true
    and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
    and c.ora_inizio is not null
    and c.ora_fine is not null
    and c.ora_fine > c.ora_inizio;

  if first_start is null
     or local_now::time < (first_start - interval '30 minutes')::time then
    return;
  end if;

  return query
  select
    c.id,
    c.nome,
    c.livello,
    c.sala,
    c.giorno_settimana,
    c.ora_inizio,
    c.ora_fine
  from public.corsi c
  where coalesce(c.attivo, true) = true
    and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
    and c.ora_inizio is not null
    and c.ora_fine is not null
    and c.ora_fine > c.ora_inizio
  order by c.ora_inizio, c.nome, c.livello;
end;
$$;

grant execute on function public.get_checkin_courses() to authenticated;


-- 2) Tutti i corsi DI OGGI a cui è iscritto uno specifico allievo.
-- La lista si apre da 30 minuti prima della prima lezione dell'allievo e resta valida fino a mezzanotte.
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
  student_first_start time;
begin
  if not public.is_admin() then
    raise exception 'Permesso negato';
  end if;

  select min(c.ora_inizio)
  into student_first_start
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
    and c.ora_fine > c.ora_inizio;

  -- Troppo presto rispetto alla prima lezione dell'allievo: nessuna opzione.
  if student_first_start is null
     or local_now::time < (student_first_start - interval '30 minutes')::time then
    return;
  end if;

  return query
  with enrolled as (
    select distinct
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
  )
  select
    e.id,
    e.nome,
    e.livello,
    e.sala,
    e.giorno_settimana,
    e.ora_inizio,
    e.ora_fine,
    exists (
      select 1
      from public.presenze_corsi p
      where p.tesseramento_id = p_tesseramento_id
        and p.corso_id = e.id
        and p.data_lezione = local_date
    ) as already_registered,
    exists (
      select 1
      from enrolled adjacent
      where adjacent.id <> e.id
        and (
          adjacent.ora_inizio = e.ora_fine
          or adjacent.ora_fine = e.ora_inizio
        )
    ) as consecutive
  from enrolled e
  order by e.ora_inizio, e.nome, e.livello;
end;
$$;

revoke execute on function public.orchidea_checkin_course_options(uuid) from public;
grant execute on function public.orchidea_checkin_course_options(uuid) to authenticated;


-- 3) Core multi: invariato nella registrazione, ma ora le opzioni consentite sono quelle dell'intera giornata.
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
      'message', 'Uno dei corsi selezionati non è disponibile per il check-in di oggi.'
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

    course_names := array_append(
      course_names,
      trim(coalesce(option_row.nome, '') || case when nullif(option_row.livello, '') is not null then ' ' || option_row.livello else '' end)
    );

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

revoke execute on function public.orchidea_registra_presenze_multi_core(uuid, uuid[], text) from public;


-- 4) Core singolo: apre dalla prima lezione dell'allievo -30 minuti e resta valido fino a fine giornata.
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
  student_row public.tesseramenti%rowtype;
  day_course_count integer := 0;
  first_start time := null;
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

  select count(*), min(c.ora_inizio)
  into day_course_count, first_start
  from public.corsi c
  join public.iscrizioni_corsi ic
    on ic.corso_id = c.id
   and ic.tesseramento_id = student_row.id
  where coalesce(c.attivo, true) = true
    and ic.stato = 'attivo'
    and coalesce(ic.rinnovo_attivo, true) = true
    and coalesce(ic.data_inizio, ic.data_iscrizione, local_date) <= local_date
    and (ic.data_fine is null or ic.data_fine >= local_date)
    and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
    and c.ora_inizio is not null
    and c.ora_fine is not null
    and c.ora_fine > c.ora_inizio;

  if day_course_count = 0 then
    return jsonb_build_object(
      'status', 'not_enrolled',
      'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
      'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
      'message', 'Oggi non risultano corsi attivi associati al tuo profilo.'
    );
  end if;

  if local_now::time < (first_start - interval '30 minutes')::time then
    return jsonb_build_object(
      'status', 'too_early',
      'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
      'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
      'message', 'Il check-in di oggi sarà disponibile dalle ' || to_char((first_start - interval '30 minutes')::time, 'HH24:MI') || '.'
    );
  end if;

  if p_corso_id is not null then
    return public.orchidea_registra_presenze_multi_core(
      student_row.id,
      array[p_corso_id]::uuid[],
      p_metodo_identificazione
    );
  end if;

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
    return jsonb_build_object(
      'status', 'no_course',
      'first_name', student_row.nome,
      'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
      'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
      'message', 'Il check-in di oggi non è ancora disponibile.'
    );
  end if;

  if pending_count = 0 then
    return public.orchidea_registra_presenze_multi_core(
      student_row.id,
      option_ids,
      p_metodo_identificazione
    );
  end if;

  if pending_count = 1 then
    return public.orchidea_registra_presenze_multi_core(
      student_row.id,
      pending_ids,
      p_metodo_identificazione
    );
  end if;

  return jsonb_build_object(
    'status', 'choose_courses',
    'tesseramento_id', student_row.id,
    'first_name', student_row.nome,
    'gender', public.orchidea_student_gender(student_row.sesso, student_row.cf),
    'full_name', trim(coalesce(student_row.nome, '') || ' ' || coalesce(student_row.cognome, '')),
    'courses', options_json,
    'message', 'Seleziona i corsi che hai frequentato oggi: puoi registrarli insieme con un solo check-in.'
  );
end;
$$;


-- 5) Ricerca nome/cognome: considera i corsisti che hanno almeno una lezione OGGI
-- e per cui la finestra personale è già aperta.
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
      end as search_rank,
      min(c.ora_inizio) as first_start
    from public.tesseramenti t
    join public.iscrizioni_corsi ic
      on ic.tesseramento_id = t.id
     and ic.stato = 'attivo'
     and coalesce(ic.rinnovo_attivo, true) = true
     and coalesce(ic.data_inizio, ic.data_iscrizione, local_date) <= local_date
     and (ic.data_fine is null or ic.data_fine >= local_date)
    join public.corsi c
      on c.id = ic.corso_id
     and coalesce(c.attivo, true) = true
     and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
     and c.ora_inizio is not null
     and c.ora_fine is not null
     and c.ora_fine > c.ora_inizio
    where (
      lower(trim(coalesce(t.nome, ''))) like query_pattern
      or lower(trim(coalesce(t.cognome, ''))) like query_pattern
      or lower(trim(coalesce(t.nome, '') || ' ' || coalesce(t.cognome, ''))) like query_pattern
      or lower(trim(coalesce(t.cognome, '') || ' ' || coalesce(t.nome, ''))) like query_pattern
      or lower(trim(coalesce(t.numero_tessera, ''))) like query_pattern
    )
      and (p_corso_id is null or c.id = p_corso_id)
    group by t.id, t.nome, t.cognome, t.numero_tessera
  )
  select
    c.tesseramento_id,
    c.nome,
    c.cognome,
    c.numero_tessera,
    'corsi_di_oggi'::text as ambito
  from candidates c
  where local_now::time >= (c.first_start - interval '30 minutes')::time
  order by c.search_rank, lower(coalesce(c.cognome, '')), lower(coalesce(c.nome, '')), c.numero_tessera
  limit 10;
end;
$$;


-- 6) Conferma multi e wrapper: firme invariate per il frontend esistente.
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

revoke execute on function public.orchidea_registra_presenza_core(uuid, uuid, text) from public;
revoke execute on function public.cerca_allievi_checkin(text, uuid) from public;
revoke execute on function public.registra_presenze_corsi_per_allievo(uuid, uuid[]) from public;

grant execute on function public.cerca_allievi_checkin(text, uuid) to authenticated;
grant execute on function public.registra_presenze_corsi_per_allievo(uuid, uuid[]) to authenticated;

-- I wrapper registra_presenza_corso(...) e registra_presenza_corso_per_allievo(...)
-- già presenti continuano a chiamare orchidea_registra_presenza_core con la stessa firma.

notify pgrst, 'reload schema';
