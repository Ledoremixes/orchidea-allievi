-- Requires the existing step-14 attendance schema and get_my_tesseramento().
-- Self check-in has its own API; tablet/admin functions remain unchanged.
begin;

create or replace function public.get_my_attendance_courses()
returns table (
  id uuid, nome text, livello text, sala text, ora_inizio time, ora_fine time,
  already_registered boolean, membership_active boolean, can_register boolean
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  local_now timestamp := timezone('Europe/Rome', now());
  student public.tesseramenti%rowtype;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto' using errcode = '42501'; end if;
  select * into student from public.get_my_tesseramento();
  if student.id is null then return; end if;

  return query
  select c.id, c.nome, c.livello, c.sala, c.ora_inizio, c.ora_fine,
    exists (select 1 from public.presenze_corsi p where p.tesseramento_id = student.id
      and p.corso_id = c.id and p.data_lezione = local_now::date),
    coalesce(student.tessera_attiva, true),
    coalesce(student.tessera_attiva, true)
      and local_now >= local_now::date + c.ora_inizio - interval '30 minutes'
        and local_now < local_now::date + interval '1 day'
  from public.corsi c
  where coalesce(c.attivo, true)
    and public.orchidea_weekday_number(c.giorno_settimana) = extract(isodow from local_now)::integer
    and c.ora_inizio is not null and c.ora_fine > c.ora_inizio
    and exists (select 1 from public.iscrizioni_corsi ic
      where ic.corso_id = c.id and ic.tesseramento_id = student.id
        and ic.stato = 'attivo' and coalesce(ic.rinnovo_attivo, true)
        and coalesce(ic.data_inizio, ic.data_iscrizione, local_now::date) <= local_now::date
        and (ic.data_fine is null or ic.data_fine >= local_now::date))
  order by c.ora_inizio, c.nome, c.id;
end;
$$;

create or replace function public.register_my_course_attendance(p_corso_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  student public.tesseramenti%rowtype;
  course record;
  attendance_id uuid;
  local_date date := timezone('Europe/Rome', now())::date;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto' using errcode = '42501'; end if;
  select * into student from public.get_my_tesseramento();
  if student.id is null then
    return jsonb_build_object('status', 'not_linked', 'message', 'Account non collegato a un tesseramento. Contatta la segreteria.');
  end if;
  select * into course from public.get_my_attendance_courses() c where c.id = p_corso_id;
  if not found then
    return jsonb_build_object('status', 'unavailable', 'message', 'Oggi non risulti iscritto a questo corso attivo. Contatta la segreteria.');
  end if;
  if course.already_registered then
    return jsonb_build_object('status', 'already_registered', 'message', 'La presenza è già registrata.');
  end if;
  if not course.membership_active then
    return jsonb_build_object('status', 'inactive_membership', 'message', 'La tessera non è attiva. Contatta la segreteria.');
  end if;
  if not course.can_register then
    return jsonb_build_object('status', 'outside_window', 'message', 'Puoi registrare la presenza da 30 minuti prima dell’inizio fino a mezzanotte del giorno della lezione.');
  end if;

  -- The unique constraint also handles simultaneous app/tablet requests.
  -- Identity, date, source and audit fields are always assigned on the server.
  insert into public.presenze_corsi
    (tesseramento_id, corso_id, data_lezione, checked_in_at, metodo_identificazione, sorgente, created_by)
  values (student.id, p_corso_id, local_date, now(), 'account', 'app', auth.uid())
  on conflict (tesseramento_id, corso_id, data_lezione) do nothing
  returning id into attendance_id;
  if attendance_id is null then
    return jsonb_build_object('status', 'already_registered', 'message', 'La presenza è già registrata.');
  end if;
  return jsonb_build_object('status', 'success', 'message', 'Presenza registrata con successo.', 'attendance_id', attendance_id);
end;
$$;

-- No INSERT policy for students: only the validated operation can write.
revoke all on function public.get_my_attendance_courses() from public, anon;
revoke all on function public.register_my_course_attendance(uuid) from public, anon;
grant execute on function public.get_my_attendance_courses() to authenticated;
grant execute on function public.register_my_course_attendance(uuid) to authenticated;
commit;

