-- 20261107140005_the_house_pays_six_bounty_only_final_two_runners_up_their_own_heads
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 14:00:05 UTC.
--
-- THE HOUSE PAYS THE SIX BOUNTY ONLY FINAL TWO RUNNERS UP THEIR OWN HEADS
--
-- OWNER RULE (Dan, 2026-11-05/06, carried by 20261106010426): a bounty only
-- PKO "is over with 2 players left" and "the top two guys that are left should
-- keep the bounties on both of their heads". Nobody is paid for a finishing
-- position; only heads pay.
--
-- THE DEFECT. 20261106010426 installed fn_ca_bounty_only_pko_final_two, the one
-- authority that closes such an event at two, but no engine release calls it
-- yet (the caller lives on agent/claude-blockers/fix/bounty-only-pko-really-
-- ends-at-two, commits 6248731e8a / d64b6509fb / 9d38dfb2b7, unmerged). So every
-- bounty only PKO so far played the heads up hand out. That hand's knockout put
-- half of the runner up's head into the champion's wallet and half onto the
-- champion's head, and fn_finalize_bounty_pool then paid the champion the pool
-- residual, which was his own head PLUS that half. One player took both final
-- heads; the runner up was paid nothing at all for the head he was entitled to
-- keep. public.ca_bounty_only_final_two holds zero rows, which is the proof that
-- no event was ever closed at two.
--
-- WHAT IS OWED, RE-DERIVED FROM THE EVENTS' OWN ROWS (read-only, 2026-11-07).
-- Six COMPLETED events match the authority's own format test (is_pko, not
-- mystery, buy_in <= 0, guaranteed_prize <= 0, prize_pool <= 0, bounty_pool > 0)
-- and all six are Midway Union promo Free Buys hosted by the union itself. For
-- each, the LAST public.tournament_bounties row of the event eliminated the
-- player who finished 2nd and was collected by the player who finished 1st, and
-- its bounty_amount IS the runner up's head at the moment the field reached two.
-- That head is exactly what fn_ca_bounty_only_pko_final_two would have paid him
-- as a bounty_residual, so it is what is owed:
--
--   event      name                       date        runner up (head owed)
--   39b5fa14   Midday Free Buy (NLH)      2026-11-05  prairieholloway   34.56
--   74ba8130   Afternoon Free Buy (NLH)   2026-11-05  wraith            18.77
--   1d115ff4   Prime Time Free Buy (NLH)  2026-11-06  coltblackwood     16.53
--   dce71e3f   Midnight Free Buy (NLH)    2026-11-06  nashblackwood      2.63
--   b3ae52ef   Midday Free Buy (NLH)      2026-11-06  sabre             26.40
--   c1b3fa5a   Midnight Free Buy (NLH)    2026-11-07  deepstack          6.98
--                                                            total     105.87
--
-- THE AUTHORITY'S OWN PRECONDITION IS SATISFIED BY EACH EVENT. It refuses unless
-- the two live heads are the whole open pool. Reading H1 (the champion's own
-- head) as his bounty_residual minus the half the final knockout added to it,
-- and the open pool as bounty_pool minus the cash halves paid before that
-- knockout, H1 + H2 = the open pool to the chip in all six:
--
--   39b5fa14  H1 22.51 + H2 34.56 =  57.07  open pool  57.07
--   74ba8130  H1 29.93 + H2 18.77 =  48.70  open pool  48.70
--   1d115ff4  H1 37.58 + H2 16.53 =  54.11  open pool  54.11
--   dce71e3f  H1 46.01 + H2  2.63 =  48.64  open pool  48.64
--   b3ae52ef  H1  2.50 + H2 26.40 =  28.90  open pool  28.90
--   c1b3fa5a  H1 36.54 + H2  6.98 =  43.52  open pool  43.52
--
-- NOTHING IS CLAWED BACK AND NO SEALED BOOK IS REWRITTEN. Each event's bounty
-- pool is paid out exactly (bounty_pool_paid = bounty_pool, and the players'
-- bounty_winnings sum to bounty_pool) and terminally closed. The champions keep
-- the extra head our defect paid them (CLAUDE.md 10.9 rule 3, the same reading
-- as 20260926085132). So this is the HOUSE paying outside those books: Midway
-- Union, which hosted and funded all six promo events, pays 105.87 from its bank.
--
-- ALL SIX PAYEES ARE HORSE FLEET PLAYERS. Dan, 2026-11-06: "HUMANS AND HORSES
-- NEED TO BE TREATED THE SAME! EVENTS OR ANYTHING ELSE DO NOT EVER CHANGE
-- BECAUSE A HUMAN DIDN'T PLAY!" (and CLAUDE.md 10.5). A horse is paid exactly as
-- a human is, into its one assigned club wallet.
--
-- NO ONE IS PAID TWICE. No ca_manual_adjustments row exists for any of the six
-- payees; no settlement credit, journal leg or wallet receipt for any of these
-- amounts exists. The only make-good already installed against any of these
-- events is 20261106213809, which paid Danimal (9b027798) 6.75 for the Afternoon
-- Free Buy's wrong-format guarantee: a different player, a different defect, and
-- it is left exactly as it is.
--
-- THE DOOR is the established audited house settlement door of 20261004151352 /
-- 20261026172816 / 20261106213809, one credit per event: fn_ca_adjustment_under_10_9
-- writes the approved paragraph, fn_ca_declare_ledger names the union bank and
-- skips the union_wallets trigger so ONE journal leg is written, the bank is
-- debited refusing if it cannot cover, fn_credit_and_log credits the player
-- through the idempotent wallet door under
-- bounty-only-final-two-make-good:<event>:<user>, and the adjustment is settled.
--
-- IDEMPOTENT. A key that is already present must carry the exact settled
-- receipts, and then that row is skipped and pays nothing; a key present with
-- anything else aborts the whole migration rather than guessing. Any drift in
-- the incident witness aborts and moves nothing.
--
-- THE DETECTION WATCH STAYS OPEN. fn_ca_bounty_only_final_two_watch
-- (20261106032337) raised closed_without_final_two on b3ae52ef. That breach is
-- about the ENGINE not closing at two and is owned by the engine fix, not by
-- this money. It is deliberately left unresolved here.
--
-- PROOF: scripts/ci/test-bounty-only-final-two-make-good.py runs these exact
-- bytes over a private PostgreSQL. Probe against a live database with
-- SET LOCAL ca.final_two_make_good_probe = 'on'; the closing exception MUST
-- abort the transaction.
--
-- @live-proof: (SELECT count(*) FROM public.ca_manual_adjustments WHERE decision_note = 'migration 20261107140005_the_house_pays_six_bounty_only_final_two_runners_up_their_own_heads' AND status = 'settled') = 6 AND (SELECT sum(amount) FROM public.ca_manual_adjustments WHERE decision_note = 'migration 20261107140005_the_house_pays_six_bounty_only_final_two_runners_up_their_own_heads' AND status = 'settled') = 105.87 AND (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key LIKE 'bounty-only-final-two-make-good:%') = 6

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $settle$
DECLARE
  c_mig    constant text := '20261107140005_the_house_pays_six_bounty_only_final_two_runners_up_their_own_heads';
  c_union  constant uuid := 'fade0000-0000-0000-0000-000000000001';
  c_actor  constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  c_total  constant numeric := 105.87;
  c_desc   constant text := 'House Make-Good: Own Bounty Head Kept At The Final Two';
  v_probe  boolean := COALESCE(current_setting('ca.final_two_make_good_probe', true), '') = 'on';
  r record;
  v_key text; v_adj uuid; v_leg uuid; v_tx uuid; v_reason text;
  v_bank_before numeric; v_bank numeric;
  v_wallet_before numeric; v_wallet_after numeric;
  v_paid numeric := 0; v_n integer := 0; v_skipped integer := 0;
  v_report jsonb := '[]'::jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(c_mig, 0)) THEN
    RAISE EXCEPTION 'the final two make-good is already owned by another transaction';
  END IF;

  CREATE TEMP TABLE zz_final_two_owed (
    event_id uuid, event_name text, event_day date, pool numeric,
    user_id uuid, username text, head numeric,
    winner_id uuid, winner_name text, winner_head numeric, winner_residual numeric,
    final_ko_id uuid, home_club uuid, club_name text) ON COMMIT DROP;
  INSERT INTO zz_final_two_owed VALUES
   ('39b5fa14-2332-472f-b0df-cde4edcdf62b','Midday Free Buy (NLH)','2026-11-05',323.00,
    '341d4951-c3cf-4446-ac75-6f1448a9bf99','prairieholloway',34.56,
    'e0f03a88-afc3-448f-835a-e8e323d09b57','quinnnightingale',22.51,39.79,
    '006eb8c9-0440-45ed-95f8-de73e212cf38','2a1132b9-5ba2-42e6-9f01-30a7fcffebe3','Deep Stack Society'),
   ('74ba8130-3ec5-48c2-b94b-409b7fb14a6b','Afternoon Free Buy (NLH)','2026-11-05',403.00,
    '0ea03648-b12d-4ae7-ba65-aeaff4fcea34','wraith',18.77,
    '01809c11-71bc-42a6-ad86-2130737d8cf9','fortwayneval',29.93,39.32,
    'aa0fe537-4063-447a-a962-b3409574789f','a0000000-0000-0000-0000-000000000001','The Felt Society'),
   ('1d115ff4-d0d5-48cc-8a3e-03ae3348d442','Prime Time Free Buy (NLH)','2026-11-06',395.00,
    '8bdb54a1-d614-4932-84fa-795dd4728828','coltblackwood',16.53,
    '23ffb778-7059-45b8-a6e9-ce65514d1619','havoc',37.58,45.85,
    '85f2cb37-9984-451e-a032-dc88bfe8fef3','2a1132b9-5ba2-42e6-9f01-30a7fcffebe3','Deep Stack Society'),
   ('dce71e3f-4f77-48e7-94db-17d909bc2664','Midnight Free Buy (NLH)','2026-11-06',329.00,
    '1fec4774-2523-4f2b-934b-db23a787f95f','nashblackwood',2.63,
    'f69498c4-2af5-49ca-b1de-d9fa0715d57f','tundraashcroft',46.01,47.33,
    'e2986b0d-d420-4732-b3b9-1055dd8f5610','2a1132b9-5ba2-42e6-9f01-30a7fcffebe3','Deep Stack Society'),
   ('b3ae52ef-097c-4dcd-a438-d46ce010c021','Midday Free Buy (NLH)','2026-11-06',314.00,
    '86468a23-14cb-4602-92f7-7e270197fc3c','sabre',26.40,
    'a0b37838-f752-469d-b41a-b999cd77b1ea','chipsinclair',2.50,15.70,
    '3a345f9b-2f35-4e97-a7e1-b3d9208032a5','a0000000-0000-0000-0000-000000000001','The Felt Society'),
   ('c1b3fa5a-85f6-4aea-8d4d-c76fc545a984','Midnight Free Buy (NLH)','2026-11-07',327.00,
    '9b918b56-08d8-4a06-b8a0-de2bf4022303','deepstack',6.98,
    'bbbe8009-75ac-4c8a-a483-9bf6b60fdf53','brian ruiz',36.54,40.03,
    'a3f35659-3b4c-45c1-8814-00eb76c08052','a0000000-0000-0000-0000-000000000001','The Felt Society');

  IF (SELECT count(*) FROM zz_final_two_owed) <> 6
     OR (SELECT round(sum(head), 2) FROM zz_final_two_owed) <> c_total THEN
    RAISE EXCEPTION 'the final two make-good no longer totals % across six events', c_total;
  END IF;

  ---------------------------------------------------------------------------
  -- 0. PRE-IMAGE. Every event still says exactly what this was written against.
  ---------------------------------------------------------------------------
  FOR r IN SELECT * FROM zz_final_two_owed ORDER BY event_day, event_id LOOP
    IF NOT EXISTS (SELECT 1 FROM public.tournaments t
                    WHERE t.id = r.event_id AND upper(t.status) = 'COMPLETED'
                      AND COALESCE(t.is_pko, false) AND NOT COALESCE(t.is_mystery_bounty, false)
                      AND COALESCE(t.buy_in_amount, 0) <= 0 AND COALESCE(t.guaranteed_prize, 0) <= 0
                      AND COALESCE(t.prize_pool, 0) <= 0 AND t.bounty_pool = r.pool
                      AND t.bounty_pool_paid = r.pool AND t.union_id = c_union) THEN
      RAISE EXCEPTION 'pre-image: event % is no longer the completed bounty only PKO this was read from', r.event_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.ca_bounty_only_final_two c WHERE c.tournament_id = r.event_id) THEN
      RAISE EXCEPTION 'pre-image: event % was closed at two after all; the authority already paid its runner up', r.event_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.tournament_payouts p WHERE p.tournament_id = r.event_id) THEN
      RAISE EXCEPTION 'pre-image: event % now carries a place ladder; a bounty only PKO pays no place', r.event_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tournament_players tp
                    WHERE tp.tournament_id = r.event_id AND tp.user_id = r.user_id
                      AND tp.position = 2 AND tp.status = 'eliminated'
                      AND COALESCE(tp.current_bounty, 0) = 0 AND COALESCE(tp.prize, 0) = 0) THEN
      RAISE EXCEPTION 'pre-image: % is no longer the eliminated second place of %', r.user_id, r.event_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tournament_players tp
                    WHERE tp.tournament_id = r.event_id AND tp.user_id = r.winner_id AND tp.position = 1) THEN
      RAISE EXCEPTION 'pre-image: % is no longer the champion of %', r.winner_id, r.event_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tournament_bounties b
                    WHERE b.id = r.final_ko_id AND b.tournament_id = r.event_id
                      AND b.eliminated_player_id = r.user_id AND b.collector_player_id = r.winner_id
                      AND b.bounty_amount = r.head) THEN
      RAISE EXCEPTION 'pre-image: the final knockout % of % no longer carries head % for %',
        r.final_ko_id, r.event_id, r.head, r.user_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.tournament_bounties b, public.tournament_bounties f
                WHERE f.id = r.final_ko_id AND b.tournament_id = r.event_id
                  AND (b.created_at, b.id) > (f.created_at, f.id)) THEN
      RAISE EXCEPTION 'pre-image: knockout % is no longer the last knockout of %', r.final_ko_id, r.event_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tournament_obligations o
                    WHERE o.tournament_id = r.event_id AND o.kind = 'bounty_residual'
                      AND o.user_id = r.winner_id AND o.amount_paid = r.winner_residual) THEN
      RAISE EXCEPTION 'pre-image: the champion residual of % is no longer %', r.event_id, r.winner_residual;
    END IF;
    IF EXISTS (SELECT 1 FROM public.tournament_obligations o
                WHERE o.tournament_id = r.event_id AND o.kind = 'bounty_residual' AND o.user_id = r.user_id) THEN
      RAISE EXCEPTION 'pre-image: % already holds a bounty residual in %', r.user_id, r.event_id;
    END IF;
    IF round(r.winner_head + r.head, 2) <> round(r.pool - ((SELECT sum(o.amount_paid) FROM public.tournament_obligations o
            WHERE o.tournament_id = r.event_id AND o.kind = 'bounty') - (r.head - (r.winner_residual - r.winner_head))), 2) THEN
      RAISE EXCEPTION 'pre-image: the two final heads of % are no longer the whole open bounty pool', r.event_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse IS TRUE) THEN
      RAISE EXCEPTION 'pre-image: % is no longer a horse; a human payee needs its own reading', r.user_id;
    END IF;
    IF public.fn_player_home_club(r.user_id, NULL) IS DISTINCT FROM r.home_club
       OR NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = r.home_club AND c.union_id = c_union) THEN
      RAISE EXCEPTION 'pre-image: % no longer banks in % inside Midway Union', r.user_id, r.home_club;
    END IF;
    IF (SELECT chip_balance FROM public.club_members cm
         WHERE cm.user_id = r.user_id AND cm.club_id = r.home_club) IS NULL THEN
      RAISE EXCEPTION 'pre-image: % holds no % wallet to credit', r.user_id, r.club_name;
    END IF;
    IF EXISTS (SELECT 1 FROM public.ca_manual_adjustments a
                WHERE a.target_id = r.user_id AND a.tournament_id = r.event_id
                  AND COALESCE(a.decision_note, '') <> 'migration ' || c_mig) THEN
      RAISE EXCEPTION 'pre-image: another adjustment for % in % needs inspection before payment', r.user_id, r.event_id;
    END IF;
  END LOOP;

  SELECT chip_balance INTO v_bank_before FROM public.union_wallets
   WHERE union_id = c_union FOR UPDATE;
  IF v_bank_before IS NULL THEN
    RAISE EXCEPTION 'the Midway Union bank is missing';
  END IF;
  IF v_bank_before < c_total THEN
    RAISE EXCEPTION 'the Midway Union bank holds % and cannot fund %', v_bank_before, c_total;
  END IF;

  ---------------------------------------------------------------------------
  -- 1. ONE CREDIT PER EVENT, THROUGH THE AUDITED HOUSE SETTLEMENT DOOR.
  ---------------------------------------------------------------------------
  FOR r IN SELECT * FROM zz_final_two_owed ORDER BY event_day, event_id LOOP
    v_key := 'bounty-only-final-two-make-good:' || r.event_id::text || ':' || r.user_id::text;

    IF EXISTS (SELECT 1 FROM public.wallet_credit_idempotency k WHERE k.key = v_key) THEN
      IF NOT EXISTS (SELECT 1 FROM public.wallet_credit_idempotency k
                      WHERE k.key = v_key AND k.user_id = r.user_id AND k.amount = r.head)
         OR (SELECT count(*) FROM public.ca_manual_adjustments a
              WHERE a.tournament_id = r.event_id AND a.target_id = r.user_id
                AND a.decision_note = 'migration ' || c_mig
                AND a.amount = r.head AND a.status = 'settled') <> 1
         OR (SELECT count(*) FROM public.chip_ledger l
              WHERE l.idempotency_key = v_key AND l.amount = r.head
                AND l.from_type = 'union_bank' AND l.from_entity_id = c_union
                AND l.to_type = 'player_wallet' AND l.to_entity_id = r.user_id
                AND l.club_id = r.home_club AND l.tournament_id IS NULL
                AND l.category = 'settlement') <> 1 THEN
        RAISE EXCEPTION 'the existing credit under % lacks the exact settled receipts', v_key;
      END IF;
      v_skipped := v_skipped + 1;
      v_report := v_report || jsonb_build_object('event', r.event_id, 'user', r.username,
                    'amount', r.head, 'state', 'already_paid');
      CONTINUE;
    END IF;

    v_reason := format(
      '%s (%s) finished 2nd of %s in %s (%s) on %s, a bounty only promo Free Buy PKO in Midway Union. '
      || 'Under the owner rule of 2026-11-05/06 that event was over with two players left and both survivors keep the bounty on their own head: '
      || '%s was entitled to keep the %s on his own head, which fn_ca_bounty_only_pko_final_two (20261106010426) would have paid him as a bounty_residual. '
      || 'No engine release calls that authority yet, so the heads up hand was played out instead: the final knockout %s moved %s of his head into the champion %s wallet and %s onto the champion head, '
      || 'and the pool residual of %s then paid the champion his own %s head plus that half. The runner up received nothing for his head. '
      || 'Reading the event own rows, the two final heads were the whole open bounty pool (%s + %s), so %s is exactly what the close would have paid. '
      || 'Midway Union, which hosted and funded this promo event, pays it from its bank outside the event sealed books; the champion keeps the extra head our defect paid him and no other player or record is changed. '
      || 'The payee is a HORSE fleet player, paid exactly as a human is (owner rule 2026-11-06, CLAUDE.md 10.5), into %s, the one club it banks in. Migration %s carries this.',
      r.username, r.user_id, (SELECT count(*) FROM public.tournament_players tp WHERE tp.tournament_id = r.event_id),
      r.event_name, r.event_id, r.event_day,
      r.username, r.head, r.final_ko_id, round(r.head - (r.winner_residual - r.winner_head), 2),
      r.winner_name, round(r.winner_residual - r.winner_head, 2), r.winner_residual, r.winner_head,
      r.winner_head, r.head, r.head, r.club_name, c_mig);

    v_adj := public.fn_ca_adjustment_under_10_9(r.event_id, r.user_id, r.head, v_reason, c_mig,
               'Claude Opus 5 under CLAUDE.md 10.9: bounty only PKO final two own head');

    SELECT chip_balance INTO v_wallet_before FROM public.club_members
     WHERE user_id = r.user_id AND club_id = r.home_club FOR NO KEY UPDATE;
    IF v_wallet_before IS NULL THEN
      RAISE EXCEPTION 'the % wallet of % vanished mid-settlement', r.club_name, r.user_id;
    END IF;

    PERFORM public.fn_ca_declare_ledger('settlement', 'union_bank', c_union, NULL, v_key, ARRAY['union_wallets']);
    PERFORM set_config('app.ledger_correlation', v_adj::text, true);
    UPDATE public.union_wallets SET chip_balance = chip_balance - r.head, updated_at = now()
     WHERE union_id = c_union AND chip_balance >= r.head;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'the Midway Union bank refused % for %', r.head, r.user_id;
    END IF;
    IF public.fn_credit_and_log(r.user_id, r.head, v_key, 'settlement', c_desc, NULL) IS NOT TRUE THEN
      RAISE EXCEPTION 'the credit door did not pay % to %', r.head, r.user_id;
    END IF;
    PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
    PERFORM set_config('app.ledger_counterparty', '', true);
    PERFORM set_config('app.ledger_counterparty_entity', '', true);
    PERFORM set_config('app.ledger_category', '', true);
    PERFORM set_config('app.ledger_idempotency_key', '', true);
    PERFORM set_config('app.ledger_correlation', '', true);

    SELECT chip_balance INTO v_wallet_after FROM public.club_members
     WHERE user_id = r.user_id AND club_id = r.home_club;
    IF round(v_wallet_after - v_wallet_before, 2) <> r.head THEN
      RAISE EXCEPTION 'the % wallet moved % where % was paid', r.username, v_wallet_after - v_wallet_before, r.head;
    END IF;
    IF (SELECT count(*) FROM public.chip_ledger l WHERE l.idempotency_key = v_key) <> 1 THEN
      RAISE EXCEPTION 'the credit to % wrote more than one journal leg', r.username;
    END IF;
    SELECT l.id INTO STRICT v_leg FROM public.chip_ledger l
     WHERE l.idempotency_key = v_key AND l.amount = r.head
       AND l.from_type = 'union_bank' AND l.from_entity_id = c_union
       AND l.to_type = 'player_wallet' AND l.to_entity_id = r.user_id
       AND l.club_id = r.home_club AND l.tournament_id IS NULL AND l.category = 'settlement';
    SELECT w.id INTO STRICT v_tx FROM public.wallet_transactions w
     WHERE w.user_id = r.user_id AND w.created_at = now() AND w.amount = r.head
       AND w.type = 'credit' AND w.category = 'settlement' AND w.description = c_desc
       AND w.related_entity_id IS NULL;

    UPDATE public.ca_manual_adjustments SET status = 'settled' WHERE id = v_adj AND status = 'approved';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'adjustment % did not settle', v_adj;
    END IF;

    v_paid := round(v_paid + r.head, 2);
    v_n := v_n + 1;
    v_report := v_report || jsonb_build_object(
      'event', r.event_id, 'event_name', r.event_name, 'event_day', r.event_day,
      'user', r.username, 'user_id', r.user_id, 'amount', r.head,
      'club_id', r.home_club, 'wallet_before', v_wallet_before, 'wallet_after', v_wallet_after,
      'adjustment_id', v_adj, 'ledger_id', v_leg, 'wallet_transaction_id', v_tx,
      'idempotency_key', v_key, 'state', 'paid');
  END LOOP;

  ---------------------------------------------------------------------------
  -- 2. POST-IMAGE. Conserved to the chip.
  ---------------------------------------------------------------------------
  SELECT chip_balance INTO v_bank FROM public.union_wallets WHERE union_id = c_union;
  IF round(v_bank_before - v_bank, 2) <> v_paid THEN
    RAISE EXCEPTION 'post-image: the union bank moved % where % was paid', v_bank_before - v_bank, v_paid;
  END IF;
  IF v_n + v_skipped <> 6 THEN
    RAISE EXCEPTION 'post-image: % paid and % skipped is not the six events', v_n, v_skipped;
  END IF;
  IF (SELECT count(*) FROM public.chip_ledger l
       WHERE l.idempotency_key LIKE 'bounty-only-final-two-make-good:%') <> 6
     OR (SELECT round(sum(l.amount), 2) FROM public.chip_ledger l
       WHERE l.idempotency_key LIKE 'bounty-only-final-two-make-good:%') <> c_total THEN
    RAISE EXCEPTION 'post-image: the journal does not carry exactly six legs totalling %', c_total;
  END IF;
  IF (SELECT count(*) FROM public.ca_manual_adjustments a
       WHERE a.decision_note = 'migration ' || c_mig AND a.status = 'settled') <> 6
     OR (SELECT round(sum(a.amount), 2) FROM public.ca_manual_adjustments a
       WHERE a.decision_note = 'migration ' || c_mig AND a.status = 'settled') <> c_total THEN
    RAISE EXCEPTION 'post-image: the six settled adjustments do not total %', c_total;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournaments t JOIN zz_final_two_owed z ON z.event_id = t.id
              WHERE t.bounty_pool_paid <> z.pool) THEN
    RAISE EXCEPTION 'post-image: a sealed event bounty pool was rewritten';
  END IF;

  IF v_n > 0 THEN
    INSERT INTO public.financial_alerts(severity, source, message, context, resolved, resolved_at, resolved_by, resolution)
    VALUES ('warning', 'bounty_only_final_two_make_good',
      'Six Bounty Only PKO Runners Up Settled By The House For Their Own Heads',
      jsonb_build_object('migration', c_mig, 'union_id', c_union, 'paid', v_paid,
        'credits', v_n, 'already_paid', v_skipped,
        'bank_before', v_bank_before, 'bank_after', v_bank,
        'basis', 'own_head_at_the_final_two_read_from_the_last_knockout_of_each_event',
        'report', v_report), true, now(), c_actor,
      format('Paid. The owner rule of 2026-11-05/06 ends a bounty only PKO at two players with both survivors keeping the bounty on their own head. '
        || 'No engine release calls fn_ca_bounty_only_pko_final_two yet, so six completed Midway Union promo Free Buys played the heads up hand out and the champion took both final heads. '
        || 'Midway Union has now paid each runner up the head he was entitled to keep, read from the last knockout of his own event: %s chips in %s credits (%s already paid on an earlier run). '
        || 'Nothing was clawed back, no sealed event book was rewritten, and the champions keep the extra head the defect paid them. '
        || 'The detection breach closed_without_final_two raised by fn_ca_bounty_only_final_two_watch is owned by the engine fix and is deliberately left open. Migration %s.',
        v_paid, v_n, v_skipped, c_mig));
  END IF;

  RAISE NOTICE 'final two make-good: bank % -> %, paid % in % credits (% skipped), report %',
    v_bank_before, v_bank, v_paid, v_n, v_skipped, v_report;
  IF v_probe THEN
    RAISE EXCEPTION 'PROBE OK (rolled back): bank % -> %, paid % in % credits (% skipped), report %',
      v_bank_before, v_bank, v_paid, v_n, v_skipped, v_report;
  END IF;
END
$settle$;

COMMIT;
