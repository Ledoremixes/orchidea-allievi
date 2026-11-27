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
 select jsonb_build_object('round_id',r.id,'index',(ord-1)::int,'name',entry->>'name') into impostor_info
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
