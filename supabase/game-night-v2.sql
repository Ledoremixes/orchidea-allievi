alter table orchidea_games.rounds add column wheel_rules jsonb not null default '{}', add column wheel_count integer not null default 0, add column wheel_default integer not null default 0;
alter table orchidea_games.tombola_cards add column marked int[] not null default '{}';
create table orchidea_games.quiz_queue(event_id uuid primary key references orchidea_games.events(id), questions jsonb not null, position int not null, round_id uuid references orchidea_games.rounds(id));
alter table orchidea_games.quiz_queue enable row level security;
revoke all on orchidea_games.quiz_queue from public,anon,authenticated;
create or replace function orchidea_games.submit(p_round uuid,p_value text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e orchidea_games.events; r orchidea_games.rounds; p orchidea_games.players; idx int; score int:=0; msg text:='Risposta registrata'; waiting boolean:=false; team_key text; correct boolean; n int; spin_no int;
begin
 if not orchidea_games.allowed() then raise exception 'Accesso non autorizzato'; end if;
 select ee.* into e from orchidea_games.events ee join orchidea_games.rounds rr on rr.event_id=ee.id where rr.id=p_round for update of ee;
 select * into r from orchidea_games.rounds where id=p_round;
 if e.status is distinct from 'live' or r.status is distinct from 'live' or r.ends_at<=clock_timestamp() then raise exception 'Tempo scaduto'; end if;
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
 if correct then score:=case when r.kind='quiz' then round(r.points*(0.5+0.5*greatest(0,least(1,extract(epoch from (r.ends_at-clock_timestamp()))/r.seconds))))::int else r.points end; msg:='Risposta corretta!'; else msg:='Risposta errata'; end if;
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
 return jsonb_build_object('ok',true);
end $$;

create or replace function orchidea_games.admin(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare e orchidea_games.events; r orchidea_games.rounds; k text; prompt text; opts jsonb; a integer; secs integer; pts integer; roster jsonb:='[]'; imp uuid; n int; target uuid; pending_row orchidea_games.responses; new_round uuid; rules jsonb; fallback int;
begin
 if not orchidea_games.allowed() or not public.is_admin() then raise exception 'Solo amministratori'; end if;
 perform pg_advisory_xact_lock(27111926);
 select * into e from orchidea_games.events where status='live' for update;
 if p_action='event' then
 if e.id is not null then raise exception 'Chiudi prima l’evento in corso'; end if;
 prompt:=trim(coalesce(p_payload->>'title','')); if length(prompt) not between 1 and 150 then raise exception 'Nome evento non valido'; end if;
 insert into orchidea_games.events(title) values(prompt);
 elsif p_action='approve' or p_action='reject' then
 if e.id is null then select * into e from orchidea_games.events order by created_at desc limit 1 for update; end if;
 target:=(p_payload->>'id')::uuid;
 select s.* into pending_row from orchidea_games.responses s join orchidea_games.rounds rr on rr.id=s.round_id where s.id=target and rr.event_id=e.id and s.pending for update of s;
 if pending_row.id is null then raise exception 'Conferma non disponibile'; end if;
 update orchidea_games.responses s set pending=false,points=case when p_action='approve' then rr.points else 0 end,result=case when p_action='approve' then 'Sfida approvata!' else 'Sfida non convalidata' end from orchidea_games.rounds rr where s.id=target and rr.id=s.round_id;
 elsif e.id is null then raise exception 'Apri prima un evento';
 elsif p_action='close_event' then update orchidea_games.tombola_sessions set status='closed' where event_id=e.id and status in ('waiting','live'); update orchidea_games.rounds set status='closed' where event_id=e.id and status='live'; update orchidea_games.events set status='closed' where id=e.id;
 elsif p_action='close_round' then update orchidea_games.rounds set status='closed' where event_id=e.id and status='live';
 elsif p_action='round' then
 if exists(select 1 from orchidea_games.tombola_sessions ts where ts.event_id=e.id and ts.status in ('waiting','live')) then raise exception 'Chiudi prima la tombola'; end if;
 if exists(select 1 from orchidea_games.rounds where event_id=e.id and status='live' and ends_at>clock_timestamp()) then raise exception 'Chiudi il round precedente'; end if;
 update orchidea_games.rounds set status='closed' where event_id=e.id and status='live';
 k:=p_payload->>'kind'; prompt:=trim(coalesce(p_payload->>'prompt','')); opts:=p_payload->'options'; a:=coalesce((p_payload->>'answer')::int,0); secs:=(p_payload->>'seconds')::int; pts:=(p_payload->>'points')::int;
 if k is null or k not in ('quiz','impostor','wheel') or length(prompt) not between 1 and 500 or secs is null or secs not between 10 and 1800 or pts is null or pts not between 0 and 1000 or jsonb_typeof(opts) is distinct from 'array' then raise exception 'Configurazione round non valida'; end if;
 n:=jsonb_array_length(opts);
 if n>100 or exists(select 1 from jsonb_array_elements(opts) x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and 250) then raise exception 'Opzioni non valide'; end if;
 if k='quiz' and (n not between 2 and 6 or a not between 0 and n-1) then raise exception 'Inserisci 2–6 risposte e un indice corretto'; end if;
 if k='bingo' and n<>9 then raise exception 'Servono esattamente nove caselle'; end if;
 if k in ('mission','wheel') and n<1 then raise exception 'Inserisci almeno una opzione'; end if;
 if k='wheel' then
 if n not between 2 and 12 then raise exception 'Servono da 2 a 12 spicchi'; end if;
 rules:=coalesce(p_payload->'wheel_rules','{}'::jsonb); fallback:=coalesce((p_payload->>'wheel_default')::int,0);
 if jsonb_typeof(rules)<>'object' or fallback not between 0 and n-1 then raise exception 'Regole ruota non valide'; end if;
 if exists(select 1 from jsonb_each_text(rules) x where x.key !~ '^[1-9][0-9]{0,5}
 if k='battle' then opts:='["Sfida completata"]'; end if;
 if k='awards' and n=0 then select coalesce(jsonb_agg(name order by name,id),'[]') into opts from orchidea_games.players where event_id=e.id; if jsonb_array_length(opts)<2 then raise exception 'Servono almeno due candidati'; end if; end if;
 if k='impostor' then
 if n<>1 then raise exception 'Inserisci una sola parola segreta'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]') into roster from orchidea_games.players where event_id=e.id;
 if jsonb_array_length(roster)<3 then raise exception 'Servono almeno tre partecipanti iscritti'; end if;
 select id into imp from orchidea_games.players where event_id=e.id order by random() limit 1;
 end if;
 insert into orchidea_games.rounds(event_id,kind,prompt,options,answer,points,seconds,ends_at,impostor_id,roster) values(e.id,k,prompt,opts,a,pts,secs,clock_timestamp()+make_interval(secs=>secs),imp,roster) returning id into new_round;
 if k='wheel' then update orchidea_games.rounds set wheel_rules=rules,wheel_default=fallback where id=new_round; end if;
 else raise exception 'Comando non valido'; end if;
 return jsonb_build_object('ok',true);
end $$;

 or x.value !~ '^[0-9]{1,2}
 if k='battle' then opts:='["Sfida completata"]'; end if;
 if k='awards' and n=0 then select coalesce(jsonb_agg(name order by name,id),'[]') into opts from orchidea_games.players where event_id=e.id; if jsonb_array_length(opts)<2 then raise exception 'Servono almeno due candidati'; end if; end if;
 if k='impostor' then
 if n<>1 then raise exception 'Inserisci una sola parola segreta'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]') into roster from orchidea_games.players where event_id=e.id;
 if jsonb_array_length(roster)<3 then raise exception 'Servono almeno tre partecipanti iscritti'; end if;
 select id into imp from orchidea_games.players where event_id=e.id order by random() limit 1;
 end if;
 insert into orchidea_games.rounds(event_id,kind,prompt,options,answer,points,seconds,ends_at,impostor_id,roster) values(e.id,k,prompt,opts,a,pts,secs,clock_timestamp()+make_interval(secs=>secs),imp,roster);
 else raise exception 'Comando non valido'; end if;
 return jsonb_build_object('ok',true);
end $$;

) then raise exception 'Giri o premi non validi'; end if;
 if exists(select 1 from jsonb_each_text(rules) x where x.value::int not between 0 and n-1) then raise exception 'Premio non valido'; end if;
 if rules<>'{}'::jsonb and opts->>fallback <> 'Riprova la prossima volta' then raise exception 'Il giro ordinario deve essere Riprova la prossima volta'; end if;
 end if;
 if k='battle' then opts:='["Sfida completata"]'; end if;
 if k='awards' and n=0 then select coalesce(jsonb_agg(name order by name,id),'[]') into opts from orchidea_games.players where event_id=e.id; if jsonb_array_length(opts)<2 then raise exception 'Servono almeno due candidati'; end if; end if;
 if k='impostor' then
 if n<>1 then raise exception 'Inserisci una sola parola segreta'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]') into roster from orchidea_games.players where event_id=e.id;
 if jsonb_array_length(roster)<3 then raise exception 'Servono almeno tre partecipanti iscritti'; end if;
 select id into imp from orchidea_games.players where event_id=e.id order by random() limit 1;
 end if;
 insert into orchidea_games.rounds(event_id,kind,prompt,options,answer,points,seconds,ends_at,impostor_id,roster) values(e.id,k,prompt,opts,a,pts,secs,clock_timestamp()+make_interval(secs=>secs),imp,roster);
 else raise exception 'Comando non valido'; end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function orchidea_games.tombola_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e orchidea_games.events; t orchidea_games.tombola_sessions; p orchidea_games.players; card int[]; marks int[]; winners jsonb; n int; latest_round timestamptz;
begin
 if not orchidea_games.allowed() then raise exception 'Accesso non autorizzato'; end if;
 select * into e from orchidea_games.events order by created_at desc limit 1;
 select * into t from orchidea_games.tombola_sessions where event_id=e.id order by created_at desc limit 1;
 if t.id is null then return null; end if;
 select max(starts_at) into latest_round from orchidea_games.rounds where event_id=e.id;
 if t.status='closed' and latest_round>t.created_at then return null; end if;
 select * into p from orchidea_games.players where event_id=e.id and user_id=auth.uid();
 if p.id is null and not public.is_admin() then return null; end if;
 select c.cells,c.marked into card,marks from orchidea_games.tombola_cards c where c.session_id=t.id and c.player_id=p.id;
 select count(*) into n from orchidea_games.tombola_cards c where c.session_id=t.id;
 select coalesce(jsonb_agg(jsonb_build_object('prize',w.prize,'name',pl.name,'number',w.draw_number,'mine',w.player_id=p.id) order by w.prize,pl.name),'[]') into winners from orchidea_games.tombola_winners w join orchidea_games.players pl on pl.id=w.player_id where w.session_id=t.id;
 return jsonb_build_object('id',t.id,'status',case when e.status='closed' then 'closed' else t.status end,'drawn',t.drawn,'card',card,'marked',coalesce(marks,'{}'::int[]),'winners',winners,'card_count',n);
end $$;

create or replace function orchidea_games.tombola_action(p_action text,p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e orchidea_games.events; t orchidea_games.tombola_sessions; p orchidea_games.players; num int; tier int; is_admin boolean;
begin
 if not orchidea_games.allowed() then raise exception 'Accesso non autorizzato'; end if;
 is_admin:=public.is_admin();
 if p_action is distinct from 'join' and not is_admin then raise exception 'Solo amministratori'; end if;
 perform pg_advisory_xact_lock(27111926);
 select * into e from orchidea_games.events where status='live' for update;
 if e.id is null then raise exception 'Apri prima la Game Night'; end if;
 if p_action='start' then
 if exists(select 1 from orchidea_games.rounds r where r.event_id=e.id and r.status='live' and r.ends_at>clock_timestamp()) then raise exception 'Chiudi prima il round in corso'; end if;
 if exists(select 1 from orchidea_games.tombola_sessions s where s.event_id=e.id and s.status in ('waiting','live')) then raise exception 'Tombola già aperta'; end if;
 insert into orchidea_games.tombola_sessions(event_id) values(e.id);
 else
 select * into t from orchidea_games.tombola_sessions where id=p_session and event_id=e.id for update;
 if t.id is null or t.status='closed' then raise exception 'Tombola non attiva'; end if;
 if p_action='join' then
 if t.status<>'waiting' then raise exception 'Cartelle chiuse: attendi la prossima partita'; end if;
 select * into p from orchidea_games.players where event_id=e.id and user_id=auth.uid();
 if p.id is null then raise exception 'Partecipa prima alla Game Night'; end if;
 insert into orchidea_games.tombola_cards(session_id,player_id,cells) values(t.id,p.id,orchidea_games.tombola_card()) on conflict do nothing;
 elsif p_action='draw' then
 if not exists(select 1 from orchidea_games.tombola_cards c where c.session_id=t.id) then raise exception 'Serve almeno una cartella'; end if;
 select x into num from generate_series(1,90) x where not(x=any(t.drawn)) order by random() limit 1;
 if num is null then raise exception 'Tutti i numeri sono stati estratti'; end if;
 t.drawn:=array_append(t.drawn,num);
 update orchidea_games.tombola_sessions set drawn=t.drawn,status='live' where id=t.id;
 -- Prizes are awarded only by explicit player marks; final draw remains open for marking.
 elsif p_action='close' then update orchidea_games.tombola_sessions set status='closed' where id=t.id;
 else raise exception 'Azione non valida'; end if;
 end if;
 return orchidea_games.tombola_state();
end $$;
create function orchidea_games.tombola_mark(p_session uuid,p_number int) returns jsonb language plpgsql security definer set search_path='' as $$
declare e orchidea_games.events; t orchidea_games.tombola_sessions; p orchidea_games.players; c orchidea_games.tombola_cards; tier int;
begin
 if not orchidea_games.allowed() then raise exception 'Accesso non autorizzato'; end if;
 -- Serialize claims and draws to make the first valid claim definitive.
 perform pg_advisory_xact_lock(27111926);
 select * into e from orchidea_games.events where status='live' for update;
 select * into t from orchidea_games.tombola_sessions where id=p_session and event_id=e.id for update;
 if t.id is null or t.status<>'live' then raise exception 'Tombola non attiva'; end if;
 select * into p from orchidea_games.players where event_id=e.id and user_id=auth.uid();
 select * into c from orchidea_games.tombola_cards where session_id=t.id and player_id=p.id for update;
 if c.player_id is null or p_number is null or p_number<1 or not(p_number=any(c.cells)) or not(p_number=any(t.drawn)) then raise exception 'Numero non valido'; end if;
 if not(p_number=any(c.marked)) then
 c.marked:=array_append(c.marked,p_number);
 update orchidea_games.tombola_cards set marked=c.marked where session_id=t.id and player_id=p.id;
 foreach tier in array array[2,3,4,5,15] loop
 if not exists(select 1 from orchidea_games.tombola_winners w where w.session_id=t.id and w.prize=tier) and
 (case when tier=15 then cardinality(c.marked)>=15 else exists(select 1 from generate_series(0,2) rowidx where (select count(*) from unnest(c.cells[rowidx*9+1:rowidx*9+9]) v where v=any(c.marked))>=tier) end)
 then insert into orchidea_games.tombola_winners(session_id,prize,player_id,draw_number) values(t.id,tier,p.id,t.drawn[cardinality(t.drawn)]); end if;
 end loop;
 if exists(select 1 from orchidea_games.tombola_winners w where w.session_id=t.id and w.prize=15) then update orchidea_games.tombola_sessions set status='closed' where id=t.id; end if;
 end if;
 return orchidea_games.tombola_state();
end $$;
revoke all on function orchidea_games.tombola_mark(uuid,int) from public,anon,authenticated;
grant execute on function orchidea_games.tombola_mark(uuid,int) to authenticated;
create function public.orchidea_tombola_mark(p_session uuid,p_number int) returns jsonb language sql security invoker set search_path='' as $$ select orchidea_games.tombola_mark(p_session,p_number) $$;
revoke all on function public.orchidea_tombola_mark(uuid,int) from public,anon,authenticated;
grant execute on function public.orchidea_tombola_mark(uuid,int) to authenticated;
create function orchidea_games.quiz_action(p_action text,p_questions jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
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
 elsif p_action='next' then
 select * into q from orchidea_games.quiz_queue where event_id=e.id for update;
 if q.event_id is null then raise exception 'Nessun quiz in corso'; end if;
 select * into r from orchidea_games.rounds where id=q.round_id;
 if r.id is distinct from (select id from orchidea_games.rounds where event_id=e.id order by starts_at desc limit 1) then raise exception 'Quiz non più attivo'; end if;
 if r.status='live' and r.ends_at>clock_timestamp() then raise exception 'Termina prima la domanda'; end if;
 pos:=q.position+1; p_questions:=q.questions;
 if pos>=jsonb_array_length(p_questions) then raise exception 'Quiz concluso'; end if;
 question:=p_questions->pos;
 else raise exception 'Comando non valido'; end if;
 perform orchidea_games.admin('round',question||jsonb_build_object('kind','quiz'));
 select id into rid from orchidea_games.rounds where event_id=e.id order by starts_at desc limit 1;
 insert into orchidea_games.quiz_queue(event_id,questions,position,round_id) values(e.id,p_questions,pos,rid)
 on conflict(event_id) do update set questions=excluded.questions,position=excluded.position,round_id=excluded.round_id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function orchidea_games.quiz_action(text,jsonb) from public,anon,authenticated;
grant execute on function orchidea_games.quiz_action(text,jsonb) to authenticated;
create function public.orchidea_quiz_action(p_action text,p_questions jsonb default null) returns jsonb language sql security invoker set search_path='' as $$ select orchidea_games.quiz_action(p_action,p_questions) $$;
revoke all on function public.orchidea_quiz_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.orchidea_quiz_action(text,jsonb) to authenticated;
create function orchidea_games.extras() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e orchidea_games.events; r orchidea_games.rounds; q orchidea_games.quiz_queue; p orchidea_games.players; idx int; result jsonb:='{}'; already boolean;
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
 if q.event_id is not null then result:=result||jsonb_build_object('quiz',jsonb_build_object('position',q.position+1,'total',jsonb_array_length(q.questions))); end if;
 return result;
end $$;
revoke all on function orchidea_games.extras() from public,anon,authenticated;
grant execute on function orchidea_games.extras() to authenticated;
create or replace function public.orchidea_game_state() returns jsonb language sql stable security invoker set search_path='' as $$ select orchidea_games.state() || jsonb_build_object('tombola',orchidea_games.tombola_state()) || orchidea_games.extras() $$;
