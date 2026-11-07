-- ═══════════════════════════════════════════════════════════════════════════
-- THE LEAGUE LOOP DEFERS REFUSALS TO THEIR OWN INSTRUMENT (2026-11-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Correcting the migration applied minutes ago. It added a
-- 'league_matchup_refused' finding to the inline league loop in
-- fn_run_horse_daily_audit on the premise that the audit had no concept of a
-- refused matchup. That premise was WRONG: fn_audit_nightly_job_health
-- already reports every refused matchup with its reason
-- (league_matchup_refused), already reports a matchup that dealt real hands
-- and returned exactly zero (league_matchup_inert), and already reports a
-- matchup that was refused in the last week and then went quiet
-- (league_refusal_went_silent). Its staleness checks correctly read
-- `status <> 'refused'` throughout. The six info findings in the 2026-11-06
-- row came from there.
--
-- So the audit was right about refusals and the 2026-11-06 analysis summary
-- was wrong to call them "league matchups that measured nothing". Leaving my
-- addition in would double-report all six every night, which is the same
-- crying-wolf it was meant to cure.
--
-- The emission is removed. What is kept from that migration, because nothing
-- else covers it:
--   * the status/refusal_reason/hands columns on the loop;
--   * the bare `continue` for a refused row, so it can never reach the
--     NEGATIVE verdict on a one-pair probe;
--   * 'league_matchup_measured_nothing' (critical) for a NON-refused row
--     with hands = 0. league_matchup_inert requires hands > 0, so a matchup
--     that was due to deal and dealt nothing at all still had no instrument;
--   * the >= 1000 hands floor on the negative verdict as a safety rail.

DO $mig$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_old :=
    'v_findings := v_findings || jsonb_build_object(''severity'',''info'',''category'',''gto'',''code'',''league_matchup_refused'',' || E'\n' ||
    '        ''title'',''League matchup '' || r.matchup || '' is REFUSED, not broken'',' || E'\n' ||
    '        ''evidence'', jsonb_build_object(''matchup'',r.matchup,''hands'',r.hands,''status'',r.status,''refusal_reason'',r.refusal_reason),' || E'\n' ||
    '        ''recommendation'',''This matchup recorded a reasoned refusal instead of a measurement. Read refusal_reason: it states why self-play cannot answer this question and what would change that. Zero hands is the documented outcome here, not a failure, and no ablation or default change follows from it.'');';

  v_new :=
    '-- fn_audit_nightly_job_health already reports every refused matchup' || E'\n' ||
    '      -- (league_matchup_refused, with the reason) and league_refusal_went_silent' || E'\n' ||
    '      -- if one stops saying so. Reporting it here too would double it. Skipping' || E'\n' ||
    '      -- also keeps a one-pair probe out of the NEGATIVE verdict below.';

  v_def := pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure);

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'refused-emission block not found - nothing to correct';
  END IF;

  v_def := replace(v_def, v_old, v_new);

  IF position('''code'',''league_matchup_refused''' in v_def) <> 0 THEN
    RAISE EXCEPTION 'duplicate refused emission still present after correction';
  END IF;
  IF position('league_matchup_measured_nothing' in v_def) = 0
     OR position('refusal_reason, hands from horse_league_results' in v_def) = 0
     OR position('coalesce(r.hands, 0) >= 1000' in v_def) = 0 THEN
    RAISE EXCEPTION 'correction removed something it was meant to keep';
  END IF;

  EXECUTE v_def;
END
$mig$;