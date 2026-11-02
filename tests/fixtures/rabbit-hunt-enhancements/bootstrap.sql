-- Extends tests/fixtures/rabbit-hunt-authority/bootstrap.sql with what 20261102165142 reads.
CREATE TABLE public.profiles(id uuid PRIMARY KEY, username text, player_number integer, role text DEFAULT 'user', is_vip boolean DEFAULT false, vip_tier text, vip_expires_at timestamptz, diamonds integer DEFAULT 0);
CREATE TABLE public.feature_pricing(feature text PRIMARY KEY, diamond_cost integer);
CREATE FUNCTION public.fn_is_platform_admin() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role text; BEGIN IF auth.uid() IS NULL THEN RETURN false; END IF;
SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid(); RETURN v_role IN ('admin','superadmin','god'); END $$;
INSERT INTO public.profiles(id, username, player_number, role, is_vip, vip_tier, vip_expires_at, diamonds) VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','alice',1001,'user',true,'monthly',now()+interval '10 days',40),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bob',1002,'user',false,null,null,3),
 ('cccccccc-cccc-cccc-cccc-cccccccccccc','carl',1003,'user',true,'lifetime',null,0),
 ('dddddddd-dddd-dddd-dddd-dddddddddddd','staffer',1004,'admin',false,null,null,0);
-- A reveal bought before the migration, run-out still on file: must be backfilled.
INSERT INTO public.rabbit_hunt_offers(table_id,hand_number,cards,board_len,eligible_user_ids,created_at) VALUES
 ('22222222-2222-2222-2222-222222222222',7,'[{"rank":"A","suit":"spades"},{"rank":"K","suit":"hearts"},{"rank":"Q","suit":"clubs"},{"rank":"J","suit":"diamonds"},{"rank":"T","suit":"spades"}]',0,ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid],now()-interval '1 hour');
INSERT INTO public.rabbit_hunt_reveals(user_id,table_id,hand_number) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222',7);
