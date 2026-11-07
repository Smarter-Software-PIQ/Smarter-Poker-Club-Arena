-- ═══════════════════════════════════════════════════════════════════════════
-- A REFUSED LEAGUE MATCHUP IS NOT A BROKEN ONE (2026-11-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The 2026-11-06 audit reported three Critical flaws. Two of them were not
-- flaws. It read `hands = 0` on six league matchups (v16_ratio_rescale,
-- v18_exploit_size, v31_gto_suit_aware and three v55 arms) and called them
-- "league matchups that measured nothing". Every one of those rows carries
-- status = 'refused' and a refusal_reason that states, at length, why
-- self-play cannot answer the question and what would change that. The
-- v16Ratio row even ends with the sentence "Read this row, not the absence
-- of one, when deciding v16Ratio."
--
-- The audit could not read it. The league loop in fn_run_horse_daily_audit
-- selects matchup, bb100, stderr, illegal_actions, truncated_streets,
-- harness_corrected_actions, brain_exception_fallbacks and engine_sha - and
-- neither status, nor refusal_reason, nor hands. So a reasoned refusal and a
-- silent harness failure look identical to it, and BOTH are invisible: there
-- was no check anywhere for a matchup that was due to measure and dealt
-- nothing.
--
-- This gives the loop those three columns and splits the two cases:
--   * status = 'refused'       -> info, carrying the reason. Zero hands is
--     the documented outcome; no ablation or default change follows from it.
--   * not refused, hands = 0   -> CRITICAL. This is the case that had no
--     instrument at all: the harness was expected to deal and dealt nothing.
--   * the NEGATIVE verdict now also requires >= 1000 hands, so one divergent
--     pair in a probe (bb100 = stderr, which the v55 card has already
--     produced once) can never be promoted into a Critical "resolves
--     NEGATIVE". Every genuinely measured matchup on the card deals >= 8000.
--
-- Surgery, not a retype: the body is 30k of audited SQL, so it is edited in
-- place from pg_get_functiondef and nothing else in it can drift. Both
-- anchors are asserted present before the edit and gone after it.

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
