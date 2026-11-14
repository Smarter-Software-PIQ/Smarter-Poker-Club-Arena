-- 20261114182834_a_satellite_seat_held_with_re_entries_is_in_the_boundary
--
-- Reserved by scripts/new-migration.mjs on 2026-11-14 18:28:34 UTC.
--
-- CLAUDE.md 10.9 / 10.11: the reasoning goes in this header, not just the SQL.
--
-- A SATELLITE SEAT HELD WITH RE-ENTRIES IS IN THE BOUNDARY (2026-11-14).
--
-- WHAT WAS WRONG. fn_union_pnl_boundary carries every registration of a
-- tournament still open at a weekly boundary at its original entry less the
-- money already returned to it. A registration admitted by a satellite-won
-- seat has no wallet entry receipt for that seat, so it has its own branch
-- (20261007001000) that holds the seat at the value its one funding row moved
-- into the prize liability. That branch only runs when the registration has
-- NO chip entry receipt at all. A seat holder who ALSO bought chips in the
-- same tournament (a re-entry or rebuy) has entry receipts, so it fell to the
-- general branch, which holds the entries less the returns and nothing for
-- the seat. The seat's value was left out of the open-tournament holding.
--
-- WHAT IT COST, READ FROM ROWS. Validating the Midway weekly statements for
-- Nov 2 - Nov 9 against the chip ledger (2026-11-14), the cash side of all four
-- clubs matched to the cent. The tournament side of two did not. At the
-- 2026-11-02 08:00Z boundary exactly six such registrations were open, every
-- one with exactly one seat row and a seat owner equal to its entry club:
--   Deep Stack Society 305.00 (fd24fa6c 100, 9e96d924 30, 5bbc2630 50,
--                              35b4d050 75, d2eeae50 50)
--   KINGS CLUB         100.00 (eec3a4c9, two entries)
-- That boundary was the CLOSE of Oct 26 - Nov 2 and the OPEN of Nov 2 - Nov 9,
-- so each club's 10% ECO moved between the two weeks:
--   Deep Stack  MIDWAY-2026-000033 141,330.49 (true 141,299.99)
--               MIDWAY-2026-000038  96,919.54 (true  96,950.04)
--   KINGS CLUB  MIDWAY-2026-000034 110,114.30 (true 110,104.30)
--               MIDWAY-2026-000039   6,042.96 (true   6,052.96)
-- The two-week totals are exact; each week is 30.50 / 10.00 off. No such
-- registration was open at the 2026-11-09 boundary, or at any union boundary
-- now (measured read-only 2026-11-14 18:30Z), so installing this changes the
-- value of no boundary a statement has not already been issued for.
--
-- THE FIX, AT THE LINE. In the general branch, after entries less returns, a
-- registration that names a source satellite and has a seat row before the
-- boundary also carries the seat, as its own deferred holding for the club
-- that funded the seat - the same ledger predicate and the same owner
-- function the seat-only branch uses, byte for byte. No seat row means
-- nothing moved into the pool before the boundary: nothing to hold, and the
-- behaviour is unchanged. More than one seat row, a non-positive value, no
-- seat owner, or any credit to this player in this tournament that is not
-- attributed to this registration's entry receipts is refused as
-- open_tournament_satellite_seat_with_entries_unproven - never guessed
-- (CLAUDE.md 10.86). Of the six above, two had credits before the boundary
-- (9e96d924: five 10.00 bounties; eec3a4c9: a 586.86 prize) and every one of
-- them is attributed to that registration's entry receipts, so all six pass.
--
-- THE PINS MOVE (scripts/ci/migration-stale-pins.mjs). The body md5
-- 5e4e878524a91518de209bc5e008db36 is pinned by exactly one installed
-- function, smarter_private.original_inventory_proof_sources_match()
-- (md5 8938ab5adca3670b89ab8515f087646e), and that function is pinned by
-- nothing, so the cascade stops there. The new md5 is read back from the
-- catalog after the patch, never hardcoded; proof_sources_match() must be
-- TRUE again before COMMIT and neither old md5 may remain in any prosrc. The
-- generation keeps its original-inventory-245-v1: prefix and its hash moves,
-- because that hash covers this body: no boundary certificate written before
-- this file is reused. Owner, ACL, security, config and volatility are
-- asserted unchanged on both functions.
--
-- @live-proof: smarter_private.original_inventory_proof_sources_match() IS TRUE AND smarter_private.original_inventory_basis_generation() LIKE 'original-inventory-245-v1:%' AND position('A SATELLITE SEAT HELD WITH RE-ENTRIES (20261114182834)' IN pg_get_functiondef('public.fn_union_pnl_boundary(uuid,timestamptz)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

-- 1. The preimages this patch was qualified against, and the six seats it was
--    measured on.
DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_union_pnl_boundary(uuid,timestamptz)'::regprocedure)) <> '5e4e878524a91518de209bc5e008db36' THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_BOUNDARY_PREIMAGE_CHANGED: fn_union_pnl_boundary was edited since this patch was qualified; requalify before installing' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure)) <> '8938ab5adca3670b89ab8515f087646e' THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_SOURCES_PREIMAGE_CHANGED: original_inventory_proof_sources_match was edited since this patch was qualified' USING ERRCODE = '55000';
  END IF;
  IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_SOURCES_ALREADY_DIFFER: the proof source list did not match the catalog before this file' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM public.tournament_players tp
       WHERE tp.id IN ('fd24fa6c-bdb8-47c8-94ad-6c77c68214d5','9e96d924-41ce-40cf-b759-78ca39532c40',
                       '5bbc2630-a517-43c6-8759-df0cd6ef26d3','35b4d050-df5a-4e51-a79f-2ad6e47c2a12',
                       'd2eeae50-939c-46bc-b313-ab4d56f774e5','eec3a4c9-e0e5-449c-ae7d-0b3ddcca8616')
         AND tp.source_satellite_id IS NOT NULL
         AND public.fn_union_pnl_satellite_seat_owner(tp.id, tp.tournament_id) IS NOT NULL) <> 6 THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_BASELINE_CHANGED: the six measured seat holders no longer resolve to a seat owner' USING ERRCODE = '55000';
  END IF;
END
$pre$;

-- 2. The general branch carries the seat.
DO $boundary$
DECLARE
  c_sig constant text := 'public.fn_union_pnl_boundary(uuid,timestamptz)';
  c_decl_old constant text := $old$ seat_rows int; seat_value numeric; seat_club uuid; seat_credits int; original_receivables jsonb;
$old$;
  c_decl_new constant text := $new$ seat_rows int; seat_value numeric; seat_club uuid; seat_credits int; original_receivables jsonb;
 seat_credit_total numeric;
$new$;
  c_old constant text := $old$   value:=value-COALESCE(returned,0);
$old$;
  c_new constant text := $new$   value:=value-COALESCE(returned,0);
   -- A SATELLITE SEAT HELD WITH RE-ENTRIES (20261114182834): a registration
   -- admitted by a satellite-won seat that ALSO bought chips (a re-entry or a
   -- rebuy) has entry receipts, so it never reaches the seat-only branch
   -- above, and the seat's value was left out of its holding. At the
   -- 2026-11-02 boundary six such registrations held 405.00 of seats and the
   -- week's opening read 405.00 short. The seat is held here at the value its
   -- one funding row moved into this prize liability, for the club that
   -- funded the seat, exactly as the seat-only branch holds it. No seat row:
   -- nothing moved into the pool before the boundary, nothing to hold. More
   -- than one, a non-positive value, no seat owner, or a credit to this
   -- player in this tournament not attributed to this registration's entries
   -- is refused, never guessed.
   IF s->>'source_satellite_id' IS NOT NULL THEN
    SELECT count(*),sum(l.amount) INTO seat_rows,seat_value FROM public.chip_ledger l
     WHERE l.status='posted' AND l.row_hash IS NOT NULL AND l.created_at<p_at
      AND l.to_type='prize_liability' AND l.to_entity_id=(t->>'id')::uuid
      AND l.metadata->>'registration_id'=s->>'id' AND l.metadata->>'user_id'=s->>'user_id'
      AND ((l.category='tournament_buyin' AND l.from_type='prize_liability' AND l.from_entity_id=(s->>'source_satellite_id')::uuid
        AND l.metadata->>'kind'='satellite_seat_pool_transfer')
       OR (l.category='ticket_redeem' AND l.from_type='escrow' AND l.metadata->>'kind'='tournament_entry_ticket_admission'
        AND l.metadata->>'source_satellite_id'=s->>'source_satellite_id'));
    IF seat_rows>0 THEN
     seat_club:=public.fn_union_pnl_satellite_seat_owner((s->>'id')::uuid,(t->>'id')::uuid);
     SELECT COALESCE((SELECT sum(c.amount) FROM public.tournament_accounting_credit_receipts c
       JOIN public.union_pnl_transaction_frames b ON b.transaction_id=c.transaction_id
       WHERE c.tournament_id=(t->>'id')::uuid AND c.user_id::text=s->>'user_id' AND b.observed_at<p_at),0)
      +COALESCE((SELECT sum(r2.amount_paid_now) FROM public.tournament_refund_tranches r2
       JOIN public.union_pnl_transaction_frames b ON b.transaction_id=r2.transaction_id
       WHERE r2.tournament_id=(t->>'id')::uuid AND r2.user_id::text=s->>'user_id' AND b.observed_at<p_at
        AND NOT EXISTS(SELECT 1 FROM public.tournament_accounting_credit_receipts c WHERE c.ledger_id=r2.credit_ledger_id)),0)
      INTO seat_credit_total;
     IF seat_rows<>1 OR seat_value IS NULL OR seat_value<=0 OR seat_club IS NULL
        OR seat_credit_total IS DISTINCT FROM COALESCE(returned,0) THEN
      issues:=issues||jsonb_build_array(jsonb_build_object('reason','open_tournament_satellite_seat_with_entries_unproven','registration_id',s->'id')); CONTINUE;
     END IF;
     holdings:=holdings||jsonb_build_array(jsonb_build_object('club_id',seat_club,'user_id',s->'user_id','amount',seat_value,
      'kind','deferred_tournament_result','source_id',s->'id','basis','satellite_seat'));
    END IF;
   END IF;
$new$;
  d text; p text; m jsonb; m2 jsonb;
BEGIN
  d := pg_get_functiondef(c_sig::regprocedure);
  IF (length(d) - length(replace(d, c_decl_old, ''))) / length(c_decl_old) <> 1 THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_DECLARE_ANCHOR: the seat declaration line is not unique' USING ERRCODE = '55000';
  END IF;
  IF (length(d) - length(replace(d, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_ANCHOR: the general-branch return line is not unique' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(replace(d, c_decl_old, c_decl_new), c_old, c_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$boundary$;

-- 3. The proof source list follows the new body. The new md5 is read back
--    from the catalog under the list's own search_path (pg_catalog).
DO $sources_pin$
DECLARE
  c_psm   constant text := 'smarter_private.original_inventory_proof_sources_match()';
  c_bound constant text := 'public.fn_union_pnl_boundary(uuid,timestamptz)';
  old_bound constant text := '5e4e878524a91518de209bc5e008db36';
  old_psm   constant text := '8938ab5adca3670b89ab8515f087646e';
  new_bound text; d text; p text; m jsonb; m2 jsonb; previous text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  new_bound := md5(pg_get_functiondef(c_bound::regprocedure));
  PERFORM set_config('search_path', previous, true);
  IF new_bound IS NOT DISTINCT FROM old_bound THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_BOUNDARY_UNCHANGED: the boundary body did not change' USING ERRCODE = '55000';
  END IF;
  d := pg_get_functiondef(c_psm::regprocedure);
  IF md5(d) IS DISTINCT FROM old_psm THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_SOURCES_PREIMAGE %', md5(d) USING ERRCODE = '55000';
  END IF;
  IF (length(d) - length(replace(d, old_bound, ''))) / length(old_bound) <> 1 THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_SOURCES_ANCHOR: the boundary pin is not unique in the list' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_psm::regprocedure;
  p := replace(d, old_bound, new_bound);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_psm::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_psm::regprocedure) <> p THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_SOURCES_POSTIMAGE %', md5(pg_get_functiondef(c_psm::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$sources_pin$;

-- 4. The pinned set holds again, and this file refuses itself on exactly the
--    condition scripts/ci/migration-stale-pins.mjs would refuse it on.
DO $pins_hold$
DECLARE v_stale text;
BEGIN
  IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_SOURCES_STILL_DIFFER: the proof source list does not match the catalog' USING ERRCODE = '55000';
  END IF;
  IF smarter_private.original_inventory_basis_generation() NOT LIKE 'original-inventory-245-v1:%' THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_GENERATION_SHAPE: %', smarter_private.original_inventory_basis_generation() USING ERRCODE = '55000';
  END IF;
  SELECT string_agg(DISTINCT x.md5 || ' is still pinned by ' || q.oid::regprocedure::text, '; ')
    INTO v_stale
    FROM (VALUES ('5e4e878524a91518de209bc5e008db36'),
                 ('8938ab5adca3670b89ab8515f087646e')) x(md5)
    JOIN pg_catalog.pg_proc q ON strpos(q.prosrc, x.md5) > 0;
  IF v_stale IS NOT NULL THEN
    RAISE EXCEPTION 'SEAT_WITH_ENTRIES_LEFT_A_STALE_PIN: %', v_stale USING ERRCODE = '55000';
  END IF;
END
$pins_hold$;

COMMIT;
