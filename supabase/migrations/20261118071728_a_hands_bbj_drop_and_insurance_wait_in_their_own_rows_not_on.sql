-- 20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch. Orders after 20261118034950 and 20261118035606 (#11256) and
-- pins their postimages.
--
-- A HAND'S BBJ DROP AND INSURANCE LEG WAIT IN THEIR OWN ROWS, NOT ON THE
-- UNION'S POOL OR BANK (part 1 of 2)
--
-- WHAT IS LEFT AFTER #11256. #11256 took the union_wallets row out of the
-- cash hand's post-commit envelope (fn_ca_process_hand_post_commit_obligations)
-- by storing the rake in cash_rake_pending. Two union-wide shared rows are
-- still reached by that envelope inside the transaction the engine's
-- settlement barrier waits on:
--
--   1. THE UNION'S BBJ POOL. Every BBJ hand takes
--      pg_advisory_xact_lock('bbj-pool:' || union), then bbj_pools FOR UPDATE,
--      then (bbj_record_contribution -> fn_bbj_allocate) the pool's
--      ca_bbj_alloc_state row FOR UPDATE and an UPDATE of the pool row, and
--      holds all of it until COMMIT. Midway Union has ONE active pool
--      (5,074,218 hands contributed; bbj_pools n_tup_upd 3.75 M on 3,774 rows).
--      Read on production 2026-11-18: 6,216 of 6,216 BBJ hands in three hours
--      were also raked, and the rake step ran first and held union_wallets, so
--      every BBJ hand already queued on union_wallets BEFORE it reached the
--      pool: postgres_logs show 33,395 >= 1 s waits on union_wallets inside the
--      envelope and 0 on the pool lock in 23 hours. With #11256 installed the
--      wallet queue is gone and the pool becomes the union's single queue,
--      held from the BBJ step through promo play-through (club_members and
--      player_stats per player: 149 >= 1 s player_stats waits inside the
--      envelope in 23 hours), insurance, add-ons, the completion receipt and
--      COMMIT. Peak 133 BBJ hands a minute. One hand waiting on one player's
--      row would hold every BBJ table in the union. The pool row is also
--      written by bbj_atomic_payout_v2, fn_bbj_mini_payout,
--      fn_union_bbj_backup_transfer, fn_union_fund_bbj_pool,
--      fn_sweep_bbj_promo_all and fn_union_promo_send, which takes
--      union_wallets FOR UPDATE first and then the pool: with #11256 an insured
--      BBJ hand takes them in the opposite order (pool, then insurance_wallet).
--   2. THE UNION'S INSURANCE BANK. record_insurance_transaction upserts
--      union_wallets.insurance_wallet (club_wallets.insurance_balance for a
--      private table): the same row the 2026-11-17 tournament settlement held
--      for 45 s per attempt. Latent today (3 insurance rows ever, the last on
--      2026-08-29; 489 insurance tables, all closed), and named by #11256 as
--      its one open exposure.
--
-- Owner rulings: a tournament problem must be isolated and must never affect
-- another tournament or a cash game; promo chips must never cause payout
-- issues.
--
-- WHAT THIS FILE INSTALLS (the #11256 pattern). Nothing here changes
-- behaviour while public.hand_bank_obligation_pending is empty, and only part 2
-- (20261118071736, the switch in the envelope) ever stores a row in it.
--
--   1. public.hand_bank_obligation_pending: one row per obligation of a hand
--      (bbj_contribution, or insurance per player and kind), holding it
--      exactly as the envelope would have passed it, and felt_amount: what the
--      hand's receipt carried as felt for it (the drop; premium - payout for
--      an insurance leg, in cents as record_insurance_transaction rounds them).
--   2. fn_ca_bank_pending_hand_obligations(hand): for each stored obligation,
--      in its own subtransaction, makes the SAME call the envelope makes today
--      (bbj_record_contribution on the pool the envelope would have chosen,
--      record_insurance_transaction) and deletes the row. It never waits for a
--      shared row: the pool lock is pg_try_advisory_xact_lock, the pool row and
--      the bank row are taken NOWAIT, then a 250 ms lock budget. Busy leaves
--      the obligation where it is.
--   3. Who calls it: the hand's own continuation, in the same pass that banks
--      its rake (fn_project_hand_side_effects, before any table or player
--      lock; the pass then ends), and the outbox row cannot leave while an
--      obligation is pending (trg_finish_hand_post_commit_obligations). No
--      timer, no sweep, no repair job (CLAUDE.md 10.12).
--   4. Conservation at every commit (the ledger invariant is in refuse mode):
--      while a row exists its felt_amount is on the felt. fn_ca_tally_balance_move
--      counts it as table_stack; fn_ca_supply_snapshot (posthand_transit) and
--      fn_ca_account_balance (table_stack) add the same sum.
--   5. Visibility. fn_rake_bbj_invariants: a drop waiting in the row is not I5
--      (never banked); a row older than five minutes is I9 (owed), one line
--      per hand even when its rake waits too. fn_post_commit_stranded_watchdog
--      (CRITICAL, ten-minute grace, same alert source) now also counts rows of
--      cash_rake_pending AND hand_bank_obligation_pending older than the grace,
--      with attempts and last_error, and resolves only when none remain: a
--      stored obligation that cannot bank pages exactly as loudly as the
--      envelope that could not complete did before #11256 (that gap was
--      #11256's too, and is closed here for both tables).
--   6. Refusal stays at the envelope. The switch (part 2) runs every
--      precondition the deferred calls check on the obligation itself, so a
--      malformed drop or leg fails the envelope as before instead of being
--      stored to fail later: whole cents; equity 0-100, non-negative amounts,
--      a known kind, the table's club; one insurance receipt per player per
--      hand; a payout the bank cannot cover net of stored payouts.
--   7. A stored insurance payout is reserved. fn_union_debit_wallet_zd3core,
--      the one spend door of union_wallets.insurance_wallet, treats stored
--      payouts for the union as spent, so the leg can always bank under
--      union_wallets_insurance_wallet_nonneg.
--   8. The banker re-reads the club's union when it banks a drop, so a club
--      that joined or left a union while its drop waited banks it where it
--      plays now.
--   9. record_insurance_transaction updates the union bank row before it
--      would insert one, so a net payout is judged against the wallet's real
--      balance, not refused by the CHECK on a proposed new row (see below).
--
-- bbj_record_contribution and fn_bbj_allocate are not changed.
-- record_insurance_transaction changes in one statement only (9 below).
--
-- @live-proof: (SELECT to_regclass('public.hand_bank_obligation_pending') IS NOT NULL AND to_regprocedure('public.fn_ca_bank_pending_hand_obligations(uuid)') IS NOT NULL AND md5(pg_get_functiondef('public.fn_ca_tally_balance_move()'::regprocedure)) = '710154d55d4cb9fb1d425f3df13087c4' AND md5(pg_get_functiondef('public.fn_ca_supply_snapshot()'::regprocedure)) = 'c14f15b5933a8ee0e24f1f918bdc6d6f' AND md5(pg_get_functiondef('public.fn_ca_account_balance(text,uuid,uuid,text)'::regprocedure)) = 'abe021e4c5a42b02f3b4c00c8bd1ffc9' AND md5(pg_get_functiondef('public.fn_rake_bbj_invariants(integer)'::regprocedure)) = '2a8c79452ced863cfb15364d1e62a40c' AND md5(pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure)) = '39d043cda727119e0a6d883a3fb25d50' AND md5(pg_get_functiondef('public.trg_finish_hand_post_commit_obligations()'::regprocedure)) = '2d9d0d7cab537e608da36be3319e347e' AND md5(pg_get_functiondef('public.fn_post_commit_stranded_watchdog()'::regprocedure)) = 'a16ceda2073f0dbb3cd28feb841106e9' AND md5(pg_get_functiondef('public.fn_union_debit_wallet_zd3core(uuid,text,numeric,text,uuid,uuid,text,uuid)'::regprocedure)) = '09f80760439fe2e2883dcbc95ad00bf5' AND md5(pg_get_functiondef('public.record_insurance_transaction(uuid,uuid,integer,uuid,numeric,numeric,numeric,numeric,boolean,character varying)'::regprocedure)) = 'bf0ba9220c9bdc77aaaa0933ff491a7b')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- The pinned-text substitution of 20261118034950, unchanged: the live
-- definition must be the pinned preimage, each anchor must occur exactly once,
-- the result must be the derived postimage before and after it is executed,
-- and owner, SECURITY DEFINER, settings and grants must not move.
CREATE FUNCTION pg_temp.ca_bank_subst(p_sig text, p_before text, p_after text,
                                      p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %)', p_sig, md5(v_def);
  END IF;
  IF array_length(p_old, 1) IS DISTINCT FROM array_length(p_new, 1) THEN
    RAISE EXCEPTION '%: anchors and replacements do not pair', p_sig;
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected exactly 1', p_sig, i, v_n;
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;

  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;

  EXECUTE v_new;

  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: the replaced function does not read back as the postimage', p_sig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = p_sig::regprocedure
                    AND p.proacl::text IS NOT DISTINCT FROM v_acl
                    AND pg_get_userbyid(p.proowner) = v_owner
                    AND p.prosecdef = v_secdef
                    AND p.proconfig IS NOT DISTINCT FROM v_cfg) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

-- #11256 must be installed whole: this file builds on its postimages.
DO $m$
BEGIN
  IF to_regclass('public.cash_rake_pending') IS NULL
     OR to_regprocedure('public.fn_ca_bank_pending_cash_rake(uuid)') IS NULL THEN
    RAISE EXCEPTION '20261118034950 (cash_rake_pending) is not installed; this file builds on it';
  END IF;
END $m$;

CREATE TABLE public.hand_bank_obligation_pending (
  hand_id         uuid        NOT NULL,
  kind            text        NOT NULL CHECK (kind IN ('bbj_contribution', 'insurance')),
  item_key        text        NOT NULL,
  table_id        uuid        NOT NULL,
  hand_number     bigint      NOT NULL,
  union_id        uuid,
  felt_amount     numeric     NOT NULL,
  obligation      jsonb       NOT NULL CHECK (jsonb_typeof(obligation) = 'object'),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts        integer     NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error      text,
  PRIMARY KEY (hand_id, kind, item_key),
  CONSTRAINT hand_bank_obligation_drop_is_the_obligation
    CHECK (kind <> 'bbj_contribution'
           OR (item_key = '' AND felt_amount > 0
               AND (obligation ->> 'amount')::numeric = felt_amount)),
  -- One insurance leg per player per hand: insurance_transactions is unique
  -- on (table_id, hand_number, player_id), whatever the kind.
  CONSTRAINT hand_bank_obligation_insurance_is_the_bank_delta
    CHECK (kind <> 'insurance'
           OR (item_key = lower(obligation ->> 'player_id')
               AND felt_amount = round(COALESCE((obligation ->> 'premium')::numeric, 0), 2)
                               - round(COALESCE((obligation ->> 'payout')::numeric, 0), 2)))
);
COMMENT ON TABLE public.hand_bank_obligation_pending IS
 'A cash hand''s BBJ drop and insurance bank legs, stored by its completed post-commit envelope and banked by fn_ca_bank_pending_hand_obligations from the hand''s projection continuation, so the envelope never waits on the union''s shared BBJ pool or insurance bank. felt_amount is on the felt by the tally until banked. Empty when every hand is banked.';
CREATE INDEX hand_bank_obligation_pending_created ON public.hand_bank_obligation_pending (created_at);
-- The insurance payouts a union still owes from its insurance_wallet: read by
-- the wallet's debit door (the reservation below) and by the envelope.
CREATE INDEX hand_bank_obligation_pending_payouts ON public.hand_bank_obligation_pending (union_id)
  WHERE kind = 'insurance' AND felt_amount < 0;
COMMENT ON COLUMN public.hand_bank_obligation_pending.union_id IS
 'The bank union as the envelope resolved it (insurance: the union whose insurance_wallet the leg moves; NULL for a club bank). The banker re-reads the union for a BBJ drop; for insurance it reserves a pending payout against this union''s insurance_wallet.';

ALTER TABLE public.hand_bank_obligation_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hand_bank_obligation_pending FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.hand_bank_obligation_pending TO service_role;

CREATE FUNCTION public.fn_ca_hand_bank_obligation_is_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public' AS $fn$
BEGIN
  IF NEW.hand_id IS DISTINCT FROM OLD.hand_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.item_key IS DISTINCT FROM OLD.item_key OR NEW.table_id IS DISTINCT FROM OLD.table_id
     OR NEW.hand_number IS DISTINCT FROM OLD.hand_number OR NEW.union_id IS DISTINCT FROM OLD.union_id
     OR NEW.felt_amount IS DISTINCT FROM OLD.felt_amount OR NEW.obligation IS DISTINCT FROM OLD.obligation
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'hand_bank_obligation_is_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_hand_bank_obligation_is_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER aaa_ca_refuse_replica_money_truncate BEFORE TRUNCATE ON public.hand_bank_obligation_pending
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_refuse_replica_money_write();
CREATE TRIGGER aaa_ca_refuse_replica_money_write BEFORE INSERT OR DELETE OR UPDATE ON public.hand_bank_obligation_pending
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_refuse_replica_money_write();
CREATE TRIGGER trg_ca_block_browser BEFORE INSERT OR DELETE OR UPDATE ON public.hand_bank_obligation_pending
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_block_browser_money_table();
CREATE TRIGGER hand_bank_obligation_is_immutable BEFORE UPDATE ON public.hand_bank_obligation_pending
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_hand_bank_obligation_is_immutable();
CREATE TRIGGER zy_ca_tally_balance_move
  AFTER INSERT OR UPDATE OF felt_amount, table_id OR DELETE ON public.hand_bank_obligation_pending
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_tally_balance_move();
CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row
  AFTER INSERT OR UPDATE OF felt_amount, table_id OR DELETE ON public.hand_bank_obligation_pending
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_balance_has_its_ledger_row();

INSERT INTO public.ca_declared_money_triggers (table_name, trigger_name, note)
SELECT x.t, x.g, x.n
  FROM (VALUES
    ('hand_bank_obligation_pending', 'aaa_ca_refuse_replica_money_truncate', '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on: no money write on a replica'),
    ('hand_bank_obligation_pending', 'aaa_ca_refuse_replica_money_write', '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on: no money write on a replica'),
    ('hand_bank_obligation_pending', 'trg_ca_block_browser', '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on: no browser role writes a hand''s bank obligation'),
    ('hand_bank_obligation_pending', 'hand_bank_obligation_is_immutable', '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on: the stored obligation never changes; only its attempt notes do'),
    ('hand_bank_obligation_pending', 'zy_ca_tally_balance_move', '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on: a stored drop or insurance leg is on the felt (table_stack) in the transaction tally until its call posts the leg and the row is deleted'),
    ('hand_bank_obligation_pending', 'zz_ca_balance_has_its_ledger_row', '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on: deferred to commit; refuses an obligation stored or removed without the matching felt movement or leg')
  ) AS x(t, g, n)
ON CONFLICT (table_name, trigger_name) DO UPDATE SET note = EXCLUDED.note;

CREATE FUNCTION public.fn_ca_bank_pending_hand_obligations(p_hand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  k record;
  p public.hand_bank_obligation_pending%ROWTYPE;
  v_lock_timeout text := current_setting('lock_timeout');
  v_pool_id uuid;
  v_receipt uuid;
  v_union uuid; v_club uuid; v_private boolean;
  v_state text; v_msg text;
  v_items jsonb := '[]'::jsonb;
  v_status text;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'hand_bank_obligation_not_authorised' USING ERRCODE = '42501';
  END IF;

  FOR k IN
    SELECT b.kind, b.item_key
      FROM public.hand_bank_obligation_pending b
     WHERE b.hand_id = p_hand_id
     ORDER BY b.kind, b.item_key
  LOOP
    v_state := NULL; v_msg := NULL;
    BEGIN
      SELECT * INTO p FROM public.hand_bank_obligation_pending b
       WHERE b.hand_id = p_hand_id AND b.kind = k.kind AND b.item_key = k.item_key
         FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN
        -- Banked already, or another continuation holds it right now.
        v_items := v_items || jsonb_build_object('kind', k.kind, 'item', k.item_key, 'status', 'absent');
        CONTINUE;
      END IF;

      IF p.kind = 'bbj_contribution' THEN
        /* NEVER WAIT FOR THE UNION'S POOL. The same advisory key and the same
           pool choice the envelope made (one active pool per union, else per
           club), each refused at once if anyone holds it. The club's union is
           read NOW, as the envelope read it at its own run: a club that joined
           or left a union while its drop waited banks it to the pool it plays
           under today, never to a closed or orphaned club pool. */
        SELECT c.union_id INTO v_union FROM public.clubs c
         WHERE c.id = (p.obligation->>'club_id')::uuid;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'BBJ obligation club not found for hand %', p_hand_id;
        END IF;
        IF NOT pg_try_advisory_xact_lock(hashtextextended(
             'bbj-pool:' || COALESCE(v_union::text, 'club:' || (p.obligation->>'club_id')), 0)) THEN
          RAISE EXCEPTION 'bbj pool lock held' USING ERRCODE = '55P03';
        END IF;
        v_pool_id := NULL;
        IF v_union IS NULL THEN
          SELECT bp.id INTO v_pool_id
            FROM public.bbj_pools bp
           WHERE bp.club_id = (p.obligation->>'club_id')::uuid
             AND bp.status = 'active'
           ORDER BY bp.created_at, bp.id
           LIMIT 1
           FOR UPDATE NOWAIT;
        ELSE
          SELECT bp.id INTO v_pool_id
            FROM public.bbj_pools bp
           WHERE bp.union_id = v_union
             AND bp.status = 'active'
           ORDER BY bp.created_at, bp.id
           LIMIT 1
           FOR UPDATE NOWAIT;
        END IF;
        PERFORM set_config('lock_timeout', '250ms', true);
        IF v_pool_id IS NULL THEN
          IF v_union IS NULL THEN
            INSERT INTO public.bbj_pools(club_id, main_balance, backup_balance, promo_balance, status)
            VALUES ((p.obligation->>'club_id')::uuid, 0, 0, 0, 'active') RETURNING id INTO v_pool_id;
          ELSE
            INSERT INTO public.bbj_pools(union_id, main_balance, backup_balance, promo_balance, status)
            VALUES (v_union, 0, 0, 0, 'active') RETURNING id INTO v_pool_id;
          END IF;
        END IF;

        -- The call the envelope made, argument for argument.
        SELECT r.id INTO v_receipt
          FROM public.bbj_record_contribution(
            v_pool_id,
            p.hand_id,
            p.table_id,
            (p.obligation->>'amount')::numeric,
            0, 0, 0,
            COALESCE((p.obligation->>'big_blind')::numeric, 2),
            p.hand_number::integer,
            (p.obligation->>'club_id')::uuid
          ) r;
        IF v_receipt IS NULL THEN
          RAISE EXCEPTION 'BBJ contribution produced no receipt for hand %', p_hand_id;
        END IF;
      ELSE
        /* NEVER WAIT FOR THE INSURANCE BANK. The bank row is the one
           record_insurance_transaction would write, chosen the same way; it is
           taken NOWAIT, only when the leg moves it. */
        IF p.felt_amount <> 0 THEN
          SELECT t.club_id, t.union_id, COALESCE(t.is_private, false)
            INTO v_club, v_union, v_private
            FROM public.tables t WHERE t.id = p.table_id;
          IF v_private THEN
            v_union := NULL;
          ELSIF v_union IS NULL THEN
            SELECT c.union_id INTO v_union FROM public.clubs c
             WHERE c.id = (p.obligation->>'club_id')::uuid;
          END IF;
          IF v_union IS NOT NULL THEN
            PERFORM 1 FROM public.union_wallets w
              WHERE w.union_id = v_union FOR NO KEY UPDATE NOWAIT;
          ELSE
            PERFORM 1 FROM public.club_wallets w
              WHERE w.club_id = (p.obligation->>'club_id')::uuid FOR NO KEY UPDATE NOWAIT;
          END IF;
        END IF;
        PERFORM set_config('lock_timeout', '250ms', true);

        -- The call the envelope made, argument for argument.
        SELECT r.id INTO v_receipt
          FROM public.record_insurance_transaction(
            p.table_id,
            (p.obligation->>'club_id')::uuid,
            p.hand_number::integer,
            (p.obligation->>'player_id')::uuid,
            COALESCE((p.obligation->>'equity_percent')::numeric, 0),
            COALESCE((p.obligation->>'premium')::numeric, 0),
            COALESCE((p.obligation->>'insured_amount')::numeric, 0),
            COALESCE((p.obligation->>'payout')::numeric, 0),
            COALESCE((p.obligation->>'player_won')::boolean, false),
            COALESCE(NULLIF(p.obligation->>'kind', ''), 'insurance')::varchar
          ) r;
        IF v_receipt IS NULL THEN
          RAISE EXCEPTION 'insurance obligation produced no receipt for hand %', p_hand_id;
        END IF;
      END IF;

      DELETE FROM public.hand_bank_obligation_pending b
       WHERE b.hand_id = p_hand_id AND b.kind = p.kind AND b.item_key = p.item_key;
      PERFORM set_config('lock_timeout', v_lock_timeout, true);
      v_items := v_items || jsonb_build_object('kind', p.kind, 'item', p.item_key, 'status', 'banked',
                                               'receipt', v_receipt, 'amount', p.felt_amount);
      CONTINUE;
    EXCEPTION
      WHEN lock_not_available THEN
        v_state := 'busy';
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    PERFORM set_config('lock_timeout', v_lock_timeout, true);

    IF v_state = 'busy' THEN
      -- Whoever holds the shared row is not this hand's problem: the
      -- obligation stays exactly where it is.
      v_items := v_items || jsonb_build_object('kind', k.kind, 'item', k.item_key, 'status', 'busy');
    ELSE
      -- Refused: nothing above was kept. The obligation stays, and says why.
      UPDATE public.hand_bank_obligation_pending b
         SET attempts = b.attempts + 1,
             last_attempt_at = clock_timestamp(),
             last_error = left(v_state || ': ' || v_msg, 500)
       WHERE b.hand_id = p_hand_id AND b.kind = k.kind AND b.item_key = k.item_key;
      v_items := v_items || jsonb_build_object('kind', k.kind, 'item', k.item_key, 'status', 'refused',
                                               'sqlstate', v_state, 'error', v_msg);
    END IF;
  END LOOP;

  v_status := CASE
    WHEN jsonb_array_length(v_items) = 0 THEN 'absent'
    WHEN EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending b WHERE b.hand_id = p_hand_id) THEN
      CASE WHEN v_items @> '[{"status":"refused"}]' THEN 'refused' ELSE 'busy' END
    ELSE 'banked' END;
  RETURN jsonb_build_object('status', v_status, 'hand_id', p_hand_id, 'items', v_items);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_bank_pending_hand_obligations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_bank_pending_hand_obligations(uuid) TO service_role;
COMMENT ON FUNCTION public.fn_ca_bank_pending_hand_obligations(uuid) IS
 'Banks one cash hand''s stored BBJ drop and insurance legs with the unchanged bbj_record_contribution / record_insurance_transaction calls and deletes each row, each in its own subtransaction. Never waits for the union''s BBJ pool or insurance bank. Called by fn_project_hand_side_effects and by the outbox delete guard; status banked | absent | busy | refused.';

SELECT pg_temp.ca_bank_subst(
  'public.fn_ca_tally_balance_move()',
  'c8c24d5a2c098d3189127e9e870601a3', '710154d55d4cb9fb1d425f3df13087c4',
  ARRAY[$otally1$    WHEN 'union_wallets' THEN
$otally1$],
  ARRAY[$ntally1$    WHEN 'hand_bank_obligation_pending' THEN
      /* A CASH HAND'S BBJ DROP AND INSURANCE LEG WAIT ON THE FELT IN THEIR OWN
         ROWS (20261118071728). The envelope completes without touching the
         union's shared BBJ pool or insurance bank: it stores each obligation
         here, and the hand's projection continuation makes the call and
         deletes the row in one transaction. While the row exists its
         felt_amount (the drop; premium - payout for insurance) is still on
         the felt by the journal, exactly as the hand's receipt carried it.
         Scoped like the seat: the cash chip felt. */
      k_old := 'table_stack'; k_new := 'table_stack';
      IF o IS NOT NULL AND public.fn_ca_felt_counts_table((o ->> 'table_id')::uuid) THEN
        v_old := COALESCE((o ->> 'felt_amount')::numeric, 0);
      END IF;
      IF n IS NOT NULL AND public.fn_ca_felt_counts_table((n ->> 'table_id')::uuid) THEN
        v_new := COALESCE((n ->> 'felt_amount')::numeric, 0);
      END IF;
    WHEN 'union_wallets' THEN
$ntally1$]
);

SELECT pg_temp.ca_bank_subst(
  'public.fn_ca_supply_snapshot()',
  '549b78dd66f1596b0942db37cef95298', 'c14f15b5933a8ee0e24f1f918bdc6d6f',
  ARRAY[$osupply1$         FROM public.cash_rake_pending rp
        WHERE NOT EXISTS (SELECT 1 FROM tables t
                           WHERE t.id = rp.table_id
                             AND (t.tournament_id IS NOT NULL
                                  OR EXISTS (SELECT 1 FROM public.clubs cl
                                              WHERE cl.id = t.club_id AND cl.asset = 'diamonds'))))            AS posthand_transit,
$osupply1$],
  ARRAY[$nsupply1$         FROM public.cash_rake_pending rp
        WHERE NOT EXISTS (SELECT 1 FROM tables t
                           WHERE t.id = rp.table_id
                             AND (t.tournament_id IS NOT NULL
                                  OR EXISTS (SELECT 1 FROM public.clubs cl
                                              WHERE cl.id = t.club_id AND cl.asset = 'diamonds'))))
    /* A BANKED-LATER DROP OR INSURANCE LEG IS STILL IN TRANSIT (20261118071728).
       Stored by the envelope in hand_bank_obligation_pending, banked by the
       hand's projection continuation. fn_ca_account_balance reads the felt
       with this line. */
    + (SELECT COALESCE(sum(bp.felt_amount), 0)
         FROM public.hand_bank_obligation_pending bp
        WHERE NOT EXISTS (SELECT 1 FROM tables t
                           WHERE t.id = bp.table_id
                             AND (t.tournament_id IS NOT NULL
                                  OR EXISTS (SELECT 1 FROM public.clubs cl
                                              WHERE cl.id = t.club_id AND cl.asset = 'diamonds'))))            AS posthand_transit,
$nsupply1$]
);

SELECT pg_temp.ca_bank_subst(
  'public.fn_ca_account_balance(text,uuid,uuid,text)',
  'f100348cb3e5e641017819066fa18d40', 'abe021e4c5a42b02f3b4c00c8bd1ffc9',
  ARRAY[$oacct1$             FROM public.cash_rake_pending rp
            WHERE NOT EXISTS (SELECT 1 FROM public.tables t
                               WHERE t.id = rp.table_id
                                 AND (t.tournament_id IS NOT NULL
                                      OR EXISTS (SELECT 1 FROM public.clubs cl
                                                  WHERE cl.id = t.club_id AND cl.asset = 'diamonds'))));
$oacct1$],
  ARRAY[$nacct1$             FROM public.cash_rake_pending rp
            WHERE NOT EXISTS (SELECT 1 FROM public.tables t
                               WHERE t.id = rp.table_id
                                 AND (t.tournament_id IS NOT NULL
                                      OR EXISTS (SELECT 1 FROM public.clubs cl
                                                  WHERE cl.id = t.club_id AND cl.asset = 'diamonds'))))
        /* A BANKED-LATER DROP OR INSURANCE LEG IS ON THE FELT BY ITS JOURNAL
           TOO (20261118071728): stored in hand_bank_obligation_pending until
           the hand's projection continuation posts its leg. */
        + (SELECT COALESCE(sum(bp.felt_amount), 0)
             FROM public.hand_bank_obligation_pending bp
            WHERE NOT EXISTS (SELECT 1 FROM public.tables t
                               WHERE t.id = bp.table_id
                                 AND (t.tournament_id IS NOT NULL
                                      OR EXISTS (SELECT 1 FROM public.clubs cl
                                                  WHERE cl.id = t.club_id AND cl.asset = 'diamonds'))));
$nacct1$]
);

SELECT pg_temp.ca_bank_subst(
  'public.fn_rake_bbj_invariants(integer)',
  'd23a4053d2578ce628381f87e9c20652', '2a8c79452ced863cfb15364d1e62a40c',
  ARRAY[$oinv2$                                AND abs(b.amount - s.bbj) <= 0.01) LIMIT 20) x
$oinv2$,
        $oinv3$           WHERE rp.created_at < v_grace
$oinv3$],
  ARRAY[$ninv2$                                AND abs(b.amount - s.bbj) <= 0.01)
             -- A DROP WAITING IN hand_bank_obligation_pending IS OWED, NOT
             -- LOST (20261118071728); a row older than the grace is I9.
             AND NOT EXISTS (SELECT 1 FROM hand_bank_obligation_pending bp
                              WHERE bp.hand_id = s.hand_id
                                AND bp.kind = 'bbj_contribution') LIMIT 20) x
$ninv2$,
        $ninv3$           WHERE rp.created_at < v_grace
          UNION ALL
          -- 20261118071728: a completed envelope's BBJ drop or insurance leg
          -- still waiting to be banked.
          -- One line per hand: a hand already listed above for its rake is not
          -- counted again.
          SELECT bp.hand_id, bp.table_id, bp.hand_number, min(bp.created_at)
            FROM hand_bank_obligation_pending bp
           WHERE bp.created_at < v_grace
             AND NOT EXISTS (SELECT 1 FROM cash_rake_pending rp
                              WHERE rp.hand_id = bp.hand_id AND rp.created_at < v_grace)
           GROUP BY 1, 2, 3
$ninv3$]
);

SELECT pg_temp.ca_bank_subst(
  'public.fn_project_hand_side_effects(uuid)',
  '16dea593b5f2c2b22052c8752d9aba7c', '39d043cda727119e0a6d883a3fb25d50',
  ARRAY[$oproj1$  v_seat_uid uuid;
BEGIN
$oproj1$,
        $oproj2$  /* THE HAND'S RAKE IS BANKED BY ITS OWN CONTINUATION (20261118). A cash
$oproj2$,
        $oproj3$  /* LOCK ORDER 1b (20261019): this tournament's shared lane, waiting, before
$oproj3$,
        $oproj4$      'cash_rake', v_post_commit,
$oproj4$],
  ARRAY[$nproj1$  v_seat_uid uuid;
  v_hand_bank jsonb;
BEGIN
$nproj1$,
        $nproj2$  /* THE HAND'S BBJ DROP AND INSURANCE LEGS ARE BANKED BY ITS OWN
     CONTINUATION (20261118071728), in the same pass as its rake and before any
     table or player lock. The banker never waits for the union's BBJ pool or
     insurance bank; a busy one leaves the obligation stored. */
  IF EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending bp WHERE bp.hand_id = p_hand_id) THEN
    v_hand_bank := public.fn_ca_bank_pending_hand_obligations(p_hand_id);
  END IF;

  /* THE HAND'S RAKE IS BANKED BY ITS OWN CONTINUATION (20261118). A cash
$nproj2$,
        $nproj3$  /* A pass that banked (or tried to bank) a drop or an insurance leg ends
     here, like the rake pass above: statistics never run while this
     transaction holds the pool or the bank (20261118071728). */
  IF v_hand_bank IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'detail', CASE WHEN v_hand_bank->>'status' IN ('banked', 'absent')
                     THEN 'hand_bank_obligations_banked_in_this_transaction'
                     ELSE 'hand_bank_obligations_pending' END,
      'hand_bank', v_hand_bank,
      'projection_applied', false,
      'hand_id', p_hand_id
    );
  END IF;

  /* LOCK ORDER 1b (20261019): this tournament's shared lane, waiting, before
$nproj3$,
        $nproj4$      'cash_rake', v_post_commit,
      'hand_bank', v_hand_bank,
$nproj4$]
);

SELECT pg_temp.ca_bank_subst(
  'public.trg_finish_hand_post_commit_obligations()',
  'bcd517670b65faed6e30ac80bef50e98', '2d9d0d7cab537e608da36be3319e347e',
  ARRAY[$otrg1$      RAISE EXCEPTION 'hand rake remains pending for %: %', OLD.hand_id, v_result;
    END IF;
  END IF;
$otrg1$],
  ARRAY[$ntrg1$      RAISE EXCEPTION 'hand rake remains pending for %: %', OLD.hand_id, v_result;
    END IF;
  END IF;
  /* 20261118071728: nor while its BBJ drop or an insurance leg is pending. */
  IF EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending bp WHERE bp.hand_id = OLD.hand_id) THEN
    v_result := public.fn_ca_bank_pending_hand_obligations(OLD.hand_id);
    IF v_result->>'status' IS DISTINCT FROM 'banked' THEN
      RAISE EXCEPTION 'hand bank obligations remain pending for %: %', OLD.hand_id, v_result;
    END IF;
  END IF;
$ntrg1$]
);

/* A STORED OBLIGATION THAT CANNOT BANK PAGES AS LOUDLY AS AN ENVELOPE THAT
   CANNOT COMPLETE. Before #11256 a hand whose rake or drop could not be posted
   left its envelope uncompleted, and fn_post_commit_stranded_watchdog raised a
   CRITICAL alert after ten minutes. Once the envelope completes by storing
   the obligation, a refused row would only be I9 (hourly warning) while its
   table's outbox row can never leave, so that table's projections stop. The
   watchdog now counts rows of BOTH pending tables older than its ten-minute
   grace, with their attempts and last error, in the same critical alert; it
   resolves only when none remain. */
SELECT pg_temp.ca_bank_subst(
  'public.fn_post_commit_stranded_watchdog()',
  'a459b8438ac006de92495a8325220ed5', 'a16ceda2073f0dbb3cd28feb841106e9',
  ARRAY[$owatch0$declare v_n int; v_oldest timestamptz; v_sample jsonb;
$owatch0$,
        $owatch1$             and committed_at < now() - interval '10 minutes') s;
$owatch1$,
        $owatch2$  if v_n > 0 then
$owatch2$,
        $owatch3$        v_n || ' committed hand(s) still have unfinished post-commit work after 10+ minutes (oldest ' || v_oldest || '). Players'' balances, stats or rake for these hands may be incomplete.',
        jsonb_build_object('stranded', v_n, 'oldest', v_oldest, 'sample', v_sample));
$owatch3$,
        $owatch4$  return jsonb_build_object('stranded', v_n, 'oldest', v_oldest);
$owatch4$],
  ARRAY[$nwatch0$declare v_n int; v_oldest timestamptz; v_sample jsonb;
  v_pending int; v_pending_oldest timestamptz; v_pending_sample jsonb;
$nwatch0$,
        $nwatch1$             and committed_at < now() - interval '10 minutes') s;

  /* 20261118071728: a completed envelope's rake, BBJ drop or insurance leg
     still stored after the same grace. Its hand's outbox row cannot leave, so
     that table's projections wait on it: page, with why it has not banked. */
  select count(*), min(created_at),
         coalesce(jsonb_agg(jsonb_build_object('obligation', kind, 'hand_id', hand_id, 'table_id', table_id,
                                               'hand_number', hand_number, 'stored_at', created_at,
                                               'attempts', attempts, 'last_error', last_error))
                  filter (where rn <= 10), '[]')
    into v_pending, v_pending_oldest, v_pending_sample
    from (select u.*, row_number() over (order by u.created_at) rn
            from (select 'rake'::text kind, rp.hand_id, rp.table_id, rp.hand_number, rp.created_at,
                         rp.attempts, rp.last_error
                    from cash_rake_pending rp
                   where rp.created_at < now() - interval '10 minutes'
                  union all
                  select bp.kind, bp.hand_id, bp.table_id, bp.hand_number, bp.created_at,
                         bp.attempts, bp.last_error
                    from hand_bank_obligation_pending bp
                   where bp.created_at < now() - interval '10 minutes') u) s;
$nwatch1$,
        $nwatch2$  if v_n + v_pending > 0 then
$nwatch2$,
        $nwatch3$        (v_n + v_pending) || ' committed hand obligation(s) still unfinished after 10+ minutes (' || v_n || ' envelope(s), oldest ' || coalesce(v_oldest::text, '-') || '; ' || v_pending || ' stored rake/BBJ/insurance obligation(s), oldest ' || coalesce(v_pending_oldest::text, '-') || '). Players'' balances, stats or rake for these hands may be incomplete.',
        jsonb_build_object('stranded', v_n, 'oldest', v_oldest, 'sample', v_sample,
                           'pending_obligations', v_pending, 'pending_oldest', v_pending_oldest,
                           'pending_sample', v_pending_sample));
$nwatch3$,
        $nwatch4$  return jsonb_build_object('stranded', v_n, 'oldest', v_oldest,
                            'pending_obligations', v_pending, 'pending_oldest', v_pending_oldest);
$nwatch4$]
);

/* AN INSURANCE PAYOUT WAITING TO BE BANKED IS RESERVED. A stored leg whose
   payout exceeds its premium will debit the union's insurance_wallet when it
   banks; union_wallets_insurance_wallet_nonneg refuses a debit below zero. If
   anything spent that money first, the stored leg could never bank. The one
   spend door of insurance_wallet on production (read 2026-11-18: the only
   function that maps a debit onto the column) is fn_union_debit_wallet_zd3core;
   it now treats pending payouts as already spent. The smaller of the two
   designs: a reservation read at the one door, instead of a reserve column
   every reader of insurance_wallet would have to learn. The envelope refuses
   a payout the wallet cannot cover net of the same reservation, as the
   wallet's CHECK refused it in the envelope before. */
SELECT pg_temp.ca_bank_subst(
  'public.fn_union_debit_wallet_zd3core(uuid,text,numeric,text,uuid,uuid,text,uuid)',
  '2b51a9540e5ed24961aed8434a8ffdd8', '09f80760439fe2e2883dcbc95ad00bf5',
  ARRAY[$odoor0$  v_cp text;
BEGIN
$odoor0$,
        $odoor1$  IF v_before < p_amount THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'insufficient balance',
      'wallet', v_wallet_column, 'balance', v_before, 'requested', p_amount
    );
  END IF;
$odoor1$],
  ARRAY[$ndoor0$  v_cp text;
  v_reserved numeric := 0;
BEGIN
$ndoor0$,
        $ndoor1$  /* 20261118071728: insurance payouts stored by completed hands and not
     yet banked are already owed from this wallet. */
  IF v_wallet_column = 'insurance_wallet' THEN
    SELECT COALESCE(sum(-bp.felt_amount), 0) INTO v_reserved
      FROM public.hand_bank_obligation_pending bp
     WHERE bp.kind = 'insurance' AND bp.union_id = p_union_id AND bp.felt_amount < 0;
  END IF;

  IF v_before - v_reserved < p_amount THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'insufficient balance',
      'wallet', v_wallet_column, 'balance', v_before, 'requested', p_amount,
      'reserved_for_pending_payouts', v_reserved
    );
  END IF;
$ndoor1$]
);

/* AN INSURANCE PAYOUT CAN BE PAID FROM THE UNION'S BANK AT ALL. Found while
   proving this file on PostgreSQL: record_insurance_transaction credits the
   union bank with INSERT ... VALUES (union, delta) ON CONFLICT DO UPDATE.
   PostgreSQL checks a CHECK constraint on the proposed INSERT row before it
   looks for the conflict, so for every leg whose payout exceeds its premium
   (delta < 0) union_wallets_insurance_wallet_nonneg refuses the proposed row
   (insurance_wallet = delta < 0) even though the union's wallet row exists and
   covers it. On production today that fails the hand's envelope; stored, it
   would be refused for ever. The existing row is updated first and a row is
   inserted only for a union that has none, so the CHECK judges the wallet's
   real balance. A credit (delta > 0) writes the same row values as before. */
SELECT pg_temp.ca_bank_subst(
  'public.record_insurance_transaction(uuid,uuid,integer,uuid,numeric,numeric,numeric,numeric,boolean,character varying)',
  'cb02192b5c7520212a307d8b4c47510e', 'bf0ba9220c9bdc77aaaa0933ff491a7b',
  ARRAY[$oins0$      INSERT INTO union_wallets (union_id, insurance_wallet)
      VALUES (v_bank_entity, v_bank_delta)
      ON CONFLICT (union_id) DO UPDATE
        SET insurance_wallet = COALESCE(union_wallets.insurance_wallet, 0) + v_bank_delta,
            updated_at = NOW();
$oins0$],
  ARRAY[$nins0$      UPDATE union_wallets
         SET insurance_wallet = COALESCE(union_wallets.insurance_wallet, 0) + v_bank_delta,
             updated_at = NOW()
       WHERE union_id = v_bank_entity;
      IF NOT FOUND THEN
        INSERT INTO union_wallets (union_id, insurance_wallet)
        VALUES (v_bank_entity, v_bank_delta);
      END IF;
$nins0$]
);

SELECT public.fn_ca_declare_guard_redefinition('fn_ca_tally_balance_move',
  'migration 20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on');
SELECT public.fn_ca_declare_guard_redefinition('fn_ca_supply_snapshot',
  'migration 20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on');

DO $m$
BEGIN
  IF EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending) THEN
    RAISE EXCEPTION 'hand_bank_obligation_pending is not empty at install';
  END IF;
  IF (SELECT count(*) FROM pg_trigger tg
       WHERE tg.tgrelid = 'public.hand_bank_obligation_pending'::regclass AND NOT tg.tgisinternal
         AND tg.tgenabled <> 'D') <> 6 THEN
    RAISE EXCEPTION 'hand_bank_obligation_pending is not covered whole';
  END IF;
  IF has_table_privilege('anon', 'public.hand_bank_obligation_pending', 'SELECT')
     OR has_table_privilege('authenticated', 'public.hand_bank_obligation_pending', 'SELECT')
     OR has_function_privilege('authenticated', 'public.fn_ca_bank_pending_hand_obligations(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_bank_pending_hand_obligations(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a browser role can reach the stored bank obligations';
  END IF;
END $m$;

COMMIT;
