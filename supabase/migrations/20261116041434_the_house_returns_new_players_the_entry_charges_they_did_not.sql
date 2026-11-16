-- 20261116041434_the_house_returns_new_players_the_entry_charges_they_did_not
--
-- Version reserved by scripts/new-migration.mjs on 2026-11-16 04:14:34 UTC.
--
-- OWNER AUTHORIZATION (Dan, in chat, 2026-11-15 21:39 America/Chicago, verbatim):
--   "I authorize restitution of verified overcharges through the maintained
--    audited correction process. Verify each recipient, exact amount, ledger
--    treatment and whether an adjustment already exists before execution.
--    Preserve pot, rake and settlement conservation; do not simply mint chips
--    or rewrite settled hand history."
--
-- THE HOUSE RETURNS NEW PLAYERS THE ENTRY CHARGES THEY DID NOT OWE
--
-- The published rule (Dan 2026-08-26, ServerTableEngineSeating.postBBToEnter):
-- a new cash seat waits for the big blind or posts ONE live big blind. A dead
-- small blind plus a live big blind is owed only by a player who was playing
-- at the table, sat out and missed blinds.
--
-- Between 2026-11-07 19:01 UTC and 2026-11-16 03:12 UTC the engine billed 24
-- first hands of brand-new human seats more than that (player report: Burls,
-- hand 59634000, "How do we lose 5.50 the pre flop raise was 4"):
--
--   23 hands  dead small blind + live big blind + a SECOND big blind that was
--             not counted toward the player's bet (2.5 BB out, 1 BB live).
--             The seat was in both postingBBToEnter and returningFromSitout.
--    1 hand   dead small blind + live big blind (56509493): the missed-blind
--             charge alone, on a seat that had never been dealt a hand.
--
-- Every one is a fresh buy-in occupancy (cash_hand_participant_manifests:
-- is_horse false, no funding_lineage moves, seat_joined_at 14 s to 4 min
-- before the hand), and the hand is the first that occupancy was dealt. All
-- are Midway Union Classic or Madness cash tables; none is a Lightning hand
-- (LightningHandHost bills bbOnlyPosts only and cannot produce the overlap).
-- Which buttons each player tapped was not recorded; the overlapping charge
-- is read from the settled hand, not inferred. The engine correction is pull
-- request "a new player's entry post is billed once"
-- (docs/changelog/2026-11-15-an-entry-post-is-one-obligation.md).
--
-- THE AUDITED POPULATION. Every cash buy-in receipt from 2026-09-17 (the first
-- cash_participant_funding_receipts row) to 2026-11-16 04:00 UTC was followed
-- to the first retained hand its occupancy was dealt, and every completed seat
-- move from 2026-11-01. Nothing before 2026-11-07 19:01 UTC carries either
-- charge shape (904 correct one-big-blind entry posts before that date), and
-- no moved player does. Horse-only hands older than the retention window are
-- not in hand_history and could not be read.
--
-- WHAT IS OWED, case by case.
--
--   The player did not win the pot (16 hands): everything billed beyond one
--   big blind went into a pot somebody else took. Owed: posted live + posted
--   dead - one big blind.
--
--   The player won the whole pot (8 hands): the second big blind was returned
--   to them as uncalled (each hand's own `return` action exceeds the bet it
--   refunds by exactly one big blind) and the dead small blind came back in
--   the pot they won. What they lost is the rake taken on that dead small
--   blind, where the rake was below its cap and a flop was dealt:
--     57630371 Bluffinbreed  rake 0.30 on 3.00, 0.25 on 2.50   owed 0.05
--     58316803 Probyourmom   rake 2.80 on 28.00, 2.70 on 27.00 owed 0.10
--     59390496 Whytegold502  rake 0.95 on 9.50, 0.93 on 9.25   owed 0.02
--   and nothing where the rake was already capped or no flop was dealt:
--     58222391 MichaelJordan (no flop, no rake), 58246229 WooWoo (cap 5.00),
--     58710591 Twin2983 (cap 5.00), 58879713 BarryWhite (cap 1.25),
--     59247360 Bud33 (cap 5.00). These five are reconciled and paid nothing.
--
-- NO ONE IS PAID TWICE. Read 2026-11-16 03:55 UTC: no ca_manual_adjustments
-- row names any of these hands for its player and no
-- wallet_credit_idempotency key names any of these hand ids. Each key below
-- names the hand and the player, and this file refuses to run if any exists.
--
-- NOTHING IS CLAWED BACK AND NO HAND IS REWRITTEN. Each pot's winner keeps it,
-- the rake and jackpot drop stand, and every hand_history row is compared
-- before and after. Midway Union hosts every one of these tables
-- (tables.club_id is the union) and pays from its bank, as in
-- 20261109212039_the_house_returns_mongo_the_blind_he_posted_without_seeing_h.
--
-- THE DOOR is the one that migration used, once per case: a 10.9 manual
-- adjustment, a declared union bank debit, fn_credit_and_log under an
-- idempotency key, one chip_ledger leg, the adjustment settled, a resolved
-- financial_alerts row.
--
-- PROBE against the live database in ONE call with
--   SET LOCAL ca.entry_post_make_good_probe = 'on';
-- the closing exception MUST abort the transaction (CLAUDE.md 11.5).
--
-- @live-proof: (SELECT count(*) FROM public.ca_manual_adjustments WHERE decision_note = 'migration 20261116041434_the_house_returns_new_players_the_entry_charges_they_did_not' AND status = 'settled') = 19 AND (SELECT sum(amount) FROM public.ca_manual_adjustments WHERE decision_note = 'migration 20261116041434_the_house_returns_new_players_the_entry_charges_they_did_not' AND status = 'settled') = 24.92 AND (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key LIKE 'entry-post-overcharge-make-good:%') = 19

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $settle$
DECLARE
  c_mig    constant text := '20261116041434_the_house_returns_new_players_the_entry_charges_they_did_not';
  c_club   constant uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  c_union  constant uuid := 'fade0000-0000-0000-0000-000000000001';
  c_actor  constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  c_desc   constant text := 'House Make-Good: Entry Charge Not Owed By A New Seat';
  c_total  constant numeric := 24.92;
  c_count  constant integer := 19;
  c_cases  constant jsonb := $cases$[
    {"hand_number": 56509493, "hand_id": "6bb031bb-a03d-471e-a920-dc8f46edf7af", "user_id": "0017e9b7-beae-4474-b0e0-c71600d1b443", "username": "CMA", "bb": 1.00, "live": 1.00, "dead": 0.50, "basis": "lost", "amount": 0.50},
    {"hand_number": 56615162, "hand_id": "b6c32aa1-7254-49b6-8814-dd47db45ea64", "user_id": "e5abee6e-abe2-4400-9005-b5c81577155d", "username": "Rooster", "bb": 2.00, "live": 4.00, "dead": 1.00, "basis": "lost", "amount": 3.00},
    {"hand_number": 57126786, "hand_id": "3760cb0b-1b9c-4ac8-8a31-73c9402a5614", "user_id": "0a73706f-54bb-40c0-9f50-9b102f78aef9", "username": "Luvtasuck", "bb": 0.50, "live": 1.00, "dead": 0.25, "basis": "lost", "amount": 0.75},
    {"hand_number": 57279189, "hand_id": "4e96d6c9-cd3a-4d78-b091-d900e10b73fe", "user_id": "9b027798-9532-403f-a5c1-15554ce2959c", "username": "Danimal", "bb": 0.50, "live": 1.00, "dead": 0.25, "basis": "lost", "amount": 0.75},
    {"hand_number": 57630371, "hand_id": "6b6fb41a-8971-4e48-949b-7ea12246f3a6", "user_id": "90f532d5-6286-4181-9a2b-f8b441a05bd6", "username": "Bluffinbreed", "bb": 1.00, "live": 2.00, "dead": 0.50, "basis": "won", "amount": 0.05},
    {"hand_number": 58203391, "hand_id": "e2529c21-47f5-490d-a1f7-0ed76ea39b60", "user_id": "16c2d21e-393e-456f-8072-cabd7ee371d6", "username": "Donkey", "bb": 0.25, "live": 0.50, "dead": 0.10, "basis": "lost", "amount": 0.35},
    {"hand_number": 58306954, "hand_id": "8a644033-2e2a-4ae9-a419-11be577aed75", "user_id": "7e616640-58dd-4d8d-a18e-2f37f057bcd9", "username": "Burls", "bb": 2.00, "live": 4.00, "dead": 1.00, "basis": "lost", "amount": 3.00},
    {"hand_number": 58316803, "hand_id": "d75f31b9-c527-4c27-a1e1-bc2305025fe4", "user_id": "eed278a8-3ca2-4e2d-a196-0a0cd9e74f90", "username": "Probyourmom", "bb": 2.00, "live": 4.00, "dead": 1.00, "basis": "won", "amount": 0.10},
    {"hand_number": 58516060, "hand_id": "be87a580-b876-4b2e-9406-0cc58a7564aa", "user_id": "eed278a8-3ca2-4e2d-a196-0a0cd9e74f90", "username": "Probyourmom", "bb": 2.00, "live": 4.00, "dead": 1.00, "basis": "lost", "amount": 3.00},
    {"hand_number": 58692649, "hand_id": "1905581f-debf-4052-9c3f-ce52c4b188c2", "user_id": "74dbee95-f41f-4c99-b208-f4228c43f727", "username": "BarryWhite", "bb": 0.25, "live": 0.50, "dead": 0.10, "basis": "lost", "amount": 0.35},
    {"hand_number": 58711319, "hand_id": "e6873d8a-4514-4f07-acfa-af888f8b24bc", "user_id": "d2914627-745d-4e55-b081-a105f255b54a", "username": "FishyFish", "bb": 2.00, "live": 4.00, "dead": 1.00, "basis": "lost", "amount": 3.00},
    {"hand_number": 58808950, "hand_id": "71d6fc9b-9e2e-47cc-a6c7-2b3b7cd37b5f", "user_id": "7e616640-58dd-4d8d-a18e-2f37f057bcd9", "username": "Burls", "bb": 2.00, "live": 4.00, "dead": 1.00, "basis": "lost", "amount": 3.00},
    {"hand_number": 58909662, "hand_id": "75e0a1a7-c2b3-4c6c-8fbc-b61394666729", "user_id": "74dbee95-f41f-4c99-b208-f4228c43f727", "username": "BarryWhite", "bb": 0.25, "live": 0.50, "dead": 0.10, "basis": "lost", "amount": 0.35},
    {"hand_number": 58920420, "hand_id": "27902613-e1ca-4d20-8875-43bc7c4d2bcc", "user_id": "c5962288-1553-4cee-b379-af8e0d9d959f", "username": "nickw", "bb": 2.00, "live": 4.00, "dead": 1.00, "basis": "lost", "amount": 3.00},
    {"hand_number": 59253146, "hand_id": "ce560e76-20d2-4700-9218-5e64c5977d6b", "user_id": "2e8073d8-ada2-4576-a879-02b9532a858e", "username": "twin2983", "bb": 1.00, "live": 2.00, "dead": 0.50, "basis": "lost", "amount": 1.50},
    {"hand_number": 59390496, "hand_id": "5ab4fc17-38e9-4f00-94dc-9955577da9e6", "user_id": "e922e29a-c18e-4428-9b81-3f1c297fda67", "username": "Whytegold502", "bb": 0.50, "live": 1.00, "dead": 0.25, "basis": "won", "amount": 0.02},
    {"hand_number": 59412541, "hand_id": "2afe1616-be4f-47a0-ba86-0fb100211c2a", "user_id": "62e39fcf-8396-4aed-a9da-ac40665c54dd", "username": "Svge0217", "bb": 0.25, "live": 0.50, "dead": 0.10, "basis": "lost", "amount": 0.35},
    {"hand_number": 59632824, "hand_id": "52e9bd5c-c7cf-4724-9dc1-22a957a3933d", "user_id": "34fe9d15-8772-4954-9f33-6fa4ba807f6a", "username": "fresco", "bb": 0.25, "live": 0.50, "dead": 0.10, "basis": "lost", "amount": 0.35},
    {"hand_number": 59634000, "hand_id": "9dabcc72-8fc8-4323-8b45-c9bdc320dbfa", "user_id": "7e616640-58dd-4d8d-a18e-2f37f057bcd9", "username": "Burls", "bb": 1.00, "live": 2.00, "dead": 0.50, "basis": "lost", "amount": 1.50}
  ]$cases$::jsonb;
  v_probe  boolean := COALESCE(current_setting('ca.entry_post_make_good_probe', true), '') = 'on';
  r record;
  v_key text; v_reason text; v_adj uuid; v_leg uuid; v_tx uuid;
  v_wallet numeric; v_after numeric; v_bank numeric; v_bank_start numeric; v_bank_after numeric;
  v_live numeric; v_dead numeric; v_blind numeric; v_returned numeric; v_won numeric; v_winners integer;
  v_h public.hand_history%ROWTYPE; v_part jsonb;
  v_hands_before text; v_hands_after text;
  v_paid numeric := 0; v_n integer := 0;
BEGIN
  IF (SELECT count(*) FROM jsonb_to_recordset(c_cases) AS c(hand_number bigint, hand_id uuid, user_id uuid, username text, bb numeric, live numeric, dead numeric, basis text, amount numeric)) <> c_count
     OR (SELECT sum(amount) FROM jsonb_to_recordset(c_cases) AS c(hand_number bigint, hand_id uuid, user_id uuid, username text, bb numeric, live numeric, dead numeric, basis text, amount numeric)) <> c_total THEN
    RAISE EXCEPTION 'the case list does not total % over % cases', c_total, c_count;
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('entry-post-overcharge-make-good', 0)) THEN
    RAISE EXCEPTION 'the make-good is already owned by another transaction';
  END IF;

  -- Paid once: refuse the whole file if any case has been touched.
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(c_cases) AS c(hand_number bigint, hand_id uuid, user_id uuid, username text, bb numeric, live numeric, dead numeric, basis text, amount numeric) JOIN public.wallet_credit_idempotency k
               ON k.key = 'entry-post-overcharge-make-good:' || c.hand_id || ':' || c.user_id)
     OR EXISTS (SELECT 1 FROM jsonb_to_recordset(c_cases) AS c(hand_number bigint, hand_id uuid, user_id uuid, username text, bb numeric, live numeric, dead numeric, basis text, amount numeric) JOIN public.chip_ledger l
               ON l.idempotency_key = 'entry-post-overcharge-make-good:' || c.hand_id || ':' || c.user_id)
     OR EXISTS (SELECT 1 FROM public.ca_manual_adjustments WHERE decision_note = 'migration ' || c_mig)
     OR EXISTS (SELECT 1 FROM jsonb_to_recordset(c_cases) AS c(hand_number bigint, hand_id uuid, user_id uuid, username text, bb numeric, live numeric, dead numeric, basis text, amount numeric) JOIN public.ca_manual_adjustments a
               ON a.target_id = c.user_id AND a.reason LIKE '%hand ' || c.hand_number || ' %') THEN
    RAISE EXCEPTION 'an entry-post make-good is already recorded';
  END IF;

  SELECT md5(string_agg(to_jsonb(h)::text, '|' ORDER BY h.hand_number)) INTO v_hands_before
    FROM public.hand_history h JOIN jsonb_to_recordset(c_cases) AS c(hand_number bigint, hand_id uuid, user_id uuid, username text, bb numeric, live numeric, dead numeric, basis text, amount numeric) ON c.hand_id = h.id;

  SELECT chip_balance INTO v_bank_start FROM public.union_wallets WHERE union_id = c_union FOR UPDATE;
  IF v_bank_start IS NULL OR v_bank_start < c_total THEN
    RAISE EXCEPTION 'the union bank is missing or unfunded';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(c_cases) AS c(hand_number bigint, hand_id uuid, user_id uuid, username text, bb numeric, live numeric, dead numeric, basis text, amount numeric) ORDER BY hand_number LOOP
    v_key := 'entry-post-overcharge-make-good:' || r.hand_id || ':' || r.user_id;

    -- The witness: the settled hand, exactly as it was read.
    SELECT * INTO v_h FROM public.hand_history h
     WHERE h.id = r.hand_id AND h.hand_number = r.hand_number AND h.tournament_id IS NULL
       AND h.big_blind = r.bb;
    IF NOT FOUND THEN RAISE EXCEPTION 'hand % is not the hand that was read', r.hand_number; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tables t WHERE t.id = v_h.table_id AND t.club_id = c_union
                     AND t.game_type = 'cash') THEN
      RAISE EXCEPTION 'hand % is not hosted by the union', r.hand_number;
    END IF;
    SELECT COALESCE(sum((a->>'amount')::numeric) FILTER (WHERE a->>'action' = 'post' AND (a->>'dead')::boolean IS NOT TRUE), 0),
           COALESCE(sum((a->>'amount')::numeric) FILTER (WHERE a->>'action' = 'post' AND (a->>'dead')::boolean), 0),
           COALESCE(sum((a->>'amount')::numeric) FILTER (WHERE a->>'action' IN ('sb', 'bb', 'straddle', 'ante')), 0),
           COALESCE(sum((a->>'amount')::numeric) FILTER (WHERE a->>'action' = 'return'), 0)
      INTO v_live, v_dead, v_blind, v_returned
      FROM jsonb_array_elements(v_h.actions) a WHERE a->>'userId' = r.user_id::text;
    SELECT COALESCE(sum((w->>'amount')::numeric) FILTER (WHERE w->>'userId' = r.user_id::text), 0),
           count(DISTINCT w->>'userId')
      INTO v_won, v_winners FROM jsonb_array_elements(v_h.winners) w;
    IF v_live <> r.live OR v_dead <> r.dead OR v_blind <> 0 THEN
      RAISE EXCEPTION 'hand %: forced posts read live % dead % blind %', r.hand_number, v_live, v_dead, v_blind;
    END IF;

    -- A genuinely new seat: a human's fresh buy-in, dealt its first hand.
    SELECT p INTO v_part FROM public.cash_hand_participant_manifests m,
           LATERAL jsonb_array_elements(m.participants) p
     WHERE m.table_id = v_h.table_id AND m.hand_number = r.hand_number
       AND p->>'user_id' = r.user_id::text;
    IF v_part IS NULL
       OR (v_part->>'is_horse')::boolean IS NOT FALSE
       OR COALESCE(jsonb_array_length(v_part->'funding_lineage'->'moves'), 0) <> 0
       OR (v_part->>'seat_joined_at')::timestamptz NOT BETWEEN v_h.started_at - interval '10 minutes' AND v_h.started_at
       OR EXISTS (SELECT 1 FROM public.hand_history e
                   WHERE e.table_id = v_h.table_id
                     AND e.created_at >= (v_part->>'seat_joined_at')::timestamptz
                     AND e.created_at < v_h.created_at
                     AND e.players @> jsonb_build_array(jsonb_build_object('userId', r.user_id::text))) THEN
      RAISE EXCEPTION 'hand %: the seat is not a new buy-in dealt its first hand', r.hand_number;
    END IF;

    -- The amount is derived from the hand, not carried in from a report.
    IF r.basis = 'lost' THEN
      IF v_won <> 0 OR v_returned <> 0 OR r.amount <> r.live + r.dead - r.bb THEN
        RAISE EXCEPTION 'hand %: not a lost hand owed live + dead - one big blind', r.hand_number;
      END IF;
    ELSIF r.basis = 'won' THEN
      IF v_winners <> 1 OR v_won <= 0 OR r.live <> 2 * r.bb
         OR COALESCE(array_length(v_h.community_cards, 1), 0) < 3
         OR v_h.rake_amount <> round(v_h.pot_size * 10) / 100
         OR r.amount <> v_h.rake_amount - round((v_h.pot_size - r.dead) * 10) / 100 THEN
        RAISE EXCEPTION 'hand %: not a scooped pot owed the uncapped rake on its dead small blind', r.hand_number;
      END IF;
    ELSE
      RAISE EXCEPTION 'hand %: unknown basis', r.hand_number;
    END IF;

    IF public.fn_player_home_club(r.user_id, NULL) IS DISTINCT FROM c_club THEN
      RAISE EXCEPTION 'hand %: wallet routing changed', r.hand_number;
    END IF;
    SELECT chip_balance INTO v_wallet FROM public.club_members
     WHERE user_id = r.user_id AND club_id = c_club FOR NO KEY UPDATE;
    SELECT chip_balance INTO v_bank FROM public.union_wallets WHERE union_id = c_union;
    IF v_wallet IS NULL OR v_bank < r.amount THEN
      RAISE EXCEPTION 'hand %: settlement wallet missing or unfunded', r.hand_number;
    END IF;

    v_reason := r.username || ' (' || r.user_id || ') bought a new seat and was dealt hand ' || r.hand_number
      || ' (hand_history ' || r.hand_id || ', Midway Union cash, big blind ' || r.bb || ') as its first hand. '
      || 'A new cash seat owes one live big blind to enter; the engine billed forced posts of ' || r.live
      || ' live and ' || r.dead || ' dead. '
      || CASE WHEN r.basis = 'lost'
           THEN 'The player did not win the pot, so everything billed beyond one big blind was lost: ' || r.amount || '. '
           ELSE 'The player won the pot: the second big blind was returned uncalled and the dead small blind came back in the pot, less the rake taken on it: ' || r.amount || '. '
         END
      || 'Owner Dan authorized restitution of verified overcharges in chat on 2026-11-15. Midway Union, which hosts the game, '
      || 'pays it from its bank; the pot winner keeps the pot, the rake and jackpot drop stand, and no hand record or other '
      || 'player is changed. The engine correction is the pull request "a new player''s entry post is billed once". Migration ' || c_mig;
    v_adj := public.fn_ca_adjustment_under_10_9(NULL, r.user_id, r.amount, v_reason, c_mig,
               'Claude under owner authorization 2026-11-15: entry charge not owed by a new cash seat');

    PERFORM public.fn_ca_declare_ledger('settlement', 'union_bank', c_union, NULL, v_key, ARRAY['union_wallets']);
    PERFORM set_config('app.ledger_correlation', v_adj::text, true);
    UPDATE public.union_wallets SET chip_balance = chip_balance - r.amount, updated_at = now()
     WHERE union_id = c_union AND chip_balance >= r.amount;
    IF NOT FOUND THEN RAISE EXCEPTION 'hand %: the union bank refused the settlement', r.hand_number; END IF;
    IF public.fn_credit_and_log(r.user_id, r.amount, v_key, 'settlement', c_desc, NULL) IS NOT TRUE THEN
      RAISE EXCEPTION 'hand %: the credit door did not pay', r.hand_number;
    END IF;
    PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
    PERFORM set_config('app.ledger_counterparty', '', true);
    PERFORM set_config('app.ledger_counterparty_entity', '', true);
    PERFORM set_config('app.ledger_category', '', true);
    PERFORM set_config('app.ledger_idempotency_key', '', true);
    PERFORM set_config('app.ledger_correlation', '', true);

    -- Post-image: one debit, one credit, one receipt, conserved to the chip.
    SELECT chip_balance INTO v_after FROM public.club_members WHERE user_id = r.user_id AND club_id = c_club;
    SELECT chip_balance INTO v_bank_after FROM public.union_wallets WHERE union_id = c_union;
    IF round(v_after - v_wallet, 2) <> r.amount OR round(v_bank - v_bank_after, 2) <> r.amount THEN
      RAISE EXCEPTION 'hand %: conservation failed: wallet moved %, bank moved %',
        r.hand_number, v_after - v_wallet, v_bank - v_bank_after;
    END IF;
    IF (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key = v_key) <> 1 THEN
      RAISE EXCEPTION 'hand %: the credit wrote other than one journal leg', r.hand_number;
    END IF;
    SELECT l.id INTO STRICT v_leg FROM public.chip_ledger l
     WHERE l.idempotency_key = v_key AND l.amount = r.amount
       AND l.from_type = 'union_bank' AND l.from_entity_id = c_union
       AND l.to_type = 'player_wallet' AND l.to_entity_id = r.user_id
       AND l.club_id = c_club AND l.category = 'settlement';
    IF (SELECT count(*) FROM public.wallet_credit_idempotency k
         WHERE k.key = v_key AND k.user_id = r.user_id AND k.amount = r.amount) <> 1 THEN
      RAISE EXCEPTION 'hand %: the idempotency receipt is missing', r.hand_number;
    END IF;
    SELECT w.id INTO v_tx FROM public.wallet_transactions w
     WHERE w.user_id = r.user_id AND w.created_at = now() AND w.amount = r.amount
       AND w.type = 'credit' AND w.category = 'settlement' AND w.description = c_desc
     ORDER BY w.id DESC LIMIT 1;
    IF v_tx IS NULL THEN RAISE EXCEPTION 'hand %: the wallet receipt is missing', r.hand_number; END IF;
    UPDATE public.ca_manual_adjustments SET status = 'settled' WHERE id = v_adj AND status = 'approved';
    IF NOT FOUND THEN RAISE EXCEPTION 'hand %: the adjustment did not settle', r.hand_number; END IF;

    INSERT INTO public.financial_alerts(severity, source, message, context, resolved, resolved_at, resolved_by, resolution)
    VALUES ('warning', 'entry_post_overcharge_make_good',
      'Entry Charge Not Owed By A New Seat Returned By The House',
      jsonb_build_object('migration', c_mig, 'hand_id', r.hand_id, 'hand_number', r.hand_number,
        'table_id', v_h.table_id, 'user_id', r.user_id, 'username', r.username, 'basis', r.basis,
        'big_blind', r.bb, 'posted_live', r.live, 'posted_dead', r.dead, 'amount', r.amount,
        'union_id', c_union, 'club_id', c_club, 'wallet_before', v_wallet, 'wallet_after', v_after,
        'bank_before', v_bank, 'bank_after', v_bank_after, 'adjustment_id', v_adj,
        'ledger_id', v_leg, 'wallet_transaction_id', v_tx, 'idempotency_key', v_key),
      true, now(), c_actor, v_reason);

    v_paid := v_paid + r.amount;
    v_n := v_n + 1;
    RAISE NOTICE 'entry-post make-good: hand % % % wallet % -> % adjustment % leg %',
      r.hand_number, r.username, r.amount, v_wallet, v_after, v_adj, v_leg;
  END LOOP;

  SELECT chip_balance INTO v_bank_after FROM public.union_wallets WHERE union_id = c_union;
  IF v_n <> c_count OR v_paid <> c_total OR round(v_bank_start - v_bank_after, 2) <> c_total THEN
    RAISE EXCEPTION 'totals: % cases, % paid, bank moved %', v_n, v_paid, v_bank_start - v_bank_after;
  END IF;
  IF (SELECT count(*) FROM public.ca_manual_adjustments
       WHERE decision_note = 'migration ' || c_mig AND status = 'settled') <> c_count THEN
    RAISE EXCEPTION 'not every adjustment settled';
  END IF;
  SELECT md5(string_agg(to_jsonb(h)::text, '|' ORDER BY h.hand_number)) INTO v_hands_after
    FROM public.hand_history h JOIN jsonb_to_recordset(c_cases) AS c(hand_number bigint, hand_id uuid, user_id uuid, username text, bb numeric, live numeric, dead numeric, basis text, amount numeric) ON c.hand_id = h.id;
  IF v_hands_after IS DISTINCT FROM v_hands_before THEN
    RAISE EXCEPTION 'post-image: a settled hand was rewritten';
  END IF;

  IF v_probe THEN
    RAISE EXCEPTION 'PROBE OK (rolled back): % cases, % paid, bank % -> %', v_n, v_paid, v_bank_start, v_bank_after;
  END IF;
END
$settle$;

COMMIT;
