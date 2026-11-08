-- 20261107233449_audit_observer_gated_reads_are_not_dead_layers.sql
--
-- Version reserved by scripts/reserve-migration-version.sh.
--
-- WHAT THIS CHANGES, AND WHY (2026-11-06 daily horse audit, finding 1):
--
-- fn_audit_layer_silence reported v16_reads_tell as `layer_silent` (warn,
-- "zero here means the repair did not take") on 2026-11-04, 11-05 and 11-06.
-- The repair did take; the layer's stage changed. Since #8075 (2026-10-25)
-- every horse reads only its own observations, in its own variant / format /
-- dealt-size scope. The tell needs five big river bets by one player that
-- reached showdown, seen by that one horse in that scope. Public history
-- rehydration is card-free and cannot rebuild a showdown counter, and the
-- owner-approved herd notes (#8235) carry none. Telemetry: 23,562 fires on
-- 2026-10-25, 1,206 on 10-26, 153 on 10-27, 50 on 10-31, 0 every day from
-- 2026-11-01 to 11-07, while the cash decision count it is measured against
-- stayed between 0.6M and 2.6M a day.
--
-- The new regression test server/src/engine/horseDecision/
-- HorseObserverDeepReads.test.ts proves the read is still wired: a horse
-- that observed the sample itself reads it, a horse that did not reads null.
--
-- 1. fn_audit_layer_silence: zero v16_reads_tell fires is
--    `layer_observer_gated` (note), not `layer_silent` (warn). Every other
--    watched layer, the straddle and default-off branches are unchanged.
--    The body is the installed one (identical to 20261016182539 up to
--    trailing whitespace, compared 2026-11-07) with one branch added.
--
-- The data_unread floors for v16_reads_f3b / v16_reads_cbet / v23_river_read
-- / v19_overbet_polarity / v62_river_bettor_polarity live in the engine's
-- HorseDataLedger.ts and reach horse_data_ledger through HorseDataLedgerSync
-- at engine boot; they are changed there, not here.
--
-- One function, one transaction (production DDL policy: one schema-cache
-- reload). No table, row or live-table lock is touched.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_audit_layer_silence(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_findings jsonb := '[]'::jsonb;
  v_decides bigint;
  v_straddle_stage int;
  feat record;
begin
  select coalesce(sum(fires), 0) into v_decides
  from horse_brain_telemetry where day = p_day and feature = 'decide';

  if v_decides < 1000 then
    return jsonb_build_array(jsonb_build_object(
      'severity','critical','category','schema','code','telemetry_dark',
      'title','Brain telemetry recorded ' || v_decides || ' decisions for ' || p_day,
      'evidence', jsonb_build_object('decide_fires', v_decides),
      'recommendation','Either BrainTelemetryFlush is not running, the deploy predates telemetry, or the fleet was down. Nothing about layer health can be known for this day.'
    ));
  end if;

  -- THE STAGE FOR THE STRADDLE LANE (Ruling R2). Counted, not assumed: a
  -- layer with no stage cannot fire, and that is not the brain's fault.
  select count(*) into v_straddle_stage
  from tables
  where straddle_enabled
    and tournament_id is null
    and status in ('running','waiting');

  for feat in
    select * from (values
      ('preflop_v7',          'critical','the V7 preflop engine - every preflop decision should route through it'),
      ('v15_nut_status',      'critical','V15 Omaha nut awareness - fires on every made flush/straight in PLO'),
      ('banded_mc_omaha',     'critical','Omaha banded equity (the reservoir sampler feeds this path)'),
      ('banded_mc_nlh',       'critical','NLH banded equity'),
      ('icm_real',            'warn','V16 real ICM - tournament decisions with stacks+payouts in context'),
      ('v16_hu_overlay',      'warn','V16 heads-up overlay - any two-handed postflop pot'),
      ('v15_eq_capped',       'warn','V15 equity cap - dominated hands facing aggression'),
      ('v16_reads_cbet',      'warn','deep-read c-bet scaling - needs 10+ observed c-bet opportunities'),
      ('v16_sizecond_bigbet', 'warn','size-conditioned sampling - a 20bb+ bet on the newest street'),
      ('v16_reads_f3b',       'warn','deep-read fold-to-3-bet scaling of the bluff 3-bet mix'),
      ('v16_reads_tell',      'warn','big-river-bet sizing tell - WAS DEAD until the 2026-08-27 scale fix; zero here means the repair did not take'),
      ('v17_pos_behind',      'warn','V17 positional pressure - 0 or 2+ live players behind in a bluff-band spot'),
      ('v17_river_probe',     'warn','V17 river delayed probe - checked-through turn into a short-handed river'),
      ('v17_catch_block',     'warn','V17 call-side blocker - WAS DEAD until the 2026-08-27 scale fix; zero here means the repair did not take'),
      ('v17_short_deck',      'warn','V17 short-deck overlay - every short-deck postflop decision'),
      ('v18_straddle',        'warn','V18 straddle fix - straddled pots re-read as unopened (straddle tables only)'),
      ('v18_self_image',      'warn','V18 self-image - a horse''s own recent line moving its bluff volume'),
      ('v18_exploit_size',    'warn','V18 exploit-sized river value raises'),
      ('v19_overbet_polarity','warn','overbet polarity respect - unreachable before the scale fix'),
      ('v19_river_bigbet_cap','warn','V15 river big-bet equity cap - unreachable before the scale fix')
    ) as t(feature, severity, why)
  loop
    if not exists (
      select 1 from horse_brain_telemetry
      where day = p_day and feature = feat.feature and fires > 0
    ) then
      if feat.feature = 'v18_straddle' and v_straddle_stage = 0 then
        -- RETIRED, NOT SILENT. Ruling R2 took the stage away on purpose.
        v_findings := v_findings || jsonb_build_object(
          'severity','note','category','logic','code','layer_retired',
          'title','Deployed layer v18_straddle has no stage to fire on',
          'evidence', jsonb_build_object(
            'feature','v18_straddle','decide_fires', v_decides,
            'live_straddle_tables', 0,
            'ruling','R2 retired the straddle lane on cash games. fn_cash_apply_ruleset forces straddle_enabled = false on every cash table each tick; pinned by TheTablesOpenAndCloseThemselves.law.test.ts and LeaguePmAndStraddle.test.ts.'),
          'recommendation','Nothing to fix. The code is deployed and correct; the stage was removed deliberately. This turns back into a warn on its own the day a live cash table carries straddle_enabled again - do not "wire up" the flag to silence it, and do not delete the layer.'
        );
      elsif feat.feature = 'v17_river_probe' then
        -- DEFAULT OFF, NOT SILENT. HorseLogic gates the river probe on
        -- opts.v17RiverProbe === true; it has been opt-in since 2026-10-16.
        v_findings := v_findings || jsonb_build_object(
          'severity','note','category','logic','code','layer_default_off',
          'title','Opt-in layer v17_river_probe did not fire (default OFF since 2026-10-16)',
          'evidence', jsonb_build_object(
            'feature','v17_river_probe','decide_fires', v_decides,
            'flag','v17RiverProbe','default','off',
            'ruling','v17_river_probe measured -0.11 +/- 0.04 bb/100 pooled over the 8 runs to 2026-10-16 and -0.02 +/- 0.03 over all 32 runs since 2026-09-15: never positive; HorseLogic gates the probe on opts.v17RiverProbe === true.'),
          'recommendation','Nothing to fix. Zero fires is the default-off flag working. Do not turn the flag on to silence this; flip it only on a pooled-SIGNIFICANT positive league result.'
        );
      elsif feat.feature = 'v16_hu_overlay' then
        -- DEFAULT OFF, NOT SILENT. HorseLogic gates the overlay on
        -- opts.v16Hu === true; it has been opt-in since 2026-10-05.
        v_findings := v_findings || jsonb_build_object(
          'severity','note','category','logic','code','layer_default_off',
          'title','Opt-in layer v16_hu_overlay did not fire (default OFF since 2026-10-05)',
          'evidence', jsonb_build_object(
            'feature','v16_hu_overlay','decide_fires', v_decides,
            'flag','v16Hu','default','off',
            'ruling','hu_v16_overlay measured -0.26 +/- 0.10 bb/100 pooled over 31 nightly runs (z -2.6); HorseLogic gates the overlay on opts.v16Hu === true.'),
          'recommendation','Nothing to fix. Zero fires is the default-off flag working. Do not turn the flag on to silence this; flip it only on a pooled-SIGNIFICANT positive league result.'
        );
      elsif feat.feature = 'v16_reads_tell' then
        -- OBSERVER-GATED, NOT DEAD (2026-11-07). Since #8075 (2026-10-25)
        -- each horse reads only what it observed itself; the V16 tell needs
        -- five big river bets by one player that reached showdown, seen by
        -- one horse in one variant/format/size scope. Public history is
        -- card-free, so a restart cannot rehydrate it, and the owner-approved
        -- herd notes (#8235) carry no showdown counter. 23,562 fires on
        -- 2026-10-25, 1,206 on 10-26, 0 from 11-01: the step is that change.
        v_findings := v_findings || jsonb_build_object(
          'severity','note','category','logic','code','layer_observer_gated',
          'title','Observer-gated layer v16_reads_tell did not fire (needs one horse''s own 5 big-bet showdowns of one player)',
          'evidence', jsonb_build_object(
            'feature','v16_reads_tell','decide_fires', v_decides,
            'gate','HorseMind.bigBetValueTendency: bigBetSD >= 5 in the observing horse''s own sandbox',
            'ruling','Observer-independent memory (#8075, 2026-10-25) is deliberate: no horse reads another horse''s observations. Card-free public history (#8214) cannot rebuild showdown counters, and pooled herd notes (#8235) carry none. Fires: 23,562 on 2026-10-25, 1,206 on 10-26, 0 every day 2026-11-01..11-07.'),
          'recommendation','Nothing to fix in the wiring (HorseObserverDeepReads.test.ts proves the tell fires once the horse has seen the sample). Do not pool private showdown observations to silence this; a herd showdown counter would be a new strategy input and ships flagged with a league matchup.'
        );
      else
        v_findings := v_findings || jsonb_build_object(
          'severity', feat.severity,'category','logic','code','layer_silent',
          'title','Deployed layer ' || feat.feature || ' fired ZERO times',
          'evidence', jsonb_build_object('feature', feat.feature,'decide_fires', v_decides,'expectation', feat.why),
          'recommendation','The code is deployed but never executes at live tables. Find the gate that turned it off - flag defaults, wiring, an upstream condition that can no longer be true, or a threshold on the wrong scale.'
        );
      end if;
    end if;
  end loop;

  return v_findings;
end $function$;

-- Operator telemetry: re-state the installed grants (production already has
-- anon/authenticated without EXECUTE, service_role with it, checked
-- 2026-11-07); CREATE OR REPLACE keeps them, this makes the file say so.
REVOKE ALL ON FUNCTION public.fn_audit_layer_silence(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_layer_silence(date) TO service_role;

COMMIT;
