# A noncooperating target writer may own either a tournament row or its hand
# advisory key. Both stay locked until after the unrelated real payout commits.
session "target"
step "hold_row" {
 BEGIN;
 SELECT id FROM public.tournaments WHERE id=md5('l04:race:target')::uuid FOR UPDATE;
}
step "hold_hand_key" {
 BEGIN;
 SELECT pg_advisory_xact_lock_shared(hashtextextended(
   'ca:tournament-terminal-settlement:v1:' || md5('l04:race:target')::uuid::text,0));
}
step "release_target" { ROLLBACK; }

session "payer"
setup {
 SET statement_timeout='10s';
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,false);
 SET ROLE service_role;
}
step "blocked_award" {
 DO $blocked$
 BEGIN
   PERFORM public.fn_settle_satellite_qualifiers(md5('l04:race:source')::uuid,
     ARRAY(SELECT x FROM unnest(ARRAY[md5('l04:race:user:1')::uuid,md5('l04:race:user:2')::uuid]) x ORDER BY x));
   RAISE EXCEPTION 'blocked award unexpectedly completed';
 EXCEPTION WHEN lock_not_available THEN
   RAISE NOTICE 'BLOCKED_AWARD_REFUSED';
 END $blocked$;
}
step "same_award" {
 DO $award$ DECLARE r jsonb;
 BEGIN
   r:=public.fn_settle_satellite_qualifiers(md5('l04:race:source')::uuid,
     ARRAY(SELECT x FROM unnest(ARRAY[md5('l04:race:user:1')::uuid,md5('l04:race:user:2')::uuid]) x ORDER BY x));
   IF r->>'receipt_version' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'original award failed: %',r; END IF;
   RAISE NOTICE 'BLOCKED_AWARD_SETTLED';
 END $award$;
}

session "unrelated"
setup {
 SET statement_timeout='10s';
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,false);
 SET ROLE service_role;
}
step "independent_award" {
 DO $award$ DECLARE r jsonb;
 BEGIN
   r:=public.fn_settle_satellite_qualifiers(md5('l04:independent:source')::uuid,
     ARRAY[md5('l04:independent:user:1')::uuid]);
   IF r->>'receipt_version' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'independent award failed: %',r; END IF;
   RAISE NOTICE 'INDEPENDENT_AWARD_SETTLED';
 END $award$;
}
step "peer_award" {
 DO $award$ DECLARE r jsonb;
 BEGIN
   r:=public.fn_settle_satellite_qualifiers(md5('l04:peer:source')::uuid,
     ARRAY[md5('l04:peer:user:1')::uuid]);
   IF r->>'receipt_version' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'same-target peer failed: %',r; END IF;
   RAISE NOTICE 'SAME_TARGET_PEER_SETTLED';
 END $award$;
}
step "effects" {
 RESET ROLE;
 DO $proof$
 BEGIN
   IF (SELECT count(*) FROM public.tournament_satellite_settlements WHERE tournament_id IN
        (md5('l04:race:source')::uuid,md5('l04:independent:source')::uuid,md5('l04:peer:source')::uuid)) <> 3
      OR (SELECT count(*) FROM public.tournament_escrow WHERE tournament_id IN
        (md5('l04:race:source')::uuid,md5('l04:independent:source')::uuid,md5('l04:peer:source')::uuid)
        AND prize_balance=0 AND prize_out=105 AND closed_at IS NOT NULL) <> 3 THEN
     RAISE EXCEPTION 'all three funded cohorts must settle and close escrow';
   END IF;
   RAISE NOTICE 'BLOCKED_TARGET_EXACT_EFFECTS';
 END $proof$;
}
permutation "hold_row" "blocked_award" "independent_award" "release_target" "same_award" "peer_award" "effects"
permutation "hold_hand_key" "blocked_award" "independent_award" "release_target" "same_award" "peer_award" "effects"
