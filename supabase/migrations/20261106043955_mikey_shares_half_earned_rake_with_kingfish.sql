-- @live-proof: (SELECT count(*)=2 FROM smarter_private.player_rake_share_rules WHERE club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4' AND from_user IN ('b52f183b-c0fc-4dcc-8d96-7d2a1cdb7216','69f2cefa-017d-49f3-ac3e-61505633747c') AND to_user='47965354-0e56-43ef-931c-ddaab82af765' AND share_bps=5000 AND effective_until IS NULL)
-- Owner November 5, 2026: Mikey keeps 50% of earned rake reporting and
-- KingFish is credited the other 50%, the same standing share as WooWoo.
-- Reuse the maintained read-time configuration. This is reporting credit,
-- not a wallet transfer, rakeback rate change, or settled-accounting rewrite.
-- Mikey's full recorded history is covered. WooWoo's prior VIP redemption and
-- historical declared split remain intact; his ongoing share is verified.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $guard$
BEGIN
 IF NOT EXISTS(SELECT FROM public.profiles WHERE id='b52f183b-c0fc-4dcc-8d96-7d2a1cdb7216' AND lower(username)='mikey')
 OR NOT EXISTS(SELECT FROM public.profiles WHERE id='47965354-0e56-43ef-931c-ddaab82af765' AND lower(username)='kingfish')
 OR NOT EXISTS(SELECT FROM smarter_private.player_rake_share_rules
 WHERE rule_key='woowoo-half-rake-to-kingfish-20261024' AND club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
 AND from_user='69f2cefa-017d-49f3-ac3e-61505633747c' AND to_user='47965354-0e56-43ef-931c-ddaab82af765'
 AND share_bps=5000 AND effective_until IS NULL) THEN RAISE EXCEPTION 'earned_rake_share_identity_or_existing_rule_changed'; END IF;
 IF EXISTS(SELECT FROM smarter_private.player_rake_share_rules
 WHERE from_user='b52f183b-c0fc-4dcc-8d96-7d2a1cdb7216' AND club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
 AND rule_key<>'mikey-half-rake-to-kingfish-20261105') THEN RAISE EXCEPTION 'mikey_rake_share_already_configured'; END IF;
END $guard$;
INSERT INTO smarter_private.player_rake_share_rules
(rule_key,club_id,from_user,to_user,share_bps,effective_from,reason)
VALUES('mikey-half-rake-to-kingfish-20261105','a41434bb-8d0c-400a-8f0d-e8b3d65afed4',
'b52f183b-c0fc-4dcc-8d96-7d2a1cdb7216','47965354-0e56-43ef-931c-ddaab82af765',5000,'1970-01-01T00:00:00Z',
'Owner instruction November 5, 2026: report half of all Mikey earned cash rake as Mikey and half as KingFish, exactly the existing WooWoo standing share; reporting only, no wallet movement.')
ON CONFLICT(rule_key) DO NOTHING;
DO $post$ BEGIN
 IF NOT EXISTS(SELECT FROM smarter_private.player_rake_share_rules WHERE rule_key='mikey-half-rake-to-kingfish-20261105'
 AND club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4' AND from_user='b52f183b-c0fc-4dcc-8d96-7d2a1cdb7216'
 AND to_user='47965354-0e56-43ef-931c-ddaab82af765' AND share_bps=5000 AND effective_from='1970-01-01T00:00:00Z'
 AND effective_until IS NULL) THEN RAISE EXCEPTION 'mikey_rake_share_readback_failed'; END IF;
END $post$;
COMMIT;
