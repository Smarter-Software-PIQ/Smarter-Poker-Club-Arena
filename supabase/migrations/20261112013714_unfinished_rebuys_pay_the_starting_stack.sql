-- @live-proof: NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.ended_at IS NULL AND upper(coalesce(t.status,'')) IN ('ANNOUNCED','REGISTERING','RUNNING') AND (coalesce(t.is_rebuy,false) OR coalesce(t.is_reentry,false)) AND coalesce(t.starting_chips,0) > 0 AND t.rebuy_chips IS DISTINCT FROM t.starting_chips)
-- ============================================================================
-- UNFINISHED REBUYS PAY THE STARTING STACK (Dan 2026-11-11)
-- ============================================================================
--
-- Dan, verbatim (2026-11-11, 7:27 PM CT): "ANY TOURNAMENT THAT HAS A REBUY OR
-- AN ADD ON, MUST 100% OF THE TIME ALWAYS AND FOREVER GIVE THEM THE SAME
-- AMOUNT OF CHIPS YOU START WITH FOR REBUYS AND ADD ON'S." And: "MAKE SURE YOU
-- GRANT THE 5000 CHIPS TO ANY PLAYER WHO REBOUGHT THAT IS STILL IN THE
-- TOURNAMENT."
--
-- Dan reported it live from the Nightly 20K (NLH), 73e12a88, Kings Club -
-- Midway Union: he rebought and received 10,000 chips against a 15,000
-- starting stack. The money core already pays
-- COALESCE(NULLIF(rebuy_chips,0), starting_chips); the wrong number comes
-- from tournaments.rebuy_chips, spawned from the owner weekly schedule config
-- (rebuyChips: 10000 against startingStack: 15000). The add-on half of this
-- rule has been enforced since 20261102005209 (zz_addon_pays_the_starting_stack);
-- the rebuy half is installed by 20261112013925 in the daily window.
--
-- THIS migration is the immediate data correction, row locks only, no DDL:
--
--   1. Every RUNNING rebuy/re-entry event whose rebuy_chips is SHORT of the
--      starting stack: raise rebuy_chips to the starting stack and, in the
--      same transaction, credit every entry that already purchased at the
--      short amount with (starting_chips - old rebuy_chips) x rebuys, onto
--      its live seat, behind fn_ca_assert_tournament_chip_grant. The config
--      raise and the credits land together, so the felt-supply constraint
--      measures both sides at once. A rebuyer with no live seat any more is
--      counted and skipped: a settled bust is not resurrected (CLAUDE.md 10.9).
--      Hand settlement writes seat deltas (chip standard 2026-09-04), so a
--      credit landing mid-hand is preserved, and the engine reloads seats
--      from the database between hands.
--   2. Every other unfinished rebuy/re-entry event: rebuy_chips :=
--      starting_chips. Finished events keep their historical values; settled
--      conservation arithmetic reads them.
--   3. The spawn source: tournament_schedules.config rebuyChips / addOnChips /
--      addonChips, and midwayWeeklyTerms rebuy_chips / addon_chips, pinned to
--      their own starting stack wherever the feature is on, so the schedule
--      sheet and the spawned rows agree.
--
-- No money legs: a tournament seat is not club-chip felt (fn_ca_felt_counts_
-- table), the purchase price and prize pool were booked correctly at buy
-- time; only the chip grant was short.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $fix$
DECLARE
  r record;
  p record;
  v_seat_id uuid;
  v_seat_stack numeric;
  v_delta numeric;
  v_credited integer := 0;
  v_skipped integer := 0;
  v_cfg jsonb;
  v_stack numeric;
  v_terms jsonb;
  v_terms_stack numeric;
BEGIN
  -- 1. RUNNING short-rebuy events: raise the config and credit the shortfall.
  FOR r IN
    SELECT t.id, t.name, t.starting_chips, t.rebuy_chips AS old_rebuy_chips
      FROM public.tournaments t
     WHERE t.ended_at IS NULL
       AND upper(coalesce(t.status,'')) = 'RUNNING'
       AND (coalesce(t.is_rebuy,false) OR coalesce(t.is_reentry,false))
       AND coalesce(t.starting_chips,0) > 0
       AND coalesce(t.rebuy_chips,0) > 0
       AND t.rebuy_chips < t.starting_chips
       FOR UPDATE
  LOOP
    UPDATE public.tournaments SET rebuy_chips = starting_chips WHERE id = r.id;
    v_delta := r.starting_chips - r.old_rebuy_chips;

    FOR p IN
      SELECT tp.user_id, tp.username, coalesce(tp.rebuys,0) AS rebuys
        FROM public.tournament_players tp
       WHERE tp.tournament_id = r.id AND coalesce(tp.rebuys,0) > 0
       ORDER BY tp.user_id
         FOR UPDATE
    LOOP
      SELECT ts.id, coalesce(ts.stack,0) INTO v_seat_id, v_seat_stack
        FROM public.table_seats ts
        JOIN public.tables tb ON tb.id = ts.table_id
       WHERE tb.tournament_id = r.id AND ts.user_id = p.user_id
         AND ts.left_at IS NULL
       ORDER BY ts.id
       LIMIT 1
         FOR UPDATE OF ts;
      IF NOT FOUND THEN
        v_skipped := v_skipped + 1;
        RAISE NOTICE 'rebuy shortfall: % (%) has no live seat in %; not credited',
          p.username, p.user_id, r.name;
        CONTINUE;
      END IF;

      PERFORM public.fn_ca_assert_tournament_chip_grant(
        r.id, p.user_id, v_seat_id, v_seat_stack + v_delta * p.rebuys,
        'rebuy shortfall correction (Dan 2026-11-11)');

      UPDATE public.table_seats
         SET stack = coalesce(stack,0) + v_delta * p.rebuys
       WHERE id = v_seat_id;

      UPDATE public.tournament_players
         SET chips = (SELECT stack FROM public.table_seats WHERE id = v_seat_id)::integer
       WHERE tournament_id = r.id AND user_id = p.user_id;

      v_credited := v_credited + 1;
      RAISE NOTICE 'rebuy shortfall: credited % x % to % (%) in %',
        v_delta, p.rebuys, p.username, p.user_id, r.name;
    END LOOP;

    PERFORM public.fn_emit_tournament_manager_wake(r.id, 'rebuy');
  END LOOP;
  RAISE NOTICE 'rebuy shortfall corrections: % credited, % skipped (no live seat)',
    v_credited, v_skipped;

  -- 2. Every other unfinished rebuy/re-entry event: config normalization only.
  UPDATE public.tournaments t
     SET rebuy_chips = t.starting_chips
   WHERE t.ended_at IS NULL
     AND upper(coalesce(t.status,'')) IN ('ANNOUNCED','REGISTERING','RUNNING')
     AND (coalesce(t.is_rebuy,false) OR coalesce(t.is_reentry,false))
     AND coalesce(t.starting_chips,0) > 0
     AND t.rebuy_chips IS DISTINCT FROM t.starting_chips;

  -- 3. The spawn source: schedule configs agree with their own starting stack.
  FOR r IN
    SELECT s.id AS sched_id, s.config
      FROM public.tournament_schedules s
     WHERE s.config IS NOT NULL
       AND coalesce(nullif(s.config->>'startingStack','')::numeric, 0) > 0
  LOOP
    v_cfg := r.config;
    v_stack := (v_cfg->>'startingStack')::numeric;

    IF (coalesce(v_cfg->>'isRebuy','false') = 'true'
        OR coalesce(v_cfg->>'isReentry','false') = 'true'
        OR lower(coalesce(v_cfg->>'type','')) = 'rebuy')
       AND v_cfg ? 'rebuyChips'
       AND coalesce(nullif(v_cfg->>'rebuyChips','')::numeric, -1) <> v_stack THEN
      v_cfg := jsonb_set(v_cfg, '{rebuyChips}', to_jsonb(v_stack::integer));
    END IF;
    IF coalesce(v_cfg->>'addOnAvailable','false') = 'true' THEN
      IF v_cfg ? 'addOnChips'
         AND coalesce(nullif(v_cfg->>'addOnChips','')::numeric, -1) <> v_stack THEN
        v_cfg := jsonb_set(v_cfg, '{addOnChips}', to_jsonb(v_stack::integer));
      END IF;
      IF v_cfg ? 'addonChips'
         AND coalesce(nullif(v_cfg->>'addonChips','')::numeric, -1) <> v_stack THEN
        v_cfg := jsonb_set(v_cfg, '{addonChips}', to_jsonb(v_stack::integer));
      END IF;
    END IF;

    v_terms := v_cfg->'midwayWeeklyTerms';
    IF jsonb_typeof(v_terms) = 'object' THEN
      v_terms_stack := coalesce(nullif(v_terms->>'starting_chips','')::numeric, v_stack);
      IF v_terms_stack > 0 THEN
        IF (coalesce(v_terms->>'is_rebuy','false') = 'true'
            OR coalesce(v_terms->>'is_reentry','false') = 'true')
           AND v_terms ? 'rebuy_chips'
           AND coalesce(nullif(v_terms->>'rebuy_chips','')::numeric, -1) <> v_terms_stack THEN
          v_cfg := jsonb_set(v_cfg, '{midwayWeeklyTerms,rebuy_chips}', to_jsonb(v_terms_stack::integer));
        END IF;
        IF coalesce(v_terms->>'add_on_available','false') = 'true'
           AND v_terms ? 'addon_chips'
           AND coalesce(nullif(v_terms->>'addon_chips','')::numeric, -1) <> v_terms_stack THEN
          v_cfg := jsonb_set(v_cfg, '{midwayWeeklyTerms,addon_chips}', to_jsonb(v_terms_stack::integer));
        END IF;
      END IF;
    END IF;

    IF v_cfg IS DISTINCT FROM r.config THEN
      UPDATE public.tournament_schedules
         SET config = v_cfg, updated_at = now()
       WHERE id = r.sched_id;
      RAISE NOTICE 'schedule % rebuy/add-on chips pinned to its starting stack', r.sched_id;
    END IF;
  END LOOP;
END $fix$;
COMMIT;
