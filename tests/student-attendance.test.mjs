import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('self attendance validates identity, enrollment, time and duplicate submissions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('test.uid', true), '')::uuid
      $$;
      create table public.tesseramenti (id uuid primary key, auth_user_id uuid, tessera_attiva boolean);
      create table public.corsi (id uuid primary key, nome text, livello text, sala text,
        giorno_settimana text, ora_inizio time, ora_fine time, attivo boolean);
      create table public.iscrizioni_corsi (tesseramento_id uuid, corso_id uuid, stato text,
        rinnovo_attivo boolean, data_inizio date, data_iscrizione date, data_fine date);
      create table public.presenze_corsi (id uuid default gen_random_uuid(), tesseramento_id uuid,
        corso_id uuid, data_lezione date, checked_in_at timestamptz, metodo_identificazione text,
        sorgente text, created_by uuid, unique(tesseramento_id, corso_id, data_lezione));
      create function public.get_my_tesseramento() returns setof public.tesseramenti
        language sql as $$ select * from public.tesseramenti where auth_user_id = auth.uid() limit 1 $$;
      create function public.orchidea_weekday_number(text) returns integer language sql as $$ select $1::integer $$;
      insert into tesseramenti values ('00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000011', true);
      insert into corsi values ('00000000-0000-0000-0000-000000000002','Salsa','Base','Sala 1',
        extract(isodow from timezone('Europe/Rome', now()))::text, '00:30', '23:59:59',true);
      insert into iscrizioni_corsi values ('00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002','attivo',true,current_date - 1,current_date - 1,null);
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261013065853_student_course_attendance.sql', import.meta.url), 'utf8'));
    const courseId = '00000000-0000-0000-0000-000000000002';
    const status = async () => (await db.query('select public.register_my_course_attendance($1) as result', [courseId])).rows[0].result.status;
    await assert.rejects(status, /Accesso richiesto/);
    const permissions = (await db.query(`select
      has_function_privilege('anon','public.register_my_course_attendance(uuid)','execute') as anon,
      has_function_privilege('authenticated','public.register_my_course_attendance(uuid)','execute') as member`)).rows[0];
    assert.deepEqual(permissions, { anon: false, member: true });
    await db.exec(`set test.uid = '00000000-0000-0000-0000-000000000099'`);
    assert.equal(await status(), 'not_linked');
    await db.exec(`set test.uid = '00000000-0000-0000-0000-000000000011'; set role authenticated;`);
    assert.equal(await status(), 'success');
    assert.equal(await status(), 'already_registered');
    await db.exec('reset role');
    const rows = (await db.query('select * from presenze_corsi')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sorgente, 'app');
    assert.equal(rows[0].created_by, '00000000-0000-0000-0000-000000000011');
    await db.exec('delete from presenze_corsi; update tesseramenti set tessera_attiva = false');
    assert.equal(await status(), 'inactive_membership');
    await db.exec(`update tesseramenti set tessera_attiva = true;
      update iscrizioni_corsi set rinnovo_attivo = false`);
    assert.equal(await status(), 'unavailable');
    await db.exec(`update iscrizioni_corsi set rinnovo_attivo = true, data_fine = current_date - 2`);
    assert.equal(await status(), 'unavailable');
    await db.exec(`update iscrizioni_corsi set data_fine = null, data_inizio = current_date + 2`);
    assert.equal(await status(), 'unavailable');
    await db.exec(`update iscrizioni_corsi set data_inizio = current_date - 1;
      update corsi set attivo = false`);
    assert.equal(await status(), 'unavailable');
    await db.exec(`update corsi set attivo = true, giorno_settimana = '0'`);
    assert.equal(await status(), 'unavailable');
    await db.exec(`update corsi set giorno_settimana = extract(isodow from timezone('Europe/Rome', now()))::text,
      ora_inizio = case when timezone('Europe/Rome',now())::time > '12:00'::time then '01:00'::time else '22:00'::time end,
      ora_fine = case when timezone('Europe/Rome',now())::time > '12:00'::time then '02:00'::time else '23:00'::time end`);
    assert.equal(await status(), 'outside_window');
    assert.equal((await db.query('select count(*)::integer as total from presenze_corsi')).rows[0].total, 0);
    // Freeze only the test database clock to check the evening and midnight boundary.
    await db.exec(`create function public.test_clock() returns timestamptz language sql stable as $$
      select current_setting('test.clock')::timestamp at time zone 'Europe/Rome' $$;
      update corsi set nome = 'Salsa Intermedio', giorno_settimana = '4', ora_inizio = '20:30', ora_fine = '21:30';
      update iscrizioni_corsi set data_inizio = '2026-01-01', data_iscrizione = '2026-01-01';`);
    const midnightMigration = await readFile(new URL('../supabase/migrations/20261022194203_student_attendance_until_midnight.sql', import.meta.url), 'utf8');
    await db.exec(midnightMigration.replaceAll('now()', 'public.test_clock()'));
    for (const [clock, expected] of [
      ['2026-10-22 19:59:59', 'outside_window'],
      ['2026-10-22 20:00:00', 'success'],
      ['2026-10-22 21:40:00', 'success'],
      ['2026-10-22 23:59:59', 'success'],
      ['2026-10-23 00:00:00', 'unavailable'],
    ]) {
      await db.exec(`delete from presenze_corsi; set test.clock = '${clock}'; set role authenticated;`);
      assert.equal(await status(), expected, clock);
      if (expected === 'success') assert.equal(await status(), 'already_registered');
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
