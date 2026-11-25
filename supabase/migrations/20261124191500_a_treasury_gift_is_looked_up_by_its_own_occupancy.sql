-- 20261124191500_a_treasury_gift_is_looked_up_by_its_own_occupancy
--
-- A TREASURY GIFT IS LOOKED UP BY ITS OWN OCCUPANCY (2026-11-24).
--
-- smarter_private.original_treasury_participant_gift(participant, table,
-- captured) answers one question: is there exactly one proven original
-- treasury seat gift for THIS chair occupancy? It answered it by running the
-- full proof smarter_private.original_treasury_gift_evidence(ledger_id) for
-- EVERY gift witness in smarter_private.original_treasury_funding_witnesses
-- and only then comparing each proof's occupancy with the participant's.
--
-- public.fn_pnl_cash_hand_evidence calls it once per participant, and the
-- retention prune (pg_cron job 117, public.sp_prune_hand_history) reaches
-- fn_pnl_cash_hand_evidence up to three times for every doomed horse hand:
-- smarter_private.horse_cash_retention_accounting_ready (candidate guard),
-- smarter_private.compact_horse_settlement_keys and
-- smarter_private.compact_horse_cash_play_contents. Measured on production
-- 2026-11-24 on frontier hands (8 days old, 30 hands, 146 participants):
--   fn_pnl_cash_hand_evidence            26 ms per hand
--   of which original_treasury_participant_gift  ~10 ms per hand (2 ms per
--     participant, four witnesses, each a full byte-exact proof)
-- 200 doomed hands x 3 evidence calls x 26 ms = ~15.6 s of the ~17 s page,
-- every 10 seconds, back to back, while the prune caught up on 2026-11-24
-- 06:00-13:00 UTC (avg 15.9-19.6 s per run, max 40.4 s; DatabaseRepliesLost
-- saturation). And the gift cost grows with every witness ever admitted,
-- for every participant of every hand, for ever.
--
-- The proof derives its occupancy from the witness's own source:
--   occ := (w.source #>> '{seat_event,after_row,occupancy_id}')::uuid
-- after checking w.source_fingerprint = md5(w.source::text), and the witness
-- table already holds ONE gift per occupancy (unique partial index
-- original_treasury_gift_occupancy_once on exactly that path). So a witness
-- whose source occupancy is canonical uuid text and differs from the
-- participant's can never return a proof whose occupancy_id equals it.
-- Only those witnesses are skipped. A witness whose source occupancy is not
-- canonical text (upper case, braces, no hyphens) still goes through the
-- full proof, so the result set is the same set, the count is the same
-- count, and the answer is the same answer. Nothing else changes: the same
-- proof, the same filters, the same exactly-one rule, the same exception
-- handler. Retention policy, deletion totals and every money-evidence guard
-- are untouched; this only stops proving gifts nobody asked about.
--
-- Equivalence measured on production before this migration (read-only):
-- 539 participants of 120 frontier hands -> 0 differences (all NULL both
-- ways), and every one of the 4 gift witnesses' own participants -> the same
-- non-NULL proof both ways. Per call: 0.916 s -> 0.070 s over the 539.
--
-- Guarded single-anchor amendment over the live definition; idempotent.
--
-- The pin moves with the body. smarter_private.original_inventory_proof_sources_match()
-- pins this function's definition md5 (one signature/md5 pair in its source
-- list); a changed body with the old pin left behind would turn it false and
-- the original-inventory generation NULL (the 2026-11-07 class, refused by the
-- applier's stale-pin guard). So, in this same transaction: the old md5 must
-- appear exactly once in that list, it is replaced by the new md5, owner,
-- ACL, security and config of the list function stay the same, the list
-- answers TRUE again, the generation keeps its original-inventory-245-v1
-- shape (its value rotates because it hashes the list function's own body,
-- as with 20261123202500), and no installed function still names either old
-- md5. Nothing pins the list function itself (checked 2026-11-24).
--
-- @live-proof: position('original_treasury_gift_occupancy_once prefilter' in pg_get_functiondef('smarter_private.original_treasury_participant_gift(jsonb,uuid,timestamptz)'::regprocedure)) > 0 AND smarter_private.original_inventory_proof_sources_match() IS TRUE AND smarter_private.original_inventory_basis_generation() LIKE 'original-inventory-245-v1:%'

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $amend$
DECLARE
  v_proc constant regprocedure :=
    'smarter_private.original_treasury_participant_gift(jsonb,uuid,timestamptz)'::regprocedure;
  v_anchor constant text :=
    $a$ WHERE w.kind='gift' AND v->>'status'='proven' AND v->>'table_id'=p_table::text$a$;
  v_marker constant text := 'original_treasury_gift_occupancy_once prefilter';
  v_new constant text :=
    $n$ WHERE w.kind='gift'
  -- original_treasury_gift_occupancy_once prefilter (20261124191500): the proof's
  -- occupancy_id is this source path cast to uuid, so a canonical source that
  -- differs from the participant can never match. Non-canonical text is proven.
  AND ((w.source#>>'{seat_event,after_row,occupancy_id}')=(p_participant->>'occupancy_id')
       OR (w.source#>>'{seat_event,after_row,occupancy_id}')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  AND v->>'status'='proven' AND v->>'table_id'=p_table::text$n$;
  v_def text;
  v_after text;
  c_psm constant regprocedure :=
    'smarter_private.original_inventory_proof_sources_match()'::regprocedure;
  v_old_gift text;
  v_new_gift text;
  v_old_psm text;
  v_psm text;
  v_psm_new text;
  m jsonb;
  m2 jsonb;
  v_stale text;
BEGIN
  v_def := pg_get_functiondef(v_proc);
  IF position(v_marker IN v_def) > 0 THEN
    RAISE NOTICE 'original_treasury_participant_gift already carries the occupancy prefilter';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'TREASURY_GIFT_PREFILTER_ANCHOR_NOT_UNIQUE: the live definition no longer has exactly one anchor';
  END IF;
  -- The pinned list must be healthy and must name exactly this body once.
  IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN
    RAISE EXCEPTION 'TREASURY_GIFT_PREFILTER_SOURCES_MISMATCH_BEFORE' USING ERRCODE = '55000';
  END IF;
  v_old_gift := md5(v_def);
  v_psm := pg_get_functiondef(c_psm);
  v_old_psm := md5(v_psm);
  IF (length(v_psm) - length(replace(v_psm, v_old_gift, ''))) / 32 <> 1 THEN
    RAISE EXCEPTION 'TREASURY_GIFT_PREFILTER_PIN_NOT_UNIQUE: % is not pinned exactly once', v_old_gift USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_new);
  v_after := pg_get_functiondef(v_proc);
  IF position(v_marker IN v_after) = 0
     OR position($c$(w.source#>>'{seat_event,after_row,occupancy_id}')=(p_participant->>'occupancy_id')$c$ IN v_after) = 0
     OR position($c$AND v->>'occupancy_id'=p_participant->>'occupancy_id'$c$ IN v_after) = 0
     OR position($c$IF n<>1 THEN RETURN NULL;END IF;RETURN g;$c$ IN v_after) = 0 THEN
    RAISE EXCEPTION 'TREASURY_GIFT_PREFILTER_DID_NOT_LAND';
  END IF;

  -- Move the pin on the changed body.
  v_new_gift := md5(v_after);
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m FROM pg_catalog.pg_proc WHERE oid = c_psm;
  v_psm_new := replace(v_psm, v_old_gift, v_new_gift);
  EXECUTE v_psm_new;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m2 FROM pg_catalog.pg_proc WHERE oid = c_psm;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_psm) <> v_psm_new THEN
    RAISE EXCEPTION 'TREASURY_GIFT_PREFILTER_PIN_POSTIMAGE %', md5(pg_get_functiondef(c_psm)) USING ERRCODE = '55000';
  END IF;
  IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN
    RAISE EXCEPTION 'TREASURY_GIFT_PREFILTER_SOURCES_STILL_DIFFER' USING ERRCODE = '55000';
  END IF;
  IF smarter_private.original_inventory_basis_generation() NOT LIKE 'original-inventory-245-v1:%' THEN
    RAISE EXCEPTION 'TREASURY_GIFT_PREFILTER_GENERATION_SHAPE %', smarter_private.original_inventory_basis_generation() USING ERRCODE = '55000';
  END IF;
  SELECT string_agg(DISTINCT x.md5 || ' is still pinned by ' || q.oid::regprocedure::text, '; ')
    INTO v_stale
    FROM (VALUES (v_old_gift), (v_old_psm)) x(md5)
    JOIN pg_catalog.pg_proc q ON strpos(q.prosrc, x.md5) > 0;
  IF v_stale IS NOT NULL THEN
    RAISE EXCEPTION 'TREASURY_GIFT_PREFILTER_STALE_PIN: %', v_stale USING ERRCODE = '55000';
  END IF;
END
$amend$;

-- Every admitted gift witness still proves its own chair (the same ledger and
-- occupancy original_treasury_gift_evidence returns), and a foreign chair
-- still finds nothing.
DO $probe$
DECLARE
  v jsonb;
  g jsonb;
  x jsonb;
BEGIN
  FOR v IN
    SELECT e FROM smarter_private.original_treasury_funding_witnesses w
    CROSS JOIN LATERAL smarter_private.original_treasury_gift_evidence(w.ledger_id) e
     WHERE w.kind='gift' AND e->>'status'='proven'
  LOOP
    x := jsonb_build_object('user_id',v->>'user_id','seat_id',v->>'seat_id',
      'occupancy_id',v->>'occupancy_id','seat_joined_at',v->>'seat_joined_at');
    g := smarter_private.original_treasury_participant_gift(x,(v->>'table_id')::uuid,'infinity'::timestamptz);
    IF g->>'status' IS DISTINCT FROM 'proven'
       OR g->>'ledger_id' IS DISTINCT FROM v->>'ledger_id'
       OR g->>'occupancy_id' IS DISTINCT FROM v->>'occupancy_id' THEN
      RAISE EXCEPTION 'TREASURY_GIFT_PREFILTER_LOST_A_PROOF: ledger %', v->>'ledger_id';
    END IF;
    g := smarter_private.original_treasury_participant_gift(
      x || jsonb_build_object('occupancy_id', gen_random_uuid()::text),
      (v->>'table_id')::uuid,'infinity'::timestamptz);
    IF g IS NOT NULL THEN
      RAISE EXCEPTION 'TREASURY_GIFT_PREFILTER_MATCHED_A_FOREIGN_CHAIR: ledger %', v->>'ledger_id';
    END IF;
  END LOOP;
END
$probe$;

COMMIT;
