-- 20261119050653_a_lightning_top_up_never_buys_over_a_pending_rebuy
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-19.
--
-- A LIGHTNING TOP-UP NEVER BUYS OVER A PENDING REBUY (2026-11-19).
--
-- WHAT WAS WRONG (read from production rows). Every one of the 49 unresolved
-- table_pending_addons rows found on 2026-11-19 (lane B8, PR #11340) was a
-- double purchase. A busted 1/2 horse on a Lightning anchor reached two money
-- doors at the same hand boundary: fn_lightning_auto_rebuy debited 400.00 into
-- a table_pending_addons row (kind 'rebuy'), and 1-7 s later
-- fn_lightning_top_up_request debited a SECOND 400.00 and landed it on the
-- seat directly (ledger category 'addon'). The auto-rebuy door already refuses
-- while a pending add-on is open ("One top-up in flight at a time"); the
-- top-up door checked only its own pending intents
-- (smarter_private.lightning_top_up_intents) and never looked at
-- table_pending_addons. So the seat was funded once and the wallet charged
-- twice, and the undelivered rebuy then floated until #11340 returns it at the
-- seat's end.
--
-- WHAT THIS CHANGES. One refusal in fn_lightning_top_up_request, in the place
-- the decision is made, right beside its existing "already pending" refusal
-- and before any intent row or debit: while the caller has an unresolved
-- table_pending_addons row on this table, the request answers
-- {success:false, error:'A Rebuy Is Already Pending For This Seat'} and
-- charges nothing. The engine callers already treat a status-less refusal as
-- a refusal (server/src/lightning/LightningTopUp.ts); the horse input device
-- and a person's browser top-up both reach this same door, so the rule is the
-- same for a human (CLAUDE.md 10.5): no is_horse anywhere. The pending rebuy
-- is then delivered by the engine or returned at the seat's end; exactly one
-- purchase lands.
--
-- The reverse order (top-up first, rebuy second) was already safe: the
-- auto-rebuy reads the funded pool stack and refuses NOT_TRIGGERED.
--
-- Function body only, patched against the live body (pre-image md5 asserted),
-- so no table is locked and nothing else in the function moves. Owner, ACL,
-- proconfig and SECURITY DEFINER are kept by CREATE OR REPLACE. This is a
-- database migration: it is live when Apply Merged Migration installs it after
-- merge, not at the engine cutover.
-- @live-proof: strpos(pg_get_functiondef('public.fn_lightning_top_up_request'::regproc), 'A Rebuy Is Already Pending For This Seat') > 0

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.fn_lightning_top_up_request(uuid,uuid,text,numeric)');
  v_def text;
  v_old text := $f$   RETURN jsonb_build_object('success',false,'error','A Lightning Top Up Is Already Pending');
 END IF;
$f$;
  v_new text := $f$   RETURN jsonb_build_object('success',false,'error','A Lightning Top Up Is Already Pending');
 END IF;
 -- ONE PURCHASE AT A TIME ACROSS BOTH DOORS (20261119050653): an unresolved
 -- rebuy or add-on for this seat is money already taken and not yet landed.
 IF EXISTS(SELECT 1 FROM public.table_pending_addons a WHERE a.table_id=p_table_id
             AND a.user_id=p_user_id AND a.resolved_at IS NULL) THEN
   RETURN jsonb_build_object('success',false,'error','A Rebuy Is Already Pending For This Seat');
 END IF;
$f$;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'fn_lightning_top_up_request is not installed';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF strpos(v_def, 'A Rebuy Is Already Pending For This Seat') > 0 THEN
    RAISE NOTICE 'already installed';
    RETURN;
  END IF;
  IF md5(v_def) <> '1bba4a245424e0af048dc8317dfad061' THEN
    RAISE EXCEPTION 'PRE_IMAGE_MOVED: fn_lightning_top_up_request md5 is %, expected 1bba4a245424e0af048dc8317dfad061', md5(v_def);
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'PRE_IMAGE_ANCHOR: the already-pending refusal is not found exactly once';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF strpos(pg_get_functiondef(v_oid), 'A Rebuy Is Already Pending For This Seat') = 0 THEN
    RAISE EXCEPTION 'fn_lightning_top_up_request did not take the pending-rebuy refusal';
  END IF;
END
$m$;

COMMIT;
