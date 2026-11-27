-- Preserve authoritative shared rounds; early close after all answers, safe manual advance.
create or replace function orchidea_games.submit(p_round uuid,p_value text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e orchidea_games.events; r orchidea_games.rounds; p orchidea_games.players; idx int; score int:=0; msg text:='Risposta registrata'; waiting boolean:=false; team_key text; correct boolean; n int; spin_no int; received_at timestamptz:=clock_timestamp();
begin
 if not orchidea_games.allowed() then raise exception 'Accesso non autorizzato'; end if;
 select ee.* into e from orchidea_games.events ee join orchidea_games.rounds rr on rr.event_id=ee.id where rr.id=p_round for update of ee;
 select * into r from orchidea_games.rounds where id=p_round;
 if e.status is distinct from 'live' or r.status is distinct from 'live' or r.ends_at<=received_at then raise exception 'Tempo scaduto'; end if;
 select * into p from orchidea_games.players where event_id=e.id and user_id=auth.uid();
 if p.id is null then raise exception 'Partecipa prima all’evento'; end if;
 if exists(select 1 from orchidea_games.responses where round_id=r.id and player_id=p.id) then raise exception 'Hai già partecipato a questo round'; end if;
 if r.kind in ('quiz','awards','impostor') then
 if p_value is null or p_value !~ '^[0-9]{1,4}$' then raise exception 'Risposta non valida'; end if;
 idx:=p_value::int; n:=case when r.kind='impostor' then jsonb_array_length(r.roster) else jsonb_array_length(r.options) end;
 if idx not between 0 and n-1 then raise exception 'Risposta non valida'; end if;
 p_value:=idx::text;
 if r.kind='impostor' and not exists(select 1 from jsonb_array_elements(r.roster) x where x->>'id'=p.id::text) then raise exception 'Attendi il prossimo round'; end if;
 if r.kind='quiz' or r.kind='impostor' then
 correct:=case when r.kind='quiz' then idx=r.answer else (r.roster->idx->>'id')::uuid=r.impostor_id and p.id<>r.impostor_id end;
 if correct then score:=case when r.kind='quiz' then round(r.points*(0.5+0.5*greatest(0,least(1,extract(epoch from (r.ends_at-received_at))/r.seconds))))::int else r.points end; msg:='Risposta corretta!'; else msg:='Risposta errata'; end if;
 end if;
 elsif r.kind='wheel' then
 if p_value is distinct from 'spin' then raise exception 'Operazione non valida'; end if;
 if exists(select 1 from orchidea_games.responses s join orchidea_games.rounds rr on rr.id=s.round_id where s.player_id=p.id and rr.kind='wheel' and rr.event_id=e.id) then raise exception 'Hai già girato la ruota in questo evento'; end if;
 update orchidea_games.rounds set wheel_count=wheel_count+1 where id=r.id returning wheel_count into spin_no;
 if r.wheel_rules <> '{}'::jsonb then idx:=coalesce((r.wheel_rules->>spin_no::text)::int,r.wheel_default); else idx:=floor(random()*jsonb_array_length(r.options))::int; end if;
 msg:=r.options->>idx; p_value:=idx::text;
 elsif r.kind in ('mission','bingo','battle') then
 if p_value is distinct from 'done' then raise exception 'Operazione non valida'; end if;
 if r.kind='battle' then if p.team='' then raise exception 'Serve un tavolo assegnato quando partecipi'; end if; team_key:=lower(trim(p.team)); end if;
 waiting:=true; msg:='In attesa di conferma del presentatore';
 else raise exception 'Gioco non valido'; end if;
 insert into orchidea_games.responses(round_id,player_id,value,result,points,pending,team_key) values(r.id,p.id,p_value,msg,score,waiting,team_key);
 -- A shared quiz can close early only when all registered players have answered.
 if r.kind='quiz' and exists(select 1 from orchidea_games.quiz_queue q where q.round_id=r.id) and not exists(select 1 from orchidea_games.players pl where pl.event_id=e.id and not exists(select 1 from orchidea_games.responses s where s.round_id=r.id and s.player_id=pl.id)) then
 update orchidea_games.rounds set status='closed' where id=r.id and status='live';
 end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function orchidea_games.quiz_action(p_action text,p_questions jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare e orchidea_games.events; q orchidea_games.quiz_queue; r orchidea_games.rounds; item jsonb; question jsonb; pos int; rid uuid; n int;
begin
 if not orchidea_games.allowed() or not public.is_admin() then raise exception 'Solo amministratori'; end if;
 perform pg_advisory_xact_lock(27111926);
 select * into e from orchidea_games.events where status='live' for update;
 if e.id is null then raise exception 'Apri prima un evento'; end if;
 if p_action='start' then
 if jsonb_typeof(p_questions) is distinct from 'array' then raise exception 'Domande non valide'; end if;
 n:=jsonb_array_length(p_questions); if n not between 1 and 50 then raise exception 'Inserisci 1–50 domande'; end if;
 for item in select value from jsonb_array_elements(p_questions) loop
 if length(trim(coalesce(item->>'prompt',''))) not between 1 and 500 or jsonb_typeof(item->'options') is distinct from 'array' then raise exception 'Domanda non valida'; end if;
 if jsonb_array_length(item->'options') not between 2 and 6 or coalesce((item->>'answer')::int,-1) not between 0 and jsonb_array_length(item->'options')-1 or coalesce((item->>'seconds')::int,0) not between 10 and 1800 or coalesce((item->>'points')::int,-1) not between 0 and 1000 then raise exception 'Controlla risposte, tempo e punti'; end if;
 if exists(select 1 from jsonb_array_elements(item->'options') x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and 250) then raise exception 'Opzione non valida'; end if;
 end loop;
 pos:=0; question:=p_questions->pos;
 elsif p_action in ('next','next_force') then
 select * into q from orchidea_games.quiz_queue where event_id=e.id for update;
 if q.event_id is null then raise exception 'Nessun quiz in corso'; end if;
 select * into r from orchidea_games.rounds where id=q.round_id;
 if r.id is distinct from (select id from orchidea_games.rounds where event_id=e.id order by starts_at desc limit 1) then raise exception 'Quiz non più attivo'; end if;
 if p_questions is not null and (p_questions->>'round_id') is distinct from r.id::text then raise exception 'Domanda già cambiata: aggiorna la schermata'; end if;
 if r.status='live' and r.ends_at>clock_timestamp() and p_action<>'next_force' then raise exception 'Attendi le risposte degli altri partecipanti'; end if;
 pos:=q.position+1; p_questions:=q.questions;
 if pos>=jsonb_array_length(p_questions) then raise exception 'Quiz concluso'; end if;
 question:=p_questions->pos;
 if p_action='next_force' then update orchidea_games.rounds set status='closed' where id=r.id and status='live'; end if;
 else raise exception 'Comando non valido'; end if;
 perform orchidea_games.admin('round',question||jsonb_build_object('kind','quiz'));
 select id into rid from orchidea_games.rounds where event_id=e.id order by starts_at desc limit 1;
 insert into orchidea_games.quiz_queue(event_id,questions,position,round_id) values(e.id,p_questions,pos,rid)
 on conflict(event_id) do update set questions=excluded.questions,position=excluded.position,round_id=excluded.round_id;
 return jsonb_build_object('ok',true);
end $$;
create or replace function orchidea_games.extras() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e orchidea_games.events; r orchidea_games.rounds; q orchidea_games.quiz_queue; p orchidea_games.players; idx int; result jsonb:='{}'; already boolean; answered_count int; eligible_count int;
begin
 if not orchidea_games.allowed() then raise exception 'Accesso non autorizzato'; end if;
 select * into e from orchidea_games.events order by created_at desc limit 1;
 select * into r from orchidea_games.rounds where event_id=e.id order by starts_at desc limit 1;
 select * into p from orchidea_games.players where event_id=e.id and user_id=auth.uid();
 if r.kind='wheel' and (p.id is not null or public.is_admin()) then
 select s.value::int into idx from orchidea_games.responses s where s.round_id=r.id and s.player_id=p.id;
 select exists(select 1 from orchidea_games.responses s join orchidea_games.rounds rr on rr.id=s.round_id where rr.event_id=e.id and rr.kind='wheel' and s.player_id=p.id) into already;
 result:=jsonb_build_object('wheel',jsonb_build_object('index',idx,'programmed',r.wheel_rules<>'{}'::jsonb,'used',already,'count',case when public.is_admin() then r.wheel_count end));
 end if;
 select * into q from orchidea_games.quiz_queue where event_id=e.id and round_id=r.id;
 if q.event_id is not null then
 select count(*) into eligible_count from orchidea_games.players pl where pl.event_id=e.id;
 select count(*) into answered_count from orchidea_games.responses s where s.round_id=r.id;
 result:=result||jsonb_build_object('quiz',jsonb_build_object('position',q.position+1,'total',jsonb_array_length(q.questions),'answered',answered_count,'eligible',eligible_count));
 end if;
 return result;
end $$;
