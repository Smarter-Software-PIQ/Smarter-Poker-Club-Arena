-- 20261111003802_the_union_close_pins_follow_the_new_bodies
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-11 00:38:02 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
--
-- THE UNION CLOSE'S PINS FOLLOW THE NEW BODIES (2026-11-11).
--
-- 20261110235613 (a chained satellite seat resolves one hop upstream) and
-- 20261110235631 (the touched step is certified in sub ranges) are the two
-- fixes for the union_accounting_scheduler money-integrity incident
-- a544b469-9226-4770-9f77-d5a77e085ea7. Both merged in #10421 at 00:29:29Z
-- and both were REFUSED by the applier at 00:30, with nothing committed:
--
--   migration_left_a_stale_pin: public.fn_union_pnl_satellite_seat_owner(uuid,uuid)
--     (old md5 58b6c79c412a9e3b26104c0b4b6878d6) is still pinned by
--     smarter_private.original_inventory_proof_sources_match()
--   migration_left_a_stale_pin: public.fn_union_pnl_evidence_report(...)
--     (old md5 80f29ec1270de41106ee6302153a7cfe) is still pinned by
--     public.fn_accounting_union_earned_plan_advance(...) and by
--     smarter_private.original_inventory_proof_sources_match()
--
-- scripts/ci/migration-stale-pins.mjs is right and the two files were wrong:
-- they changed bodies that other installed functions pin by md5 and left
-- those pins naming a body that no longer exists. There is no @stale-pin-ok
-- declaration anywhere in this tree and this is not the place to write the
-- first one - what the pins protect is read, not guessed, so the pins move.
--
-- MEASURED read-only on production 2026-11-11 00:35-00:45Z:
--   original_inventory_proof_sources_match() = true
--   original_inventory_basis_generation() = original-inventory-245-v1:47dd0e41022511cc4c1e0dcad231f02a
--   fn_union_pnl_satellite_seat_owner(uuid,uuid)          58b6c79c412a9e3b26104c0b4b6878d6
--     pinned by: original_inventory_proof_sources_match()
--   fn_union_pnl_evidence_report(uuid,tstz,tstz)          80f29ec1270de41106ee6302153a7cfe
--     pinned by: fn_accounting_union_earned_plan_advance(), proof_sources_match()
--   fn_accounting_union_earned_plan_advance(uuid,tstz,tstz) 911c6c96b4dfe66bff7bdcfb00eb94d2
--     pinned by: original_inventory_proof_sources_match()
--   original_inventory_proof_sources_match()              866cccb1eb119003fb3fd21bb517a3f3
--     pinned by: nothing - so the cascade terminates at these four functions
-- The catalog and public-search_path md5s are identical for all four, so
-- there is no second spelling of any old md5 left to clear.
--
-- This file is 20261110235613 and 20261110235631 carried over BYTE-EXACT -
-- the same preimage pins, the same anchor-uniqueness checks, the same
-- replacements, the same 83-resolved/0-null/2-mismatch measurement and the
-- same NOT VALID frame_is_observed CHECK - plus, in the same transaction,
-- the pin moves those two files owed:
--   1. the advance's report pin 80f29ec1.. -> the report's new body;
--   2. the 69-source list's three entries: the seat owner, the report and
--      the advance, each -> the new body md5 read back from the catalog
--      after it was patched, never a hardcoded guess;
--   3. proof_sources_match() must be TRUE again before COMMIT, and no old
--      md5 of any of the four may remain in any prosrc - this file refuses
--      itself on the same condition the applier would refuse it on.
-- Owner, ACL, security, config and volatility are asserted unchanged on
-- every function this file replaces.
--
-- The two in-body markers deliberately still read (20261110235613) and
-- (20261110235631): the patch text is carried over unchanged so the
-- qualification of those two files still describes the bytes being
-- installed. Those two files are retired out of the active chain in this
-- same pull request - they never ran, and the install watch closes a
-- never-installed file only when it is installed or removed from main.
--
-- The generation keeps its original-inventory-245-v1: prefix and its hash
-- changes, because that hash covers these function bodies: no inventory
-- certificate written before this file is reused.
--
-- @live-proof: smarter_private.original_inventory_proof_sources_match() IS TRUE AND smarter_private.original_inventory_basis_generation() LIKE 'original-inventory-245-v1:%' AND position('CHAINED SATELLITE SEATS (20261110235613)' IN pg_get_functiondef('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure))>0 AND position('SUB-RANGE CERTIFIED TOUCHED STEP (20261110235631)' IN pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

-- 1. A chained satellite seat resolves one hop upstream (20261110235613).
DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure)) <> '58b6c79c412a9e3b26104c0b4b6878d6' THEN
    RAISE EXCEPTION 'SATELLITE_SEAT_OWNER_PREIMAGE_CHANGED: fn_union_pnl_satellite_seat_owner was edited since this patch was qualified; requalify before installing';
  END IF;
  IF (SELECT count(*) FROM public.tournament_refund_entitlements t
       WHERE t.tournament_id = 'f4153d52-f30e-402c-bda8-be30b8d1b30b'
         AND t.entitlement_kind = 'satellite_seat'
         AND public.fn_union_pnl_satellite_seat_owner(t.registration_id, NULL) = t.refund_wallet_club_id) <> 75 THEN
    RAISE EXCEPTION 'SATELLITE_SEAT_OWNER_PREIMAGE_CHANGED: the measured baseline of 75 resolving entitlements no longer holds';
  END IF;
END
$pre$;

DO $owner$
DECLARE
  s text;
  n text;
  k integer;
  c_sig constant text := 'public.fn_union_pnl_satellite_seat_owner(uuid,uuid)';
  c_old constant text := $old$  FROM award a JOIN public.tournament_participant_funding_receipts r ON r.tournament_id=a.tournament_id AND r.user_id=a.user_id
 )
 SELECT CASE WHEN (SELECT count(*) FROM award)=1 AND e.n>0 AND e.entries>=1 AND e.clubs=1 AND e.bad=0 THEN e.club END FROM entry e$old$;
  c_new constant text := $new$  FROM award a JOIN public.tournament_participant_funding_receipts r ON r.tournament_id=a.tournament_id AND r.user_id=a.user_id
 -- CHAINED SATELLITE SEATS (20261110235613): a seat produced by a satellite the
 -- player was admitted to by WINNING an upstream satellite has no wallet entry
 -- receipt of its own, so 'entry' above keeps nothing and the seat's owning
 -- club was unresolvable. One hop, never two, and never recursive: the hop is
 -- taken only when the immediate satellite has NO entry receipt at all
 -- (e.entries=0), so a resolvable or a conflicting immediate answer is never
 -- overridden, and it is accepted only when the upstream registration's own
 -- original row names no satellite, so the walk must terminate at a wallet
 -- entry or resolve nothing. Both registrations are read from
 -- union_pnl_inventory_events (the same first-event provenance as 'reg'); the
 -- live tournament_players row is only the unique (tournament,user) key used
 -- to find them, and a later edit to it can only make this NULL. The upstream
 -- receipts face the identical quality conjunction, byte for byte.
 ), upstream AS (
  SELECT u.tournament_id upstream_id,w.user_id FROM who w
  JOIN public.tournament_players s ON s.tournament_id=w.satellite_id AND s.user_id=w.user_id
  CROSS JOIN LATERAL (SELECT e.after_row r FROM public.union_pnl_inventory_events e
   WHERE e.source_name='tournament_players' AND e.row_id=s.id ORDER BY e.event_id LIMIT 1) sreg
  JOIN public.tournament_players u ON u.tournament_id=(sreg.r->>'source_satellite_id')::uuid AND u.user_id=w.user_id
  CROSS JOIN LATERAL (SELECT e.after_row r FROM public.union_pnl_inventory_events e
   WHERE e.source_name='tournament_players' AND e.row_id=u.id ORDER BY e.event_id LIMIT 1) ureg
  WHERE (SELECT e.entries FROM entry e)=0 AND (SELECT count(*) FROM award)=1
   AND sreg.r->>'tournament_id'=w.satellite_id::text AND sreg.r->>'user_id'=w.user_id::text
   AND sreg.r->>'source_satellite_id' IS NOT NULL
   AND ureg.r->>'tournament_id'=sreg.r->>'source_satellite_id' AND ureg.r->>'user_id'=w.user_id::text
   AND ureg.r->>'source_satellite_id' IS NULL
   AND EXISTS(SELECT 1 FROM public.tournament_satellite_awards a WHERE a.tournament_id=u.tournament_id AND a.user_id=w.user_id)
 ), upstream_entry AS (
  SELECT count(*) n,count(DISTINCT r.funding_club_id) clubs,min(r.funding_club_id::text)::uuid club,
   count(*) FILTER(WHERE r.operation='entry') entries,
   count(*) FILTER(WHERE r.asset IS DISTINCT FROM 'chips' OR r.amount IS NULL OR r.amount<=0 OR r.funding_club_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM (SELECT row.* FROM public.chip_ledger row WHERE row.id=r.ledger_id OFFSET 0) l WHERE l.status='posted' AND l.from_type='player_wallet' AND l.from_entity_id=r.user_id
     AND l.to_type='prize_liability' AND l.to_entity_id=r.tournament_id AND l.tournament_id=r.tournament_id AND l.amount=r.amount
     AND l.club_id=r.funding_club_id AND l.category IN ('tournament_buyin','rebuy','addon') AND l.row_hash IS NOT NULL)) bad
  FROM upstream x JOIN public.tournament_participant_funding_receipts r ON r.tournament_id=x.upstream_id AND r.user_id=x.user_id
 )
 SELECT CASE WHEN (SELECT count(*) FROM award)=1 AND e.n>0 AND e.entries>=1 AND e.clubs=1 AND e.bad=0 THEN e.club
  WHEN (SELECT count(*) FROM award)=1 AND e.entries=0 AND (SELECT count(*) FROM upstream)=1
   AND x.n>0 AND x.entries>=1 AND x.clubs=1 AND x.bad=0 THEN x.club END
 FROM entry e CROSS JOIN upstream_entry x$new$;
BEGIN
  s := pg_get_functiondef(c_sig::regprocedure);
  k := (length(s) - length(replace(s, c_old, ''))) / length(c_old);
  IF k IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SATELLITE_SEAT_OWNER_ANCHOR: tail found % times; requalify before installing', k;
  END IF;
  n := replace(s, c_old, c_new);
  IF n = s THEN
    RAISE EXCEPTION 'SATELLITE_SEAT_OWNER_ANCHOR: patch did not change the function';
  END IF;
  EXECUTE n;
END
$owner$;

DO $post_owner$
DECLARE v_resolved integer; v_null integer; v_mismatch integer;
BEGIN
  IF position('CHAINED SATELLITE SEATS (20261110235613)' in
              pg_get_functiondef('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SATELLITE_SEAT_OWNER_POSTIMAGE: the marker is not in the installed function';
  END IF;
  SELECT count(*) FILTER (WHERE o = t.refund_wallet_club_id),
         count(*) FILTER (WHERE o IS NULL),
         count(*) FILTER (WHERE o IS NOT NULL AND o <> t.refund_wallet_club_id)
    INTO v_resolved, v_null, v_mismatch
    FROM public.tournament_refund_entitlements t
    CROSS JOIN LATERAL (SELECT public.fn_union_pnl_satellite_seat_owner(t.registration_id, NULL) o) z
   WHERE t.tournament_id = 'f4153d52-f30e-402c-bda8-be30b8d1b30b'
     AND t.entitlement_kind = 'satellite_seat';
  IF v_resolved <> 83 OR v_null <> 0 OR v_mismatch <> 2 THEN
    RAISE EXCEPTION 'SATELLITE_SEAT_OWNER_POSTIMAGE: expected 83 resolved / 0 null / 2 mismatch, got % / % / %', v_resolved, v_null, v_mismatch;
  END IF;
END
$post_owner$;

-- 2. The touched step is certified in sub ranges (20261110235631).
DO $pre_report$
BEGIN
  IF md5(pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure)) <> '80f29ec1270de41106ee6302153a7cfe' THEN
    RAISE EXCEPTION 'EVIDENCE_REPORT_PREIMAGE_CHANGED: fn_union_pnl_evidence_report was edited since this patch was qualified; requalify before installing';
  END IF;
  IF to_regprocedure('public.fn_accounting_close_warm_stop()') IS NULL THEN
    RAISE EXCEPTION 'EVIDENCE_REPORT_PREIMAGE_CHANGED: fn_accounting_close_warm_stop is missing';
  END IF;
END
$pre_report$;

DO $slice$
DECLARE
  s text;
  n text;
  k integer;
  c_sig constant text := 'public.fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)';
  c_decl_old constant text := $do$ v_cert jsonb; v_generation text;v_hand_parts jsonb;$do$;
  c_decl_new constant text := $dn$ v_cert jsonb; v_generation text;v_hand_parts jsonb;
 v_slice jsonb; v_slice_start timestamptz; v_slice_end timestamptz; v_slice_bad bigint;$dn$;
  c_open_old constant text := $ao$ IF v_cert IS NOT NULL THEN
  v_bad:=(v_cert->>'bad')::bigint;
 ELSE
 WITH touched AS MATERIALIZED (
  SELECT w.registration_id row_id,w.touched_tournament_id tournament_id
  FROM public.fn_union_pnl_touched_registrations(p_start,p_end,v_inv) w$ao$;
  c_open_new constant text := $an$ IF v_cert IS NOT NULL THEN
  v_bad:=(v_cert->>'bad')::bigint;
 ELSE
 -- SUB-RANGE CERTIFIED TOUCHED STEP (20261110235631): this one statement
 -- cannot fit a 4 minute scope budget. Two of its joins are CTE scan nested
 -- loops, so its cost is quadratic in the rows of the period: measured on the
 -- week of 2026-11-02, 204,675,344 then 1,182,765,165 join filter evaluations
 -- for a single 6 hour slice. The week is therefore proved in 3 hour
 -- sub-ranges, each certified under the SAME 'pnl_touched' kind at its own
 -- narrower (start,end) key, and summed. 'bad' is a count of touch rows, the
 -- two range predicates of fn_union_pnl_touched_registrations are the same
 -- predicate (fn_union_pnl_inventory_observe stamps every event with its
 -- frame's observed_at and is the only writer), and a row's verdict has no
 -- period dependence, so the sum over any contiguous half-open tiling is the
 -- identical number the full week returns. Measured: 631738 rows at 7, 28 and
 -- 56 slices and at one week. Slices are generated rather than counted because
 -- a DST week is 167 or 169 hours, and LEAST clamps the last end to p_end.
 -- Nothing is skipped, no timeout is extended, and the week's own certificate
 -- is still written only from the complete sum, below.
 v_bad:=0;
 FOR v_slice_start,v_slice_end IN
  SELECT s.a,LEAST(s.a+interval '3 hours',p_end)
  FROM generate_series(p_start,p_end-interval '1 microsecond',interval '3 hours') s(a) ORDER BY s.a
 LOOP
 v_slice:=COALESCE(smarter_private.inventory_basis_cache_read(v_generation,false,'pnl_touched',p_union_id,v_slice_start,v_slice_end),
  smarter_private.inventory_basis_cache_read(v_generation,true,'pnl_touched',p_union_id,v_slice_start,v_slice_end));
 IF v_slice IS NOT NULL THEN
  v_bad:=v_bad+(v_slice->>'bad')::bigint;
 ELSE
 WITH touched AS MATERIALIZED (
  SELECT w.registration_id row_id,w.touched_tournament_id tournament_id
  FROM public.fn_union_pnl_touched_registrations(v_slice_start,v_slice_end,v_inv) w$an$;
  c_close_old constant text := $bo$ ) SELECT count(*) INTO v_bad FROM union_touched i LEFT JOIN entries e ON e.registration_id=i.row_id
 LEFT JOIN satellite_owners o ON o.row_id=i.row_id
 WHERE (NOT COALESCE(e.has_entry,false) AND i.row_id<>ALL(v_open_resolved)
   AND o.owner IS NULL)
  OR COALESCE(e.has_other,false);
  IF v_bad=0 THEN PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_touched',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad));
  ELSE PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_touched_problem',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad)); END IF;$bo$;
  c_close_new constant text := $bn$ ) SELECT count(*) INTO v_slice_bad FROM union_touched i LEFT JOIN entries e ON e.registration_id=i.row_id
 LEFT JOIN satellite_owners o ON o.row_id=i.row_id
 WHERE (NOT COALESCE(e.has_entry,false) AND i.row_id<>ALL(v_open_resolved)
   AND o.owner IS NULL)
  OR COALESCE(e.has_other,false);
  PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_touched',p_union_id,v_slice_start,v_slice_end,jsonb_build_object('bad',v_slice_bad));
  v_bad:=v_bad+v_slice_bad;
  -- One sub-range per visit, through the yield that already exists:
  -- fn_accounting_close_certify sets app.accounting_close_certified, which is
  -- what fn_accounting_close_warm_stop reads. The next visit resumes from the
  -- sub-ranges already certified above. No new setting, no new deadline.
  IF public.fn_accounting_close_warm_stop() THEN RETURN jsonb_build_object('report_version',1,'status','warming','basis_certified',false,'payment_authorized',false,'union_id',p_union_id,'period_start',p_start,'period_end',p_end,'issues',jsonb_build_array('union_pnl_certification_in_progress'),'all_players_included',false); END IF;
 END IF;
 END LOOP;
  IF v_bad=0 THEN PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_touched',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad));
  ELSE PERFORM smarter_private.inventory_basis_cache_write(v_generation,'pnl_touched_problem',p_union_id,p_start,p_end,jsonb_build_object('bad',v_bad)); END IF;$bn$;
BEGIN
  s := pg_get_functiondef(c_sig::regprocedure);
  FOR k IN 1..1 LOOP
    IF (length(s) - length(replace(s, c_decl_old, ''))) / length(c_decl_old) <> 1 THEN
      RAISE EXCEPTION 'EVIDENCE_REPORT_ANCHOR: DECLARE anchor is not unique';
    END IF;
    IF (length(s) - length(replace(s, c_open_old, ''))) / length(c_open_old) <> 1 THEN
      RAISE EXCEPTION 'EVIDENCE_REPORT_ANCHOR: loop-open anchor is not unique';
    END IF;
    IF (length(s) - length(replace(s, c_close_old, ''))) / length(c_close_old) <> 1 THEN
      RAISE EXCEPTION 'EVIDENCE_REPORT_ANCHOR: loop-close anchor is not unique';
    END IF;
  END LOOP;
  n := replace(replace(replace(s, c_decl_old, c_decl_new), c_open_old, c_open_new), c_close_old, c_close_new);
  IF n = s THEN
    RAISE EXCEPTION 'EVIDENCE_REPORT_ANCHOR: patch did not change the function';
  END IF;
  EXECUTE n;
END
$slice$;

-- The invariant the sum rests on, gated for every future insert.
ALTER TABLE public.union_pnl_inventory_touches
  ADD CONSTRAINT union_pnl_inventory_touches_frame_is_observed
  CHECK (frame_observed_at = observed_at) NOT VALID;

DO $post_report$
BEGIN
  IF position('SUB-RANGE CERTIFIED TOUCHED STEP (20261110235631)' in
              pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'EVIDENCE_REPORT_POSTIMAGE: the marker is not in the installed function';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'union_pnl_inventory_touches_frame_is_observed'
                    AND conrelid = 'public.union_pnl_inventory_touches'::regclass) THEN
    RAISE EXCEPTION 'EVIDENCE_REPORT_POSTIMAGE: the frame_is_observed CHECK was not added';
  END IF;
END
$post_report$;

-- 3. The advance proves the week's original flows only while the report is
--    the reviewed definition, so its pin follows the report's new body.
DO $advance_pin$
DECLARE
  c_report constant text := 'public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)';
  c_adv    constant text := 'public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)';
  old_report constant text := '80f29ec1270de41106ee6302153a7cfe';
  old_adv    constant text := '911c6c96b4dfe66bff7bdcfb00eb94d2';
  new_report text; d text; p text; m jsonb; m2 jsonb; k integer;
BEGIN
  new_report := md5(pg_get_functiondef(c_report::regprocedure));
  IF new_report IS NOT DISTINCT FROM old_report THEN
    RAISE EXCEPTION 'UNION_PINS_REPORT_UNCHANGED: the report body did not change' USING ERRCODE='55000';
  END IF;
  d := pg_get_functiondef(c_adv::regprocedure);
  IF md5(d) IS DISTINCT FROM old_adv THEN
    RAISE EXCEPTION 'UNION_PINS_ADVANCE_PREIMAGE %', md5(d) USING ERRCODE='55000';
  END IF;
  k := (length(d) - length(replace(d, old_report, ''))) / length(old_report);
  IF k IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'UNION_PINS_ADVANCE_ANCHOR: the report pin appears % times', k USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_adv::regprocedure;
  p := replace(d, old_report, new_report);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_adv::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_adv::regprocedure) <> p THEN
    RAISE EXCEPTION 'UNION_PINS_ADVANCE_POSTIMAGE %', md5(pg_get_functiondef(c_adv::regprocedure)) USING ERRCODE='55000';
  END IF;
END
$advance_pin$;

-- 4. The 69-source list behind original_inventory_basis_generation: the seat
--    owner, the report and the advance each follow their new body. The new
--    md5s are read back from the catalog after the patch, not hardcoded.
DO $sources_pin$
DECLARE
  c_psm    constant text := 'smarter_private.original_inventory_proof_sources_match()';
  c_owner  constant text := 'public.fn_union_pnl_satellite_seat_owner(uuid,uuid)';
  c_report constant text := 'public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)';
  c_adv    constant text := 'public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)';
  old_owner  constant text := '58b6c79c412a9e3b26104c0b4b6878d6';
  old_report constant text := '80f29ec1270de41106ee6302153a7cfe';
  old_adv    constant text := '911c6c96b4dfe66bff7bdcfb00eb94d2';
  old_psm    constant text := '866cccb1eb119003fb3fd21bb517a3f3';
  d text; p text; m jsonb; m2 jsonb;
BEGIN
  d := pg_get_functiondef(c_psm::regprocedure);
  IF md5(d) IS DISTINCT FROM old_psm THEN
    RAISE EXCEPTION 'UNION_PINS_SOURCES_PREIMAGE %', md5(d) USING ERRCODE='55000';
  END IF;
  IF (length(d) - length(replace(d, old_owner,  ''))) / length(old_owner)  <> 1
     OR (length(d) - length(replace(d, old_report, ''))) / length(old_report) <> 1
     OR (length(d) - length(replace(d, old_adv,    ''))) / length(old_adv)    <> 1 THEN
    RAISE EXCEPTION 'UNION_PINS_SOURCES_ANCHORS: a pinned md5 is not unique in the list' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_psm::regprocedure;
  p := replace(replace(replace(d,
         old_owner,  md5(pg_get_functiondef(c_owner::regprocedure))),
         old_report, md5(pg_get_functiondef(c_report::regprocedure))),
         old_adv,    md5(pg_get_functiondef(c_adv::regprocedure)));
  IF p = d THEN
    RAISE EXCEPTION 'UNION_PINS_SOURCES_UNCHANGED: no entry moved' USING ERRCODE='55000';
  END IF;
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_psm::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_psm::regprocedure) <> p THEN
    RAISE EXCEPTION 'UNION_PINS_SOURCES_POSTIMAGE %', md5(pg_get_functiondef(c_psm::regprocedure)) USING ERRCODE='55000';
  END IF;
END
$sources_pin$;

-- 5. The pinned set holds again, and this file refuses itself on exactly the
--    condition scripts/ci/migration-stale-pins.mjs would refuse it on.
DO $pins_hold$
DECLARE v_stale text;
BEGIN
  IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN
    RAISE EXCEPTION 'UNION_PINS_SOURCES_STILL_DIFFER: the 69-source list does not match the catalog' USING ERRCODE='55000';
  END IF;
  IF smarter_private.original_inventory_basis_generation() NOT LIKE 'original-inventory-245-v1:%' THEN
    RAISE EXCEPTION 'UNION_PINS_GENERATION_SHAPE: %', smarter_private.original_inventory_basis_generation() USING ERRCODE='55000';
  END IF;
  SELECT string_agg(DISTINCT x.md5 || ' is still pinned by ' || q.oid::regprocedure::text, '; ')
    INTO v_stale
    FROM (VALUES ('58b6c79c412a9e3b26104c0b4b6878d6'),
                 ('80f29ec1270de41106ee6302153a7cfe'),
                 ('911c6c96b4dfe66bff7bdcfb00eb94d2'),
                 ('866cccb1eb119003fb3fd21bb517a3f3')) x(md5)
    JOIN pg_catalog.pg_proc q ON strpos(q.prosrc, x.md5) > 0;
  IF v_stale IS NOT NULL THEN
    RAISE EXCEPTION 'UNION_PINS_LEFT_A_STALE_PIN: %', v_stale USING ERRCODE='55000';
  END IF;
END
$pins_hold$;

COMMIT;
