-- 20261118155910_the_finished_original_cash_discharger_retires_and_releases_i.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE FINISHED ORIGINAL CASH DISCHARGER RETIRES AND RELEASES ITS MONEY PINS
-- (2026-11-18, incident 075013fd lane Q). CLAUDE.md 10.9: the reasoning is here.
--
-- WHAT IT WAS FOR. smarter_private.original_erased_cash_base_discharge(bigint,text)
-- (20261012224150) is the one-shot writer for a finite set of SEVEN historical
-- receivables: cash bases of deleted accounts erased in the original week
-- (union fade0000, 2026-10-05 -> 10-12). original_erased_cash_base_expected_hash
-- names exactly those seven events and nothing else. For each, the writer
-- mints the base from issuance_reserve into the deleted player's wallet
-- (fn_ca_restore_erased_seat_credit, key retired_completed_cash_base:<occupancy>)
-- and the deleted-wallet trigger returns it to the funding club's bank, then it
-- records an immutable certificate in original_erased_cash_base_discharges
-- (UPDATE/DELETE/TRUNCATE refused by trigger). Because that write runs through
-- ~46 money triggers and helpers, the writer refuses
-- (original_cash_discharge_money_source_changed) unless every one of them still
-- has the body it was qualified against on 2026-10-12.
--
-- MEASURED READ-ONLY ON PRODUCTION, 2026-11-18 15:40-16:00 UTC:
--  * original_erased_cash_base_discharges holds all 7 events, every one
--    discharged_at 2026-10-13 01:54:11.449761Z (one transaction):
--      42309154 297.50   42346932  33.31   42399949  35.99   42407664  97.04
--      42586570  46.94   42607253 108.11   42626673 1,226.98   = 1,845.87 chips
--  * the independent reader original_erased_cash_base_discharge_receipt (which
--    re-verifies each certificate against its six immutable financial rows:
--    idempotency key, mint row, issuance leg, bank-claim leg, two transactions)
--    returns 'discharged' for all 7; each key has exactly one chip_ledger leg.
--  * the only 7 erased_cash_receivable cases are those 7. Nothing is pending,
--    nothing is stranded, no money is owed by or waiting on this writer.
--  * no function calls the writer (prosrc search; the one textual hit,
--    original_inventory_proof_sources_match, pins its md5 in a string literal)
--    and no cron job names it. Readers (original_inventory_basis_generation)
--    call the receipt function, never the writer.
--  * 13 of its pins are stale, so EVERY call - including the replay of an
--    existing certificate - refuses. 12 went stale between 2026-10-13 and
--    11-16; the 13th (fn_ca_tally_balance_move b7911a24) was declared
--    @stale-pin-ok by 20261118034950 (#11256/#11270) and has since moved again
--    (c8c24d5a, then 710154d5 by 20261118071728, #11266).
--
-- WHY RETIRE, NOT RE-PIN. The pins protect one write, and that write can
-- never run again: the expected-hash domain is exactly the 7 events, all 7 hold
-- an immutable certificate, and the writer's own first branch on an existing
-- certificate is replay. Re-pinning 13 bodies would certify a payment path that
-- is unreachable, and would keep 46 of the platform's core money functions
-- (tally triggers, ledger writers, freeze guards) tied to a finished one-shot:
-- every future change to any of them either re-qualifies this dead proof or
-- trips the applier's stale-pin guard - which is exactly what refused #11256's
-- install during this incident. A pin is worth its maintenance only while the
-- thing it guards can still happen.
--
-- PER-PIN REVIEW (pinned 2026-10-12 -> live; what moved it; does the property
-- the discharge relied on - one issuance leg of exactly the base into the
-- player wallet, the whole base returned to the funding club bank, wallet
-- ending at 0 - still hold?). Recorded so nobody repeats the reading; none of
-- these is re-pinned, because no write remains to protect.
--  1 fn_ca_deleted_wallet_credit() 90411405 -> 38381e35: 20261017002119 (only
--    banks it pays are locked), 20261017065530 (a deleted payer with published
--    weekly obligations returns only its FREE net chips; the stages flush the
--    rest), 20261022164439 (commission routing). NOT unconditionally preserved:
--    a deleted user with published obligations would keep part of a fresh
--    credit pending. The old writer's post-assertions would then refuse, not
--    certify; moot, nothing remains to discharge.
--  2 fn_ca_issuance_leg_is_registered() abdf1fd1 -> 164b9494,
--  3 fn_ca_mint_issued_24h(text,uuid) e0bf5ff9 -> 62c322f1,
--  4 fn_ca_emergency_issuance_guard() ad9f6b99 -> c36eea86: all three by
--    20261012181905 (scoped launch reset; installed after the 01:54Z discharge,
--    which is why the pins still matched then). Each adds an exemption only for
--    a launch retirement reversal / an authorized launch 'mint:' opening into
--    a club treasury. A refund leg issuance_reserve -> player_wallet keyed
--    retired_completed_cash_base:... matches none of them. Preserved.
--  5 fn_club_members_ledger_writer() d9b0429e -> 68030454: 20261029065153
--    (promo sends name their journal source column). chip_balance path
--    unchanged. Preserved.
--  6 fn_ca_deleted_wallet_bank_return(uuid,uuid,text) bccd3022 -> b8b056e0:
--    20261017065530 (obligation-aware, as 1), 20261017161610 (FOR NO KEY
--    UPDATE instead of FOR UPDATE - amounts unchanged), 20261022164439,
--    20261116163600 (retired clubs' final round). Not unconditionally
--    preserved, for the same reason as 1.
--  7 fn_ca_ledger_tally_key(text,uuid,uuid) 7d8c761d -> ff30c090 and
--  8 fn_ca_tally_store_move() ba64376c -> 6db4f04e: 20261020151328 (agent cash
--    and member promo keys scoped by club; "all other financial accounts keep
--    their identities"). Player chip wallet and club treasury keys unchanged.
--    Preserved.
--  9 fn_refuse_while_frozen() 3a866372 -> a8dd8119: 20261016101008 (a
--    zero-balance wallets INSERT is identity, not money, and passes the
--    freeze). The writer refused while frozen anyway. Preserved.
-- 10 fn_cashier_operation_intent_guard() d89888ea -> 60350724: 20261016024912
--    (Send Out promo aliases). The discharge is no cashier operation. Preserved.
-- 11 fn_ca_autoledger() 852f2e9b -> ceb53c91: 20261015141043 (no
--    treasury-to-itself legs), 20261108155826 (welcome jackpot return names its
--    source). player_wallet -> club_treasury leg unchanged. Preserved.
-- 12 fn_ca_tally_balance_move() b7911a24 -> c8c24d5a -> 710154d5:
--    20261118034950 and 20261118071728 each insert ONE new CASE branch
--    (cash_rake_pending; hand_bank_obligation_pending) ahead of the
--    unchanged 'union_wallets' branch; the club_members and clubs branches the
--    discharge moved through are byte-identical. Preserved.
-- 13 fn_guard_retired_club_mutation() 941df8f6 -> 8c7ad1d3: 20261029193107
--    (certification cleanup locks only its own club graph), 20261116131652
--    (retired clubs settle their final earned week). The funding clubs are
--    active. Preserved.
--
-- WHAT THIS FILE DOES, in one transaction:
--  1. Refuses itself unless: the writer is the exact live preimage (functiondef
--     9e6fcbf6, prosrc b7e407e4); the inventory source authority
--     original_inventory_proof_sources_match() is TRUE and names the writer's
--     md5 exactly once; the 7 expected events are the only erased-cash cases,
--     each has its certificate, and the receipt reader says 'discharged'.
--  2. Replaces the writer with its retired form: STABLE (PostgreSQL itself then
--     refuses any INSERT/UPDATE/DELETE inside it), no md5 pins, same caller and
--     request checks, a certificate replays its durable receipt exactly as
--     before ({replayed: true, financial_payment: false}), and anything else
--     raises original_cash_discharge_retired. Owner and grants unchanged.
--  3. Moves the source authority's one pin on the writer to the retired body's
--     md5 READ BACK from the catalog (20261111003802's method), through a
--     pg_temp helper that names the pinner it rewrites, asserts the
--     authority is TRUE again and that the old md5 9e6fcbf6 is pinned by
--     nothing. No @stale-pin-ok: the applier's stale-pin guard must pass clean.
--
-- CONSEQUENCE, accepted as in 20261014225815 and 20261111003802: the
-- original-inventory generation hashes the source authority's own body, so it
-- keeps its original-inventory-245-v1: prefix and its hash changes. It is read
-- only for union fade0000 windows ending on/after 2026-10-12 (memo keys of the
-- close reports and the earned-plan advance; union_eco records it); those
-- memos are recomputed by their existing owners. No certificate, cache, cutoff,
-- ledger row, wallet or money is written here, and no hot table is locked.
--
-- @live-proof: smarter_private.original_inventory_proof_sources_match() IS TRUE AND smarter_private.original_inventory_basis_generation() LIKE 'original-inventory-245-v1:%' AND (SELECT md5(p.prosrc)='627ec207046e9a9ac75c58dc93a21877' AND p.provolatile='s' AND strpos(p.prosrc,'original_cash_discharge_retired')>0 FROM pg_proc p WHERE p.oid='smarter_private.original_erased_cash_base_discharge(bigint,text)'::regprocedure) AND NOT EXISTS(SELECT 1 FROM pg_proc q WHERE strpos(q.prosrc,'9e6fcbf606004b81353a7704b50f072f')>0)

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE
  v_writer regprocedure := 'smarter_private.original_erased_cash_base_discharge(bigint,text)'::regprocedure;
  v_sm text := pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure);
  v_pin text := $p$('smarter_private.original_erased_cash_base_discharge(bigint,text)','9e6fcbf606004b81353a7704b50f072f')$p$;
  v_cases integer; v_certs integer; v_bad text;
BEGIN
  IF md5(pg_get_functiondef(v_writer)) IS DISTINCT FROM '9e6fcbf606004b81353a7704b50f072f'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_writer) IS DISTINCT FROM 'b7e407e4754fa326d1aba21e60e1d67b' THEN
    RAISE EXCEPTION 'DISCHARGER_RETIREMENT_REFUSED: the writer is not the qualified preimage (md5 %)',
      md5(pg_get_functiondef(v_writer)) USING ERRCODE = '55000';
  END IF;
  IF smarter_private.original_inventory_proof_sources_match() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'DISCHARGER_RETIREMENT_REFUSED: the inventory source authority is not true before the move'
      USING ERRCODE = '55000';
  END IF;
  IF (length(v_sm) - length(replace(v_sm, v_pin, ''))) / length(v_pin) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'DISCHARGER_RETIREMENT_REFUSED: the source authority does not pin the writer exactly once'
      USING ERRCODE = '55000';
  END IF;
  -- The finite set is complete: 7 cases, 7 certificates, 7 verified receipts.
  SELECT count(*) INTO v_cases FROM smarter_private.original_inventory_restoration_cases
   WHERE family = 'erased_cash_receivable';
  SELECT count(*) INTO v_certs
    FROM smarter_private.original_inventory_restoration_cases c
    JOIN smarter_private.original_erased_cash_base_discharges d USING (event_id)
   WHERE c.family = 'erased_cash_receivable'
     AND d.witness_md5 = smarter_private.original_erased_cash_base_expected_hash(c.event_id);
  SELECT string_agg(c.event_id::text || '=' || coalesce(r->>'status', 'null'), ', ') INTO v_bad
    FROM smarter_private.original_inventory_restoration_cases c
    CROSS JOIN LATERAL (SELECT smarter_private.original_erased_cash_base_discharge_receipt(
      c.event_id, smarter_private.original_erased_cash_base_expected_hash(c.event_id)) r) x
   WHERE c.family = 'erased_cash_receivable' AND r->>'status' IS DISTINCT FROM 'discharged';
  IF v_cases IS DISTINCT FROM 7 OR v_certs IS DISTINCT FROM 7 OR v_bad IS NOT NULL
     OR (SELECT count(*) FROM smarter_private.original_erased_cash_base_discharges) IS DISTINCT FROM 7::bigint THEN
    RAISE EXCEPTION 'DISCHARGER_RETIREMENT_REFUSED: the finite discharge set is not complete (cases %, certificates %, not discharged: %)',
      v_cases, v_certs, coalesce(v_bad, 'none') USING ERRCODE = '55000';
  END IF;
END
$pre$;

-- RETIRED 20261118155910: all seven original erased cash bases were discharged
-- on 2026-10-13 and their certificates are immutable. This function can only
-- replay a certificate's verified receipt; it writes nothing (STABLE).
CREATE OR REPLACE FUNCTION smarter_private.original_erased_cash_base_discharge(e bigint,h text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,smarter_private SET timezone='UTC' AS $b$
DECLARE old jsonb;
BEGIN
 IF session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
 OR nullif(current_setting('request.jwt.claim.role',true),'') IS NOT NULL
 OR nullif(current_setting('request.jwt.claims',true),'') IS NOT NULL THEN
 RAISE EXCEPTION 'original_cash_discharge_caller_refused' USING ERRCODE='42501';END IF;
 IF h IS NULL OR h IS DISTINCT FROM smarter_private.original_erased_cash_base_expected_hash(e) THEN
 RAISE EXCEPTION 'original_cash_discharge_unknown_request' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM smarter_private.original_erased_cash_base_discharges WHERE event_id=e) THEN
 RAISE EXCEPTION 'original_cash_discharge_retired' USING ERRCODE='55000',
 HINT='The finite seven-case discharge completed on 2026-10-13 (20261118155910); there is no write path.';END IF;
 old:=smarter_private.original_erased_cash_base_discharge_receipt(e,h);
 IF old->>'status' IS DISTINCT FROM 'discharged' THEN
 RAISE EXCEPTION 'original_cash_discharge_durable_receipt_refused' USING ERRCODE='55000';END IF;
 RETURN old||jsonb_build_object('replayed',true,'financial_payment',false);
END$b$;
ALTER FUNCTION smarter_private.original_erased_cash_base_discharge(bigint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION smarter_private.original_erased_cash_base_discharge(bigint,text) FROM PUBLIC,anon,authenticated,service_role;

-- The one pin move, through a pg_temp helper named with the pinner it rewrites
-- (the substitution form 20261118034950 uses), so a static reader sees which
-- installed function this file changes.
CREATE FUNCTION pg_temp.ca_move_discharger_pin(p_pinner regprocedure)
RETURNS void LANGUAGE plpgsql AS $move$
DECLARE
  v_writer regprocedure := 'smarter_private.original_erased_cash_base_discharge(bigint,text)'::regprocedure;
  v_sm_sig regprocedure := p_pinner;
  v_old text := '9e6fcbf606004b81353a7704b50f072f';
  v_new text := md5(pg_get_functiondef('smarter_private.original_erased_cash_base_discharge(bigint,text)'::regprocedure));
  v_def text := pg_get_functiondef(p_pinner);
  v_pre jsonb; v_post jsonb; v_w pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO v_w FROM pg_proc WHERE oid = v_writer;
  IF md5(v_w.prosrc) IS DISTINCT FROM '627ec207046e9a9ac75c58dc93a21877' OR v_w.provolatile IS DISTINCT FROM 's'
     OR v_w.prosecdef OR pg_get_userbyid(v_w.proowner) IS DISTINCT FROM 'postgres'
     OR v_w.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
     OR v_w.proconfig::text IS DISTINCT FROM '{"search_path=pg_catalog, public, smarter_private",TimeZone=UTC}'
     OR v_w.prosrc ~ '[0-9a-f]{32}' THEN
    RAISE EXCEPTION 'DISCHARGER_RETIREMENT_REFUSED: the retired writer is not the reviewed postimage (prosrc md5 %)',
      md5(v_w.prosrc) USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_array(proowner::regrole::text, proacl::text, prosecdef, provolatile::text, proconfig::text)
    INTO v_pre FROM pg_proc WHERE oid = v_sm_sig;
  EXECUTE replace(v_def,
    $p$('smarter_private.original_erased_cash_base_discharge(bigint,text)','$p$ || v_old || $p$')$p$,
    $p$('smarter_private.original_erased_cash_base_discharge(bigint,text)','$p$ || v_new || $p$')$p$);
  SELECT jsonb_build_array(proowner::regrole::text, proacl::text, prosecdef, provolatile::text, proconfig::text)
    INTO v_post FROM pg_proc WHERE oid = v_sm_sig;
  IF v_post IS DISTINCT FROM v_pre THEN
    RAISE EXCEPTION 'DISCHARGER_RETIREMENT_REFUSED: the source authority''s owner, grants or settings moved (% -> %)',
      v_pre, v_post USING ERRCODE = '55000';
  END IF;
  IF smarter_private.original_inventory_proof_sources_match() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'DISCHARGER_RETIREMENT_REFUSED: the inventory source authority is not true after the move'
      USING ERRCODE = '55000';
  END IF;
END
$move$;
SELECT pg_temp.ca_move_discharger_pin('smarter_private.original_inventory_proof_sources_match()'::regprocedure);
DROP FUNCTION pg_temp.ca_move_discharger_pin(regprocedure);

-- Nothing installed may still pin the writer's old body (the helper above
-- carried it as a literal and is gone).
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc q WHERE strpos(q.prosrc, '9e6fcbf606004b81353a7704b50f072f') > 0) THEN
    RAISE EXCEPTION 'DISCHARGER_RETIREMENT_REFUSED: the old writer body % is still pinned', '9e6fcbf606004b81353a7704b50f072f'
      USING ERRCODE = '55000';
  END IF;
END
$post$;

COMMIT;
