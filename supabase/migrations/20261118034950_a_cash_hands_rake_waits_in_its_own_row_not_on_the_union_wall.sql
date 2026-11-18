-- 20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch.
--
-- A CASH HAND'S RAKE WAITS IN ITS OWN ROW, NOT ON THE UNION WALLET (part 1 of 2)
--
-- WHAT HAPPENED. Every cash hand's post-commit envelope
-- (fn_ca_process_hand_post_commit_obligations) banks its rake through
-- atomic_distribute_rake, whose union leg is an upsert of union_wallets. Midway
-- Union is ONE row. On 2026-11-17 a tournament settlement debited promo_wallet
-- on that row early in a long transaction and held it 45 s per attempt for 90
-- minutes; every cash table's envelope waited on it and timed out at 8 s:
-- 2,676 statement timeouts in 25 minutes. Earlier the same evening a stats
-- projection held the same row (fixed by 20261117225600). 49 functions write
-- that row; a row lock does not care which column a writer touches.
--
-- Owner ruling: a tournament problem must be isolated and must never affect
-- another tournament or a cash game.
--
-- WHAT THIS FILE INSTALLS. Nothing here changes behaviour while
-- public.cash_rake_pending is empty, and only part 2 (20261118035606, the
-- switch in the envelope) ever stores a row in it.
--
--   1. public.cash_rake_pending: one row per hand (primary key hand_id)
--      holding the rake obligation exactly as the envelope would have passed
--      it to atomic_distribute_rake. Identity columns are immutable.
--   2. fn_ca_bank_pending_cash_rake(hand): locks that row, makes the SAME
--      atomic_distribute_rake call the envelope makes today, and deletes the
--      row, in one transaction. It never waits for the union wallet row
--      (NOWAIT, then a 250 ms lock budget): a held wallet leaves the row where
--      it is. atomic_distribute_rake itself is not changed, so every row it
--      writes today (rake_records, rake_attributions, both
--      rake_distribution_legs, club_table_rake_totals,
--      club_wallet_transactions, union_wallets, union_wallet_transactions,
--      accounting_cash_bank_receipts, the journal leg) is still written by
--      one call in one transaction, hand-gated as before. In particular
--      rake_records.created_at = union_wallet_transactions.created_at =
--      accounting_cash_bank_receipts.banked_at, which
--      fn_accounting_union_earned_plan_v3 requires at the weekly close.
--   3. Who calls it: the hand's own continuation. fn_project_hand_side_effects
--      (the engine's existing outbox worker) banks a pending rake before it
--      takes any table or player lock and ends that pass, exactly as
--      20261117225600 ends the pass that completed an envelope; the outbox row
--      is the durable record and cannot be deleted while the rake is pending
--      (trg_finish_hand_post_commit_obligations). No timer, no sweep, no
--      repair job (CLAUDE.md 10.12): this is the second half of the hand's own
--      write, restartable from its own record.
--   4. Conservation at every commit. The ledger invariant is in refuse mode.
--      While a row exists its amount is on the felt:
--        - fn_ca_tally_balance_move counts it as table_stack, so the
--          envelope's transaction (hand receipt completes: -rake; row stored:
--          +rake) and the banking transaction (row deleted: -rake felt; wallet
--          +rake; one leg table_stack -> union_wallet) each balance alone;
--        - fn_ca_supply_snapshot (posthand_transit) and fn_ca_account_balance
--          (table_stack) add the same sum, so neither meter moves.
--      Read on production 2026-11-18 about 03:50 UTC: 4,458 raked envelopes in three
--      hours, every one on a cash chip table, payload rake.amount equal to
--      stack_result.rake in every one.
--   5. Visibility. fn_rake_bbj_invariants: a hand whose rake waits in the row
--      is not I7 (never banked); a row older than five minutes is I9 (owed).
--
-- @live-proof: (SELECT to_regclass('public.cash_rake_pending') IS NOT NULL AND to_regprocedure('public.fn_ca_bank_pending_cash_rake(uuid)') IS NOT NULL AND md5(pg_get_functiondef('public.fn_ca_tally_balance_move()'::regprocedure)) = 'c8c24d5a2c098d3189127e9e870601a3' AND md5(pg_get_functiondef('public.fn_ca_supply_snapshot()'::regprocedure)) = '549b78dd66f1596b0942db37cef95298' AND md5(pg_get_functiondef('public.fn_ca_account_balance(text,uuid,uuid,text)'::regprocedure)) = 'f100348cb3e5e641017819066fa18d40' AND md5(pg_get_functiondef('public.fn_rake_bbj_invariants(integer)'::regprocedure)) = 'd23a4053d2578ce628381f87e9c20652' AND md5(pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure)) = '16dea593b5f2c2b22052c8752d9aba7c' AND md5(pg_get_functiondef('public.trg_finish_hand_post_commit_obligations()'::regprocedure)) = 'bcd517670b65faed6e30ac80bef50e98')

-- STALE PIN, DECLARED (2026-11-18, incident 075013fd). One installed function
-- pins this migration's preimage of fn_ca_tally_balance_move:
-- smarter_private.original_erased_cash_base_discharge(bigint,text). It refuses
-- (original_cash_discharge_money_source_changed) whenever ANY of its 46 pins is
-- stale, and 12 of them were already stale on production before this file
-- (read 2026-11-18 07:40 UTC), so its behaviour is identical with or without
-- this change. Moving the pin would certify the new tally body for that proof
-- without its owner's requalification, so the old body is declared instead.
-- @stale-pin-ok: b7911a245d4bf33134a9a2f474c1f410 original_erased_cash_base_discharge already refuses on 12 other stale pins; requalification belongs to its owner

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- The pinned-text substitution every function change below goes through
-- (the form 20261016172614 and 20261022062934 use): the live definition must
-- be the pinned preimage, each anchor must occur exactly once, the result must
-- be the derived postimage before and after it is executed, and owner,
-- SECURITY DEFINER, settings and grants must not move.
CREATE FUNCTION pg_temp.ca_rake_subst(p_sig text, p_before text, p_after text,
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

CREATE TABLE public.cash_rake_pending (
  hand_id         uuid        PRIMARY KEY,
  table_id        uuid        NOT NULL,
  hand_number     bigint      NOT NULL,
  amount          numeric     NOT NULL CHECK (amount > 0),
  rake            jsonb       NOT NULL CHECK (jsonb_typeof(rake) = 'object'),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts        integer     NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error      text,
  CONSTRAINT cash_rake_pending_amount_is_the_obligation
    CHECK ((rake ->> 'amount')::numeric = amount)
);
COMMENT ON TABLE public.cash_rake_pending IS
 'A cash hand''s rake obligation, stored by its completed post-commit envelope and banked by fn_ca_bank_pending_cash_rake from the hand''s projection continuation. One row per hand; on the felt by the tally until banked. Empty when every hand is banked.';
CREATE INDEX cash_rake_pending_created ON public.cash_rake_pending (created_at);

ALTER TABLE public.cash_rake_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cash_rake_pending FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.cash_rake_pending TO service_role;

CREATE FUNCTION public.fn_ca_cash_rake_pending_is_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public' AS $fn$
BEGIN
  IF NEW.hand_id IS DISTINCT FROM OLD.hand_id OR NEW.table_id IS DISTINCT FROM OLD.table_id
     OR NEW.hand_number IS DISTINCT FROM OLD.hand_number OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.rake IS DISTINCT FROM OLD.rake OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'cash_rake_pending_obligation_is_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_cash_rake_pending_is_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER aaa_ca_refuse_replica_money_truncate BEFORE TRUNCATE ON public.cash_rake_pending
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_refuse_replica_money_write();
CREATE TRIGGER aaa_ca_refuse_replica_money_write BEFORE INSERT OR DELETE OR UPDATE ON public.cash_rake_pending
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_refuse_replica_money_write();
CREATE TRIGGER trg_ca_block_browser BEFORE INSERT OR DELETE OR UPDATE ON public.cash_rake_pending
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_block_browser_money_table();
CREATE TRIGGER cash_rake_pending_is_immutable BEFORE UPDATE ON public.cash_rake_pending
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_cash_rake_pending_is_immutable();
CREATE TRIGGER zy_ca_tally_balance_move
  AFTER INSERT OR UPDATE OF amount, table_id OR DELETE ON public.cash_rake_pending
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_tally_balance_move();
CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row
  AFTER INSERT OR UPDATE OF amount, table_id OR DELETE ON public.cash_rake_pending
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_balance_has_its_ledger_row();

INSERT INTO public.ca_declared_money_triggers (table_name, trigger_name, note)
SELECT x.t, x.g, x.n
  FROM (VALUES
    ('cash_rake_pending', 'aaa_ca_refuse_replica_money_truncate', '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall: no money write on a replica'),
    ('cash_rake_pending', 'aaa_ca_refuse_replica_money_write', '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall: no money write on a replica'),
    ('cash_rake_pending', 'trg_ca_block_browser', '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall: no browser role writes a rake obligation'),
    ('cash_rake_pending', 'cash_rake_pending_is_immutable', '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall: the stored obligation never changes; only its attempt notes do'),
    ('cash_rake_pending', 'zy_ca_tally_balance_move', '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall: a stored rake is on the felt (table_stack) in the transaction tally until atomic_distribute_rake posts its leg and the row is deleted'),
    ('cash_rake_pending', 'zz_ca_balance_has_its_ledger_row', '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall: deferred to commit; refuses a rake row stored or removed without the matching felt movement or leg')
  ) AS x(t, g, n)
ON CONFLICT (table_name, trigger_name) DO UPDATE SET note = EXCLUDED.note;

CREATE FUNCTION public.fn_ca_bank_pending_cash_rake(p_hand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p public.cash_rake_pending%ROWTYPE;
  r record;
  v_union uuid;
  v_lock_timeout text := current_setting('lock_timeout');
  v_state text;
  v_msg text;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'cash_rake_bank_not_authorised' USING ERRCODE = '42501';
  END IF;

  BEGIN
    SELECT * INTO p FROM public.cash_rake_pending c
     WHERE c.hand_id = p_hand_id
       FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      -- Banked already, or another continuation holds it right now.
      RETURN jsonb_build_object('status', 'absent', 'hand_id', p_hand_id);
    END IF;

    /* NEVER WAIT FOR THE SHARED WALLET ROW. The union this rake is routed to
       is the game's stamp, read as atomic_distribute_rake reads it. A wallet
       someone holds leaves the obligation exactly where it is; whoever holds
       it is not this hand's problem and this hand is not theirs. */
    SELECT CASE WHEN COALESCE(t.is_private, false) THEN NULL ELSE t.union_id END
      INTO v_union
      FROM public.tables t WHERE t.id = p.table_id;
    IF v_union IS NOT NULL THEN
      PERFORM 1 FROM public.union_wallets w
        WHERE w.union_id = v_union
          FOR NO KEY UPDATE NOWAIT;
    END IF;
    PERFORM set_config('lock_timeout', '250ms', true);

    -- The call the envelope made, argument for argument.
    SELECT * INTO r
      FROM public.atomic_distribute_rake(
        p.table_id,
        (p.rake->>'club_id')::uuid,
        p.hand_id,
        p.hand_number::integer,
        (p.rake->>'amount')::numeric,
        COALESCE((p.rake->>'bbj')::numeric, 0),
        NULLIF(p.rake->>'pot', '')::numeric,
        NULLIF(p.rake->>'num_players', '')::integer,
        COALESCE(p.rake->'contributions', '{}'::jsonb),
        NULLIF(p.rake->>'tournament_id', '')::uuid,
        COALESCE(p.rake->'returned_uncalled', '{}'::jsonb),
        COALESCE(NULLIF(p.rake->>'method', ''), 'WEIGHTED_CONTRIBUTED')
      );
    IF NOT FOUND OR NOT (
      COALESCE(r.applied, false)
      OR COALESCE(r.already_processed, false)
      OR r.rake_record_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'rake obligation did not produce a receipt for hand %', p_hand_id;
    END IF;

    DELETE FROM public.cash_rake_pending c WHERE c.hand_id = p_hand_id;
    PERFORM set_config('lock_timeout', v_lock_timeout, true);
    RETURN jsonb_build_object(
      'status', 'banked', 'hand_id', p_hand_id, 'amount', p.amount,
      'applied', r.applied, 'already_processed', r.already_processed,
      'recovered', r.recovered, 'rake_record_id', r.rake_record_id,
      'route', r.spendable_route, 'union_id', r.union_id_out);
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN jsonb_build_object('status', 'busy', 'hand_id', p_hand_id);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  -- Refused: nothing above was kept. The obligation stays, and says why.
  UPDATE public.cash_rake_pending c
     SET attempts = c.attempts + 1,
         last_attempt_at = clock_timestamp(),
         last_error = left(v_state || ': ' || v_msg, 500)
   WHERE c.hand_id = p_hand_id;
  RETURN jsonb_build_object('status', 'refused', 'hand_id', p_hand_id,
                            'sqlstate', v_state, 'error', v_msg);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_bank_pending_cash_rake(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_bank_pending_cash_rake(uuid) TO service_role;
COMMENT ON FUNCTION public.fn_ca_bank_pending_cash_rake(uuid) IS
 'Banks one cash hand''s stored rake obligation with the unchanged atomic_distribute_rake call and deletes the row, in one transaction. Never waits for the union wallet row. Called by fn_project_hand_side_effects and by the outbox delete guard; status banked | absent | busy | refused.';

SELECT pg_temp.ca_rake_subst(
  'public.fn_ca_tally_balance_move()',
  'b7911a245d4bf33134a9a2f474c1f410', 'c8c24d5a2c098d3189127e9e870601a3',
  ARRAY[$otally0$    WHEN 'union_wallets' THEN
$otally0$],
  ARRAY[$ntally0$    WHEN 'cash_rake_pending' THEN
      /* A CASH HAND'S RAKE WAITS ON THE FELT IN ITS OWN ROW (20261118). The
         hand's envelope completes without crediting the shared union wallet
         row: it stores the rake here, and the hand's own projection
         continuation banks it through atomic_distribute_rake and deletes the
         row in one transaction. While the row exists the rake is still on the
         felt by the journal, exactly as the envelope carried it, so the
         envelope's transaction and the banking transaction each balance on
         their own. Scoped like the seat: the cash chip felt. */
      k_old := 'table_stack'; k_new := 'table_stack';
      IF o IS NOT NULL AND public.fn_ca_felt_counts_table((o ->> 'table_id')::uuid) THEN
        v_old := COALESCE((o ->> 'amount')::numeric, 0);
      END IF;
      IF n IS NOT NULL AND public.fn_ca_felt_counts_table((n ->> 'table_id')::uuid) THEN
        v_new := COALESCE((n ->> 'amount')::numeric, 0);
      END IF;
    WHEN 'union_wallets' THEN
$ntally0$]
);

SELECT pg_temp.ca_rake_subst(
  'public.fn_ca_supply_snapshot()',
  'de5f2ec2b0897d91d12689288723b57f', '549b78dd66f1596b0942db37cef95298',
  ARRAY[$osupply0$                                            WHERE cl.id = t.club_id AND cl.asset = 'diamonds'))))            AS posthand_transit,
$osupply0$],
  ARRAY[$nsupply0$                                            WHERE cl.id = t.club_id AND cl.asset = 'diamonds'))))
    /* A BANKED-LATER RAKE IS STILL IN TRANSIT (20261118). A cash hand's
       envelope stores its rake in cash_rake_pending and the hand's projection
       continuation banks it; until then it is on the felt by the journal and
       on no store above. fn_ca_account_balance reads the felt with this line. */
    + (SELECT COALESCE(sum(rp.amount), 0)
         FROM public.cash_rake_pending rp
        WHERE NOT EXISTS (SELECT 1 FROM tables t
                           WHERE t.id = rp.table_id
                             AND (t.tournament_id IS NOT NULL
                                  OR EXISTS (SELECT 1 FROM public.clubs cl
                                              WHERE cl.id = t.club_id AND cl.asset = 'diamonds'))))            AS posthand_transit,
$nsupply0$]
);

SELECT pg_temp.ca_rake_subst(
  'public.fn_ca_account_balance(text,uuid,uuid,text)',
  '10fb48193630ebaacff488dced27b230', 'f100348cb3e5e641017819066fa18d40',
  ARRAY[$oacct0$                               WHERE t.id = c.table_id
                                 AND (t.tournament_id IS NOT NULL
                                      OR EXISTS (SELECT 1 FROM public.clubs cl
                                                  WHERE cl.id = t.club_id AND cl.asset = 'diamonds'))));
    WHEN 'clubs.chip_treasury' THEN
$oacct0$],
  ARRAY[$nacct0$                               WHERE t.id = c.table_id
                                 AND (t.tournament_id IS NOT NULL
                                      OR EXISTS (SELECT 1 FROM public.clubs cl
                                                  WHERE cl.id = t.club_id AND cl.asset = 'diamonds'))))
        /* A BANKED-LATER RAKE IS ON THE FELT BY ITS JOURNAL TOO (20261118).
           The envelope stores a cash hand's rake in cash_rake_pending; its leg
           is written when the hand's projection continuation banks it. */
        + (SELECT COALESCE(sum(rp.amount), 0)
             FROM public.cash_rake_pending rp
            WHERE NOT EXISTS (SELECT 1 FROM public.tables t
                               WHERE t.id = rp.table_id
                                 AND (t.tournament_id IS NOT NULL
                                      OR EXISTS (SELECT 1 FROM public.clubs cl
                                                  WHERE cl.id = t.club_id AND cl.asset = 'diamonds'))));
    WHEN 'clubs.chip_treasury' THEN
$nacct0$]
);

SELECT pg_temp.ca_rake_subst(
  'public.fn_rake_bbj_invariants(integer)',
  '1c8bda472ed556ae781c2416ebb0ec94', 'd23a4053d2578ce628381f87e9c20652',
  ARRAY[$oinv0$             AND NOT EXISTS (SELECT 1 FROM hand_atomic_commits c
                              WHERE c.hand_id = hh.id
                                AND c.post_commit_payload IS NOT NULL
                                AND c.post_commit_completed_at IS NULL)
$oinv0$,
        $oinv1$                  OR jsonb_typeof(c.post_commit_payload->'bbj_contribution') = 'object')
           ORDER BY c.committed_at
           LIMIT 20) x
$oinv1$],
  ARRAY[$ninv0$             AND NOT EXISTS (SELECT 1 FROM hand_atomic_commits c
                              WHERE c.hand_id = hh.id
                                AND c.post_commit_payload IS NOT NULL
                                AND c.post_commit_completed_at IS NULL)
             -- A RAKE WAITING IN cash_rake_pending IS OWED, NOT LOST (20261118):
             -- the completed envelope stored it there and the hand's projection
             -- continuation banks it. A row older than the grace is I9.
             AND NOT EXISTS (SELECT 1 FROM cash_rake_pending rp WHERE rp.hand_id = hh.id)
$ninv0$,
        $ninv1$                  OR jsonb_typeof(c.post_commit_payload->'bbj_contribution') = 'object')
          UNION ALL
          -- 20261118: a completed envelope's rake still waiting to be banked.
          SELECT rp.hand_id, rp.table_id, rp.hand_number, rp.created_at
            FROM cash_rake_pending rp
           WHERE rp.created_at < v_grace
           ORDER BY 4
           LIMIT 20) x
$ninv1$]
);

SELECT pg_temp.ca_rake_subst(
  'public.fn_project_hand_side_effects(uuid)',
  '459a0031d391c2516633b28afdca089e', '16dea593b5f2c2b22052c8752d9aba7c',
  ARRAY[$oproj0$  /* LOCK ORDER 1b (20261019): this tournament's shared lane, waiting, before
$oproj0$],
  ARRAY[$nproj0$  /* THE HAND'S RAKE IS BANKED BY ITS OWN CONTINUATION (20261118). A cash
     hand's completed envelope stores its rake in cash_rake_pending instead of
     crediting the shared union wallet row, so a dealing table never waits on
     whoever holds that row. This pass banks it before any table or player
     lock is taken and never waits for the wallet. It ends here either way:
     the outbox row is the durable continuation, and the worker already
     defers predecessor_pending without claiming success. Statistics run on
     the next pass, so they never run while this transaction holds the wallet. */
  IF EXISTS (SELECT 1 FROM public.cash_rake_pending rp WHERE rp.hand_id = p_hand_id) THEN
    v_post_commit := public.fn_ca_bank_pending_cash_rake(p_hand_id);
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'detail', CASE WHEN v_post_commit->>'status' = 'banked'
                     THEN 'cash_rake_banked_in_this_transaction'
                     ELSE 'cash_rake_pending' END,
      'cash_rake', v_post_commit,
      'projection_applied', false,
      'hand_id', p_hand_id
    );
  END IF;

  /* LOCK ORDER 1b (20261019): this tournament's shared lane, waiting, before
$nproj0$]
);

SELECT pg_temp.ca_rake_subst(
  'public.trg_finish_hand_post_commit_obligations()',
  '66d5a81792f64fc5ec1ab33ced6a05ba', 'bcd517670b65faed6e30ac80bef50e98',
  ARRAY[$otrg0$      OLD.hand_id, v_result;
  END IF;
$otrg0$],
  ARRAY[$ntrg0$      OLD.hand_id, v_result;
  END IF;
  /* 20261118: the outbox row is the continuation that banks a cash hand's
     stored rake. It may not leave while that rake is still pending. */
  IF EXISTS (SELECT 1 FROM public.cash_rake_pending rp WHERE rp.hand_id = OLD.hand_id) THEN
    v_result := public.fn_ca_bank_pending_cash_rake(OLD.hand_id);
    IF v_result->>'status' IS DISTINCT FROM 'banked' THEN
      RAISE EXCEPTION 'hand rake remains pending for %: %', OLD.hand_id, v_result;
    END IF;
  END IF;
$ntrg0$]
);

SELECT public.fn_ca_declare_guard_redefinition('fn_ca_tally_balance_move',
  'migration 20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall');
SELECT public.fn_ca_declare_guard_redefinition('fn_ca_supply_snapshot',
  'migration 20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall');

DO $m$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cash_rake_pending) THEN
    RAISE EXCEPTION 'cash_rake_pending is not empty at install';
  END IF;
  IF (SELECT count(*) FROM pg_trigger tg
       WHERE tg.tgrelid = 'public.cash_rake_pending'::regclass AND NOT tg.tgisinternal
         AND tg.tgenabled <> 'D') <> 6 THEN
    RAISE EXCEPTION 'cash_rake_pending is not covered whole';
  END IF;
  IF has_table_privilege('anon', 'public.cash_rake_pending', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cash_rake_pending', 'SELECT')
     OR has_function_privilege('authenticated', 'public.fn_ca_bank_pending_cash_rake(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_bank_pending_cash_rake(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a browser role can reach the stored rake';
  END IF;
END $m$;

COMMIT;
