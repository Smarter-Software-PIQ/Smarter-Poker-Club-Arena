-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- CERTIFY THE RETURNED-ESCROW HAND 05d8e6bc / 43640739 (Oct 19-26 close).
--
-- With the returned-escrow proof live (previous migration), this records the
-- immutable posthand escrow certificate for the one blocked hand, through the
-- sanctioned writer fn_union_pnl_certify_posthand_escrow, inside one
-- transaction (snapshot and expectation are computed and pinned together, and
-- the certifier re-verifies them under its advisory lock). After this, the
-- hand is accepted and its participants book to the club that funded each
-- seat, closing the week's remaining -2.00 at Deep Stack Society.
-- @live-proof: (SELECT public.fn_union_pnl_cash_outcome_accepted(o) FROM public.union_pnl_cash_outcomes o WHERE o.table_id='05d8e6bc-07ca-4980-b5f3-476ca4439e41' AND o.hand_number=43640739)
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog,public;

DO $do$
DECLARE s jsonb; r jsonb; o public.union_pnl_cash_outcomes; v text;
BEGIN
 IF position('original_pending_escrow_returned_to_wallet' IN pg_get_functiondef('public.fn_union_pnl_prove_posthand_escrow(uuid,bigint)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'returned_escrow_prover_not_live'; END IF;
 s:=smarter_private.posthand_escrow_original_snapshot('05d8e6bc-07ca-4980-b5f3-476ca4439e41',43640739);
 r:=public.fn_union_pnl_certify_posthand_escrow('05d8e6bc-07ca-4980-b5f3-476ca4439e41',43640739,
   md5((s->'proof')::text), encode(extensions.digest(convert_to(s::text,'UTF8'),'sha256'),'hex'));
 IF r->>'status' IS DISTINCT FROM 'certified' THEN RAISE EXCEPTION 'escrow_certify_refused: %', r; END IF;
 SELECT * INTO STRICT o FROM public.union_pnl_cash_outcomes WHERE table_id='05d8e6bc-07ca-4980-b5f3-476ca4439e41' AND hand_number=43640739;
 IF NOT public.fn_union_pnl_cash_outcome_accepted(o) THEN RAISE EXCEPTION 'hand_still_unaccepted_after_certificate'; END IF;
 SELECT p->>'earning_club_id' INTO v FROM jsonb_array_elements(smarter_private.posthand_escrow_certified_evidence(o.table_id,o.hand_number)->'participants') p
  WHERE p->>'user_id'='514f3adc-eeaf-4aff-863c-46c9b41a7ad1';
 IF v IS DISTINCT FROM '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3' THEN RAISE EXCEPTION 'affected_participant_not_booked_to_funding_club: %', v; END IF;
END
$do$;
COMMIT;
