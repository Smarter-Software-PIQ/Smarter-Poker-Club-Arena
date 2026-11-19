-- 20261119173100_equity_coverage_recovers_on_the_last_day.sql
--
-- EQUITY COVERAGE RECOVERS ON THE LAST DAY (ca_stats_witness_audit, ca_stats_health, 2026-11-19)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, 2026-11-19 ~17:25 UTC)
--
-- StatsAllInEquityCoverageLow fires on poker_stats_ev_coverage_7d < 0.99 with
-- at least 50 owed runout seats. The fix for the missing equity went live at
-- the 10:00 UTC cutover; the audit log's 7-day pair read 304,755 owed and
-- 9,332 without equity (96.9%) and will stay under the bar for days while the
-- pre-fix week ages out. Read from ca_hand_facts at the same time: the last
-- 6 h carried 17,544 owed and 137 missing (99.2%). A seven-day number alone
-- cannot say a fixed writer is fixed.
--
-- THE FIX
--
-- The witness audit also measures the last 24 hours with the same rule (a
-- seat owes equity when it was all-in before the river, reached showdown, and
-- carries a figure or saw no check, bet or raise after the hand's last
-- all-in), on EVERY run: it reads about 40,000 seats in ~1.3 s, where the
-- 7-day read stays hourly. Two new columns hold it (allin_showdown_24h,
-- allin_showdown_without_equity_24h) and ca_stats_health() publishes it as
-- evCoverage24h beside the unchanged evCoverage7d. The engine exports it as
-- poker_stats_ev_coverage_24h / poker_stats_allin_showdowns_24h and both the
-- engine alert and the Prometheus rule stand down once the last day is back
-- over the bar on a real sample, and fire as before otherwise.
--
-- Pinned pre/postimage substitutions; a re-apply is a no-op.
--
-- @live-proof: position('evCoverage24h' in pg_get_functiondef('public.ca_stats_health()'::regprocedure)) > 0 AND position('v_allin_sd_24h' in pg_get_functiondef('public.ca_stats_witness_audit(integer,integer)'::regprocedure)) > 0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '240s';

ALTER TABLE public.ca_stats_witness_audit_log ADD COLUMN IF NOT EXISTS allin_showdown_24h integer;
ALTER TABLE public.ca_stats_witness_audit_log ADD COLUMN IF NOT EXISTS allin_showdown_without_equity_24h integer;

CREATE FUNCTION pg_temp.evc_subst(p_sig text, p_before text, p_after text,
                                  p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) = p_after THEN
    RAISE NOTICE '%: already the postimage, nothing to do', p_sig;
    RETURN;
  END IF;
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %)', p_sig, md5(v_def);
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

-- 1. The audit measures the last 24 hours on every run.
SELECT pg_temp.evc_subst(
  'public.ca_stats_witness_audit(integer,integer)',
  'f2b2f73202c042c5189151c62fcbcdc4', '02373004c0db2fb9475e5039e3dea4d8',
  ARRAY[
$o1$  v_allin_sd_no_eq    integer := 0;
$o1$,
$o2$  END IF;

  /* The pre-2026-10-03 form, kept unexecuted for the record:$o2$,
$o3$    human_player_hands, human_without_facts, allin_showdown_7d, allin_showdown_without_equity_7d,
    idx_lag_seconds, repair_done, duration_ms
  ) VALUES ($o3$,
$o4$    v_human_hands, v_human_no_facts, v_allin_sd, v_allin_sd_no_eq,
    v_idx_lag, v_repair_done,$o4$],
  ARRAY[
$n1$  v_allin_sd_no_eq    integer := 0;
  v_allin_sd_24h      integer;
  v_allin_sd_no_eq_24h integer;
$n1$,
$n2$  END IF;

  /* 2g. EV coverage, last 24 hours, on EVERY run (20261119173100). The same
     rule as 2f over one day: about 40,000 seats, ~1.3 s measured. The 7-day
     pair cannot say a fixed writer is fixed until the bad days age out; this
     one says it within a day, and the alerts stand down on it. */
  SELECT count(*) FILTER (WHERE x.has_eq OR NOT coalesce(x.betting_continued, true))::int,
         count(*) FILTER (WHERE NOT x.has_eq AND NOT coalesce(x.betting_continued, true))::int
    INTO v_allin_sd_24h, v_allin_sd_no_eq_24h
  FROM (
    SELECT f.all_in_equity IS NOT NULL AS has_eq,
           CASE WHEN f.all_in_equity IS NULL THEN
             (SELECT bool_or(a.act->>'action' IN ('check', 'bet', 'raise') AND a.ord > la.last_allin)
                FROM public.hand_history h
                CROSS JOIN LATERAL (
                  SELECT max(b.ord) AS last_allin
                  FROM jsonb_array_elements(h.actions) WITH ORDINALITY b(act, ord)
                  WHERE b.act->>'action' IN ('all_in', 'allin')
                ) la
                CROSS JOIN LATERAL jsonb_array_elements(h.actions) WITH ORDINALITY a(act, ord)
               WHERE h.id = f.hand_id)
           END AS betting_continued
      FROM public.ca_hand_facts f
     WHERE f.was_all_in = true
       AND f.went_to_showdown
       AND coalesce(f.all_in_street, '') <> 'river'
       AND f.played_at >= now() - interval '24 hours'
    OFFSET 0
  ) x;

  /* The pre-2026-10-03 form, kept unexecuted for the record:$n2$,
$n3$    human_player_hands, human_without_facts, allin_showdown_7d, allin_showdown_without_equity_7d,
    allin_showdown_24h, allin_showdown_without_equity_24h,
    idx_lag_seconds, repair_done, duration_ms
  ) VALUES ($n3$,
$n4$    v_human_hands, v_human_no_facts, v_allin_sd, v_allin_sd_no_eq,
    v_allin_sd_24h, v_allin_sd_no_eq_24h,
    v_idx_lag, v_repair_done,$n4$]);

-- @probe-for: public.ca_stats_witness_audit
DO $probe$
DECLARE r jsonb;
BEGIN
  r := public.ca_stats_witness_audit(10, 90);
  IF (r->>'allin_showdown_24h') IS NULL OR (r->>'allin_showdown_without_equity_24h') IS NULL THEN
    RAISE EXCEPTION 'the audit did not record its 24 h equity coverage: %', r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- 2. ca_stats_health() publishes it beside the 7-day figure.
SELECT pg_temp.evc_subst(
  'public.ca_stats_health()',
  'edbe14c1d8a1c82dd4d210402104e4d1', 'b2d391dd9b0e42daba4e4ef58a014d96',
  ARRAY[
$h1$           allin_showdown_7d, allin_showdown_without_equity_7d, duration_ms$h1$,
$h2$    'lastAudit', (SELECT jsonb_build_object($h2$],
  ARRAY[
$k1$           allin_showdown_7d, allin_showdown_without_equity_7d, duration_ms,
           allin_showdown_24h, allin_showdown_without_equity_24h$k1$,
$k2$    -- The last 24 hours by the same rule (20261119173100): the alerts stand
    -- down on it once a fix is live, without waiting a week. NULL until the
    -- first audit after that migration has run.
    'evCoverage24h', (SELECT jsonb_build_object(
                       'allInShowdowns', allin_showdown_24h,
                       'withoutEquity', allin_showdown_without_equity_24h,
                       'ratio', CASE WHEN allin_showdown_24h > 0
                                     THEN round((allin_showdown_24h - allin_showdown_without_equity_24h)::numeric
                                                / allin_showdown_24h, 4)
                                     ELSE NULL END)
                      FROM audit WHERE allin_showdown_24h IS NOT NULL),
    'lastAudit', (SELECT jsonb_build_object($k2$]);

COMMIT;
