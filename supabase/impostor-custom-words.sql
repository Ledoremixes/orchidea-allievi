create or replace function orchidea_games.state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e orchidea_games.events; r orchidea_games.rounds; p orchidea_games.players; myrow orchidea_games.responses; admin boolean; live boolean; opts jsonb; secret text; reveal text; board jsonb; teams jsonb; pending jsonb; counts jsonb; my_response jsonb; total integer;
begin
 if not orchidea_games.allowed() then raise exception 'Accesso riservato ai corsisti e allo staff'; end if;
 admin:=public.is_admin();
 select * into e from orchidea_games.events order by created_at desc limit 1;
 if e.id is null then return jsonb_build_object('admin',admin,'joined',false,'event',null); end if;
 select * into p from orchidea_games.players where event_id=e.id and user_id=auth.uid();
 if p.id is not null or admin then
 select coalesce(jsonb_agg(to_jsonb(b) order by b.xp desc,b.name),'[]') into board from (select pl.id,pl.name,coalesce(sum(case when rr.kind in ('quiz','impostor') and rr.status='live' and rr.ends_at>now() and e.status='live' then 0 else s.points end),0) as xp from orchidea_games.players pl left join orchidea_games.responses s on s.player_id=pl.id left join orchidea_games.rounds rr on rr.id=s.round_id where pl.event_id=e.id group by pl.id order by xp desc,pl.name limit 100) b;
 select coalesce(jsonb_agg(to_jsonb(b) order by b.xp desc,b.name),'[]') into teams from (select min(pl.team) name, sum(s.points) xp from orchidea_games.players pl join orchidea_games.responses s on s.player_id=pl.id where pl.event_id=e.id and s.team_key is not null group by s.team_key order by xp desc limit 100) b;
 select coalesce(sum(case when rr.kind in ('quiz','impostor') and rr.status='live' and rr.ends_at>now() and e.status='live' then 0 else s.points end),0) into total from orchidea_games.responses s join orchidea_games.rounds rr on rr.id=s.round_id where s.player_id=p.id;
 end if;
 if admin then select coalesce(jsonb_agg(to_jsonb(b)),'[]') into pending from (select s.id,pl.name,pl.team,rr.kind,rr.prompt,s.created_at from orchidea_games.responses s join orchidea_games.players pl on pl.id=s.player_id join orchidea_games.rounds rr on rr.id=s.round_id where pl.event_id=e.id and s.pending order by s.created_at limit 100) b; end if;
 select * into r from orchidea_games.rounds where event_id=e.id order by starts_at desc limit 1;
 if r.id is not null and (p.id is not null or admin) then
 live:=e.status='live' and r.status='live' and r.ends_at>now();
 opts:=r.options;
 if r.kind='mission' then opts:='[]'; if p.id is not null then secret:=r.options->>((hashtextextended(p.id::text||r.id::text,0)&9223372036854775807)%jsonb_array_length(r.options))::int; end if;
 elsif r.kind='impostor' then
  opts:=coalesce((select jsonb_agg(x->>'name' order by i) from jsonb_array_elements(r.roster) with ordinality q(x,i)),'[]');
  if p.id is not null and exists(select 1 from jsonb_array_elements(r.roster) x where x->>'id'=p.id::text) then secret:=case when p.id=r.impostor_id then case when nullif(r.options->>1,'') is not null then 'Sei l’impostore! La tua parola: '||(r.options->>1) else 'Sei l’impostore! Non conosci la parola.' end else 'Parola segreta: '||(r.options->>0) end; elsif live and not admin then opts:='[]'; end if;
  if not live then reveal:='L’impostore era: '||(select name from orchidea_games.players where id=r.impostor_id); end if;
 elsif r.kind='quiz' and not live then reveal:='Risposta corretta: '||(r.options->>r.answer);
 end if;
 select * into myrow from orchidea_games.responses where round_id=r.id and player_id=p.id;
 if myrow.id is not null then my_response:=jsonb_build_object('result',case when live and r.kind in ('quiz','impostor') then 'Risposta registrata!' else myrow.result end,'points',case when live and r.kind in ('quiz','impostor') then 0 else myrow.points end,'pending',myrow.pending); end if;
 if not live and r.kind in ('awards','impostor') then
 select coalesce(jsonb_agg(jsonb_build_object('name',opts->>b.idx,'votes',b.votes) order by b.votes desc,b.idx),'[]') into counts from (select value::int idx,count(*) votes from orchidea_games.responses where round_id=r.id group by value) b;
 end if;
 end if;
 return jsonb_build_object('admin',admin,'joined',p.id is not null,'team',p.team,'event',jsonb_build_object('id',e.id,'title',e.title,'status',e.status),'round',case when r.id is not null and (p.id is not null or admin) then jsonb_build_object('id',r.id,'kind',r.kind,'prompt',r.prompt,'options',opts,'secret',secret,'reveal',reveal,'status',case when live then 'live' else 'closed' end,'ends_at',r.ends_at,'seconds',r.seconds,'counts',counts) end,'response',my_response,'leaderboard',coalesce(board,'[]'),'teams',coalesce(teams,'[]'),'pending',coalesce(pending,'[]'),'xp',coalesce(total,0),'server_time',now(),'player_count',(select count(*) from orchidea_games.players where event_id=e.id));
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
 if exists(select 1 from jsonb_each_text(rules) x where x.key !~ '^[1-9][0-9]{0,5}$' or x.value !~ '^[0-9]{1,2}$') then raise exception 'Giri o premi non validi'; end if;
 if exists(select 1 from jsonb_each_text(rules) x where x.value::int not between 0 and n-1) then raise exception 'Premio non valido'; end if;
 if rules<>'{}'::jsonb and (opts->>fallback) <> 'Riprova la prossima volta' then raise exception 'Il giro ordinario deve essere Riprova la prossima volta'; end if;
 end if;
 if k='battle' then opts:='["Sfida completata"]'; end if;
 if k='awards' and n=0 then select coalesce(jsonb_agg(name order by name,id),'[]') into opts from orchidea_games.players where event_id=e.id; if jsonb_array_length(opts)<2 then raise exception 'Servono almeno due candidati'; end if; end if;
 if k='impostor' then
 if n<>2 then raise exception 'Inserisci la parola dei partecipanti e quella dell’impostore'; end if;
 if lower(trim(opts->>0))=lower(trim(opts->>1)) then raise exception 'Le due parole devono essere diverse'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]') into roster from orchidea_games.players where event_id=e.id;
 if jsonb_array_length(roster)<3 then raise exception 'Servono almeno tre partecipanti iscritti'; end if;
 select id into imp from orchidea_games.players where event_id=e.id order by random() limit 1;
 end if;
 insert into orchidea_games.rounds(event_id,kind,prompt,options,answer,points,seconds,ends_at,impostor_id,roster) values(e.id,k,prompt,opts,a,pts,secs,clock_timestamp()+make_interval(secs=>secs),imp,roster) returning id into new_round;
 if k='wheel' then update orchidea_games.rounds set wheel_rules=rules,wheel_default=fallback where id=new_round; end if;
 else raise exception 'Comando non valido'; end if;
 return jsonb_build_object('ok',true);
end $$;



create or replace function orchidea_games.extras() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e orchidea_games.events; r orchidea_games.rounds; q orchidea_games.quiz_queue; p orchidea_games.players; idx int; result jsonb:='{}'; already boolean; answered_count int; eligible_count int; impostor_info jsonb;
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
 if r.kind='impostor' and public.is_admin() then
 select jsonb_build_object('round_id',r.id,'index',(ord-1)::int,'name',entry->>'name','common_word',r.options->>0,'impostor_word',r.options->>1) into impostor_info
 from jsonb_array_elements(r.roster) with ordinality as roster(entry,ord)
 where entry->>'id'=r.impostor_id::text limit 1;
 if impostor_info is not null then result:=result||jsonb_build_object('impostor_admin',impostor_info); end if;
 end if;
 select * into q from orchidea_games.quiz_queue where event_id=e.id and round_id=r.id;
 if q.event_id is not null then
 select count(*) into eligible_count from orchidea_games.players pl where pl.event_id=e.id;
 select count(*) into answered_count from orchidea_games.responses s where s.round_id=r.id;
 result:=result||jsonb_build_object('quiz',jsonb_build_object('position',q.position+1,'total',jsonb_array_length(q.questions),'answered',answered_count,'eligible',eligible_count));
 end if;
 return result;
end $$;
