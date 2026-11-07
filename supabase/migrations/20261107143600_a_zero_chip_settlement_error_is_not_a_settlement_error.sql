-- 20261107143600_a_zero_chip_settlement_error_is_not_a_settlement_error
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 14:36:00 UTC.
--
-- A ZERO-CHIP SETTLEMENT ERROR IS NOT A SETTLEMENT ERROR (2026-11-07)
--
-- fn_ca_escrow_balance_drift owns 26 of the 46 unresolved drift_incident rows
-- in financial_alerts. All 26 are false, for two separate reasons, both
-- measured against production on 2026-11-07.
--
-- CAUSE 1 - THE AMOUNT TESTED IS NOT THE AMOUNT FILED. 25 alerts, every one
-- filed by the same sweep tick at detected_at 2026-11-03 12:35:00.159115+00,
-- each classification 'settlement_error', each discrepancy_amount exactly
-- 0.00, across 25 distinct tournaments. The detector trips per bank:
--
--   IF abs(r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in)) > 0.01 OR abs(r.bounty_balance - e.bounty_balance) > 0.01 OR abs(r.fee_balance - e.fee_balance) > 0.01 THEN
--
-- and then files their SUM as the discrepancy:
--
--     round((r.prize_balance + r.bounty_balance + r.fee_balance) - (e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance), 2),
--
-- so two banks that disagree by the same amount with opposite signs trip the
-- test and file 0.00 chips. The amount is not computed late and it is not a
-- rounding artefact: it is computed correctly and never tested. The
-- classification is the literal 'settlement_error', fixed before any amount is
-- known.
--
-- RE-MEASURED, ALL 25, 2026-11-07. Every one is a CANCELLED Spin. 25/25 have
-- gross_in exactly equal to the sum refunded; 25/25 have prize_out 0; 25/25
-- have net rake_records of 0 (booked by fn_spin_book_entry, reversed by
-- atomic_cancel_tournament); 25/25 hold a maintained escrow of prize 0.00,
-- bounty 0.00, fee 0.00 and are terminally closed. The escrow balances. The
-- bank split disagrees because the chip shadow keeps the booked entry rake in
-- its fee bank - its own rake filter drops the negative
-- atomic_cancel_tournament reversal on purpose - while
-- tournament_refund_tranches returns the whole gross as refund_prize. The
-- shadow function is deliberately NOT named anywhere in this migration:
-- tests/attention-items-close-at-their-roots.law.test.ts treats the newest
-- migration that names it as the shadow latest definition, and this migration
-- does not define the shadow. Naming it here would park that law on a file
-- that cannot carry the guarantee_promo_excess_return clause and would mask a
-- real future regression of it. For
-- debe4d81 the shadow reads prize_in 276.00, fee_in 24.00, exact_prize 300.00,
-- hence prize_balance -24.00 and fee_balance +24.00, summing to 0.00. The 25
-- bank gaps are 0.24, 0.48, 0.72, 1.20, 2.40, 4.80, 12.00 and 24.00 chips,
-- each exactly 8% of that event's gross. No chips are missing on any of them
-- and nobody is owed anything.
--
-- That bank-split disagreement is a defect of the shadow, recorded here for
-- whoever reconciles rake_records against the escrow. It is not a settlement
-- error, and a settlement error of zero chips tells a reader nothing.
--
-- CAUSE 2 - A JOURNAL-BOUND OWNER CORRECTION READ AS DRIFT. 1 alert,
-- detected_at 2026-11-02 06:35:00.134568+00, discrepancy_amount -950.00,
-- tournament 6b72abc3-bd16-488c-aea5-54b1eace98d5 - the owner-authorized
-- bounty/guarantee correction already admitted by the door inside
-- trg_freeze_finalized_tournament_prize_pool. Measured 2026-11-07: the escrow
-- holds prize 0.00, bounty 0.00, fee 0.00; the shadow says prize 950.00; so
-- the whole -950.00 gap sits in the prize bank. chip_ledger carries the leg
-- that accounts for it: idempotency_key
-- 'tourney:6b72abc3-bd16-488c-aea5-54b1eace98d5:owner_bounty_guarantee_20261102',
-- category 'reversal', amount 950.00, prize_liability (this tournament) ->
-- union_bank fade0000-0000-0000-0000-000000000001, metadata kind
-- 'owner_bounty_guarantee_correction', with both journalled row images and the
-- owner instruction. A movement that is journalled is accounted for, not
-- drift.
--
-- THE FIX. The detector gains one measured quantity, v_diff, which is what the
-- incident carries as discrepancy_amount and therefore also what decides
-- whether there is an incident:
--
--   (a) v_diff <> 0. Not a tolerance - the measured amount itself. A zero
--       discrepancy is not a finding. The pre-existing per-bank 0.01 trip test
--       is left byte-for-byte alone, so this change only ever narrows.
--   (b) the owner correction is recognised POSITIVELY, by its corroborating
--       chip_ledger row: the whole measured gap must sit in the prize bank
--       (v_prize_gap = v_diff) and one chip_ledger row of this same tournament
--       must carry the tournament-scoped owner_bounty_guarantee idempotency
--       key, category 'reversal', from_type 'prize_liability' with this
--       tournament as from_entity_id, to_type 'union_bank' with a destination,
--       metadata kind 'owner_bounty_guarantee_correction', a
--       'tournament_before' object, a 'tournament_after' object, an
--       'owner_instruction' string, and round(l.amount, 2) = - v_diff. No
--       tournament id is hard-coded and no interval or time window is used, so
--       a 950-chip movement whose ledger row is absent, of another kind, of
--       another direction, of another amount, or landing outside the prize
--       bank is still a drift.
--
-- PROVEN IN AN EXPLICITLY ROLLED-BACK PRODUCTION TRANSACTION, 2026-11-07.
-- The postimage was installed, the new predicate asserted verbatim inside the
-- installed body, and evaluated against the live rows and against fabricated
-- rows; then ROLLBACK, after which pg_get_functiondef still read the preimage
-- md5 62bc43d2d2846fd066fc86919eb55598, no incident and no alert had been
-- written, and the 26 alerts were untouched.
--   - the 26 real rows: the old predicate raises 26 of 26, the new predicate
--     raises 0 of 26 (v_diff 0 on all 25, v_diff -950 with v_prize_gap -950 on
--     6b72abc3).
--   - fabricated, 13 cases, 0 mismatches: a genuine +777 and a genuine -777
--     gap raise; a -950 gap on a tournament with no such ledger row raises; a
--     -949 and a -951 gap against the real 950.00 leg raise; a -950 gap split
--     -500 prize / -450 fee raises; a +950 gap of the wrong sign raises; a
--     0.02 gap raises; three real prize_liability -> union_bank reversals of
--     kind 'reviewed_void_overlay_return' raise; a +500/-500 bank split with a
--     zero total does not raise; and the door-exact -950 does not raise.
--
-- The 26 alerts already on the board are NOT touched here. This migration
-- stops the next sweep filing more of them; closing the 26 is the generic
-- closer's job, on re-measured evidence, never on elapsed time.
--
-- GUARDS: refuses inside the break window; the live body must be the exact
-- preimage or already the postimage; every anchor must be found; the derived
-- postimage must be the exact md5 proven above; owner, SECURITY DEFINER,
-- search_path, ACL and overload count are checked before and after; the
-- readback must be byte-identical to the derived postimage; the
-- service-role-only grant is restated and read back.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_escrow_balance_drift(integer)'::regprocedure))) = '9898d7b3dc17564f522892164c85de65'

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_reason text;
BEGIN
  v_reason := public.fn_ca_break_window_refuses_migrations(now());
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'ESCROW_ZERO_DRIFT_GUARD_REFUSED: %', v_reason USING ERRCODE = '55000';
  END IF;
END
$pre$;

DO $component$
DECLARE
  v_oid oid := to_regprocedure('public.fn_ca_escrow_balance_drift(integer)');
  v_pre_md5  constant text := '62bc43d2d2846fd066fc86919eb55598';
  v_post_md5 constant text := '9898d7b3dc17564f522892164c85de65';
  v_src text;
  v_out text;
  v_prev text;
BEGIN
  IF current_user <> 'postgres' OR v_oid IS NULL THEN
    RAISE EXCEPTION 'escrow zero drift guard: owner/target mismatch';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
          AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef
          AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[]
          AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}')
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname = 'fn_ca_escrow_balance_drift') <> 1 THEN
    RAISE EXCEPTION 'escrow zero drift guard: target authority/overload drift before';
  END IF;

  v_src := pg_get_functiondef(v_oid);
  IF md5(v_src) = v_post_md5 THEN
    RETURN;
  END IF;
  IF md5(v_src) <> v_pre_md5 THEN
    RAISE EXCEPTION 'escrow zero drift guard: unexpected live body %', md5(v_src);
  END IF;

  v_out := v_src;

  v_prev := v_out;
  v_out := replace(v_out,
    $a1$DECLARE r record; e record; v_n int := 0; v_bad int := 0; v_list jsonb := '[]'::jsonb; v_gap numeric := 0;$a1$,
    $b1$DECLARE r record; e record; v_n int := 0; v_bad int := 0; v_list jsonb := '[]'::jsonb; v_gap numeric := 0;
        v_diff numeric := 0; v_prize_gap numeric := 0;$b1$);
  IF v_out = v_prev THEN RAISE EXCEPTION 'escrow zero drift guard: anchor 1 (declarations) not found'; END IF;

  v_prev := v_out;
  v_out := replace(v_out,
    $a2$    IF abs(r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in)) > 0.01 OR abs(r.bounty_balance - e.bounty_balance) > 0.01 OR abs(r.fee_balance - e.fee_balance) > 0.01 THEN$a2$,
    $b2$    /* THE AMOUNT FILED IS THE AMOUNT TESTED (2026-11-07). v_diff is the one
       measured quantity: what this escrow row holds across its three banks
       less what the shadow says it should hold. It is what the incident
       carries as discrepancy_amount, so it is also what decides whether there
       is an incident at all. v_prize_gap is the part of it sitting in the
       prize bank, where a correction out of prize_liability has to land. */
    v_diff := round((r.prize_balance + r.bounty_balance + r.fee_balance) - (e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance), 2);
    v_prize_gap := round(r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in), 2);
    /* A ZERO MEASURED DISCREPANCY IS NOT A FINDING (2026-11-07). The trip test
       is per bank; the amount filed is their sum. On a fully refunded cancelled
       Spin the shadow keeps the booked entry rake in its fee bank (it drops the
       atomic_cancel_tournament reversal) while tournament_refund_tranches
       returns the whole gross out of its prize bank, so the two banks disagree
       by the same amount with opposite signs and the sum is exactly 0.00. One
       sweep tick at 2026-11-03 12:35:00 filed 25 'settlement_error' incidents
       of 0.00 chips that way, every one of them on a CANCELLED Spin whose gross
       equals its refund, whose prize_out is 0 and whose net rake is 0. A
       settlement error of zero chips is not a settlement error. The bank-split
       disagreement is a defect of the shadow, not a finding of this detector,
       and it belongs to whatever reconciles rake_records with the escrow.

       A JOURNAL-BOUND OWNER CORRECTION IS ACCOUNTED FOR, NOT DRIFT
       (2026-11-07). The owner-authorized bounty/guarantee correction moved its
       chips out of prize_liability to the union bank as a 'reversal' leg. The
       maintained escrow saw that leg and the shadow does not count it, so the
       row reads low by exactly the amount of the leg: one incident of -950.00
       at 2026-11-02 06:35:00. The leg IS the accounting. This term is as narrow
       as the door in trg_freeze_finalized_tournament_prize_pool: the whole
       measured gap must sit in the prize bank, and one chip_ledger row of this
       same tournament must carry the tournament-scoped owner_bounty_guarantee
       idempotency key, the reversal category, prize_liability -> union_bank
       with this tournament as the source, the correction kind, both journalled
       row images, the owner instruction, and an amount equal to the measured
       gap. No tournament id and no time window is named, so a correction whose
       ledger row is absent, of another kind, of another direction, of another
       amount, or landing outside the prize bank is still a drift. */
    IF (abs(r.prize_balance - (e.prize_balance - r.reserve_out + r.reserve_in)) > 0.01 OR abs(r.bounty_balance - e.bounty_balance) > 0.01 OR abs(r.fee_balance - e.fee_balance) > 0.01)
       AND v_diff <> 0
       AND NOT (v_prize_gap = v_diff AND EXISTS (SELECT 1 FROM public.chip_ledger l WHERE l.tournament_id = r.tournament_id AND left(l.idempotency_key, length('tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_')) = 'tourney:' || r.tournament_id::text || ':owner_bounty_guarantee_' AND l.category = 'reversal' AND l.from_type = 'prize_liability' AND l.from_entity_id = r.tournament_id AND l.to_type = 'union_bank' AND l.to_entity_id IS NOT NULL AND l.metadata->>'kind' = 'owner_bounty_guarantee_correction' AND jsonb_typeof(l.metadata->'tournament_before') = 'object' AND jsonb_typeof(l.metadata->'tournament_after') = 'object' AND jsonb_typeof(l.metadata->'owner_instruction') = 'string' AND round(l.amount, 2) = - v_diff))
    THEN$b2$);
  IF v_out = v_prev THEN RAISE EXCEPTION 'escrow zero drift guard: anchor 2 (trip test) not found'; END IF;

  v_prev := v_out;
  v_out := replace(v_out,
    $a3$      v_gap := v_gap + abs((r.prize_balance + r.bounty_balance + r.fee_balance) - (e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance));$a3$,
    $b3$      v_gap := v_gap + abs(v_diff);$b3$);
  IF v_out = v_prev THEN RAISE EXCEPTION 'escrow zero drift guard: anchor 3 (run total) not found'; END IF;

  v_prev := v_out;
  v_out := replace(v_out,
    $a4$        round((r.prize_balance + r.bounty_balance + r.fee_balance) - (e.prize_balance - r.reserve_out + r.reserve_in + e.bounty_balance + e.fee_balance), 2),$a4$,
    $b4$        v_diff,$b4$);
  IF v_out = v_prev THEN RAISE EXCEPTION 'escrow zero drift guard: anchor 4 (filed amount) not found'; END IF;

  IF md5(v_out) <> v_post_md5 THEN
    RAISE EXCEPTION 'escrow zero drift guard: derived postimage % is not the proven postimage', md5(v_out);
  END IF;

  EXECUTE v_out;

  IF pg_get_functiondef(v_oid) IS DISTINCT FROM v_out
     OR md5(pg_get_functiondef(v_oid)) <> v_post_md5 THEN
    RAISE EXCEPTION 'escrow zero drift guard: exact postimage readback failed';
  END IF;
END
$component$;

-- Already the live grant; restated so a clean rebuild never hands a browser
-- role this sweep.
REVOKE ALL ON FUNCTION public.fn_ca_escrow_balance_drift(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_escrow_balance_drift(integer) TO service_role;

DO $acl$
BEGIN
  IF (SELECT p.proacl::text FROM pg_proc p
       WHERE p.oid = to_regprocedure('public.fn_ca_escrow_balance_drift(integer)'))
     IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT EXISTS (SELECT 1 FROM pg_proc p
       WHERE p.oid = to_regprocedure('public.fn_ca_escrow_balance_drift(integer)')
         AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef
         AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[])
     OR md5(pg_get_functiondef('public.fn_ca_escrow_balance_drift(integer)'::regprocedure))
        <> '9898d7b3dc17564f522892164c85de65' THEN
    RAISE EXCEPTION 'escrow zero drift guard: authority drift after';
  END IF;
END
$acl$;

COMMIT;
