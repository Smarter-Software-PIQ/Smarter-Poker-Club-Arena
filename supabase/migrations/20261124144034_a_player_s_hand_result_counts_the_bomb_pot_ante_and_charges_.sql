-- 20261124144034_a_player_s_hand_result_counts_the_bomb_pot_ante_and_charges_.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: (SELECT count(*)=2 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('ca_hand_player_facts_one','ca_hand_player_facts_range') AND position('AS is_bomb_pot,' in prosrc)>0 AND position('''straddle'',''ante'',''bomb_ante'') THEN ''inc''' in prosrc)>0 AND position('WHEN mh.is_bomb_pot THEN 0' in prosrc)>0)
--
-- A PLAYER'S HAND RESULT COUNTS THE BOMB-POT ANTE AND CHARGES NO BLIND NOBODY
-- POSTED (2026-11-24).
--
-- WHAT WAS WRONG
--
-- ca_hand_player_facts_one / _range (the two bodies behind ca_hand_player_facts;
-- they write ca_hand_player_stat through trg_ca_stats_live_from_hand, the
-- accepted-hand projector and ca_roll_hand_stats_forward) had two faults on a
-- timed bomb pot, the only kind of hand whose log carries `bomb_ante` rows:
--
--   1. money_acts gave `bomb_ante` the kind 'none', so the ante every dealt
--      seat pays was in nobody's invested total.
--   2. A bomb pot logs no blind posts, and a log without posts is read as a
--      pre-FORCED_BETS_POSTED row: seat_blind synthesised the small and big
--      blind for the seats one and two off the button, and my_blind reported
--      it. Nobody posts a blind in a bomb pot.
--
-- Measured on production 2026-11-24 (read-only): every bomb pot since the
-- first (2026-08-31, 1,397 hands) logs one `bomb_ante` row per dealt seat, no
-- `sb`/`bb`/`post` row, and sets hand_history.bomb_pot. The 649 stored
-- ca_hand_player_stat rows of 243 bomb pots all disagree with ca_hand_facts.net
-- (the settled per-seat result, which reconciles to pot_size on every hand):
-- stat profit sums to +4,172.17, ca_hand_facts to +716.42; 374.75 chips of
-- blinds were charged that nobody posted. Examples: 41c06d33 (anted 6, folded
-- the turn: true -6, the function said 0) and b06f6fc5 (SB seat, anted 6,
-- folded the flop: true -6, the function said -1).
--
-- WHAT THIS CHANGES (both bodies, the same six anchored edits)
--
--   my_hands      is_bomb_pot: hand_history.bomb_pot is an object, or the log
--                 has a bomb_ante row (the two coincide on every recorded hand).
--   money_acts    bomb_ante is kind 'inc' and dead: in the pot, never in the
--                 street's live bet level, exactly like an ordinary ante.
--   seat_blind    a bomb pot implies no blind.
--   my_blind      a bomb pot reports 0 (posted blinds still win when posted).
--   last pf act   bomb_ante is a forced bet, not a preflop decision.
--
-- Nothing else moves: every other action kind, the bet-level and raise
-- predicates, returns, the stored-pot arbitration, authorization and the two
-- access paths are byte-for-byte the live text. The patch is applied to the
-- live definitions (pg_get_functiondef), like 20261027182146 did for these
-- same two functions, and refuses if any anchor is missing or ambiguous.
--
-- SELF-PROOF ON THE DATABASE IT RUNS ON
--
-- Before the patch the 100 newest ordinary hands are projected and kept; after
-- it they must project identically (every output column), and on the 50 newest
-- bomb pots every seat's invested_actions + my_blind must sum to pot_size,
-- my_blind must be 0 and profit must be won_amt minus what the seat put in.
-- Any difference rolls the whole migration back.
--
-- Function bodies only: no table, no lock on hand_history (STABLE readers).
-- One transaction, one schema-cache reload. Already-stored bomb-pot stat rows
-- are recomputed by the separate, reviewable 20261124145120 file.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE
  r record;
  d text;
  original text;
  changed integer := 0;
  v_before jsonb;
  v_after jsonb;
  v_bad jsonb;
  -- old text, new text; each old text must occur exactly once in each body
  edits text[][] := ARRAY[
    ARRAY[
      chr(10) || '         h.players,' || chr(10),
      chr(10) || '         h.players,' || chr(10) ||
      '         -- A timed bomb pot: nobody posts a blind; every dealt seat antes' || chr(10) ||
      '         -- (one bomb_ante row each). hand_history.bomb_pot is the engine''s marker.' || chr(10) ||
      '         (jsonb_typeof(h.bomb_pot) = ''object''' || chr(10) ||
      '          OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(h.actions, ''[]''::jsonb)) ba' || chr(10) ||
      '                      WHERE lower(ba->>''action'') = ''bomb_ante'')) AS is_bomb_pot,' || chr(10)
    ],
    ARRAY[
      $o$'small_blind','big_blind','straddle','ante') THEN 'inc'$o$,
      $n$'small_blind','big_blind','straddle','ante','bomb_ante') THEN 'inc'$n$
    ],
    ARRAY[
      $o$(a.dead_flag OR a.action = 'ante') AS dead$o$,
      $n$(a.dead_flag OR a.action IN ('ante','bomb_ante')) AS dead$n$
    ],
    ARRAY[
      chr(10) || '           WHEN ofs.pos_offset IS NULL THEN 0' || chr(10),
      chr(10) || '           WHEN mh.is_bomb_pot THEN 0' || chr(10) ||
      '           WHEN ofs.pos_offset IS NULL THEN 0' || chr(10)
    ],
    ARRAY[
      chr(10) || '      WHEN ofs.pos_offset IS NULL THEN 0' || chr(10),
      chr(10) || '      WHEN mh.is_bomb_pot THEN 0' || chr(10) ||
      '      WHEN ofs.pos_offset IS NULL THEN 0' || chr(10)
    ],
    ARRAY[
      $o$'big_blind','ante','straddle','return')$o$,
      $n$'big_blind','ante','bomb_ante','straddle','return')$n$
    ]
  ];
  i integer;
  n integer;
BEGIN
  -- The newest ordinary hands, projected by the live bodies.
  SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.hand_id, f.user_id), '[]'::jsonb)
    INTO v_before
    FROM (SELECT h.id FROM public.hand_history h
           WHERE h.bomb_pot IS NULL
             AND NOT coalesce(h.actions, '[]'::jsonb) @> '[{"action":"bomb_ante"}]'::jsonb
           ORDER BY h.created_at DESC LIMIT 100) o
    CROSS JOIN LATERAL public.ca_hand_player_facts_one(o.id, NULL) f;

  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('ca_hand_player_facts_one', 'ca_hand_player_facts_range')
     ORDER BY p.proname
  LOOP
    d := pg_get_functiondef(r.oid);
    original := d;
    IF position('is_bomb_pot' in d) > 0 THEN
      RAISE EXCEPTION 'Bomb-pot patch already installed in %', r.proname;
    END IF;
    FOR i IN 1 .. array_length(edits, 1) LOOP
      n := (length(d) - length(replace(d, edits[i][1], ''))) / length(edits[i][1]);
      IF n <> 1 THEN
        RAISE EXCEPTION 'Anchor % occurs % times in % (expected exactly once)', i, n, r.proname;
      END IF;
      d := replace(d, edits[i][1], edits[i][2]);
    END LOOP;
    IF d = original THEN RAISE EXCEPTION 'Nothing changed in %', r.proname; END IF;
    EXECUTE d;
    changed := changed + 1;
  END LOOP;
  IF changed <> 2 THEN
    RAISE EXCEPTION 'Expected both hand fact readers, found %', changed;
  END IF;

  -- Ordinary hands: identical, column for column.
  EXECUTE $q$
    SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.hand_id, f.user_id), '[]'::jsonb)
      FROM (SELECT h.id FROM public.hand_history h
             WHERE h.bomb_pot IS NULL
               AND NOT coalesce(h.actions, '[]'::jsonb) @> '[{"action":"bomb_ante"}]'::jsonb
             ORDER BY h.created_at DESC LIMIT 100) o
      CROSS JOIN LATERAL public.ca_hand_player_facts_one(o.id, NULL) f
  $q$ INTO v_after;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'An ordinary hand projected differently after the bomb-pot patch';
  END IF;

  -- Bomb pots: the seats' chips in are the stored pot; no blind; profit is
  -- won minus everything put in.
  EXECUTE $q$
    WITH b AS (
      SELECT h.id, coalesce(h.pot_size, 0)::numeric AS pot_size
        FROM public.hand_history h
       WHERE h.bomb_pot IS NOT NULL
       ORDER BY h.created_at DESC LIMIT 50
    ), f AS (
      SELECT b.id, b.pot_size, x.*
        FROM b CROSS JOIN LATERAL public.ca_hand_player_facts_one(b.id, NULL) x
    )
    SELECT jsonb_agg(jsonb_build_object('hand_id', id, 'why', why))
      FROM (
        SELECT id, 'pot' AS why FROM f GROUP BY id, pot_size
         HAVING abs(sum(invested_actions + my_blind) - pot_size) >= 0.02
        UNION ALL
        SELECT id, 'blind' FROM f WHERE my_blind <> 0
        UNION ALL
        SELECT id, 'profit' FROM f
         WHERE abs(profit - (won_amt - invested_actions - my_blind)) >= 0.005
      ) bad
  $q$ INTO v_bad;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Bomb-pot facts do not reconcile: %', v_bad;
  END IF;
END
$patch$;

COMMIT;
