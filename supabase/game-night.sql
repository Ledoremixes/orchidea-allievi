-- Game Night: separate from attendance and existing Community rankings.
create schema if not exists orchidea_games;
revoke all on schema orchidea_games from public, anon, authenticated;
create table orchidea_games.events (
 id uuid primary key default gen_random_uuid(), title text not null, status text not null default 'live' check(status in ('live','closed')), created_at timestamptz not null default now()
);
create unique index gn_one_live_event on orchidea_games.events(status) where status='live';
create table orchidea_games.players (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references orchidea_games.events(id), user_id uuid not null, name text not null, team text not null default '', unique(event_id,user_id)
);
create table orchidea_games.rounds (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references orchidea_games.events(id), kind text not null check(kind in ('quiz','mission','bingo','impostor','awards','battle','wheel')), prompt text not null, options jsonb not null, answer integer not null default 0, points integer not null check(points between 0 and 1000), seconds integer not null check(seconds between 10 and 1800), starts_at timestamptz not null default clock_timestamp(), ends_at timestamptz not null, status text not null default 'live' check(status in ('live','closed')), impostor_id uuid, roster jsonb not null default '[]'
);
create unique index gn_one_live_round on orchidea_games.rounds(event_id) where status='live';
create table orchidea_games.responses (
 id uuid primary key default gen_random_uuid(), round_id uuid not null references orchidea_games.rounds(id), player_id uuid not null references orchidea_games.players(id), value text not null, result text not null, points integer not null default 0, pending boolean not null default false, team_key text, created_at timestamptz not null default clock_timestamp(), unique(round_id,player_id)
);
create unique index gn_one_team_battle on orchidea_games.responses(round_id,team_key) where team_key is not null;
create index gn_round_event on orchidea_games.rounds(event_id,starts_at desc);
create index gn_response_player on orchidea_games.responses(player_id);
alter table orchidea_games.events enable row level security;
alter table orchidea_games.players enable row level security;
alter table orchidea_games.rounds enable row level security;
alter table orchidea_games.responses enable row level security;
revoke all on all tables in schema orchidea_games from public, anon, authenticated;

create function orchidea_games.allowed() returns boolean language sql stable set search_path='' as $$
 select auth.uid() is not null and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false and (public.is_admin() or exists(select 1 from public.get_my_tesseramento() t where t.is_corsista is true) or exists(select 1 from public.get_my_teacher_account()))
$$;
create function orchidea_games.join_event(p_team text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e orchidea_games.events; n text; u uuid:=auth.uid();
begin
 if not orchidea_games.allowed() then raise exception 'Accesso riservato ai corsisti e allo staff'; end if;
 select * into e from orchidea_games.events where status='live' for update;
 if e.id is null then raise exception 'Nessun evento aperto'; end if;
 select nullif(trim(concat_ws(' ',t.nome,t.cognome)),'') into n from public.get_my_tesseramento() t where t.is_corsista is true;
 if n is null then select nullif(trim(concat_ws(' ',t.nome,t.cognome)),'') into n from public.get_my_teacher_account() t; end if;
 if n is null and public.is_admin() then n:='Staff Orchidea'; end if;
 if n is null then raise exception 'Profilo non disponibile'; end if;
 insert into orchidea_games.players(event_id,user_id,name,team) values(e.id,u,left(n,100),left(trim(coalesce(p_team,'')),40)) on conflict(event_id,user_id) do nothing;
 return jsonb_build_object('ok',true);
end $$;

create function orchidea_games.state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e orchidea_games.events; r orchidea_games.rounds; p orchidea_games.players; s orchidea_games.responses; admin boolean; live boolean; opts jsonb; secret text; reveal text; board jsonb; teams jsonb; pending jsonb; counts jsonb; my_response jsonb; total integer;
begin
 if not orchidea_games.allowed() then raise exception 'Accesso riservato ai corsisti e allo staff'; end if;
 admin:=public.is_admin();
 select * into e from orchidea_games.events order by created_at desc limit 1;
 if e.id is null then return jsonb_build_object('admin',admin,'joined',false,'event',null); end if;
 select * into p from orchidea_games.players where event_id=e.id and user_id=auth.uid();
 if p.id is not null or admin then
 select coalesce(jsonb_agg(to_jsonb(b) order by b.xp desc,b.name),'[]') into board from (select pl.id,pl.name,coalesce(sum(s.points),0) as xp from orchidea_games.players pl left join orchidea_games.responses s on s.player_id=pl.id where pl.event_id=e.id group by pl.id order by xp desc,pl.name limit 100) b;
 select coalesce(jsonb_agg(to_jsonb(b) order by b.xp desc,b.name),'[]') into teams from (select min(pl.team) name, sum(s.points) xp from orchidea_games.players pl join orchidea_games.responses s on s.player_id=pl.id where pl.event_id=e.id and s.team_key is not null group by s.team_key order by xp desc limit 100) b;
 select coalesce(sum(points),0) into total from orchidea_games.responses where player_id=p.id;
 end if;
 if admin then select coalesce(jsonb_agg(to_jsonb(b)),'[]') into pending from (select s.id,pl.name,pl.team,r.kind,r.prompt,s.created_at from orchidea_games.responses s join orchidea_games.players pl on pl.id=s.player_id join orchidea_games.rounds r on r.id=s.round_id where pl.event_id=e.id and s.pending order by s.created_at limit 100) b; end if;
 select * into r from orchidea_games.rounds where event_id=e.id order by starts_at desc limit 1;
 if r.id is not null and (p.id is not null or admin) then
 live:=e.status='live' and r.status='live' and r.ends_at>now();
 opts:=r.options;
 if r.kind='mission' then opts:='[]'; if p.id is not null then secret:=r.options->>((hashtextextended(p.id::text||r.id::text,0)&9223372036854775807)%jsonb_array_length(r.options))::int; end if;
 elsif r.kind='impostor' then
  opts:=coalesce((select jsonb_agg(x->>'name' order by i) from jsonb_array_elements(r.roster) with ordinality q(x,i)),'[]');
  if p.id is not null and exists(select 1 from jsonb_array_elements(r.roster) x where x->>'id'=p.id::text) then secret:=case when p.id=r.impostor_id then 'Sei l’impostore! Non conosci la parola.' else 'Parola segreta: '||(r.options->>0) end; else opts:='[]'; end if;
  if not live then reveal:='L’impostore era: '||(select name from orchidea_games.players where id=r.impostor_id); end if;
 elsif r.kind='quiz' and not live then reveal:='Risposta corretta: '||(r.options->>r.answer);
 end if;
 select * into s from orchidea_games.responses where round_id=r.id and player_id=p.id;
 if s.id is not null then my_response:=jsonb_build_object('result',case when live and r.kind in ('quiz','impostor') then 'Risposta registrata!' else s.result end,'points',case when live and r.kind in ('quiz','impostor') then 0 else s.points end,'pending',s.pending); end if;
 if not live and r.kind in ('awards','impostor') then
 select coalesce(jsonb_agg(jsonb_build_object('name',opts->>b.idx,'votes',b.votes) order by b.votes desc,b.idx),'[]') into counts from (select value::int idx,count(*) votes from orchidea_games.responses where round_id=r.id group by value) b;
 end if;
 end if;
 return jsonb_build_object('admin',admin,'joined',p.id is not null,'team',p.team,'event',jsonb_build_object('id',e.id,'title',e.title,'status',e.status),'round',case when r.id is not null and (p.id is not null or admin) then jsonb_build_object('id',r.id,'kind',r.kind,'prompt',r.prompt,'options',opts,'secret',secret,'reveal',reveal,'status',case when live then 'live' else 'closed' end,'ends_at',r.ends_at,'seconds',r.seconds,'counts',counts) end,'response',my_response,'leaderboard',coalesce(board,'[]'),'teams',coalesce(teams,'[]'),'pending',coalesce(pending,'[]'),'xp',coalesce(total,0),'server_time',now(),'player_count',(select count(*) from orchidea_games.players where event_id=e.id));
end $$;

create function orchidea_games.admin(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 elsif p_action='close_event' then update orchidea_games.rounds set status='closed' where event_id=e.id and status='live'; update orchidea_games.events set status='closed' where id=e.id;
 elsif p_action='close_round' then update orchidea_games.rounds set status='closed' where event_id=e.id and status='live';
 elsif p_action='round' then
 if exists(select 1 from orchidea_games.rounds where event_id=e.id and status='live' and ends_at>clock_timestamp()) then raise exception 'Chiudi il round precedente'; end if;
 update orchidea_games.rounds set status='closed' where event_id=e.id and status='live';
 k:=p_payload->>'kind'; prompt:=trim(coalesce(p_payload->>'prompt','')); opts:=p_payload->'options'; a:=coalesce((p_payload->>'answer')::int,0); secs:=(p_payload->>'seconds')::int; pts:=(p_payload->>'points')::int;
 if k is null or k not in ('quiz','mission','bingo','impostor','awards','battle','wheel') or length(prompt) not between 1 and 500 or secs is null or secs not between 10 and 1800 or pts is null or pts not between 0 and 1000 or jsonb_typeof(opts) is distinct from 'array' then raise exception 'Configurazione round non valida'; end if;
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

create function orchidea_games.submit(p_round uuid,p_value text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e orchidea_games.events; r orchidea_games.rounds; p orchidea_games.players; idx int; score int:=0; msg text:='Risposta registrata'; waiting boolean:=false; team_key text; correct boolean; n int;
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
 idx:=floor(random()*jsonb_array_length(r.options))::int; msg:=r.options->>idx; p_value:=idx::text;
 elsif r.kind in ('mission','bingo','battle') then
 if p_value is distinct from 'done' then raise exception 'Operazione non valida'; end if;
 if r.kind='battle' then if p.team='' then raise exception 'Serve un tavolo assegnato quando partecipi'; end if; team_key:=lower(trim(p.team)); end if;
 waiting:=true; msg:='In attesa di conferma del presentatore';
 else raise exception 'Gioco non valido'; end if;
 insert into orchidea_games.responses(round_id,player_id,value,result,points,pending,team_key) values(r.id,p.id,p_value,msg,score,waiting,team_key);
 return jsonb_build_object('ok',true);
end $$;

revoke all on all functions in schema orchidea_games from public, anon, authenticated;
grant usage on schema orchidea_games to authenticated;
grant execute on function orchidea_games.state(),orchidea_games.join_event(text),orchidea_games.admin(text,jsonb),orchidea_games.submit(uuid,text) to authenticated;
create function public.orchidea_game_state() returns jsonb language sql stable security invoker set search_path='' as $$ select orchidea_games.state() $$;
create function public.orchidea_game_join(p_team text) returns jsonb language sql security invoker set search_path='' as $$ select orchidea_games.join_event(p_team) $$;
create function public.orchidea_game_admin(p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select orchidea_games.admin(p_action,p_payload) $$;
create function public.orchidea_game_submit(p_round uuid,p_value text) returns jsonb language sql security invoker set search_path='' as $$ select orchidea_games.submit(p_round,p_value) $$;
revoke all on function public.orchidea_game_state(),public.orchidea_game_join(text),public.orchidea_game_admin(text,jsonb),public.orchidea_game_submit(uuid,text) from public,anon,authenticated;
grant execute on function public.orchidea_game_state(),public.orchidea_game_join(text),public.orchidea_game_admin(text,jsonb),public.orchidea_game_submit(uuid,text) to authenticated;
