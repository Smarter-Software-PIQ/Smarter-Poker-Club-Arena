-- EVERY HORSE DECISION UPGRADE HAS A LIVE SWITCH (2026-11-14)
--
-- The style read switch (20261113201841) could carry seven options. This migration widens the SAME switch (the
-- same table, the same audit table, the same 30 second engine read) so it carries every option REGISTERED in
-- server/src/engine/HorseOptionSwitch.ts. It adds no second table.
--
-- OWNER ORDER (2026-11-14 22:01 Chicago, OWNER-MESSAGE-20261114-2201CT-EVERY-FEATURE-ON-WITH-SWITCH.md, sha256
-- 2080c2026d5553e11ac288a74fcef51d20f81b30c0a9da446b5063a9f7196bf1): "YOU NEED TO MAKE SURE THAT EVERY SINGLE
-- FUNCTION FEATURE, SKILL ETC ACROSS ALL GAMES TYPES, CASH AND TOURNAMENTS FOR ALL 9 CHATS IS FULLY ACTIVATED AND
-- EVERY SINGLE ONE HAS AN ON OFF SWITCH BUILT AND ACTIVATED AT THE NEXT CUT OVER". So the registry is every on/off
-- option of the engine's data ledger, and each has an on/off switch here. THIS MIGRATION ENABLES NOTHING.
--
-- WHAT AN OPERATOR CAN DO AFTER IT (service_role only, every change audited with actor, note and time):
--   SELECT public.fn_ca_horse_option_switch_set('<option>', 'off', '<actor>', '<note>');
--   SELECT public.fn_ca_horse_option_switch_set('<option>', 'on', '<actor>', 'authority: <file and sha256>');
--   SELECT public.fn_ca_horse_option_switch_clear('<option>', '<actor>', '<note>');   -- back to the release default
--   SELECT public.fn_ca_horse_option_switch_effective();
-- The seven style options also take 'shadow' and 'canary'. No other option does: it has no shadow arm in the
-- engine, and the set function refuses those states for it by name.
--
-- 'on' CITES ITS AUTHORITY. For a non-style option the set function writes 'on' only when the note starts with
-- 'authority: ' and names the authority (at least 24 characters), and the table refuses such a row without it
-- from any writer. The audit row keeps the note. 'off' and clear stay available for every registered option. The
-- style options keep their own states and controls, unchanged. This replaces the evidence-file rule this switch
-- carried before (HA-10878-1) for the switch only; nothing here is described as passing promotion evidence.
--
-- IT CHANGES NOTHING UNTIL A ROW IS SET. This migration adds NO rows. No row = the release default: the engine
-- does not pass the option at all and the code default decides. `on` passes true, `off` passes false.
--
-- FAIL SAFE (engine side). The seven style options keep their rule: an unreadable, invalid or stale answer reads
-- as OFF. Every other option goes back to its RELEASE DEFAULT, not to off.
--
-- AN OLDER ENGINE IS NOT DISTURBED. fn_ca_horse_style_switch_effective keeps its exact answer shape and now names
-- only the seven style options, so an engine that predates this change (its parser rejects an option it does not
-- know and then turns every style option off) never sees a row of a newer option.
--
-- NOT SWITCHABLE: the authority-gated held-out cash pack and held-out PLO cards, the phase packs, Pillar 2 (the
-- deep-dive discipline), the R7/R8 solver rounds (V31), leak maps and the two withdrawn rules. They are not in the
-- whitelist below, and the engine registry refuses them by name. An option under an owner hold or measured
-- harmful (the preflop range hold, commitUnderPot) IS registered; the engine registry records its hold or verdict.
--
-- FLEET-WIDE ONLY: the table stays keyed by the option name alone. There is no per-Horse, per-lane, per-club or
-- per-table dimension, and this migration adds no column.
--
-- THE WHITELIST IS THE ENGINE REGISTRY. The names between the registry markers below are written by
-- server/scripts/gen-horse-option-switch-sql.ts, and everyUpgradeHasALiveSwitch.law.test.ts fails when they differ
-- from OPTION_SWITCH_REGISTRY.
--
-- COST: three ALTERs on a table of one row per switched option (seven today), read once per 30 seconds; no live table is touched.
BEGIN;

-- The option whitelist of the table: replace the seven-name check with the registry.
DO $drop_old_whitelist$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.ca_horse_style_switch'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%styleValueBettorNotManiac%'
  LOOP
    EXECUTE format('ALTER TABLE public.ca_horse_style_switch DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$drop_old_whitelist$;

ALTER TABLE public.ca_horse_style_switch
  ADD CONSTRAINT ca_horse_style_switch_option_is_registered CHECK (
    option IN (
    -- registry:style-options:begin
    'styleValueBettorNotManiac', 'styleBigBetHonesty', 'styleRaiseRespect',
    'styleTightReRaiserRespect', 'styleFoldRatePreRepair', 'styleValueExtraction', 'styleFoldBluff'
    -- registry:style-options:end
    )
    OR option IN (
    -- registry:plain-options:begin
    'streetIQ', 'handReading', 'v7', 'v7Preflop', 'v7Barrels', 'v7SizeReads', 'v7CounterAdapt',
    'v7AdaptiveMC', 'v8', 'v8Draws', 'v8HiLo', 'v8Nlh', 'v9', 'v9Sizing', 'v9Timing',
    'decisionGravityTiming', 'v9Mood', 'v10', 'v10Cbet', 'v10Spr', 'v10Rake', 'v10ThinValue',
    'v10Iso', 'v11', 'v12', 'v12Ranges', 'v12River', 'v13', 'v15', 'v15Boats', 'v16Reads', 'v16Icm',
    'v16Hu', 'v16Blockers', 'v16SizeCond', 'v16PloPolar', 'v16Ratio', 'v17Pos', 'v17RiverProbe',
    'v17CatchBlock', 'v17ShortDeck', 'v18Straddle', 'v18Squeeze', 'v18SelfImage', 'v18ExploitSize',
    'v18Families', 'v20Multiway', 'v20Mzone', 'v21River', 'v21Deep', 'v23Endgame', 'v23Plan',
    'v23Reads', 'v23Variants', 'v23ShortDeck', 'v23Spin', 'v24Bounty', 'v24PloDefense',
    'v25PloTourney', 'v26Prizes', 'v27GtoCharts', 'v29GtoFlop', 'v30GtoTurnRiver',
    'v32FacingDefense', 'v33DepthCeiling', 'v37Satellite', 'v38Ev', 'v40Omaha',
    'holdemPremiumAggression', 'holdemDominatedFold', 'ploPairedBoardFold',
    'ploPairedBoardRiverCheck', 'ploSuitedAcesFourBet', 'v86PloOverhaul', 'v87HoldemOverhaul',
    'v87RiverBlockBetTrap', 'v87HollywoodTank', 'v87FlopStabCheckRaise', 'v46Charts',
    'v46ShortDeck', 'v51RiverFlat', 'v55OmahaRiverTripsFlat', 'v56OmahaPressureRange',
    'v57TournamentAggression', 'v61RiverOnePairShade', 'v66BetRaisedOnePair',
    'v67RiverBetRaisedOnePair', 'v88CommitmentHonored', 'omahaTournamentFirstIn',
    'omahaHiLoTournamentFirstIn', 'tokenCallPrice', 'plo6ManiacPriceRefusalToRangePlay',
    'plo6TopSetNutRealization', 'v64RiverRaiseNeedsTwoPair', 'v63LargeRiverBetShade',
    'v74OmahaSemiBluffNeedsDraw', 'v62RiverBettorPolarity', 'v60CashPressure',
    'v65TurnOnePairShade', 'v68TurnAirDrawCalls', 'v69TurnCallGaps', 'v70GtoOpeningRanges',
    'v71AnteAwarePushFold', 'v72DefenceByOpener', 'v73Vs3BetDefence', 'v75SqueezeDefence',
    'v79TopPairWeakKicker', 'v81OmahaBigBetCalls', 'v15RiverNoNearLock', 'v85CashAction',
    'v84OmahaRiverReraiseCalls', 'v83AggressionNeedsBluffs', 'readPostflopFoldRate',
    'readShrinkResponse', 'readBreakEvenBluff', 'omahaEvFoldModel', 'omahaNeutralUnknown',
    'omahaTightOpponent', 'readScopedShrink', 'planFingerprint', 'v80TopPairStrongKicker',
    'v78NoCommittingBluffRaise', 'v70FacingOpenZone', 'huBbDefendsToPrice',
    'huOpenerDefendsToPrice', 'huLimpDefendsToPrice', 'committedStackPricedIn', 'nashCallVsJam',
    'nashPushFoldIcm', 'facingOpenFullRingZone', 'vs3BetShortStack',
    'omahaCommitZoneThreeBetPriceRelief', 'facingClosedAllIn', 'limpReraiseIsoRead',
    'commitUnderPot', 'v77SeatAwareJams', 'v76RetireFourBetBluffBand', 'v74NlhOpenSizes',
    'v52RangeAdvantage', 'v53Pressure', 'v58Plo6RiverNuts', 'v59Plo6RiverUnpaired',
    'drawOutlookQuality', 'committedRaiseDiscipline', 'callDeductionPricing',
    'flopTurnBluffBaseline', 'riverBluffBaseline', 'riverLeadRange', 'riverBluffHiLo',
    'riverBluffMultiway', 'riverFastCalldown', 'probeAwareAggression', 'riverBluffFixedLimit',
    'riverBluffShortDeck', 'riverBluffBombPot', 'riverBluffMultiBoard', 'v43Tempo', 'v41Leaks',
    'v86UnblockedPreflop', 'v86MultiStreetUnblocked'
    -- registry:plain-options:end
    ));

-- 'on' for a non-style option cites its authority in the note, from any writer.
ALTER TABLE public.ca_horse_style_switch
  ADD CONSTRAINT ca_horse_style_switch_on_cites_authority CHECK (
    state <> 'on'
    OR option IN (
    -- registry:style-options:begin
    'styleValueBettorNotManiac', 'styleBigBetHonesty', 'styleRaiseRespect',
    'styleTightReRaiserRespect', 'styleFoldRatePreRepair', 'styleValueExtraction', 'styleFoldBluff'
    -- registry:style-options:end
    )
    OR (note IS NOT NULL AND note LIKE 'authority: %' AND length(note) >= 24)
  );

-- Shadow and canary only where the engine has a shadow arm: the seven style options.
ALTER TABLE public.ca_horse_style_switch
  ADD CONSTRAINT ca_horse_style_switch_state_fits_option CHECK (
    state IN ('off', 'on')
    OR option IN (
    -- registry:style-options:begin
    'styleValueBettorNotManiac', 'styleBigBetHonesty', 'styleRaiseRespect',
    'styleTightReRaiserRespect', 'styleFoldRatePreRepair', 'styleValueExtraction', 'styleFoldBluff'
    -- registry:style-options:end
    ));

-- The states an option may be set to; NULL for an option that is not registered.
CREATE FUNCTION public.fn_ca_horse_option_switch_states(p_option text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN p_option IN (
    -- registry:style-options:begin
    'styleValueBettorNotManiac', 'styleBigBetHonesty', 'styleRaiseRespect',
    'styleTightReRaiserRespect', 'styleFoldRatePreRepair', 'styleValueExtraction', 'styleFoldBluff'
    -- registry:style-options:end
    )
      THEN ARRAY['off', 'shadow', 'canary', 'on']
    WHEN p_option IN (
    -- registry:plain-options:begin
    'streetIQ', 'handReading', 'v7', 'v7Preflop', 'v7Barrels', 'v7SizeReads', 'v7CounterAdapt',
    'v7AdaptiveMC', 'v8', 'v8Draws', 'v8HiLo', 'v8Nlh', 'v9', 'v9Sizing', 'v9Timing',
    'decisionGravityTiming', 'v9Mood', 'v10', 'v10Cbet', 'v10Spr', 'v10Rake', 'v10ThinValue',
    'v10Iso', 'v11', 'v12', 'v12Ranges', 'v12River', 'v13', 'v15', 'v15Boats', 'v16Reads', 'v16Icm',
    'v16Hu', 'v16Blockers', 'v16SizeCond', 'v16PloPolar', 'v16Ratio', 'v17Pos', 'v17RiverProbe',
    'v17CatchBlock', 'v17ShortDeck', 'v18Straddle', 'v18Squeeze', 'v18SelfImage', 'v18ExploitSize',
    'v18Families', 'v20Multiway', 'v20Mzone', 'v21River', 'v21Deep', 'v23Endgame', 'v23Plan',
    'v23Reads', 'v23Variants', 'v23ShortDeck', 'v23Spin', 'v24Bounty', 'v24PloDefense',
    'v25PloTourney', 'v26Prizes', 'v27GtoCharts', 'v29GtoFlop', 'v30GtoTurnRiver',
    'v32FacingDefense', 'v33DepthCeiling', 'v37Satellite', 'v38Ev', 'v40Omaha',
    'holdemPremiumAggression', 'holdemDominatedFold', 'ploPairedBoardFold',
    'ploPairedBoardRiverCheck', 'ploSuitedAcesFourBet', 'v86PloOverhaul', 'v87HoldemOverhaul',
    'v87RiverBlockBetTrap', 'v87HollywoodTank', 'v87FlopStabCheckRaise', 'v46Charts',
    'v46ShortDeck', 'v51RiverFlat', 'v55OmahaRiverTripsFlat', 'v56OmahaPressureRange',
    'v57TournamentAggression', 'v61RiverOnePairShade', 'v66BetRaisedOnePair',
    'v67RiverBetRaisedOnePair', 'v88CommitmentHonored', 'omahaTournamentFirstIn',
    'omahaHiLoTournamentFirstIn', 'tokenCallPrice', 'plo6ManiacPriceRefusalToRangePlay',
    'plo6TopSetNutRealization', 'v64RiverRaiseNeedsTwoPair', 'v63LargeRiverBetShade',
    'v74OmahaSemiBluffNeedsDraw', 'v62RiverBettorPolarity', 'v60CashPressure',
    'v65TurnOnePairShade', 'v68TurnAirDrawCalls', 'v69TurnCallGaps', 'v70GtoOpeningRanges',
    'v71AnteAwarePushFold', 'v72DefenceByOpener', 'v73Vs3BetDefence', 'v75SqueezeDefence',
    'v79TopPairWeakKicker', 'v81OmahaBigBetCalls', 'v15RiverNoNearLock', 'v85CashAction',
    'v84OmahaRiverReraiseCalls', 'v83AggressionNeedsBluffs', 'readPostflopFoldRate',
    'readShrinkResponse', 'readBreakEvenBluff', 'omahaEvFoldModel', 'omahaNeutralUnknown',
    'omahaTightOpponent', 'readScopedShrink', 'planFingerprint', 'v80TopPairStrongKicker',
    'v78NoCommittingBluffRaise', 'v70FacingOpenZone', 'huBbDefendsToPrice',
    'huOpenerDefendsToPrice', 'huLimpDefendsToPrice', 'committedStackPricedIn', 'nashCallVsJam',
    'nashPushFoldIcm', 'facingOpenFullRingZone', 'vs3BetShortStack',
    'omahaCommitZoneThreeBetPriceRelief', 'facingClosedAllIn', 'limpReraiseIsoRead',
    'commitUnderPot', 'v77SeatAwareJams', 'v76RetireFourBetBluffBand', 'v74NlhOpenSizes',
    'v52RangeAdvantage', 'v53Pressure', 'v58Plo6RiverNuts', 'v59Plo6RiverUnpaired',
    'drawOutlookQuality', 'committedRaiseDiscipline', 'callDeductionPricing',
    'flopTurnBluffBaseline', 'riverBluffBaseline', 'riverLeadRange', 'riverBluffHiLo',
    'riverBluffMultiway', 'riverFastCalldown', 'probeAwareAggression', 'riverBluffFixedLimit',
    'riverBluffShortDeck', 'riverBluffBombPot', 'riverBluffMultiBoard', 'v43Tempo', 'v41Leaks',
    'v86UnblockedPreflop', 'v86MultiStreetUnblocked'
    -- registry:plain-options:end
    )
      THEN ARRAY['off', 'on']
    ELSE NULL
  END;
$function$;

-- The style read, unchanged in shape, now naming only the style options (see AN OLDER ENGINE above).
CREATE OR REPLACE FUNCTION public.fn_ca_horse_style_switch_effective()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'version', 1,
    'options', coalesce((SELECT jsonb_object_agg(s.option, s.state)
                         FROM public.ca_horse_style_switch s
                         WHERE public.fn_ca_horse_option_switch_states(s.option) @> ARRAY['shadow']),
                        '{}'::jsonb));
$function$;

-- The wide read: exactly {"version": 2, "style": {"version": 1, "options": {...}}, "options": {...}}. `style` is
-- the answer above; `options` names every other option that has a row. Never null, never another key.
CREATE FUNCTION public.fn_ca_horse_option_switch_effective()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'version', 2,
    'style', public.fn_ca_horse_style_switch_effective(),
    'options', coalesce((SELECT jsonb_object_agg(s.option, s.state)
                         FROM public.ca_horse_style_switch s
                         WHERE NOT (public.fn_ca_horse_option_switch_states(s.option) @> ARRAY['shadow'])),
                        '{}'::jsonb));
$function$;

-- The write for any registered option: one option, one state it supports, one audit row, one transaction.
CREATE FUNCTION public.fn_ca_horse_option_switch_set(p_option text, p_state text, p_actor text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_states text[] := public.fn_ca_horse_option_switch_states(p_option);
  v_old    text;
  v_at     timestamptz := now();
BEGIN
  IF v_states IS NULL THEN
    RAISE EXCEPTION 'not a switchable option: %', coalesce(p_option, '(null)');
  END IF;
  IF p_state IS NULL OR NOT (p_state = ANY (v_states)) THEN
    RAISE EXCEPTION 'option % does not support state % (it supports %)',
      p_option, coalesce(p_state, '(null)'), array_to_string(v_states, ', ');
  END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'an actor is required';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN
    RAISE EXCEPTION 'the note is longer than 500 characters';
  END IF;
  -- 'on' for a non-style option cites its authority; the note is kept in the audit row below
  IF p_state = 'on' AND NOT ('shadow' = ANY (v_states))
     AND NOT (p_note IS NOT NULL AND p_note LIKE 'authority: %' AND length(p_note) >= 24) THEN
    RAISE EXCEPTION 'option % may be set on only with a note that cites its authority (authority: <file and sha256>)',
      p_option;
  END IF;

  -- the same lock key as fn_ca_horse_style_switch_set, so the two writers of one option never interleave
  PERFORM pg_advisory_xact_lock(hashtext('ca_horse_style_switch:' || p_option));
  SELECT s.state INTO v_old FROM public.ca_horse_style_switch s WHERE s.option = p_option FOR UPDATE;

  INSERT INTO public.ca_horse_style_switch AS s (option, state, updated_by, updated_at, note)
  VALUES (p_option, p_state, p_actor, v_at, p_note)
  ON CONFLICT (option) DO UPDATE
    SET state = excluded.state, updated_by = excluded.updated_by, updated_at = excluded.updated_at,
        note = excluded.note;

  INSERT INTO public.ca_horse_style_switch_audit (option, old_state, new_state, changed_by, changed_at, note)
  VALUES (p_option, v_old, p_state, p_actor, v_at, p_note);

  RETURN jsonb_build_object('option', p_option, 'state', p_state, 'updated_at', v_at);
END
$function$;

-- Back to the release default: the row goes away, the audit row (new_state 'default') stays.
CREATE FUNCTION public.fn_ca_horse_option_switch_clear(p_option text, p_actor text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_old text;
  v_at  timestamptz := now();
BEGIN
  IF public.fn_ca_horse_option_switch_states(p_option) IS NULL THEN
    RAISE EXCEPTION 'not a switchable option: %', coalesce(p_option, '(null)');
  END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'an actor is required';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN
    RAISE EXCEPTION 'the note is longer than 500 characters';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ca_horse_style_switch:' || p_option));
  DELETE FROM public.ca_horse_style_switch s WHERE s.option = p_option RETURNING s.state INTO v_old;

  INSERT INTO public.ca_horse_style_switch_audit (option, old_state, new_state, changed_by, changed_at, note)
  VALUES (p_option, v_old, 'default', p_actor, v_at, p_note);

  RETURN jsonb_build_object('option', p_option, 'state', 'default', 'updated_at', v_at);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_states(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_effective() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_set(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_clear(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_style_switch_effective() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_states(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_effective() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_set(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_clear(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_style_switch_effective() TO service_role;

-- The table access law is restated (the tables are the same ones): no role writes them directly.
REVOKE ALL ON TABLE public.ca_horse_style_switch FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ca_horse_style_switch_audit FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.ca_horse_style_switch_audit_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ca_horse_style_switch TO service_role;
GRANT SELECT ON TABLE public.ca_horse_style_switch_audit TO service_role;

-- Read back: the shape, the refusals and the access law. Rows that exist are left exactly as they were.
DO $readback$
DECLARE
  v_wide jsonb := public.fn_ca_horse_option_switch_effective();
BEGIN
  IF v_wide->>'version' IS DISTINCT FROM '2'
     OR jsonb_typeof(v_wide->'options') IS DISTINCT FROM 'object'
     OR v_wide->'style' IS DISTINCT FROM public.fn_ca_horse_style_switch_effective()
     OR (SELECT count(*) FROM jsonb_object_keys(v_wide)) <> 3 THEN
    RAISE EXCEPTION 'the wide switch read is not the documented shape: %', v_wide;
  END IF;
  IF public.fn_ca_horse_option_switch_states('commitUnderPot') IS DISTINCT FROM ARRAY['off', 'on']
     OR public.fn_ca_horse_option_switch_states('styleFoldBluff')
          IS DISTINCT FROM ARRAY['off', 'shadow', 'canary', 'on'] THEN
    RAISE EXCEPTION 'a registered option does not answer with its states';
  END IF;
  IF public.fn_ca_horse_option_switch_states('v54RiverBluff') IS NOT NULL
     OR public.fn_ca_horse_option_switch_states('v53PloTourneyIcm') IS NOT NULL
     OR public.fn_ca_horse_option_switch_states('comboDrawPressure') IS NOT NULL
     OR public.fn_ca_horse_option_switch_states('vpipFloorDeepStackOff') IS NOT NULL
     OR public.fn_ca_horse_option_switch_states('phase13Joint') IS NOT NULL
     OR public.fn_ca_horse_option_switch_states('v87DeepDiveDiscipline') IS NOT NULL
     OR public.fn_ca_horse_option_switch_states('v31GtoSuitAware') IS NOT NULL
     OR public.fn_ca_horse_option_switch_states('omahaPreflopCallWithActionBehind') IS NOT NULL
     OR public.fn_ca_horse_option_switch_states('notAnOption') IS NOT NULL
     OR public.fn_ca_horse_option_switch_states(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'a refused option is switchable';
  END IF;
  IF has_function_privilege('anon', 'public.fn_ca_horse_option_switch_effective()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_effective()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_horse_option_switch_clear(text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_clear(text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_horse_option_switch_states(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_states(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_horse_style_switch_effective()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_style_switch_effective()', 'EXECUTE')
     OR has_table_privilege('anon', 'public.ca_horse_style_switch', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ca_horse_style_switch', 'SELECT')
     OR has_table_privilege('anon', 'public.ca_horse_style_switch_audit', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ca_horse_style_switch_audit', 'SELECT') THEN
    RAISE EXCEPTION 'a browser role can reach the option switch';
  END IF;
  IF has_table_privilege('service_role', 'public.ca_horse_style_switch', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('service_role', 'public.ca_horse_style_switch_audit', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_sequence_privilege('service_role', 'public.ca_horse_style_switch_audit_id_seq', 'USAGE, SELECT, UPDATE') THEN
    RAISE EXCEPTION 'service_role can write the option switch tables directly';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.fn_ca_horse_option_switch_effective()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_ca_horse_option_switch_clear(text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_ca_horse_style_switch_effective()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot use the option switch';
  END IF;
END
$readback$;

COMMIT;
