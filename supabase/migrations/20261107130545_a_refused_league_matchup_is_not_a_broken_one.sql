DO $mig$
DECLARE
  v_def text;
  v_old_select text := 'for r in select matchup, bb100, stderr, illegal_actions, truncated_streets, harness_corrected_actions, brain_exception_fallbacks, engine_sha from horse_league_results';
  v_new_select text := 'for r in select matchup, bb100, stderr, illegal_actions, truncated_streets, harness_corrected_actions, brain_exception_fallbacks, engine_sha, status, refusal_reason, hands from horse_league_results';
  v_old_neg text := 'if r.bb100 < 0 and abs(r.bb100) > 2 * r.stderr then';
  v_new_neg text;
BEGIN
  v_new_neg :=
    'if coalesce(r.status, ''measured'') = ''refused'' then' || E'\n' ||
    '      v_findings := v_findings || jsonb_build_object(''severity'',''info'',''category'',''gto'',''code'',''league_matchup_refused'',' || E'\n' ||
    '        ''title'',''League matchup '' || r.matchup || '' is REFUSED, not broken'',' || E'\n' ||
    '        ''evidence'', jsonb_build_object(''matchup'',r.matchup,''hands'',r.hands,''status'',r.status,''refusal_reason'',r.refusal_reason),' || E'\n' ||
    '        ''recommendation'',''This matchup recorded a reasoned refusal instead of a measurement. Read refusal_reason: it states why self-play cannot answer this question and what would change that. Zero hands is the documented outcome here, not a failure, and no ablation or default change follows from it.'');' || E'\n' ||
    '      continue;' || E'\n' ||
    '    end if;' || E'\n' ||
    '    if coalesce(r.hands, 0) = 0 then' || E'\n' ||
    '      v_findings := v_findings || jsonb_build_object(''severity'',''critical'',''category'',''logic'',''code'',''league_matchup_measured_nothing'',' || E'\n' ||
    '        ''title'',''League matchup '' || r.matchup || '' was due to measure and produced ZERO hands'',' || E'\n' ||
    '        ''evidence'', jsonb_build_object(''matchup'',r.matchup,''hands'',r.hands,''status'',r.status,''engine_sha'',r.engine_sha),' || E'\n' ||
    '        ''recommendation'',''This row carries no refusal, so the harness was expected to deal and dealt nothing. Find why it dealt nothing before trusting any other league verdict from this run.'');' || E'\n' ||
    '      continue;' || E'\n' ||
    '    end if;' || E'\n' ||
    '    if r.bb100 < 0 and abs(r.bb100) > 2 * r.stderr and coalesce(r.hands, 0) >= 1000 then';

  v_def := pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure);

  IF position(v_old_select in v_def) = 0 THEN
    RAISE EXCEPTION 'league select anchor not found - refusing to edit blind';
  END IF;
  IF position(v_old_neg in v_def) = 0 THEN
    RAISE EXCEPTION 'league negative-verdict anchor not found - refusing to edit blind';
  END IF;

  v_def := replace(v_def, v_old_select, v_new_select);
  v_def := replace(v_def, v_old_neg, v_new_neg);

  IF position(v_old_neg in v_def) <> 0 THEN
    RAISE EXCEPTION 'negative-verdict anchor still present after edit';
  END IF;
  IF position('league_matchup_refused' in v_def) = 0
     OR position('league_matchup_measured_nothing' in v_def) = 0
     OR position('refusal_reason, hands from horse_league_results' in v_def) = 0 THEN
    RAISE EXCEPTION 'edit did not take';
  END IF;

  EXECUTE v_def;
END
$mig$;