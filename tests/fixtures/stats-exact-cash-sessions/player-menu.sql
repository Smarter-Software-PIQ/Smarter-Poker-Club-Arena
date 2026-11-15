ALTER TABLE public.club_members ADD COLUMN role text, ADD COLUMN agent_id uuid;
ALTER TABLE public.tables ADD COLUMN name text;
ALTER TABLE public.ca_hand_facts ADD COLUMN vpip boolean, ADD COLUMN pfr boolean;
CREATE TABLE public.hand_history(id uuid,table_id uuid,created_at timestamptz,players jsonb);
CREATE TABLE public.poker_diamond_custody(id uuid,user_id uuid,target_id uuid,purpose text,state text,created_at timestamptz);
CREATE TABLE public.poker_diamond_movements(custody_id uuid,action text,amount numeric);

DO $test$
DECLARE
  viewer uuid:=gen_random_uuid(); middle_agent uuid:=gen_random_uuid(); player uuid:=gen_random_uuid();
  outsider uuid:=gen_random_uuid(); club uuid:=gen_random_uuid(); game uuid:=gen_random_uuid();
  other_game uuid:=gen_random_uuid(); hand uuid:=gen_random_uuid(); stats jsonb;
BEGIN
  INSERT INTO club_members(user_id,club_id,status,role,agent_id) VALUES
    (viewer,club,'active','agent',NULL),(middle_agent,club,'active','sub_agent',viewer),
    (player,club,'active','member',middle_agent);
  INSERT INTO tables(id,club_id,status,name) VALUES(game,club,'running','A'),(other_game,club,'running','B');
  INSERT INTO table_seats(id,table_id,user_id) VALUES(gen_random_uuid(),game,player),(gen_random_uuid(),other_game,player);
  INSERT INTO cash_player_session(id,player_id,club_id,scope_type,scope_id,table_id,opened_at,baseline)
    VALUES(gen_random_uuid(),player,club,'table',game,game,now()-interval '1 hour',200),
          (gen_random_uuid(),player,club,'table',other_game,other_game,now()-interval '1 hour',100);
  INSERT INTO hand_history VALUES(hand,game,now(),jsonb_build_array(jsonb_build_object('userId',player)));
  INSERT INTO ca_hand_facts(hand_id,user_id,club_id,table_id,played_at,net,vpip,pfr)
    VALUES(hand,player,club,game,now(),-12.5,true,false);
  PERFORM set_config('request.jwt.claim.sub',viewer::text,true);
  stats:=public.ca_player_menu_cash_stats(game,player);
  IF jsonb_array_length(stats) IS DISTINCT FROM 2 OR (stats->0) @>
    '{"hands":1,"net":-12.5,"boughtIn":200,"vpip":100,"pfr":0}' IS NOT TRUE
    OR (stats->1->>'net')::numeric IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'session mismatch %',stats; END IF;
  UPDATE tables SET cluster_id=club WHERE id=game;
  IF public.ca_player_menu_cash_stats(club,player) IS NULL THEN RAISE EXCEPTION 'pool room'; END IF;
  PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
  IF public.ca_player_menu_cash_stats(game,player) IS NOT NULL THEN RAISE EXCEPTION 'unrelated viewer'; END IF;
  PERFORM set_config('request.jwt.claim.sub','47965354-0e56-43ef-931c-ddaab82af765',true);
  IF public.ca_player_menu_cash_stats(game,player) IS NULL THEN RAISE EXCEPTION 'owner denied'; END IF;
  -- The same occupied table and club cannot grant access to another agent's player.
  INSERT INTO club_members(user_id,club_id,status,role,agent_id) VALUES
    (outsider,club,'active','agent',NULL);
  INSERT INTO table_seats(id,table_id,user_id) VALUES(gen_random_uuid(),game,outsider);
  INSERT INTO cash_player_session(id,player_id,club_id,scope_type,scope_id,table_id,opened_at,baseline)
    VALUES(gen_random_uuid(),outsider,club,'table',game,game,now()-interval '1 hour',100);
  IF public.ca_player_menu_cash_stats(game,outsider) IS NULL THEN RAISE EXCEPTION 'owner denied unrelated seat'; END IF;
  PERFORM set_config('request.jwt.claim.sub',viewer::text,true);
  IF public.ca_player_menu_cash_stats(game,outsider) IS NOT NULL THEN RAISE EXCEPTION 'same-table outsider leaked'; END IF;
  PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
  IF public.ca_player_menu_cash_stats(game,player) IS NOT NULL THEN RAISE EXCEPTION 'unrelated active agent'; END IF;
  PERFORM set_config('request.jwt.claim.sub',middle_agent::text,true);
  IF public.ca_player_menu_cash_stats(game,player) IS NULL THEN RAISE EXCEPTION 'direct agent denied'; END IF;
  UPDATE club_members SET status='inactive' WHERE user_id=middle_agent;
  IF public.ca_player_menu_cash_stats(game,player) IS NOT NULL THEN RAISE EXCEPTION 'inactive agent'; END IF;
  PERFORM set_config('request.jwt.claim.sub',viewer::text,true);
  IF public.ca_player_menu_cash_stats(game,player) IS NOT NULL THEN RAISE EXCEPTION 'inactive chain'; END IF;
  PERFORM set_config('request.jwt.claim.sub','47965354-0e56-43ef-931c-ddaab82af765',true);
  DELETE FROM ca_hand_facts WHERE hand_id=hand;
  IF public.ca_player_menu_cash_stats(game,player)->0->'net' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'partial facts'; END IF;
  UPDATE tables SET tournament_id=gen_random_uuid() WHERE id=game;
  IF public.ca_player_menu_cash_stats(game,player) IS NOT NULL THEN RAISE EXCEPTION 'tournament'; END IF;
END;
$test$;
