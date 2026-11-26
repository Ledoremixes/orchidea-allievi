-- Live tombola, isolated from XP and historic games.
create table orchidea_games.tombola_sessions(
 id uuid primary key default gen_random_uuid(), event_id uuid not null references orchidea_games.events(id),
 status text not null default 'waiting' check(status in ('waiting','live','closed')), drawn int[] not null default '{}',
 created_at timestamptz not null default clock_timestamp()
);
create unique index tombola_one_open on orchidea_games.tombola_sessions(event_id) where status in ('waiting','live');
create table orchidea_games.tombola_cards(
 session_id uuid not null references orchidea_games.tombola_sessions(id), player_id uuid not null references orchidea_games.players(id),
 cells int[] not null check(cardinality(cells)=27), primary key(session_id,player_id)
);
create table orchidea_games.tombola_winners(
 session_id uuid not null references orchidea_games.tombola_sessions(id), prize int not null check(prize in (2,3,4,5,15)),
 player_id uuid not null references orchidea_games.players(id), draw_number int not null, primary key(session_id,prize,player_id)
);
alter table orchidea_games.tombola_sessions enable row level security;
alter table orchidea_games.tombola_cards enable row level security;
alter table orchidea_games.tombola_winners enable row level security;
revoke all on orchidea_games.tombola_sessions,orchidea_games.tombola_cards,orchidea_games.tombola_winners from public,anon,authenticated;

create function orchidea_games.tombola_card() returns int[] language plpgsql volatile set search_path='' as $$
declare cells int[]; r int; c int; cols int[]; chosen int[]; slots int[]; i int; lo int; hi int;
begin
 loop
 cells:=array_fill(0,array[27]);
 for r in 0..2 loop
 select array_agg(x) into cols from (select x from generate_series(0,8) x order by random() limit 5) q;
 foreach c in array cols loop cells[r*9+c+1]:=-1; end loop;
 end loop;
 exit when not exists(select 1 from generate_series(1,9) g where cells[g]=0 and cells[g+9]=0 and cells[g+18]=0);
 end loop;
 for c in 0..8 loop
 slots:=array(select g from generate_series(1,27) g where (g-1)%9=c and cells[g]=-1 order by g);
 lo:=case when c=0 then 1 else c*10 end;
 hi:=case when c=8 then 90 else c*10+9 end;
 select array_agg(x order by x) into chosen from (select x from generate_series(lo,hi) x order by random() limit cardinality(slots)) q;
 for i in 1..cardinality(slots) loop cells[slots[i]]:=chosen[i]; end loop;
 end loop;
 return cells;
end $$;

create function orchidea_games.tombola_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e orchidea_games.events; t orchidea_games.tombola_sessions; p orchidea_games.players; card int[]; winners jsonb; n int; latest_round timestamptz;
begin
 if not orchidea_games.allowed() then raise exception 'Accesso non autorizzato'; end if;
 select * into e from orchidea_games.events order by created_at desc limit 1;
 select * into t from orchidea_games.tombola_sessions where event_id=e.id order by created_at desc limit 1;
 if t.id is null then return null; end if;
 select max(starts_at) into latest_round from orchidea_games.rounds where event_id=e.id;
 if t.status='closed' and latest_round>t.created_at then return null; end if;
 select * into p from orchidea_games.players where event_id=e.id and user_id=auth.uid();
 if p.id is null and not public.is_admin() then return null; end if;
 select c.cells into card from orchidea_games.tombola_cards c where c.session_id=t.id and c.player_id=p.id;
 select count(*) into n from orchidea_games.tombola_cards c where c.session_id=t.id;
 select coalesce(jsonb_agg(jsonb_build_object('prize',w.prize,'name',pl.name,'number',w.draw_number,'mine',w.player_id=p.id) order by w.prize,pl.name),'[]') into winners from orchidea_games.tombola_winners w join orchidea_games.players pl on pl.id=w.player_id where w.session_id=t.id;
 return jsonb_build_object('id',t.id,'status',case when e.status='closed' then 'closed' else t.status end,'drawn',t.drawn,'card',card,'winners',winners,'card_count',n);
end $$;

create function orchidea_games.tombola_action(p_action text,p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
 foreach tier in array array[2,3,4,5,15] loop
 if not exists(select 1 from orchidea_games.tombola_winners w where w.session_id=t.id and w.prize=tier) then
 insert into orchidea_games.tombola_winners(session_id,prize,player_id,draw_number)
 select t.id,tier,c.player_id,num from orchidea_games.tombola_cards c
 where c.session_id=t.id and (case when tier=15 then (select count(*) from unnest(c.cells) v where v=any(t.drawn))>=15 else exists(select 1 from generate_series(0,2) rowidx where (select count(*) from unnest(c.cells[rowidx*9+1:rowidx*9+9]) v where v=any(t.drawn))>=tier) end);
 end if;
 end loop;
 if exists(select 1 from orchidea_games.tombola_winners w where w.session_id=t.id and w.prize=15) or cardinality(t.drawn)=90 then update orchidea_games.tombola_sessions set status='closed' where id=t.id; end if;
 elsif p_action='close' then update orchidea_games.tombola_sessions set status='closed' where id=t.id;
 else raise exception 'Azione non valida'; end if;
 end if;
 return orchidea_games.tombola_state();
end $$;
revoke all on function orchidea_games.tombola_card(),orchidea_games.tombola_state(),orchidea_games.tombola_action(text,uuid) from public,anon,authenticated;
grant execute on function orchidea_games.tombola_state(),orchidea_games.tombola_action(text,uuid) to authenticated;
create function public.orchidea_tombola_action(p_action text,p_session uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select orchidea_games.tombola_action(p_action,p_session) $$;
revoke all on function public.orchidea_tombola_action(text,uuid) from public,anon,authenticated;
grant execute on function public.orchidea_tombola_action(text,uuid) to authenticated;
create or replace function public.orchidea_game_state() returns jsonb language sql stable security invoker set search_path='' as $$ select orchidea_games.state() || jsonb_build_object('tombola',orchidea_games.tombola_state()) $$;

create or replace function orchidea_games.admin(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare e orchidea_games.events; r orchidea_games.rounds; k text; prompt text; opts jsonb; a integer; secs integer; pts integer; roster jsonb:='[]'; imp uuid; n int; target uuid; pending_row orchidea_games.responses;
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
 if k='wheel' and n>12 then raise exception 'Massimo 12 premi'; end if;
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

