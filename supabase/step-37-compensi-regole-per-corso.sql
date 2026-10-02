-- STEP 37 - COMPENSI INSEGNANTI: REGOLE SPECIFICHE PER CORSO
-- Allinea Orchidea App alla logica corrente di Nova.
-- La percentuale generale dell'insegnante resta il fallback, ma ogni collegamento
-- insegnanti_corsi.percentuale_compenso puo sovrascriverla per il singolo corso.
-- Esempio: Laura 20% generale + Lady Style 40%.
--
-- La funzione continua a usare la stessa competenza mensile, ripartizione delle
-- quote pagate e storico prezzi dello STEP 25.2. Lo storico dei 12 mesi si aggiorna
-- automaticamente perche richiama questa funzione.

drop function if exists public.get_my_teacher_compensation_nova(text);
create function public.get_my_teacher_compensation_nova(
  p_month text default to_char(current_date, 'YYYY-MM')
)
returns table (
  corso_id uuid,
  corso_nome text,
  corso_livello text,
  giorno_settimana text,
  ora_inizio time,
  ora_fine time,
  corsisti_paganti bigint,
  compenso numeric,
  metodo_compenso text,
  aliquota numeric
)
language sql
stable
security definer
set search_path = public
as $$
with recursive
params as (
  select
    case
      when coalesce(p_month, '') ~ '^[0-9]{4}-[0-9]{2}$' then p_month
      else to_char(current_date, 'YYYY-MM')
    end as selected_month,
    to_date(
      case
        when coalesce(p_month, '') ~ '^[0-9]{4}-[0-9]{2}$' then p_month
        else to_char(current_date, 'YYYY-MM')
      end || '-01',
      'YYYY-MM-DD'
    )::date as month_start
),
param_dates as (
  select
    selected_month,
    month_start,
    (month_start + interval '1 month - 1 day')::date as month_end
  from params
),
my_teacher as (
  select
    i.id as teacher_id,
    i.nome as teacher_name,
    lower(coalesce(nullif(trim(i.pagamento_tipo), ''), 'percentuale')) as payment_type,
    coalesce(i.percentuale_compenso, 0)::numeric as percentage_compensation,
    coalesce(i.compenso_fisso_mensile, 0)::numeric as fixed_monthly_compensation,
    coalesce(i.compenso_orario, 0)::numeric as hourly_rate
  from public.insegnanti i
  where i.id = public.resolve_my_teacher_compensation_id()
  limit 1
),
assigned_courses as (
  select
    c.id as corso_id,
    c.nome as corso_nome,
    c.livello as corso_livello,
    c.giorno_settimana,
    c.ora_inizio,
    c.ora_fine,
    ic.percentuale_compenso::numeric as course_percentage_compensation
  from public.insegnanti_corsi ic
  join my_teacher mt on mt.teacher_id = ic.insegnante_id
  join public.corsi c on c.id = ic.corso_id
  where ic.attivo is distinct from false
    and c.attivo is distinct from false
),
-- Iscrizioni attive nel mese: replica enrollmentIsActiveForMonth di Nova.
all_active_enrollments_base as (
  select
    e.id as enrollment_id,
    e.tesseramento_id,
    e.corso_id,
    e.quota_allievo_mensile,
    e.tariffa_mensile,
    e.created_at,
    c.nome as corso_nome,
    c.livello as corso_livello,
    c.giorno_settimana,
    c.ora_inizio,
    c.ora_fine,
    c.prezzo_mensile
  from public.iscrizioni_corsi e
  join public.corsi c on c.id = e.corso_id
  cross join param_dates prm
  where lower(coalesce(e.stato, '')) not in ('annullato','rimosso','cancellato','inactive','non_attivo')
    and e.rinnovo_attivo is distinct from false
    and c.attivo is distinct from false
    and coalesce(e.data_inizio, e.data_iscrizione, e.created_at::date, prm.month_start) <= prm.month_end
    and coalesce(e.data_fine, prm.month_end) >= prm.month_start
),
-- Limitiamo i calcoli agli allievi che frequentano almeno un corso del docente,
-- ma per la ripartizione manteniamo TUTTI i loro corsi attivi.
teacher_students as (
  select distinct e.tesseramento_id
  from all_active_enrollments_base e
  join assigned_courses ac on ac.corso_id = e.corso_id
  where e.tesseramento_id is not null
),
all_active_enrollments as (
  select e.*
  from all_active_enrollments_base e
  join teacher_students ts on ts.tesseramento_id = e.tesseramento_id
),
-- Prezzo storico piu' recente dell'iscrizione valido entro la fine del mese.
latest_pricing as (
  select distinct on (h.enrollment_id::text)
    h.enrollment_id::text as enrollment_id,
    h.quota_allievo_mensile
  from public.nova_package_pricing_history h
  join all_active_enrollments e on e.enrollment_id::text = h.enrollment_id::text
  cross join param_dates prm
  where h.effective_from is not null
    and h.effective_from::date <= prm.month_end
  order by h.enrollment_id::text, h.effective_from desc, h.id desc
),
priced_enrollments as (
  select
    e.*,
    greatest(
      0::numeric,
      coalesce(
        lp.quota_allievo_mensile,
        e.quota_allievo_mensile,
        e.tariffa_mensile,
        e.prezzo_mensile,
        0
      )::numeric
    ) as prezzo_corso
  from all_active_enrollments e
  left join latest_pricing lp on lp.enrollment_id = e.enrollment_id::text
),
-- Pagamenti che Nova considera di competenza del mese.
month_payments as (
  select p.*
  from public.pagamenti p
  join teacher_students ts on ts.tesseramento_id = p.tesseramento_id
  cross join param_dates prm
  where (
    -- Quando esiste una competenza esplicita, Nova usa quella e NON la data di incasso.
    (
      nullif(trim(coalesce(p.periodo::text, '')), '') is not null
      or p.mese is not null
      or p.scadenza is not null
    )
    and (
      left(coalesce(p.periodo::text, ''), 7) = prm.selected_month
      or left(coalesce(p.mese::text, ''), 7) = prm.selected_month
      or left(coalesce(p.scadenza::text, ''), 7) = prm.selected_month
    )
  )
  or (
    nullif(trim(coalesce(p.periodo::text, '')), '') is null
    and p.mese is null
    and p.scadenza is null
    and (
      left(coalesce(p.data_pagamento::text, ''), 7) = prm.selected_month
      or left(coalesce(p.pagato_il::text, ''), 7) = prm.selected_month
      or left(coalesce(p.created_at::text, ''), 7) = prm.selected_month
    )
  )
),
classified_payments as (
  select
    p.*,
    (
      lower(coalesce(p.tipo, '')) in ('quota_mensile', 'quota mensile')
      or lower(coalesce(p.descrizione, '')) like 'quota mensile %'
    ) as is_canonical,
    (
      lower(coalesce(p.nova_package_type, '')) = 'gettone'
      or lower(coalesce(p.tipo, '')) like '%gettone%'
      or lower(coalesce(p.descrizione, '')) like '%a gettone%'
      or lower(coalesce(p.descrizione, '')) like '%lezione singola%'
    ) as is_token,
    lower(coalesce(p.stato, '')) in ('pagato','paid','coperto','parziale','partial') as is_paid,
    lower(coalesce(p.stato, '')) in ('sospeso','chiuso','paused','closed') as is_paused
  from month_payments p
),
canonical_ranked as (
  select
    p.*,
    row_number() over (
      partition by p.tesseramento_id
      order by p.updated_at desc nulls last, p.created_at desc nulls last, p.id desc
    ) as rn
  from classified_payments p
  where p.is_canonical
    and not p.is_token
),
canonical_paid as (
  select
    p.tesseramento_id,
    case
      when p.is_paid and not p.is_paused then greatest(coalesce(p.importo, 0), 0)::numeric
      else 0::numeric
    end as paid_amount
  from canonical_ranked p
  where p.rn = 1
),
token_paid as (
  select
    p.tesseramento_id,
    sum(
      case
        when p.is_paid and not p.is_paused then greatest(coalesce(p.importo, 0), 0)
        else 0
      end
    )::numeric as paid_amount
  from classified_payments p
  where p.is_token
  group by p.tesseramento_id
),
-- Compatibilita' con i vecchi record: se non esiste la quota_mensile Nova,
-- sommiamo soltanto pagamenti didattici validi ed escludiamo tessere/eventi/etc.
legacy_paid as (
  select
    p.tesseramento_id,
    sum(
      case
        when p.is_paid and not p.is_paused then greatest(coalesce(p.importo, 0), 0)
        else 0
      end
    )::numeric as paid_amount
  from classified_payments p
  where not p.is_canonical
    and not p.is_token
    and not (
      lower(coalesce(p.tipo, '')) ~ '(associativ|tesser|visita|certificat|evento|serata|shop)'
      or lower(coalesce(p.descrizione, '')) ~ '(associativ|tesser|visita|certificat|evento|serata|shop)'
    )
    and (
      lower(coalesce(p.tipo, '')) ~ '(corso|quota corso|mensile|pacchetto)'
      or lower(coalesce(p.descrizione, '')) ~ '(corso|quota corso|mensile|pacchetto)'
      or p.periodo is not null
    )
  group by p.tesseramento_id
),
student_paid as (
  select
    ts.tesseramento_id,
    greatest(
      0::numeric,
      (
        case
          when cp.tesseramento_id is not null then coalesce(cp.paid_amount, 0)
          else coalesce(lp.paid_amount, 0)
        end
        + coalesce(tp.paid_amount, 0)
      )::numeric
    ) as paid_amount
  from teacher_students ts
  left join canonical_paid cp on cp.tesseramento_id = ts.tesseramento_id
  left join legacy_paid lp on lp.tesseramento_id = ts.tesseramento_id
  left join token_paid tp on tp.tesseramento_id = ts.tesseramento_id
),
weighted_enrollments as (
  select
    e.*,
    sp.paid_amount,
    sum(e.prezzo_corso) over (partition by e.tesseramento_id) as total_weight,
    count(*) over (partition by e.tesseramento_id) as courses_count,
    row_number() over (
      partition by e.tesseramento_id
      order by e.created_at nulls last, e.enrollment_id
    ) as rn
  from priced_enrollments e
  join student_paid sp on sp.tesseramento_id = e.tesseramento_id
  where sp.paid_amount > 0
),
allocation_pre as (
  select
    w.*,
    round(
      w.paid_amount *
      case
        when w.total_weight > 0 then w.prezzo_corso / w.total_weight
        else 1::numeric / greatest(w.courses_count, 1)
      end,
      2
    ) as provisional_share
  from weighted_enrollments w
),
allocations as (
  select
    a.*,
    greatest(
      0::numeric,
      case
        -- Nova arrotonda a centesimi tutti i corsi tranne l'ultimo,
        -- che riceve il residuo per mantenere esattamente il totale pagato.
        when a.rn = a.courses_count then
          a.paid_amount - coalesce(
            sum(a.provisional_share) over (
              partition by a.tesseramento_id
              order by a.rn
              rows between unbounded preceding and 1 preceding
            ),
            0
          )
        else a.provisional_share
      end
    )::numeric as paid_student_quota
  from allocation_pre a
),
assigned_allocations as (
  select a.*
  from allocations a
  join assigned_courses ac on ac.corso_id = a.corso_id
  where a.paid_student_quota > 0
),
course_stats as (
  select
    ac.corso_id,
    ac.corso_nome,
    ac.corso_livello,
    ac.giorno_settimana,
    ac.ora_inizio,
    ac.ora_fine,
    ac.course_percentage_compensation,
    count(distinct aa.tesseramento_id)::bigint as corsisti_paganti,
    coalesce(sum(aa.paid_student_quota), 0)::numeric as quota_pagata_attribuita
  from assigned_courses ac
  left join assigned_allocations aa on aa.corso_id = ac.corso_id
  group by
    ac.corso_id,
    ac.corso_nome,
    ac.corso_livello,
    ac.giorno_settimana,
    ac.ora_inizio,
    ac.ora_fine,
    ac.course_percentage_compensation
),
percentage_rows as (
  select
    cs.corso_id,
    cs.corso_nome,
    cs.corso_livello,
    cs.giorno_settimana,
    cs.ora_inizio,
    cs.ora_fine,
    cs.corsisti_paganti,
    round(
      cs.quota_pagata_attribuita
      * coalesce(cs.course_percentage_compensation, mt.percentage_compensation)
      / 100.0,
      2
    )::numeric as compenso,
    'percentuale'::text as metodo_compenso,
    coalesce(cs.course_percentage_compensation, mt.percentage_compensation)::numeric as aliquota
  from course_stats cs
  cross join my_teacher mt
  where mt.payment_type not like '%orar%'
    and mt.payment_type not like '%fiss%'
),
fixed_rows as (
  select
    null::uuid as corso_id,
    'Compenso mensile fisso'::text as corso_nome,
    null::text as corso_livello,
    null::text as giorno_settimana,
    null::time as ora_inizio,
    null::time as ora_fine,
    count(distinct aa.tesseramento_id)::bigint as corsisti_paganti,
    round(mt.fixed_monthly_compensation, 2)::numeric as compenso,
    'fisso'::text as metodo_compenso,
    mt.fixed_monthly_compensation::numeric as aliquota
  from my_teacher mt
  left join assigned_allocations aa on true
  where mt.payment_type like '%fiss%'
  group by mt.fixed_monthly_compensation
  having count(aa.tesseramento_id) > 0
),
hourly_course_base as (
  select
    cs.*,
    case
      when translate(lower(coalesce(cs.giorno_settimana, '')), 'àèéìòù', 'aeeiou') in ('lunedi','monday') then 1
      when translate(lower(coalesce(cs.giorno_settimana, '')), 'àèéìòù', 'aeeiou') in ('martedi','tuesday') then 2
      when translate(lower(coalesce(cs.giorno_settimana, '')), 'àèéìòù', 'aeeiou') in ('mercoledi','wednesday') then 3
      when translate(lower(coalesce(cs.giorno_settimana, '')), 'àèéìòù', 'aeeiou') in ('giovedi','thursday') then 4
      when translate(lower(coalesce(cs.giorno_settimana, '')), 'àèéìòù', 'aeeiou') in ('venerdi','friday') then 5
      when translate(lower(coalesce(cs.giorno_settimana, '')), 'àèéìòù', 'aeeiou') in ('sabato','saturday') then 6
      when translate(lower(coalesce(cs.giorno_settimana, '')), 'àèéìòù', 'aeeiou') in ('domenica','sunday') then 0
      else null
    end as dow_num
  from course_stats cs
  where cs.corsisti_paganti > 0
),
hourly_rows as (
  select
    hb.corso_id,
    hb.corso_nome,
    hb.corso_livello,
    hb.giorno_settimana,
    hb.ora_inizio,
    hb.ora_fine,
    hb.corsisti_paganti,
    round(
      coalesce(mt.hourly_rate, 0) *
      coalesce((
        select count(*)::numeric
        from generate_series(prm.month_start, prm.month_end, interval '1 day') d
        where extract(dow from d) = hb.dow_num
      ), 0) *
      greatest(
        0::numeric,
        coalesce(extract(epoch from (hb.ora_fine - hb.ora_inizio)) / 3600.0, 0)
      ),
      2
    )::numeric as compenso,
    'orario'::text as metodo_compenso,
    mt.hourly_rate::numeric as aliquota
  from hourly_course_base hb
  cross join my_teacher mt
  cross join param_dates prm
  where mt.payment_type like '%orar%'
)
select * from percentage_rows
union all
select * from fixed_rows
union all
select * from hourly_rows
order by giorno_settimana nulls last, ora_inizio nulls last, corso_nome;
$$;

grant execute on function public.get_my_teacher_compensation_nova(text) to authenticated;
