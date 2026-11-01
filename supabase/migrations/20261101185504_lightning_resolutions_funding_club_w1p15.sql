-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- LIGHTNING LINK RESOLUTIONS FOLLOW THE CLUB THAT FUNDED THE SEAT, Oct 19-26
-- week, part 15 of 15 (window 2026-10-26 04:00Z .. 2026-10-26 07:00Z, about 20738 hands).
--
-- One-time supersession under the owner's 2026-11-01 ruling (given in chat,
-- answering the in-chat question): Lightning P&L belongs to the player's HOME
-- club, the club whose wallet funded the seat, and the already-recorded weeks
-- are corrected once under an owner-authorized exception. Midway's Oct 19-26
-- books cannot close while about 495k chips of Lightning hand results sit on
-- the Union itself (fade0000) against flows and rake at the member clubs.
--
-- fn_lightning_original_pnl_proof already books new hands to the funding club
-- (migration 20261101132936 and the carried-stack fallback 20261101185431,
-- which must be live: the guard refuses both earlier bodies). This migration
-- re-proves each recorded
-- lightning_pool link resolution in its window with that same live function
-- and replaces the row ONLY when the new proof is clean (proven, evidence
-- ready, same hand_id) and actually differs. Unclean proofs are never
-- touched. No money moves: rake, rakeback, ledgers and payouts are untouched;
-- these rows feed the P&L/ECO paperwork only. session_replication_role
-- 'replica' is scoped to this transaction to pass original_pnl_immutable,
-- exactly as the owner-approved plan prescribes.
-- @live-proof: (SELECT NOT EXISTS (SELECT 1 FROM public.union_pnl_cash_outcome_link_resolutions r JOIN public.union_pnl_cash_outcomes o ON o.table_id=r.table_id AND o.hand_number=r.hand_number WHERE r.roster_source='lightning_pool' AND r.game_scope->>'game_union_id'='fade0000-0000-0000-0000-000000000001' AND o.recognized_at>='2026-10-26 04:00Z' AND o.recognized_at<'2026-10-26 07:00Z' AND r.reason NOT LIKE '%one-time supersession%' AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.evidence->'participants') p WHERE p->>'earning_club_id'='fade0000-0000-0000-0000-000000000001')))
BEGIN;
SET LOCAL statement_timeout='290s';
SET LOCAL lock_timeout='10s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
DECLARE v_def text;
BEGIN
 v_def := pg_get_functiondef('public.fn_lightning_original_pnl_proof(uuid,bigint)'::regprocedure);
 IF strpos(v_def,'FUNDING CLUB FALLBACK 20261101')=0
    OR md5(v_def) IN ('c8ca7384306de10f52c8bf806b9a1db3','629e602df66bd009b8227f0cde2f3751') THEN
  RAISE EXCEPTION 'lightning_pnl_proof_is_not_the_carried_stack_fallback_version'; END IF;
END
$guard$;

SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE _lrb_new ON COMMIT DROP AS
WITH scope AS (
 SELECT r.table_id, r.hand_number, r.hand_id old_hand_id, r.proof_md5 old_md5
 FROM public.union_pnl_cash_outcome_link_resolutions r
 JOIN public.union_pnl_cash_outcomes o ON o.table_id=r.table_id AND o.hand_number=r.hand_number
 WHERE r.roster_source='lightning_pool'
   AND r.game_scope->>'game_union_id'='fade0000-0000-0000-0000-000000000001'
   AND o.recognized_at>='2026-10-26 04:00Z' AND o.recognized_at<'2026-10-26 07:00Z'
)
SELECT s.table_id, s.hand_number, np.np
FROM scope s
CROSS JOIN LATERAL (SELECT public.fn_lightning_original_pnl_proof(s.table_id,s.hand_number) np) np
WHERE np.np->>'status'='proven' AND np.np#>>'{evidence,status}'='ready'
  AND (np.np->>'hand_id')::uuid=s.old_hand_id
  AND md5(np.np::text) <> s.old_md5;

DELETE FROM public.union_pnl_cash_outcome_link_resolutions r
USING _lrb_new c
WHERE r.table_id=c.table_id AND r.hand_number=c.hand_number;

INSERT INTO public.union_pnl_cash_outcome_link_resolutions
 (table_id,hand_number,hand_id,outcome_payload_hash,outcome_evidence_md5,
  roster_source,manifest_id,game_scope,evidence,proof,proof_md5,reason)
SELECT c.table_id, c.hand_number, (c.np->>'hand_id')::uuid,
       o.payload_hash, md5(o.evidence::text), 'lightning_pool', NULL,
       c.np->'game_scope', c.np->'evidence', c.np, md5(c.np::text),
       'Lightning results book to the club that funded the seat; one-time supersession of this recorded link resolution under the owner''s 2026-11-01 ruling'
FROM _lrb_new c
JOIN public.union_pnl_cash_outcomes o ON o.table_id=c.table_id AND o.hand_number=c.hand_number;

SET LOCAL session_replication_role = origin;

DO $check$
DECLARE v_missing bigint; v_badmd5 bigint;
BEGIN
 SELECT count(*) INTO v_missing FROM _lrb_new c
  LEFT JOIN public.union_pnl_cash_outcome_link_resolutions r
    ON r.table_id=c.table_id AND r.hand_number=c.hand_number
  WHERE r.table_id IS NULL;
 IF v_missing>0 THEN RAISE EXCEPTION 'lightning_resolution_supersession_lost_% rows', v_missing; END IF;
 SELECT count(*) INTO v_badmd5
  FROM public.union_pnl_cash_outcome_link_resolutions r
  JOIN _lrb_new c ON r.table_id=c.table_id AND r.hand_number=c.hand_number
  WHERE r.proof_md5 IS DISTINCT FROM md5(r.proof::text)
     OR r.hand_id IS DISTINCT FROM (r.proof->>'hand_id')::uuid
     OR r.outcome_payload_hash IS DISTINCT FROM r.proof->>'outcome_payload_hash';
 IF v_badmd5>0 THEN RAISE EXCEPTION 'lightning_resolution_supersession_inconsistent_% rows', v_badmd5; END IF;
END
$check$;

COMMIT;
