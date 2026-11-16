-- The legacy trigger refuses the join under an open payout row lock.
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA smarter_private;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
CREATE TABLE public.club_members(club_id int, user_id uuid, agent_id int, is_active boolean);
CREATE TABLE public.agents(club_id int, user_id int, total_players int, active_player_count int, wallet numeric);
INSERT INTO agents VALUES (1,2,0,0,123);
INSERT INTO auth.users VALUES
 ('00000000-0000-0000-0000-000000000001','ca-customization-cert-postdeploy-test@example.invalid','{"ca_certification_purpose":"table-spectator"}','{}'),
 ('00000000-0000-0000-0000-000000000002','ca-customization-cert-postdeploy-other@example.invalid','{}','{"ca_certification_purpose":"table-spectator"}');
\ir ../../../../supabase/migrations/20260721185310_agent_player_counts_trigger_clean_body_20260721.sql
CREATE TRIGGER counts AFTER INSERT OR DELETE OR UPDATE OF agent_id, club_id, is_active ON club_members
 FOR EACH ROW EXECUTE FUNCTION public.fn_sync_agent_player_counts();
BEGIN;
UPDATE agents SET wallet=wallet+1 WHERE club_id=1 AND user_id=2;
PREPARE TRANSACTION 'weekly-payout';
SET lock_timeout='200ms';
DO $$BEGIN
 INSERT INTO club_members VALUES(1,'00000000-0000-0000-0000-000000000001',2,true);
 RAISE EXCEPTION 'expected baseline join to hit payout lock';
EXCEPTION WHEN lock_not_available THEN NULL;
END$$;
\ir ../../../../supabase/migrations/20261116155001_spectator_memberships_do_not_count_as_agent_players.sql
SET lock_timeout='200ms';
INSERT INTO club_members VALUES(1,'00000000-0000-0000-0000-000000000001',2,true);
UPDATE club_members SET is_active=true;
DELETE FROM club_members;
INSERT INTO club_members VALUES(1,'00000000-0000-0000-0000-000000000001',2,true);
DO $$BEGIN
 INSERT INTO club_members VALUES(1,'00000000-0000-0000-0000-000000000002',2,true);
 RAISE EXCEPTION 'user-editable metadata exempted an ordinary member';
EXCEPTION WHEN lock_not_available THEN NULL;
END$$;
COMMIT PREPARED 'weekly-payout';
INSERT INTO club_members VALUES(1,'00000000-0000-0000-0000-000000000002',2,true);
DO $$BEGIN
 IF (SELECT (total_players,active_player_count,wallet) <> (1,1,124) FROM agents) THEN
   RAISE EXCEPTION 'incorrect player count or payout';
 END IF;
END$$;
UPDATE club_members SET is_active=false WHERE user_id='00000000-0000-0000-0000-000000000002';
DO $$BEGIN
 IF (SELECT (total_players,active_player_count) <> (1,0) FROM agents) THEN RAISE EXCEPTION 'active count'; END IF;
END$$;
DELETE FROM club_members;
DO $$BEGIN
 IF (SELECT (total_players,active_player_count,wallet) <> (0,0,124) FROM agents) THEN RAISE EXCEPTION 'cleanup'; END IF;
END$$;
