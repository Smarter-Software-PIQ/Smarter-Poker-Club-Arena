-- 20261105221247_diamond_midnight_retirement_admitted_once_with_cheap_hand_proof
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 22:12:47 UTC.
--
-- THE DIAMOND MIDNIGHT FREE BUY RETIREMENT IS ADMITTED ONCE, AND THE OWNER
-- RETIREMENT DOOR PROVES ITS HANDS CHEAPLY
--
-- Owner, 2026-11-05 15:04 America/Chicago, verbatim: "OVERRIDE THE 4 AM RULE
-- FOR THE MIDNIGHT FREE BUY AND RETIRE DIAMOND ARENA NOW". Repeated in the
-- owner's assignment for this chat: "CLOSE THE MIDNIGHT FREE BUY AND RETIRE
-- DIAMOND ARENA NOW", scoped to this exact event and this retirement, with the
-- ordinary closure guard preserved for every other event.
--
-- READ FROM PRODUCTION, 2026-11-05 22:00-22:12 UTC
--
-- * Target: Midnight Free Buy (NLH) 6429087f-a9d1-49a3-b7cf-85e1ee283ac9,
--   club Diamond Arena 002c2d27-9584-4e52-835a-bb2be148fc81, operation
--   d44c4440-2911-430c-8ee7-376611ef3f38, state quiesced, money hash
--   ce805b135d2fe1e40e5b3a22acd207b1, 0 reserved permits. 170 entrant rows
--   (all horses; 37 playing, 133 eliminated). The guard counts tournament_
--   players rows (170), not seated players (37).
-- * Diamond escrow: prize 11,200 (in 11,200, out 0), bounty 0, fee 0; custody
--   11,200; no open lot reservations; no obligations. Disposition recorded
--   2026-11-02 16:18 UTC in owner_tournament_deletion_intents (owner chat
--   01a19ccc-894e-75e2-a9e7-fe0d2df6c326): diamonds to KingFish
--   47965354-0e56-43ef-931c-ddaab82af765, enforced by
--   smarter_private.owner_retirement_transfer_pools.
-- * #9573 (20261105210545) waived large_outside_quiet_hours by patching
--   bulk_closure_admission's text; #9567 (20261105200238) was applied after it
--   and replaced the whole body, so the waiver is gone (probe at 22:08:33 UTC
--   refused bulk_closure_large_outside_quiet_hours).
-- * Even with the waiver the door could not finish: it md5s the event's whole
--   hand_history (1,744 rows, ~5 MB of jsonb) twice in its body and a third
--   time in the receipt validator it returns through. Measured 4.95 s cold and
--   2.11 s warm per hash, so roughly 6-9 s while holding the platform-wide
--   hand-settlement barrier. That breaks #9567's 2 s live hold bound and
--   would break the 8 s quiet-window ceiling too.
--
-- WHAT THIS CHANGES
--
-- 1. smarter_private.bulk_closure_owner_exceptions: one recorded owner
--    authorization per (kind, exact target set), waiving ONLY
--    large_outside_quiet_hours, with an expiry, consumed by the admission
--    inside the closure's own transaction. If the closure rolls back, the
--    consumption rolls back with it (a safe retry of the same operation);
--    once a closure commits, the row is consumed and can never admit
--    anything again. Rows are append-only apart from that one consumption.
--    One row is inserted: owner_retire of exactly {6429087f}, until
--    2026-11-06 10:00 UTC (04:00 Chicago, when the ordinary window opens).
-- 2. bulk_closure_admission: when the only reason to refuse is size and an
--    unconsumed, unexpired exception matches exactly, the refusal is re-asked
--    with the size rule satisfied. Every other rule still applies in the same
--    order: break window, maintenance, resume settling, unbounded caller, the
--    2 s live hold bound and the 5 s cooldown. The admission row still
--    records the real entrant count (170).
-- 3. smarter_private.hand_history_fingerprint(uuid): 'v2:' || md5 of every
--    hand row's id and xmin, in id order. An INSERT adds an id, a DELETE
--    removes one, and any UPDATE writes a new row version with a new xmin,
--    so it detects exactly what the old whole-row hash detected (any write to
--    the event's hands while the closure holds the lane) without serializing
--    5 MB. fn_ca_owner_retire_tournament uses it for before/after, and
--    owner_retirement_receipt uses it for receipts that carry a 'v2:' value.
--    Receipts already written keep their original whole-row comparison.
--
-- WHAT THIS DOES NOT CHANGE
--
-- No money moves here. No refund, prize, fee, transfer or destination logic
-- changes. The ordinary guard is unchanged for every other event, kind and
-- target set. No timestamp, entrant count or registration row is altered.
--
-- @live-proof: to_regclass('smarter_private.bulk_closure_owner_exceptions') IS NOT NULL AND position('bulk_closure_owner_exceptions' in pg_get_functiondef('smarter_private.bulk_closure_admission(text,uuid[])'::regprocedure))>0 AND position('hand_history_fingerprint' in pg_get_functiondef('public.fn_ca_owner_retire_tournament(uuid,uuid,text)'::regprocedure))>0 AND position('hand_history_fingerprint' in pg_get_functiondef('smarter_private.owner_retirement_receipt(uuid,uuid)'::regprocedure))>0 AND NOT has_function_privilege('service_role','smarter_private.bulk_closure_admission(text,uuid[])','EXECUTE')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE TABLE smarter_private.bulk_closure_owner_exceptions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('settle_refund','settle_equal_share','owner_retire','operator_cancel','request_abort')),
 tournament_ids uuid[] NOT NULL CHECK (cardinality(tournament_ids) >= 1),
 waives text NOT NULL CHECK (waives = 'large_outside_quiet_hours'),
 authorization_text text NOT NULL CHECK (length(btrim(authorization_text)) > 0),
 owner_reference text NOT NULL,
 granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 consumed_txid bigint,
 CHECK (expires_at > granted_at),
 CHECK ((consumed_at IS NULL) = (consumed_txid IS NULL)),
 UNIQUE (kind, tournament_ids)
);
REVOKE ALL ON smarter_private.bulk_closure_owner_exceptions FROM PUBLIC, anon, authenticated, service_role;

-- Append-only, apart from the one consumption the admission performs.
CREATE FUNCTION smarter_private.bulk_closure_owner_exception_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $fn$
BEGIN
 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'bulk_closure_owner_exception_is_permanent' USING ERRCODE = '55000';
 END IF;
 IF OLD.consumed_at IS NOT NULL
  OR NEW.consumed_at IS NULL
  OR (NEW.id, NEW.kind, NEW.tournament_ids, NEW.waives, NEW.authorization_text, NEW.owner_reference, NEW.granted_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.kind, OLD.tournament_ids, OLD.waives, OLD.authorization_text, OLD.owner_reference, OLD.granted_at, OLD.expires_at)
 THEN
  RAISE EXCEPTION 'bulk_closure_owner_exception_only_consumes_once' USING ERRCODE = '55000';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.bulk_closure_owner_exception_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER bulk_closure_owner_exception_guard
 BEFORE UPDATE OR DELETE ON smarter_private.bulk_closure_owner_exceptions
 FOR EACH ROW EXECUTE FUNCTION smarter_private.bulk_closure_owner_exception_guard();

INSERT INTO smarter_private.bulk_closure_owner_exceptions
 (kind, tournament_ids, waives, authorization_text, owner_reference, expires_at)
VALUES
 ('owner_retire', ARRAY['6429087f-a9d1-49a3-b7cf-85e1ee283ac9'::uuid], 'large_outside_quiet_hours',
  'OVERRIDE THE 4 AM RULE FOR THE MIDNIGHT FREE BUY AND RETIRE DIAMOND ARENA NOW / CLOSE THE MIDNIGHT FREE BUY AND RETIRE DIAMOND ARENA NOW',
  'Dan, 2026-11-05 15:04 America/Chicago; Diamond Arena 002c2d27-9584-4e52-835a-bb2be148fc81; operation d44c4440-2911-430c-8ee7-376611ef3f38',
  '2026-11-06 10:00:00+00');

-- The cheap, complete hand proof.
CREATE FUNCTION smarter_private.hand_history_fingerprint(p_tournament_id uuid) RETURNS text
 LANGUAGE sql STABLE SET search_path TO 'pg_catalog', 'public' AS $fn$
 SELECT 'v2:' || md5(coalesce(string_agg(h.id::text || '.' || h.xmin::text, ',' ORDER BY h.id), ''))
   FROM public.hand_history h WHERE h.tournament_id = p_tournament_id
$fn$;
REVOKE ALL ON FUNCTION smarter_private.hand_history_fingerprint(uuid) FROM PUBLIC, anon, authenticated, service_role;

DO $patch$
DECLARE
 v_def text; v_new text;
 c_decl constant text := 'v_refusal text;';
 c_anchor constant text :=
  E' v_refusal := smarter_private.bulk_closure_refusal(p_kind, v_entrants, v_at, v_timeout);\n';
 c_door_hands constant text :=
  $q$(SELECT md5(coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id)::text,'[]')) FROM public.hand_history h WHERE h.tournament_id=p_tournament_id)$q$;
 c_receipt_hands constant text :=
  $q$(SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id)::text,'[]')) FROM public.hand_history v WHERE v.tournament_id=p_tournament_id)$q$;
BEGIN
 -- 1. Admission: an exact, unconsumed owner exception satisfies only the size rule.
 v_def := pg_get_functiondef('smarter_private.bulk_closure_admission(text,uuid[])'::regprocedure);
 IF position('bulk_closure_owner_exceptions' IN v_def) > 0 THEN
  RAISE EXCEPTION 'bulk_closure_admission already carries the owner exception';
 END IF;
 IF (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor) <> 1
  OR (length(v_def) - length(replace(v_def, c_decl, ''))) / length(c_decl) <> 1 THEN
  RAISE EXCEPTION 'bulk_closure_admission anchors not found exactly once; refusing to patch';
 END IF;
 v_new := replace(v_def, c_decl, 'v_refusal text; v_exception bigint;');
 v_new := replace(v_new, c_anchor, c_anchor
  || E' -- Owner exception (20261105221247): an exact, unconsumed, unexpired\n'
  || E' -- authorization satisfies the size rule only; every other rule is re-asked.\n'
  || E' IF v_refusal = ''large_outside_quiet_hours'' THEN\n'
  || E'  UPDATE smarter_private.bulk_closure_owner_exceptions x\n'
  || E'     SET consumed_at = v_at, consumed_txid = txid_current()\n'
  || E'   WHERE x.kind = p_kind AND x.tournament_ids = p_tournament_ids\n'
  || E'     AND x.consumed_at IS NULL AND v_at < x.expires_at\n'
  || E'  RETURNING x.id INTO v_exception;\n'
  || E'  IF v_exception IS NOT NULL THEN\n'
  || E'   v_refusal := smarter_private.bulk_closure_refusal(p_kind, 0::bigint, v_at, v_timeout);\n'
  || E'  END IF;\n'
  || E' END IF;\n');
 EXECUTE v_new;

 -- 2. Door: before/after hand proof by fingerprint.
 v_def := pg_get_functiondef('public.fn_ca_owner_retire_tournament(uuid,uuid,text)'::regprocedure);
 IF (length(v_def) - length(replace(v_def, c_door_hands, ''))) / length(c_door_hands) <> 2 THEN
  RAISE EXCEPTION 'fn_ca_owner_retire_tournament hand proof not found exactly twice; refusing to patch';
 END IF;
 EXECUTE replace(v_def, c_door_hands, 'smarter_private.hand_history_fingerprint(p_tournament_id)');

 -- 3. Receipt validator: v2 receipts by fingerprint, earlier receipts unchanged.
 v_def := pg_get_functiondef('smarter_private.owner_retirement_receipt(uuid,uuid)'::regprocedure);
 IF (length(v_def) - length(replace(v_def, c_receipt_hands, ''))) / length(c_receipt_hands) <> 1 THEN
  RAISE EXCEPTION 'owner_retirement_receipt hand proof not found exactly once; refusing to patch';
 END IF;
 EXECUTE replace(v_def, c_receipt_hands,
  '(CASE WHEN left(h.receipt->''preserved_history''->>''hands'',3)=''v2:'' THEN smarter_private.hand_history_fingerprint(p_tournament_id) ELSE '
  || c_receipt_hands || ' END)');
END
$patch$;

-- The patched bodies keep their original privileges (CREATE OR REPLACE keeps
-- grants); assert the private ones stayed private.
DO $post$
BEGIN
 IF has_function_privilege('service_role','smarter_private.bulk_closure_admission(text,uuid[])','EXECUTE')
  OR has_function_privilege('authenticated','public.fn_ca_owner_retire_tournament(uuid,uuid,text)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.fn_ca_owner_retire_tournament(uuid,uuid,text)','EXECUTE')
  OR has_function_privilege('service_role','smarter_private.hand_history_fingerprint(uuid)','EXECUTE')
  OR (SELECT count(*) FROM smarter_private.bulk_closure_owner_exceptions) <> 1 THEN
  RAISE EXCEPTION 'diamond_midnight_exception_postcondition_failed';
 END IF;
END $post$;

COMMIT;
