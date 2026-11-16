-- Original BBJ contributions and stack awards, beside the unchanged invoice totals.
-- Report-only extension of the existing atomic aggregate/journal and finite loader.
-- Old rows are not zero BBJ: versioned source coverage refuses their reconciliation
-- until the original accounting day is reconstructed by the maintained loader.
-- @live-proof: EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ca_club_acct_fact' AND column_name='bbj_gross') AND to_regprocedure('public.fn_ca_club_acct_reconciliation(uuid,date,date,jsonb,uuid[],uuid[])') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.fn_ca_club_acct_cash_fee_rows(jsonb)') AND position('bbj_attributed_contribution' IN prosrc)>0)
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='60s';

ALTER TABLE public.ca_club_acct_fact ADD COLUMN bbj_gross numeric NOT NULL DEFAULT 0, ADD COLUMN bbj_awards numeric NOT NULL DEFAULT 0;
ALTER TABLE public.ca_club_acct_fact_journal ADD COLUMN bbj_gross numeric NOT NULL DEFAULT 0, ADD COLUMN bbj_awards numeric NOT NULL DEFAULT 0;
ALTER TABLE public.ca_club_acct_seed_log ADD COLUMN bbj_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.ca_club_acct_seed_parts ADD COLUMN bbj_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.ca_club_acct_state ADD COLUMN bbj_live_from timestamptz, ADD COLUMN bbj_attachment_xid xid8;
UPDATE public.ca_club_acct_state SET bbj_live_from=clock_timestamp(),bbj_attachment_xid=pg_current_xact_id() WHERE singleton=true;

CREATE FUNCTION public.fn_ca_club_acct_bbj_source_missing(p_record uuid,p_player uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path=public AS $function$
BEGIN RAISE EXCEPTION 'CLUB_DATA_BBJ_ORIGINAL_SOURCE_INCOMPLETE: record %, player %',p_record,p_player; END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_club_acct_bbj_source_missing(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_ca_club_acct_put(jsonb,smallint)'::regprocedure)) <> 'faee3c233534da8545924f09fe010789' THEN RAISE EXCEPTION 'DATA_RECONCILIATION_PREIMAGE_CHANGED: fn_ca_club_acct_put('; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_put(p_rows jsonb, p_src smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT x.club_id, x.acct_day, min(x.kind) AS kind, x.game_id, x.user_id, min(x.union_id::text)::uuid AS union_id,
           sum(COALESCE(x.fee, 0)) AS fee, sum(COALESCE(x.result, 0)) AS result, sum(COALESCE(x.buyins, 0)) AS buyins,
           sum(COALESCE(x.cashouts, 0)) AS cashouts, sum(COALESCE(x.hands, 0))::bigint AS hands, sum(coalesce(x.bbj_gross,0)) AS bbj_gross, sum(coalesce(x.bbj_awards,0)) AS bbj_awards, max(x.at) AS at
      FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS x(club_id uuid, acct_day date, kind text, game_id uuid,
             user_id uuid, union_id uuid, fee numeric, result numeric, buyins numeric, cashouts numeric, hands bigint,
             at timestamptz, bbj_gross numeric, bbj_awards numeric)
     WHERE x.club_id IS NOT NULL AND x.acct_day IS NOT NULL AND x.game_id IS NOT NULL AND x.user_id IS NOT NULL
       AND x.kind IN ('CASH', 'TOURNAMENT') AND x.at IS NOT NULL
     GROUP BY x.club_id, x.acct_day, x.game_id, x.user_id
     ORDER BY x.club_id, x.acct_day, x.game_id, x.user_id
  LOOP
    CONTINUE WHEN r.fee = 0 AND r.result = 0 AND r.buyins = 0 AND r.cashouts = 0 AND r.hands = 0 AND r.bbj_gross = 0 AND r.bbj_awards = 0;
    IF p_src <> 0
       OR public.fn_ca_club_acct_own('f:' || r.club_id || ':' || r.acct_day || ':' || r.game_id || ':' || r.user_id) THEN
      INSERT INTO public.ca_club_acct_fact AS f
        (club_id, acct_day, kind, game_id, user_id, union_id, fee, result, buyins, cashouts, hands, last_at, src, bbj_gross, bbj_awards)
      VALUES (r.club_id, r.acct_day, r.kind, r.game_id, r.user_id, r.union_id, r.fee, r.result, r.buyins, r.cashouts,
              r.hands, r.at, p_src, r.bbj_gross, r.bbj_awards)
      ON CONFLICT (club_id, acct_day, game_id, user_id, src) DO UPDATE
         SET bbj_gross=f.bbj_gross+EXCLUDED.bbj_gross, bbj_awards=f.bbj_awards+EXCLUDED.bbj_awards,
             fee = f.fee + EXCLUDED.fee, result = f.result + EXCLUDED.result,
             buyins = f.buyins + EXCLUDED.buyins, cashouts = f.cashouts + EXCLUDED.cashouts,
             hands = f.hands + EXCLUDED.hands, union_id = COALESCE(f.union_id, EXCLUDED.union_id),
             last_at = GREATEST(f.last_at, EXCLUDED.last_at);
    ELSE
      INSERT INTO public.ca_club_acct_fact_journal
        (club_id, acct_day, kind, game_id, user_id, union_id, fee, result, buyins, cashouts, hands, last_at, bbj_gross, bbj_awards)
      VALUES (r.club_id, r.acct_day, r.kind, r.game_id, r.user_id, r.union_id, r.fee, r.result, r.buyins, r.cashouts,
              r.hands, r.at, r.bbj_gross, r.bbj_awards);
    END IF;
  END LOOP;
END;
$function$
;

DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_ca_club_acct_cash_fee_rows(jsonb)'::regprocedure)) <> '12fdc37036655c90dd69f5b94527d406' THEN RAISE EXCEPTION 'DATA_RECONCILIATION_PREIMAGE_CHANGED: fn_ca_club_acct_cash_fee_rows('; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_cash_fee_rows(p_sources jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', COALESCE(a.funding_club_id, s.club_id),
           'acct_day', public.fn_ca_accounting_day(s.earned_at),
           'kind', 'CASH',
           'game_id', COALESCE(rr.table_id, '00000000-0000-0000-0000-0000000000c1'::uuid),
           'user_id', COALESCE(s.player_id, '00000000-0000-0000-0000-000000000000'::uuid),
           'union_id', s.union_id, 'fee', s.rake_credit, 'bbj_gross', CASE WHEN original_bbj.n=1 AND original_bbj.credit IS NOT NULL THEN original_bbj.credit
           WHEN rr.id IS NOT NULL AND rr.bbj_contribution=0 THEN 0
           ELSE public.fn_ca_club_acct_bbj_source_missing(s.rake_record_id,s.player_id) END, 'at', s.earned_at)), '[]'::jsonb)
    FROM jsonb_to_recordset(COALESCE(p_sources, '[]'::jsonb)) AS s(id uuid, rake_record_id uuid, player_id uuid,
                                            club_id uuid, union_id uuid, earned_at timestamptz, rake_credit numeric)
    LEFT JOIN public.rake_records rr ON rr.id = s.rake_record_id
    LEFT JOIN LATERAL (SELECT count(*) AS n,max(ra.bbj_attributed_contribution) AS credit
      FROM public.rake_attributions ra WHERE ra.rake_record_id=s.rake_record_id AND ra.player_id=s.player_id) original_bbj ON true
    LEFT JOIN public.accounting_cash_funding_contract_admissions a ON a.source_id = s.id
    LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at)
      ON bd.club_id = COALESCE(a.funding_club_id, s.club_id)
   WHERE s.union_id IS NOT NULL AND s.earned_at IS NOT NULL AND isfinite(s.earned_at)
     AND EXISTS (SELECT 1 FROM public.unions u WHERE u.id = s.union_id)
     AND (bd.cutoff_at IS NULL OR s.earned_at >= bd.cutoff_at);
$function$
;

DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_ca_club_acct_admission_rows(jsonb)'::regprocedure)) <> '67cf18e1303b1d1d36c346b3aa8e9243' THEN RAISE EXCEPTION 'DATA_RECONCILIATION_PREIMAGE_CHANGED: fn_ca_club_acct_admission_rows('; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_admission_rows(p_admissions jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH a AS (
    SELECT s.*, x.funding_club_id, rr.table_id, CASE WHEN original_bbj.n=1 AND original_bbj.credit IS NOT NULL THEN original_bbj.credit
           WHEN rr.id IS NOT NULL AND rr.bbj_contribution=0 THEN 0
           ELSE public.fn_ca_club_acct_bbj_source_missing(s.rake_record_id,s.player_id) END AS original_bbj
      FROM jsonb_to_recordset(COALESCE(p_admissions, '[]'::jsonb)) AS x(source_id uuid, funding_club_id uuid)
      JOIN public.accounting_cash_rake_sources s ON s.id = x.source_id
      LEFT JOIN public.rake_records rr ON rr.id = s.rake_record_id
    LEFT JOIN LATERAL (SELECT count(*) AS n,max(ra.bbj_attributed_contribution) AS credit
      FROM public.rake_attributions ra WHERE ra.rake_record_id=s.rake_record_id AND ra.player_id=s.player_id) original_bbj ON true
     WHERE x.funding_club_id IS DISTINCT FROM s.club_id AND s.union_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.unions u WHERE u.id = s.union_id)
       AND s.earned_at IS NOT NULL AND isfinite(s.earned_at)
  ), sides AS (
    SELECT a.club_id AS club, -1 AS sign, a.* FROM a
    UNION ALL
    SELECT a.funding_club_id, 1, a.* FROM a
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', x.club, 'acct_day', public.fn_ca_accounting_day(x.earned_at), 'kind', 'CASH',
           'game_id', COALESCE(x.table_id, '00000000-0000-0000-0000-0000000000c1'::uuid),
           'user_id', COALESCE(x.player_id, '00000000-0000-0000-0000-000000000000'::uuid),
           'union_id', x.union_id, 'fee', x.sign * x.rake_credit, 'bbj_gross', x.sign*x.original_bbj, 'at', x.earned_at)), '[]'::jsonb)
    FROM sides x
    LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at) ON bd.club_id = x.club
   WHERE x.club IS NOT NULL AND (bd.cutoff_at IS NULL OR x.earned_at >= bd.cutoff_at);
$function$
;

DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_ca_club_acct_bbj_rows(uuid,uuid,timestamp with time zone)'::regprocedure)) <> 'a3eab4f306fa942c1190bd19b373004a' THEN RAISE EXCEPTION 'DATA_RECONCILIATION_PREIMAGE_CHANGED: fn_ca_club_acct_bbj_rows('; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_bbj_rows(p_payout uuid, p_user uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', a.club_id, 'acct_day', public.fn_ca_accounting_day(p_at), 'kind', 'CASH',
           'game_id', b.table_id, 'user_id', p_user, 'union_id', t.union_id,
           'result', a.amount, 'bbj_awards', a.amount, 'at', p_at)), '[]'::jsonb)
    FROM public.bbj_payouts b
    JOIN public.tables t ON t.id = b.table_id AND t.union_id IS NOT NULL
    CROSS JOIN LATERAL public.fn_union_pnl_week_bbj_stack_awards(t.union_id, p_at, p_at + interval '1 day') a
   WHERE b.id = p_payout AND a.payout_id = p_payout AND a.user_id = p_user AND a.club_id IS NOT NULL;
$function$
;

DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_ca_club_acct_seed_begin(date,boolean)'::regprocedure)) <> '3760de90a4bc2d9f089a725e8a2dfcb4' THEN RAISE EXCEPTION 'DATA_RECONCILIATION_PREIMAGE_CHANGED: fn_ca_club_acct_seed_begin('; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_seed_begin(p_day date, p_rebuild boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'smarter_private'
 SET statement_timeout TO '240s'
 SET work_mem TO '128MB'
AS $function$
DECLARE
  v_lo timestamptz := public.fn_ca_accounting_day_start(p_day);
  v_hi timestamptz := public.fn_ca_accounting_day_start(p_day + 1);
  v_snap pg_snapshot := pg_current_snapshot();
  v_live_day date;
  n_live bigint; n_fix bigint; v jsonb; r jsonb; n_bbj bigint;
BEGIN
  IF p_day IS NULL THEN
    RAISE EXCEPTION 'club data accounting load needs a day' USING ERRCODE = '22023';
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'club data accounting load begins in one REPEATABLE READ transaction';
  END IF;
  IF EXISTS(SELECT 1 FROM public.ca_club_acct_state s
    WHERE pg_snapshot_xmin(v_snap)<=s.bbj_attachment_xid) THEN
    RAISE EXCEPTION 'CLUB_DATA_BBJ_PREATTACHMENT_TRANSACTION_STILL_OPEN';
  END IF;
  SELECT public.fn_ca_accounting_day(s.live_from) INTO v_live_day FROM public.ca_club_acct_state s;
  IF v_live_day IS NULL THEN
    RAISE EXCEPTION 'club data accounting load waits for the live projection (20261115020011)';
  END IF;
  IF p_day > public.fn_ca_accounting_day(now()) THEN
    RAISE EXCEPTION 'accounting day % is after the live projection''s day %; the live projection holds it', p_day, v_live_day
      USING ERRCODE = '22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:seed', 0)) THEN
    RAISE EXCEPTION 'another club data accounting load is running';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = p_day) THEN
    IF NOT p_rebuild THEN RAISE EXCEPTION 'accounting day % is already loaded', p_day; END IF;
    DELETE FROM public.ca_club_acct_seed_log WHERE acct_day = p_day;
  END IF;
  DELETE FROM public.ca_club_acct_seed_parts WHERE acct_day = p_day;
  DELETE FROM public.ca_club_acct_fact WHERE acct_day = p_day AND src = 1;
  DELETE FROM public.ca_club_acct_hands WHERE acct_day = p_day AND src = 1;

  PERFORM public.fn_ca_club_acct_put((
    SELECT jsonb_agg(jsonb_build_object('club_id', f.club_id, 'acct_day', f.acct_day, 'kind', f.kind,
             'game_id', f.game_id, 'user_id', f.user_id, 'union_id', f.union_id, 'fee', -f.fee, 'result', -f.result,
             'bbj_gross',-f.bbj_gross,'bbj_awards',-f.bbj_awards,'buyins', -f.buyins, 'cashouts', -f.cashouts, 'hands', -f.hands, 'at', f.last_at))
      FROM public.ca_club_acct_fact f WHERE f.acct_day = p_day AND f.src = 0), 1::smallint);
  PERFORM public.fn_ca_club_acct_put_hands((
    SELECT jsonb_agg(jsonb_build_object('club_id', h.club_id, 'acct_day', h.acct_day, 'table_id', h.table_id,
             'hands', -h.hands))
      FROM public.ca_club_acct_hands h WHERE h.acct_day = p_day AND h.src = 0), 1::smallint);
  DELETE FROM public.ca_club_acct_fact_journal j WHERE j.acct_day = p_day;
  GET DIAGNOSTICS n_live = ROW_COUNT;
  DELETE FROM public.ca_club_acct_hands_journal j WHERE j.acct_day = p_day;

  -- Inside S: the day's rows of S's xmin or newer.
  r := public.fn_ca_club_acct_seed_read(p_day, v_lo, v_hi, v_snap, true);

  -- Inside S: the day's Bad Beat Jackpot stack awards (few; all of them).
  v := COALESCE((
    SELECT jsonb_agg(x) FROM public.bbj_payout_recipients b
     CROSS JOIN LATERAL jsonb_array_elements(public.fn_ca_club_acct_bbj_rows(b.payout_id, b.user_id, b.created_at)) x
     WHERE b.created_at >= v_lo AND b.created_at < v_hi), '[]'::jsonb);
  PERFORM public.fn_ca_club_acct_put(v, 1::smallint);
  n_bbj := jsonb_array_length(v);

  -- Inside S: every projection failure of the day that S holds is made whole
  -- by this load (its source row is in S); a boundary's only by loading it.
  UPDATE public.ca_club_acct_projection_failures pf SET resolved_at = clock_timestamp()
   WHERE pf.acct_day = p_day AND pf.resolved_at IS NULL AND pf.source NOT LIKE 'pnl_boundary%';
  GET DIAGNOSTICS n_fix = ROW_COUNT;

  INSERT INTO public.ca_club_acct_seed_parts (acct_day, kind, part_lo, part_hi, snapshot, fact_inputs, hand_inputs, unclassified, bbj_version)
  VALUES (p_day, 'begin', v_lo, v_lo, v_snap::text, (r->>'fact_inputs')::bigint + n_bbj, (r->>'hand_inputs')::bigint,
          (r->>'unclassified_flows')::bigint,1);

  RETURN jsonb_build_object('acct_day', p_day, 'snapshot', v_snap::text, 'journal_rows_folded', n_live,
                            'recent', r, 'bbj_rows', n_bbj, 'failures_resolved', n_fix);
END;
$function$
;

DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_ca_club_acct_seed_finish(date,pg_snapshot,bigint,bigint,bigint)'::regprocedure)) <> 'b1795adcd82bf801aeedb8471537be9a' THEN RAISE EXCEPTION 'DATA_RECONCILIATION_PREIMAGE_CHANGED: fn_ca_club_acct_seed_finish('; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_seed_finish(p_day date, p_snap pg_snapshot, p_unclassified bigint, p_fact_inputs bigint, p_hand_inputs bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'smarter_private'
 SET statement_timeout TO '240s'
 SET work_mem TO '128MB'
AS $function$
DECLARE
  v_lo timestamptz := public.fn_ca_accounting_day_start(p_day);
  v_hi timestamptz := public.fn_ca_accounting_day_start(p_day + 1);
  v_gaps bigint; v_first timestamptz; v_last timestamptz; v_other bigint;
  n_f bigint; n_h bigint; n_u bigint;
BEGIN
  IF p_day IS NULL OR p_snap IS NULL THEN
    RAISE EXCEPTION 'club data accounting finish needs a day and its snapshot' USING ERRCODE = '22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:seed', 0)) THEN
    RAISE EXCEPTION 'another club data accounting load is running';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = p_day) THEN
    RAISE EXCEPTION 'accounting day % is already loaded', p_day;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ca_club_acct_seed_parts sp
                  WHERE sp.acct_day = p_day AND sp.kind = 'begin' AND sp.snapshot = p_snap::text) THEN
    RAISE EXCEPTION 'accounting day % has no load begun with snapshot %; begin it again', p_day, p_snap::text;
  END IF;
  SELECT count(*) FILTER (WHERE sp.snapshot <> p_snap::text) INTO v_other
    FROM public.ca_club_acct_seed_parts sp WHERE sp.acct_day = p_day;
  SELECT count(*) FILTER (WHERE x.prev_hi IS DISTINCT FROM x.part_lo AND x.rn > 1), min(x.part_lo), max(x.part_hi)
    INTO v_gaps, v_first, v_last
    FROM (SELECT sp.part_lo, sp.part_hi, lag(sp.part_hi) OVER (ORDER BY sp.part_lo) AS prev_hi,
                 row_number() OVER (ORDER BY sp.part_lo) AS rn
            FROM public.ca_club_acct_seed_parts sp WHERE sp.acct_day = p_day AND sp.kind = 'slice') x;
  IF v_other > 0 OR v_gaps IS DISTINCT FROM 0 OR v_first IS DISTINCT FROM v_lo OR v_last IS DISTINCT FROM v_hi THEN
    RAISE EXCEPTION 'accounting day % is not covered exactly by its slices (% gap(s), from %, to %, % other snapshot row(s))',
      p_day, v_gaps, v_first, v_last, v_other;
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.ca_club_acct_seed_parts sp WHERE sp.acct_day=p_day AND sp.kind='begin' AND sp.bbj_version=1) THEN
    RAISE EXCEPTION 'CLUB_DATA_BBJ_LOAD_VERSION_REQUIRED'; END IF;
  DELETE FROM public.ca_club_acct_fact z
   WHERE z.acct_day = p_day AND z.src = 1
     AND z.fee = 0 AND z.result = 0 AND z.buyins = 0 AND z.cashouts = 0 AND z.hands = 0 AND z.bbj_gross=0 AND z.bbj_awards=0;
  DELETE FROM public.ca_club_acct_hands z WHERE z.acct_day = p_day AND z.src = 1 AND z.hands = 0;

  SELECT sum(sp.fact_inputs), sum(sp.hand_inputs), sum(sp.unclassified) INTO n_f, n_h, n_u
    FROM public.ca_club_acct_seed_parts sp WHERE sp.acct_day = p_day;
  IF n_u > 0 THEN
    INSERT INTO public.ca_club_acct_projection_failures (source, acct_day, detail)
    VALUES ('tournament_flow_unclassified', p_day,
            n_u || ' posted union tournament flow(s) no receipt rule classifies (day load)');
  END IF;

  INSERT INTO public.ca_club_acct_seed_log (acct_day, fact_rows, hand_rows, bbj_version) VALUES (p_day, n_f, n_h,1);
  RETURN jsonb_build_object('acct_day', p_day, 'fact_inputs', n_f, 'hand_inputs', n_h, 'unclassified_flows', n_u);
END;
$function$
;

DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_ca_club_acct_seed_day(date,boolean)'::regprocedure))<>'0518807a63aa1c6d13236621ce2c8860' THEN RAISE EXCEPTION 'DATA_RECONCILIATION_PREIMAGE_CHANGED: seed_day'; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_seed_day(p_day date, p_rebuild boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'smarter_private'
 SET statement_timeout TO '600s'
 SET work_mem TO '128MB'
AS $function$
DECLARE
  v_lo timestamptz := public.fn_ca_accounting_day_start(p_day);
  v_hi timestamptz := public.fn_ca_accounting_day_start(p_day + 1);
  w_lo timestamptz; w_hi timestamptz; v jsonb; f jsonb; n_f bigint := 0; n_h bigint := 0; n_live bigint; n_fix bigint;
  n_unclassified bigint := 0;
BEGIN
  IF p_day IS NULL THEN
    RAISE EXCEPTION 'club data accounting load needs a day' USING ERRCODE = '22023';
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'club data accounting load runs in one REPEATABLE READ transaction (BEGIN ISOLATION LEVEL REPEATABLE READ)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ca_club_acct_state) THEN
    RAISE EXCEPTION 'club data accounting load waits for the live projection (20261115020011)';
  END IF;
  IF EXISTS(SELECT 1 FROM public.ca_club_acct_state s WHERE pg_snapshot_xmin(pg_current_snapshot())<=s.bbj_attachment_xid) THEN RAISE EXCEPTION 'CLUB_DATA_BBJ_PREATTACHMENT_TRANSACTION_STILL_OPEN'; END IF;
  IF v_lo > now() THEN
    RAISE EXCEPTION 'accounting day % has not started', p_day USING ERRCODE = '22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:seed', 0)) THEN
    RAISE EXCEPTION 'another club data accounting load is running';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = p_day) THEN
    IF NOT p_rebuild THEN RAISE EXCEPTION 'accounting day % is already loaded', p_day; END IF;
    DELETE FROM public.ca_club_acct_seed_log WHERE acct_day = p_day;
  END IF;
  DELETE FROM public.ca_club_acct_fact WHERE acct_day = p_day AND src = 1;
  DELETE FROM public.ca_club_acct_hands WHERE acct_day = p_day AND src = 1;

  -- The whole day, in two-hour slices, one union (or club) at a time through
  -- each source's (union | club, time) index; the day is one transaction.
  w_lo := v_lo;
  WHILE w_lo < v_hi LOOP
    w_hi := LEAST(w_lo + interval '2 hours', v_hi);

    v := public.fn_ca_club_acct_cash_fee_rows((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'rake_record_id', s.rake_record_id, 'player_id', s.player_id,
               'club_id', s.club_id, 'union_id', s.union_id, 'earned_at', s.earned_at, 'rake_credit', s.rake_credit))
        FROM public.unions u
        CROSS JOIN LATERAL (SELECT x.* FROM public.accounting_cash_rake_sources x
                             WHERE x.union_id = u.id AND x.earned_at >= w_lo AND x.earned_at < w_hi) s));
    PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

    v := public.fn_ca_club_acct_tournament_fee_rows((
      SELECT jsonb_agg(to_jsonb(rs)) FROM public.accounting_tournament_recognized_sources rs
       WHERE rs.recognized_at >= w_lo AND rs.recognized_at < w_hi));
    PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

    v := public.fn_ca_club_acct_hand_rows(public.fn_ca_club_acct_touch_hands((
      SELECT jsonb_agg(to_jsonb(t)) FROM public.unions u
       CROSS JOIN LATERAL (SELECT x.* FROM public.union_pnl_cash_outcome_touches x
                            WHERE x.game_union_id = u.id::text
                              AND x.recognized_at >= w_lo AND x.recognized_at < w_hi) t)));
    PERFORM public.fn_ca_club_acct_put(v->'facts', 1::smallint);
    PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 1::smallint);
    n_f := n_f + jsonb_array_length(v->'facts'); n_h := n_h + jsonb_array_length(v->'hands');

    v := public.fn_ca_club_acct_hand_rows(public.fn_ca_club_acct_link_hands((
      SELECT jsonb_agg(public.fn_ca_club_acct_link_row(r)) FROM public.union_pnl_cash_outcome_link_resolutions r
        JOIN public.union_pnl_cash_outcomes o ON o.table_id = r.table_id AND o.hand_number = r.hand_number
       WHERE o.recognized_at >= w_lo AND o.recognized_at < w_hi AND r.game_scope->>'game_union_id' IS NOT NULL)));
    PERFORM public.fn_ca_club_acct_put(v->'facts', 1::smallint);
    PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 1::smallint);
    n_f := n_f + jsonb_array_length(v->'facts'); n_h := n_h + jsonb_array_length(v->'hands');

    f := (SELECT jsonb_agg(to_jsonb(fl)) FROM public.unions u
           CROSS JOIN LATERAL (SELECT x.* FROM public.union_pnl_original_flows x
                                WHERE x.game_scope->>'game_union_id' = u.id::text
                                  AND x.recognized_at >= w_lo AND x.recognized_at < w_hi
                                  AND NULLIF(x.game_scope->>'tournament_id', '') IS NOT NULL) fl);
    v := public.fn_ca_club_acct_flow_rows(f);
    n_unclassified := n_unclassified + public.fn_ca_club_acct_flow_eligible(f) - jsonb_array_length(v);
    PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

    w_lo := w_hi;
  END LOOP;

  v := COALESCE((
    SELECT jsonb_agg(x) FROM public.bbj_payout_recipients r
     CROSS JOIN LATERAL jsonb_array_elements(public.fn_ca_club_acct_bbj_rows(r.payout_id, r.user_id, r.created_at)) x
     WHERE r.created_at >= v_lo AND r.created_at < v_hi), '[]'::jsonb);
  PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

  -- Minus what the live aggregate rows already hold for the day (same
  -- snapshot); the day's journal rows in the snapshot are folded in.
  PERFORM public.fn_ca_club_acct_put((
    SELECT jsonb_agg(jsonb_build_object('club_id', f.club_id, 'acct_day', f.acct_day, 'kind', f.kind,
             'game_id', f.game_id, 'user_id', f.user_id, 'union_id', f.union_id, 'fee', -f.fee, 'result', -f.result,
             'bbj_gross',-f.bbj_gross,'bbj_awards',-f.bbj_awards,'buyins', -f.buyins, 'cashouts', -f.cashouts, 'hands', -f.hands, 'at', f.last_at))
      FROM public.ca_club_acct_fact f WHERE f.acct_day = p_day AND f.src = 0), 1::smallint);
  PERFORM public.fn_ca_club_acct_put_hands((
    SELECT jsonb_agg(jsonb_build_object('club_id', h.club_id, 'acct_day', h.acct_day, 'table_id', h.table_id,
             'hands', -h.hands))
      FROM public.ca_club_acct_hands h WHERE h.acct_day = p_day AND h.src = 0), 1::smallint);
  DELETE FROM public.ca_club_acct_fact_journal j WHERE j.acct_day = p_day;
  GET DIAGNOSTICS n_live = ROW_COUNT;
  DELETE FROM public.ca_club_acct_hands_journal j WHERE j.acct_day = p_day;
  -- An all-zero src 1 row says nothing; a src 1 row that offsets live rows
  -- to zero is removed (the live rows keep the player's participation).
  DELETE FROM public.ca_club_acct_fact z
   WHERE z.acct_day = p_day AND z.src = 1
     AND z.fee = 0 AND z.result = 0 AND z.buyins = 0 AND z.cashouts = 0 AND z.hands = 0 AND z.bbj_gross=0 AND z.bbj_awards=0;
  DELETE FROM public.ca_club_acct_hands z WHERE z.acct_day = p_day AND z.src = 1 AND z.hands = 0;

  -- The day is whole again for every live projection of it; a boundary's
  -- failures are resolved only by loading that boundary.
  UPDATE public.ca_club_acct_projection_failures pf SET resolved_at = clock_timestamp()
   WHERE pf.acct_day = p_day AND pf.resolved_at IS NULL AND pf.source NOT LIKE 'pnl_boundary%';
  GET DIAGNOSTICS n_fix = ROW_COUNT;
  -- A plain insert, not fn_ca_club_acct_fail: if the record cannot be
  -- written the load aborts, so the day is never read as complete.
  IF n_unclassified > 0 THEN
    INSERT INTO public.ca_club_acct_projection_failures (source, acct_day, detail)
    VALUES ('tournament_flow_unclassified', p_day,
            n_unclassified || ' posted union tournament flow(s) no receipt rule classifies (day load)');
  END IF;

  INSERT INTO public.ca_club_acct_seed_log (acct_day, fact_rows, hand_rows, bbj_version) VALUES (p_day, n_f, n_h,1);
  RETURN jsonb_build_object('acct_day', p_day, 'from', v_lo, 'to', v_hi, 'fact_inputs', n_f, 'hand_inputs', n_h,
                            'journal_rows_folded', n_live, 'failures_resolved', n_fix,
                            'unclassified_flows', n_unclassified);
END;
$function$
;

-- Append columns: every established consumer keeps its original column positions.
CREATE OR REPLACE VIEW public.ca_club_acct_fact_ct AS
 SELECT f.club_id,f.acct_day AS stat_date,f.kind,f.game_id,f.user_id,f.fee,f.buyins,f.cashouts,f.result AS winnings,f.last_at,f.src,f.hands,f.bbj_gross,f.bbj_awards FROM public.ca_club_acct_fact f
 UNION ALL
 SELECT j.club_id,j.acct_day,j.kind,j.game_id,j.user_id,j.fee,j.buyins,j.cashouts,j.result,j.last_at,0::smallint,j.hands,j.bbj_gross,j.bbj_awards FROM public.ca_club_acct_fact_journal j;
REVOKE ALL ON public.ca_club_acct_fact_ct FROM PUBLIC,anon,authenticated,service_role;

DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_ca_club_acct_coverage(uuid,date,date)'::regprocedure))<>'7f213c5167ecf5a2ee12e7d690001d98' THEN RAISE EXCEPTION 'DATA_RECONCILIATION_PREIMAGE_CHANGED: coverage'; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_coverage(p_club_id uuid, p_from date, p_through date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH k AS (
    SELECT public.fn_ca_club_data_union_of(p_club_id) AS union_id,
           (SELECT public.fn_ca_accounting_day(s.live_from) FROM public.ca_club_acct_state s) AS live_day,
           public.fn_ca_accounting_day(now()) AS today
  ), invoiced AS (
    SELECT max(sp.end_at) AS through_at
      FROM k JOIN public.settlement_periods sp ON sp.union_id = k.union_id
      JOIN public.settlement_invoices si ON si.period_id = sp.id
     WHERE si.invoice_type = 'union_weekly_squareup' AND si.status <> 'cancelled'
  ), days AS (
    SELECT g.d::date AS d FROM generate_series(p_from, p_through, interval '1 day') g(d)
  ), missing AS (
    SELECT d.d FROM days d, k
     WHERE d.d <= k.today AND (k.live_day IS NULL OR d.d <= k.live_day)
       AND NOT EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = d.d)
    UNION
    SELECT d.d FROM days d WHERE EXISTS(
      SELECT 1 FROM public.ca_club_acct_seed_parts sp WHERE sp.acct_day=d.d AND sp.kind='begin' AND sp.bbj_version=1)
      AND NOT EXISTS(SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day=d.d AND l.bbj_version=1)
  ), failed AS (
    SELECT DISTINCT d.d FROM days d CROSS JOIN k
      JOIN public.ca_club_acct_projection_failures pf
        ON pf.resolved_at IS NULL AND pf.acct_day = d.d
       AND (pf.source NOT LIKE 'pnl_boundary%' OR split_part(COALESCE(pf.source_key, ''), ':', 1) = k.union_id::text)
  ), boundaries AS (
    -- Every union week boundary from the window's first day through the
    -- day after its last, that has happened.
    SELECT public.fn_ca_accounting_day_start(d.d) AS b
      FROM (SELECT g.d::date AS d FROM generate_series(p_from, p_through + 1, interval '1 day') g(d)) d, k
     WHERE public.fn_ca_accounting_day_start(d.d) = public.fn_union_week_start(public.fn_ca_accounting_day_start(d.d))
       AND public.fn_ca_accounting_day_start(d.d) <= now()
  ), sides AS (
    -- awaiting: no certificate of the boundary is kept yet and the side's
    -- week has no issued invoice (certificates arrive a day or two after
    -- the boundary): provisional, not incomplete (audit G4).
    SELECT public.fn_ca_accounting_day(b.b) AS d, COALESCE(g.opening_exact, false) AS exact,
           (g.union_id IS NULL AND (i.through_at IS NULL OR b.b >= i.through_at)) AS awaiting
      FROM boundaries b CROSS JOIN k CROSS JOIN invoiced i
      LEFT JOIN public.ca_club_acct_boundary_log g ON g.union_id = k.union_id AND g.boundary = b.b
    UNION ALL
    SELECT public.fn_ca_accounting_day(b.b - interval '1 microsecond'), COALESCE(g.closing_exact, false),
           (g.union_id IS NULL AND (i.through_at IS NULL OR b.b > i.through_at))
      FROM boundaries b CROSS JOIN k CROSS JOIN invoiced i
      LEFT JOIN public.ca_club_acct_boundary_log g ON g.union_id = k.union_id AND g.boundary = b.b
  ), not_exact AS (
    SELECT DISTINCT s.d FROM sides s JOIN days d ON d.d = s.d WHERE NOT s.exact AND NOT s.awaiting
  ), awaiting AS (
    SELECT DISTINCT s.d FROM sides s JOIN days d ON d.d = s.d WHERE NOT s.exact AND s.awaiting
  ), uncovered AS (
    SELECT d.d FROM days d, invoiced i
     WHERE i.through_at IS NULL OR public.fn_ca_accounting_day_start(d.d) >= i.through_at
  )
  SELECT jsonb_build_object(
    'complete', NOT EXISTS (SELECT 1 FROM missing) AND NOT EXISTS (SELECT 1 FROM failed)
                AND NOT EXISTS (SELECT 1 FROM not_exact),
    'missing_days', COALESCE((SELECT jsonb_agg(m.d ORDER BY m.d) FROM missing m), '[]'::jsonb),
    'failed_days', COALESCE((SELECT jsonb_agg(f.d ORDER BY f.d) FROM failed f), '[]'::jsonb),
    'not_invoice_exact_days', COALESCE((SELECT jsonb_agg(n.d ORDER BY n.d) FROM not_exact n), '[]'::jsonb),
    'awaiting_boundary_days', COALESCE((SELECT jsonb_agg(a.d ORDER BY a.d) FROM awaiting a), '[]'::jsonb),
    'provisional', EXISTS (SELECT 1 FROM uncovered),
    'provisional_from', (SELECT min(u.d) FROM uncovered u),
    'window_start', public.fn_ca_accounting_day_start(p_from),
    'window_end', public.fn_ca_accounting_day_start(p_through + 1),
    'day_boundary', '00:00', 'day_zone', 'America/Los_Angeles',
    'source', 'ca_club_acct_fact');
$function$
;
REVOKE ALL ON FUNCTION public.fn_ca_club_acct_coverage(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_club_acct_reconciliation(p_context uuid,p_start date,p_end date,p_summary jsonb,p_users uuid[] DEFAULT NULL,p_games uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $function$
DECLARE v_missing date[];v_complete boolean;v_gross numeric;v_awards numeric;v_coverage jsonb;v_clubs uuid[];
 v_cash_fee numeric:=coalesce((p_summary->>'cash_fee')::numeric,0);
 v_cash_win numeric:=coalesce((p_summary->>'cash_winnings')::numeric,0);
 v_tour_fee numeric:=coalesce((p_summary->>'tournament_fee')::numeric,0);
 v_tour_win numeric:=coalesce((p_summary->>'tournament_winnings')::numeric,0);
BEGIN
 -- A bounded multi-part rebuild may have committed its subtraction but not
 -- all original slices. Never expose its intermediate headline as live money.
 IF EXISTS(SELECT 1 FROM public.ca_club_acct_seed_parts sp WHERE sp.acct_day BETWEEN p_start AND p_end
  AND sp.kind='begin' AND sp.bbj_version=1 AND NOT EXISTS(SELECT 1 FROM public.ca_club_acct_seed_log l
   WHERE l.acct_day=sp.acct_day AND l.bbj_version=1)) THEN
  RAISE EXCEPTION 'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE: original accounting source rebuild is in progress' USING ERRCODE='P0001';
 END IF;
 v_coverage:=public.fn_ca_club_acct_coverage(p_context,p_start,p_end);
 SELECT coalesce(array_agg(d.report_day ORDER BY d.report_day),ARRAY[]::date[]) INTO v_missing
 FROM (SELECT gs::date AS report_day FROM generate_series(p_start,p_end,interval '1 day')gs) d
 WHERE NOT EXISTS(SELECT 1 FROM public.ca_club_acct_state st
   WHERE public.fn_ca_accounting_day_start(d.report_day)>=st.bbj_live_from)
 AND NOT EXISTS(SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day=d.report_day AND l.bbj_version=1);
 v_complete:=cardinality(v_missing)=0 AND coalesce((v_coverage->>'complete')::boolean,false);
 IF v_complete THEN
   v_clubs:=public.fn_ca_club_data_clubs(p_context);
   SELECT coalesce(sum(f.bbj_gross),0),coalesce(sum(f.bbj_awards),0) INTO v_gross,v_awards
   FROM public.ca_club_acct_fact_ct f
   WHERE f.kind='CASH' AND f.club_id=ANY(v_clubs) AND f.stat_date BETWEEN p_start AND p_end
    AND (p_users IS NULL OR f.user_id=ANY(p_users)) AND(p_games IS NULL OR f.game_id=ANY(p_games));
 END IF;
 RETURN jsonb_build_object('complete',v_complete,'missing_days',v_missing,
 'bbj_gross',round(v_gross,2),'bbj_awards',round(v_awards,2),'bbj_net',round(v_gross-v_awards,2),
 'cash_fee',v_cash_fee,'cash_winnings',v_cash_win,'tournament_fee',v_tour_fee,'tournament_winnings',v_tour_win,
 'cash_residual',round(-v_cash_win-v_cash_fee-(v_gross-v_awards),2),
 'tournament_flow_difference',round(-v_tour_win-v_tour_fee,2));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_club_acct_reconciliation(uuid,date,date,jsonb,uuid[],uuid[]) FROM PUBLIC,anon,authenticated,service_role;

DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure))<>'247c300f7695311711ba6abf22013893' THEN RAISE EXCEPTION 'DATA_RECONCILIATION_PREIMAGE_CHANGED: ca_club_data_screen_union_basis('; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.ca_club_data_screen_union_basis(p_club_id uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_game text DEFAULT 'ALL'::text, p_stakes text DEFAULT 'ALL'::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '64MB'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_today date := public.fn_ca_accounting_day(now());
  v_end date := LEAST(COALESCE(p_end, v_today), v_today);
  v_start date := COALESCE(p_start, v_end);
  v_game text := UPPER(COALESCE(NULLIF(p_game, ''), 'ALL'));
  v_stakes text := UPPER(COALESCE(NULLIF(p_stakes, ''), 'ALL'));
  v_q text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_lim int := GREATEST(LEAST(COALESCE(p_limit, 200), 500), 1);
  v_scope text := public.fn_ca_club_data_scope(p_club_id);
  v_attrs boolean;
  v_mtt_win numeric; v_mtt_fee numeric; v_run_win numeric; v_run_fee numeric;
  v_users uuid[];
  v_role text;
  v_club_name text;
  v_union uuid;
  v_facts_from date;
  v_member_fees jsonb;
  v_sum jsonb;
  v_rows jsonb;
  v_days date[];
  v_clubs uuid[];
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_games bigint; v_cash_fee numeric; v_tour_fee numeric; v_cash_win numeric; v_tour_win numeric;
  v_felt_ids uuid[]; v_felt_amt numeric[]; v_felt_seated int[]; v_felt_sum numeric;
  v_live_t uuid[]; v_cands uuid[]; v_need int; v_day date;
  v_is_union boolean;
  v_club_rows jsonb; v_recon_ids uuid[];
BEGIN
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'not authorized for this club' USING ERRCODE = '42501';
  END IF;
  IF v_start < v_end - 92 THEN v_start := v_end - 92; END IF;
  IF v_start > v_end THEN v_start := v_end; END IF;
  IF v_scope = 'downline' THEN
    v_users := public.fn_ca_club_data_downline(p_club_id, auth.uid());
  END IF;
  -- Tournament attributes for every game only when a filter reads them.
  v_attrs := v_game IN ('MTT', 'SNG') OR v_q IS NOT NULL;
  SELECT c.name INTO v_club_name FROM public.clubs c WHERE c.id = p_club_id;
  SELECT cm.role INTO v_role FROM public.club_members cm
   WHERE cm.club_id = p_club_id AND cm.user_id = auth.uid()
   ORDER BY public.fn_club_role_rank(cm.role) DESC LIMIT 1;
  SELECT uc.union_id INTO v_union FROM public.union_clubs uc WHERE uc.club_id = p_club_id LIMIT 1;
  IF EXISTS(SELECT 1 FROM public.unions u WHERE u.id=p_club_id) THEN v_union:=p_club_id; END IF;
  -- 20261115205153: the union's own answer (reporting_scope 'union') also
  -- carries its figures club by club; no other answer gains a key.
  v_is_union := COALESCE(v_union = p_club_id, false);
  v_facts_from := public.fn_ca_club_acct_facts_from();
  v_days := ARRAY(SELECT gs::date FROM generate_series(v_start, v_end, interval '1 day') gs);
  -- 20261115164547: the reporting clubs once, as a value the planner sees.
  -- Every read below is of the accounting records (ca_club_acct_fact_ct) by
  -- these clubs and this window; KINGS CLUB and the horse clubs read the same
  -- rows the same way (the KINGS CLUB window-function arm was that very query).
  v_clubs := public.fn_ca_club_data_clubs(p_club_id);

  IF v_scope = 'downline' THEN
    SELECT jsonb_build_object('cash_fees', coalesce(sum(f.cash_fees),0),
      'tournament_fees', coalesce(sum(f.tournament_fees),0),
      'total_fees', coalesce(sum(f.total_fees),0), 'day_basis', 'America/Los_Angeles 00:00', 'definition', 'downline_accounting_fees', 'source', 'ca_club_acct_fact')
      INTO v_member_fees
      FROM public.fn_ca_club_acct_member_fee_totals(p_club_id, v_start, v_end, auth.uid()) f;
  END IF;
  IF v_game = 'ALL' AND v_stakes = 'ALL' AND v_q IS NULL THEN
    -- THE PLAIN SCREEN (20261017221938; 20261115164547). The union's 93-day
    -- window is 2.3 million accounting rows. Measured on production
    -- 2026-11-15 (read-only): the screen read them six times over - the
    -- totals (a 2.3M-row external sort for count(DISTINCT game_id), 7 s),
    -- the MTT split (a second pass, joined to tournaments), and the page's
    -- rows, the seated tables and the running tournaments each by a scan of
    -- the window - 61 s in all for the union, 15 s for KINGS CLUB over 30
    -- days. Here the window is read twice, both passes hash-based and
    -- sort-free:
    --   * pass 1: every total and the MTT split in one aggregate over the
    --     rows (the MTTs joined by key, 8,205 in all);
    --   * pass 2: the number of distinct games (a hash over the game ids);
    --   * the page's rows are chosen from the most recent days first - every
    --     fact's last_at falls on its own stat_date, so a game seen on a later
    --     day outranks every game seen only earlier, and the order is exact;
    --   * only those rows are totalled, counted and described, and a seated
    --     table or a running tournament is looked up, by exact
    --     (club, day, game) keys of ca_club_acct_fact's primary key.
    SELECT array_agg(x.table_id), array_agg(x.felt), array_agg(x.seated), COALESCE(SUM(x.felt), 0)
      INTO v_felt_ids, v_felt_amt, v_felt_seated, v_felt_sum
      FROM (
        -- Chips still in front of this club's seated players: part of the
        -- result, not a loss. The seat's own club, as the money was.
        SELECT s.table_id, SUM(s.stack) AS felt, count(*)::int AS seated
          FROM public.table_seats s
          JOIN public.tables t ON t.id = s.table_id AND t.tournament_id IS NULL
         WHERE s.left_at IS NULL AND s.user_id IS NOT NULL
           AND COALESCE(s.status, 'active') <> 'left' AND COALESCE(s.stack, 0) > 0
           AND public.fn_ca_accounting_day(s.joined_at) BETWEEN v_start AND v_end
           AND COALESCE(s.club_id, public.fn_ca_cash_reporting_club(t.union_id, t.club_id, s.user_id)) = ANY (v_clubs)
           AND (v_users IS NULL OR s.user_id = ANY (v_users))
         GROUP BY s.table_id) x;
    v_felt_ids := COALESCE(v_felt_ids, ARRAY[]::uuid[]);

    -- Pass 1: the totals by kind, and (20261022120121) MTT Winnings as
    -- FINISHED MTTs only (tournaments.status COMPLETED or CANCELLED); every
    -- other MTT's entries and payouts so far are Running MTT Entries. Both
    -- stay inside tournament_winnings, so total = cash + tournament still
    -- holds. A row joins its MTT by key (tournaments.id is the primary key,
    -- so no row is counted twice); a row of no MTT is in neither split.
    -- 20261115205153: the same single pass, grouped by the row's club (at
    -- most one group per reporting club), so the union's answer can give each
    -- member club's and the union account's Fee and Total Winnings; the page
    -- totals are the sums of those groups, the same rows added once each.
    WITH p AS (
      SELECT d.club_id,
             COALESCE(SUM(d.fee) FILTER (WHERE d.kind = 'CASH'), 0) AS cash_fee,
             COALESCE(SUM(d.fee) FILTER (WHERE d.kind <> 'CASH'), 0) AS tour_fee,
             COALESCE(SUM(d.winnings) FILTER (WHERE d.kind = 'CASH'), 0) AS cash_win,
             COALESCE(SUM(d.winnings) FILTER (WHERE d.kind <> 'CASH'), 0) AS tour_win,
             COALESCE(SUM(d.winnings) FILTER (WHERE mt.finished), 0) AS mtt_win,
             COALESCE(SUM(d.fee) FILTER (WHERE mt.finished), 0) AS mtt_fee,
             COALESCE(SUM(d.winnings) FILTER (WHERE NOT mt.finished), 0) AS run_win,
             COALESCE(SUM(d.fee) FILTER (WHERE NOT mt.finished), 0) AS run_fee
        FROM public.ca_club_acct_fact_ct d
        LEFT JOIN (SELECT tr.id, COALESCE(tr.status IN ('COMPLETED','CANCELLED'), false) AS finished
                     FROM public.tournaments tr WHERE tr.tournament_type = 'MTT') mt
          ON d.kind = 'TOURNAMENT' AND mt.id = d.game_id
       WHERE d.club_id = ANY (v_clubs) AND d.stat_date BETWEEN v_start AND v_end
         AND (v_users IS NULL OR d.user_id = ANY (v_users))
       GROUP BY d.club_id
    )
    SELECT COALESCE(SUM(p.cash_fee), 0), COALESCE(SUM(p.tour_fee), 0),
           COALESCE(SUM(p.cash_win), 0), COALESCE(SUM(p.tour_win), 0),
           COALESCE(SUM(p.mtt_win), 0), COALESCE(SUM(p.mtt_fee), 0),
           COALESCE(SUM(p.run_win), 0), COALESCE(SUM(p.run_fee), 0),
           CASE WHEN v_is_union THEN (
             SELECT jsonb_agg(jsonb_build_object(
                      'club_id', u.id, 'name', COALESCE(cl.name, 'Club'), 'slug', cl.slug,
                      'union_account', u.id = p_club_id,
                      'fee', round(COALESCE(pc.cash_fee + pc.tour_fee, 0), 2),
                      'total_winnings', round(COALESCE(pc.cash_win + pc.tour_win, 0), 2))
                    ORDER BY (u.id = p_club_id), upper(COALESCE(cl.name, '')), u.id)
               FROM unnest(v_clubs) u(id)
               LEFT JOIN p pc ON pc.club_id = u.id
               LEFT JOIN public.clubs cl ON cl.id = u.id) END
      INTO v_cash_fee, v_tour_fee, v_cash_win, v_tour_win, v_mtt_win, v_mtt_fee, v_run_win, v_run_fee, v_club_rows
      FROM p;

    -- Pass 2: the games of the window, each once, however many clubs, days
    -- and players saw it (a hash over the game ids; never a sort).
    SELECT count(*) INTO v_games
      FROM (SELECT d.game_id FROM public.ca_club_acct_fact_ct d
             WHERE d.club_id = ANY (v_clubs) AND d.stat_date BETWEEN v_start AND v_end
               AND (v_users IS NULL OR d.user_id = ANY (v_users))
             GROUP BY d.game_id) g;

    -- A seated table with no fact in the window is still a game on the screen.
    v_games := v_games + (SELECT count(*) FROM unnest(v_felt_ids) ft(id)
      WHERE NOT EXISTS (SELECT 1 FROM public.ca_club_acct_fact_ct f
                         WHERE f.club_id = ANY (v_clubs) AND f.stat_date = ANY (v_days) AND f.game_id = ft.id
                           AND (v_users IS NULL OR f.user_id = ANY (v_users))));

    -- Running tournaments this club (or this agent's downline) played in.
    v_live_t := ARRAY(
      SELECT tr.id FROM public.tournaments tr
       WHERE tr.status = 'RUNNING'
         AND EXISTS (SELECT 1 FROM public.ca_club_acct_fact_ct f
                      WHERE f.club_id = ANY (v_clubs) AND f.stat_date = ANY (v_days) AND f.game_id = tr.id
                        AND (v_users IS NULL OR f.user_id = ANY (v_users))));

    -- The page: every live game, then the most recently active, newest day first.
    v_cands := v_felt_ids || v_live_t;
    v_need := v_lim;
    FOR v_day IN SELECT u.d FROM unnest(v_days) u(d) ORDER BY u.d DESC LOOP
      v_cands := v_cands || ARRAY(
        SELECT f.game_id FROM public.ca_club_acct_fact_ct f
         WHERE f.club_id = ANY (v_clubs) AND f.stat_date = v_day
           AND (v_users IS NULL OR f.user_id = ANY (v_users))
           AND NOT (f.game_id = ANY (v_cands))
         GROUP BY f.game_id ORDER BY max(f.last_at) DESC LIMIT v_need);
      v_need := v_lim - (cardinality(v_cands) - cardinality(v_felt_ids) - cardinality(v_live_t));
      EXIT WHEN v_need <= 0;
    END LOOP;

    WITH c AS (
      SELECT f.kind, f.game_id, SUM(f.fee) AS fee, SUM(f.winnings) AS winnings, max(f.last_at) AS activity_at,
             count(DISTINCT f.user_id) FILTER (WHERE f.user_id <> v_zero) AS players
        FROM public.ca_club_acct_fact_ct f
       WHERE f.club_id = ANY (v_clubs) AND f.stat_date = ANY (v_days) AND f.game_id = ANY (v_cands)
         AND (v_users IS NULL OR f.user_id = ANY (v_users))
       GROUP BY f.kind, f.game_id
    ), fe AS (
      SELECT x.table_id, x.felt, x.seated
        FROM unnest(v_felt_ids, COALESCE(v_felt_amt, ARRAY[]::numeric[]), COALESCE(v_felt_seated, ARRAY[]::int[])) AS x(table_id, felt, seated)
    ), rows_ AS (
      SELECT COALESCE(c.kind, 'CASH') AS k, COALESCE(c.game_id, fe.table_id) AS game_id,
             COALESCE(c.fee, 0) AS fee, COALESCE(c.winnings, 0) AS winnings,
             COALESCE(c.activity_at, now()) AS activity_at,
             (fe.table_id IS NOT NULL OR (c.kind = 'TOURNAMENT' AND c.game_id = ANY (v_live_t))) AS live,
             fe.seated, fe.felt AS on_felt, COALESCE(c.players, 0) AS players
        FROM c FULL JOIN fe ON fe.table_id = c.game_id
    ), top AS (
      SELECT * FROM rows_ ORDER BY live DESC, activity_at DESC NULLS LAST, k, game_id LIMIT v_lim
    ), described AS (
      SELECT CASE WHEN tp.k = 'CASH' THEN 'CASH'
                  WHEN tr.tournament_type = 'SPIN' THEN 'SPIN'
                  WHEN tr.tournament_type = 'SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END AS kind,
             tp.game_id::text AS id,
             CASE WHEN tp.k = 'CASH' THEN COALESCE(t.name, 'Unnamed') ELSE COALESCE(tr.name, 'Tournament') END AS name,
             CASE WHEN tp.k = 'CASH' THEN UPPER(COALESCE(t.game_variant, 'nlh'))
                  ELSE UPPER(COALESCE(tr.variant, tr.game_type, 'nlh')) END AS variant,
             CASE WHEN tp.k = 'CASH' THEN
                    CASE WHEN COALESCE(t.game_variant,'') ILIKE '%plo%' OR COALESCE(t.game_variant,'') ILIKE '%omaha%' THEN 'OMAHA'
                         WHEN COALESCE(t.game_variant,'') ILIKE '%mixed%' OR COALESCE(t.game_mode,'') ILIKE '%mixed%' THEN 'MIXED'
                         ELSE 'HOLDEM' END
                  WHEN tr.tournament_type = 'SPIN' THEN 'SPIN' WHEN tr.tournament_type = 'SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END AS game_class,
             CASE WHEN tp.k <> 'CASH' THEN 'NA'
                  WHEN COALESCE(t.big_blind,0) < 1 THEN 'MICRO'
                  WHEN COALESCE(t.big_blind,0) < 5 THEN 'SMALL'
                  WHEN COALESCE(t.big_blind,0) < 25 THEN 'MID' ELSE 'HIGH' END AS stakes_tier,
             CASE WHEN tp.k = 'CASH' AND COALESCE(t.big_blind,0) > 0 THEN
               trim(trailing '.' from trim(trailing '0' from COALESCE(t.small_blind,0)::text)) || '/' ||
               trim(trailing '.' from trim(trailing '0' from t.big_blind::text)) END AS blinds,
             CASE WHEN tp.k = 'CASH' THEN t.created_at ELSE tr.start_time END AS started_at,
             CASE WHEN tp.k = 'CASH' THEN t.status ELSE tr.status END AS status,
             CASE WHEN tp.k = 'CASH' THEN COALESCE(pr.username, '') ELSE '' END AS creator_name,
             round(tp.fee, 2) AS fee, round(tp.winnings, 2) AS winnings,
             GREATEST(tp.players, COALESCE(tp.seated, 0))::int AS players,
             tp.activity_at, tp.live, tp.seated, round(tp.on_felt, 2) AS on_felt, tp.k
        FROM top tp
        LEFT JOIN public.tables t ON tp.k = 'CASH' AND t.id = tp.game_id
        LEFT JOIN public.profiles pr ON pr.id = t.created_by
        LEFT JOIN public.tournaments tr ON tp.k = 'TOURNAMENT' AND tr.id = tp.game_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'kind', kind, 'id', id, 'name', name, 'variant', variant,
             'game_class', game_class, 'stakes_tier', stakes_tier, 'blinds', blinds,
             'started_at', started_at, 'activity_at', activity_at, 'status', status,
             'creator_name', NULLIF(creator_name, ''), 'fee', COALESCE(fee, 0),
             'winnings', COALESCE(winnings, 0), 'players', COALESCE(players, 0),
             'live', live, 'seated', seated, 'on_felt', on_felt)
             ORDER BY live DESC, activity_at DESC NULLS LAST, k, id), '[]'::jsonb)
      INTO v_rows FROM described;

    v_sum := jsonb_build_object(
      'games', v_games,
      'total_winnings', round(v_cash_win + v_tour_win, 2),
      'mtt_winnings', round(v_mtt_win, 2), 'tournament_winnings', round(v_tour_win,2),
      'running_mtt_entries', round(v_run_win, 2), 'running_mtt_fee', round(v_run_fee, 2),
      'cash_winnings', round(v_cash_win, 2),
      'fee', round(v_cash_fee + v_tour_fee, 2),
      'cash_fee', round(v_cash_fee, 2),
      'mtt_fee', round(v_mtt_fee, 2), 'tournament_fee', round(v_tour_fee,2),
      'on_felt', round(v_felt_sum, 2),
      'live_games', cardinality(v_felt_ids) + cardinality(v_live_t));

    v_sum:=v_sum||jsonb_build_object('reconciliation',public.fn_ca_club_acct_reconciliation(p_club_id,v_start,v_end,v_sum,v_users,NULL));
    RETURN jsonb_build_object(
      'range', jsonb_build_object('start', v_start, 'end', v_end, 'days', (v_end - v_start) + 1),
      'filters', jsonb_build_object('game', v_game, 'stakes', v_stakes, 'search', v_q),
      'scope', v_scope, 'reporting_scope', CASE WHEN v_union=p_club_id THEN 'union' ELSE 'club' END, 'reporting_club_count', cardinality(v_clubs), 'accounting_basis', 'union_invoice_accounting', 'day_basis', 'America/Los_Angeles 00:00', 'accounting_coverage', public.fn_ca_club_acct_coverage(p_club_id, v_start, v_end), 'viewer_role', v_role, 'club_name', v_club_name, 'facts_from', v_facts_from,
      'member_fees', v_member_fees, 'summary', v_sum, 'rows', v_rows, 'row_count', (v_sum->>'games')::int,
      'union_id', v_union, 'generated_at', now())
      || CASE WHEN v_is_union THEN jsonb_build_object('clubs', COALESCE(v_club_rows, '[]'::jsonb)) ELSE '{}'::jsonb END;
  END IF;

  -- A FILTERED SCREEN (a game class, stakes, or a search): every game's
  -- attributes are read, as before; the players are counted for the page's
  -- rows by exact (club, day, game) lookups.

  WITH g0 AS MATERIALIZED (
    -- 20261115205153: for the union's own screen each game's figures are kept
    -- per reporting club as well (club_key; NULL for every other screen, so
    -- a club's screen groups exactly as before); g is their sum per game.
    SELECT CASE WHEN v_is_union THEN d.club_id END AS club_key,
           d.kind, d.game_id, SUM(d.fee) AS fee, SUM(d.winnings) AS winnings, max(d.last_at) AS activity_at
      FROM public.ca_club_acct_fact_ct d
     WHERE d.club_id = ANY (v_clubs) AND d.stat_date BETWEEN v_start AND v_end
       AND (v_users IS NULL OR d.user_id = ANY (v_users))
       AND (v_game = 'ALL'
            OR (v_game IN ('HOLDEM', 'OMAHA', 'MIXED') AND d.kind = 'CASH')
            OR (v_game IN ('MTT', 'SNG') AND d.kind = 'TOURNAMENT'))
       AND (v_stakes = 'ALL' OR d.kind = 'CASH')
     GROUP BY 1, d.kind, d.game_id
  ), g AS MATERIALIZED (
    SELECT g0.kind, g0.game_id, SUM(g0.fee) AS fee, SUM(g0.winnings) AS winnings, max(g0.activity_at) AS activity_at
      FROM g0
     GROUP BY g0.kind, g0.game_id
  ), felt AS MATERIALIZED (
    -- Chips still in front of this club's seated players: part of the result,
    -- not a loss. The seat's own club, as the money was.
    SELECT s.table_id, SUM(s.stack) AS felt, count(*)::int AS seated
      FROM public.table_seats s
      JOIN public.tables t ON t.id = s.table_id AND t.tournament_id IS NULL
     WHERE s.left_at IS NULL AND s.user_id IS NOT NULL
       AND COALESCE(s.status, 'active') <> 'left' AND COALESCE(s.stack, 0) > 0
       AND public.fn_ca_accounting_day(s.joined_at) BETWEEN v_start AND v_end
       AND COALESCE(s.club_id, public.fn_ca_cash_reporting_club(t.union_id, t.club_id, s.user_id)) = ANY (v_clubs)
       AND (v_users IS NULL OR s.user_id = ANY (v_users))
       AND v_game IN ('ALL', 'HOLDEM', 'OMAHA', 'MIXED')
     GROUP BY s.table_id
  ), running AS MATERIALIZED (
    SELECT tr.id FROM public.tournaments tr WHERE tr.status = 'RUNNING'
  ), cash AS (
    -- Cash games are few; every one is described.
    SELECT t.id AS game_id, COALESCE(t.name, 'Unnamed') AS name,
           CASE WHEN COALESCE(t.game_variant,'') ILIKE '%plo%' OR COALESCE(t.game_variant,'') ILIKE '%omaha%' THEN 'OMAHA'
                WHEN COALESCE(t.game_variant,'') ILIKE '%mixed%' OR COALESCE(t.game_mode,'') ILIKE '%mixed%' THEN 'MIXED'
                ELSE 'HOLDEM' END AS game_class,
           CASE WHEN COALESCE(t.big_blind,0) < 1 THEN 'MICRO'
                WHEN COALESCE(t.big_blind,0) < 5 THEN 'SMALL'
                WHEN COALESCE(t.big_blind,0) < 25 THEN 'MID' ELSE 'HIGH' END AS stakes_tier,
           COALESCE(pr.username, '') AS creator_name,
           COALESCE(gg.fee, 0) AS fee,
           COALESCE(gg.winnings, 0) AS winnings,
           COALESCE(gg.activity_at, now()) AS activity_at,
           (fe.felt IS NOT NULL) AS live, fe.seated, fe.felt AS on_felt
      FROM (SELECT * FROM g WHERE g.kind = 'CASH') gg
      FULL JOIN felt fe ON fe.table_id = gg.game_id
      JOIN public.tables t ON t.id = COALESCE(gg.game_id, fe.table_id)
      LEFT JOIN public.profiles pr ON pr.id = t.created_by
  ), tour AS (
    SELECT g.game_id, g.fee, g.winnings, g.activity_at,
           (g.game_id IN (SELECT r.id FROM running r)) AS live
      FROM g WHERE g.kind = 'TOURNAMENT'
  ), tour_described AS (
    -- Read only when a filter needs it: v_attrs is a one-time filter, so the
    -- tournaments join is never executed for the plain screen.
    SELECT tu.*, COALESCE(tr.name, 'Tournament') AS name,
           CASE WHEN tr.tournament_type = 'SPIN' THEN 'SPIN' WHEN tr.tournament_type = 'SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END AS game_class
      FROM tour tu JOIN public.tournaments tr ON tr.id = tu.game_id
     WHERE v_attrs
  ), filtered AS (
    SELECT 'CASH'::text AS k, c.game_id, c.fee, c.winnings, c.activity_at, c.live, c.seated, c.on_felt
      FROM cash c
     WHERE (v_game = 'ALL' OR c.game_class = v_game)
       AND (v_stakes = 'ALL' OR c.stakes_tier = v_stakes)
       AND (v_q IS NULL OR c.name ILIKE '%' || v_q || '%' OR c.game_id::text ILIKE '%' || v_q || '%'
            OR c.creator_name ILIKE '%' || v_q || '%')
    UNION ALL
    SELECT 'TOURNAMENT', tu.game_id, tu.fee, tu.winnings, tu.activity_at, tu.live, NULL::int, NULL::numeric
      FROM tour tu WHERE NOT v_attrs
    UNION ALL
    SELECT 'TOURNAMENT', td.game_id, td.fee, td.winnings, td.activity_at, td.live, NULL::int, NULL::numeric
      FROM tour_described td
     WHERE v_attrs
       AND (v_game = 'ALL' OR td.game_class = v_game)
       AND (v_q IS NULL OR td.name ILIKE '%' || v_q || '%' OR td.game_id::text ILIKE '%' || v_q || '%')
  ), summary AS (
    SELECT jsonb_build_object(
      'games', count(*),
      'total_winnings', round(COALESCE(SUM(winnings), 0), 2),
      'mtt_winnings', round(COALESCE(SUM(winnings) FILTER (WHERE k = 'TOURNAMENT' AND EXISTS(SELECT 1 FROM public.tournaments mt WHERE mt.id=filtered.game_id AND mt.tournament_type='MTT' AND COALESCE(mt.status IN ('COMPLETED','CANCELLED'),false))), 0), 2),
      'running_mtt_entries', round(COALESCE(SUM(winnings) FILTER (WHERE k = 'TOURNAMENT' AND EXISTS(SELECT 1 FROM public.tournaments mt WHERE mt.id=filtered.game_id AND mt.tournament_type='MTT' AND NOT COALESCE(mt.status IN ('COMPLETED','CANCELLED'),false))), 0), 2),
      'running_mtt_fee', round(COALESCE(SUM(fee) FILTER (WHERE k = 'TOURNAMENT' AND EXISTS(SELECT 1 FROM public.tournaments mt WHERE mt.id=filtered.game_id AND mt.tournament_type='MTT' AND NOT COALESCE(mt.status IN ('COMPLETED','CANCELLED'),false))), 0), 2),
      'cash_winnings', round(COALESCE(SUM(winnings) FILTER (WHERE k = 'CASH'), 0), 2),
      'fee', round(COALESCE(SUM(fee), 0), 2),
      'cash_fee', round(COALESCE(SUM(fee) FILTER (WHERE k = 'CASH'), 0), 2),
      'mtt_fee', round(COALESCE(SUM(fee) FILTER (WHERE k = 'TOURNAMENT' AND EXISTS(SELECT 1 FROM public.tournaments mt WHERE mt.id=filtered.game_id AND mt.tournament_type='MTT' AND COALESCE(mt.status IN ('COMPLETED','CANCELLED'),false))),0),2), 'tournament_fee',round(COALESCE(SUM(fee) FILTER(WHERE k <> 'CASH'),0),2), 'tournament_winnings',round(COALESCE(SUM(winnings) FILTER(WHERE k <> 'CASH'),0),2),
      'on_felt', round(COALESCE(SUM(on_felt), 0), 2),
      'live_games', count(*) FILTER (WHERE live)) AS s
      FROM filtered
  ), by_club AS (
    -- The union's screen: each reporting club's share of exactly the games
    -- the filters kept (a seated table with no fact adds no money).
    SELECT g0.club_key AS club_id, SUM(g0.fee) AS fee, SUM(g0.winnings) AS winnings
      FROM g0 JOIN filtered fl ON fl.k = g0.kind AND fl.game_id = g0.game_id
     WHERE v_is_union
     GROUP BY g0.club_key
  ), top AS MATERIALIZED (
    SELECT * FROM filtered ORDER BY live DESC, activity_at DESC NULLS LAST, k, game_id LIMIT v_lim
  ), pl AS (
    SELECT f.game_id, count(DISTINCT f.user_id) AS n
      FROM public.ca_club_acct_fact_ct f
     WHERE f.club_id = ANY (v_clubs) AND f.stat_date BETWEEN v_start AND v_end
       AND f.user_id <> '00000000-0000-0000-0000-000000000000'::uuid
       AND (v_users IS NULL OR f.user_id = ANY (v_users))
       AND f.game_id IN (SELECT tp.game_id FROM top tp)
     GROUP BY f.game_id
  ), described AS (
    SELECT CASE WHEN tp.k = 'CASH' THEN 'CASH'
                WHEN tr.tournament_type = 'SPIN' THEN 'SPIN'
                WHEN tr.tournament_type = 'SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END AS kind,
           tp.game_id::text AS id,
           CASE WHEN tp.k = 'CASH' THEN COALESCE(t.name, 'Unnamed') ELSE COALESCE(tr.name, 'Tournament') END AS name,
           CASE WHEN tp.k = 'CASH' THEN UPPER(COALESCE(t.game_variant, 'nlh'))
                ELSE UPPER(COALESCE(tr.variant, tr.game_type, 'nlh')) END AS variant,
           CASE WHEN tp.k = 'CASH' THEN
                  CASE WHEN COALESCE(t.game_variant,'') ILIKE '%plo%' OR COALESCE(t.game_variant,'') ILIKE '%omaha%' THEN 'OMAHA'
                       WHEN COALESCE(t.game_variant,'') ILIKE '%mixed%' OR COALESCE(t.game_mode,'') ILIKE '%mixed%' THEN 'MIXED'
                       ELSE 'HOLDEM' END
                WHEN tr.tournament_type = 'SPIN' THEN 'SPIN' WHEN tr.tournament_type = 'SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END AS game_class,
           CASE WHEN tp.k <> 'CASH' THEN 'NA'
                WHEN COALESCE(t.big_blind,0) < 1 THEN 'MICRO'
                WHEN COALESCE(t.big_blind,0) < 5 THEN 'SMALL'
                WHEN COALESCE(t.big_blind,0) < 25 THEN 'MID' ELSE 'HIGH' END AS stakes_tier,
           CASE WHEN tp.k = 'CASH' AND COALESCE(t.big_blind,0) > 0 THEN
             trim(trailing '.' from trim(trailing '0' from COALESCE(t.small_blind,0)::text)) || '/' ||
             trim(trailing '.' from trim(trailing '0' from t.big_blind::text)) END AS blinds,
           CASE WHEN tp.k = 'CASH' THEN t.created_at ELSE tr.start_time END AS started_at,
           CASE WHEN tp.k = 'CASH' THEN t.status ELSE tr.status END AS status,
           CASE WHEN tp.k = 'CASH' THEN COALESCE(pr.username, '') ELSE '' END AS creator_name,
           round(tp.fee, 2) AS fee, round(tp.winnings, 2) AS winnings,
           GREATEST(COALESCE(pl.n, 0), COALESCE(tp.seated, 0))::int AS players,
           tp.activity_at, tp.live, tp.seated, round(tp.on_felt, 2) AS on_felt, tp.k
      FROM top tp
      LEFT JOIN public.tables t ON tp.k = 'CASH' AND t.id = tp.game_id
      LEFT JOIN public.profiles pr ON pr.id = t.created_by
      LEFT JOIN public.tournaments tr ON tp.k = 'TOURNAMENT' AND tr.id = tp.game_id
      LEFT JOIN pl ON pl.game_id = tp.game_id
  )
  SELECT (SELECT s FROM summary),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'kind', kind, 'id', id, 'name', name, 'variant', variant,
           'game_class', game_class, 'stakes_tier', stakes_tier, 'blinds', blinds,
           'started_at', started_at, 'activity_at', activity_at, 'status', status,
           'creator_name', NULLIF(creator_name, ''), 'fee', COALESCE(fee, 0),
           'winnings', COALESCE(winnings, 0), 'players', COALESCE(players, 0),
           'live', live, 'seated', seated, 'on_felt', on_felt)
           ORDER BY live DESC, activity_at DESC NULLS LAST, k, id) FROM described), '[]'::jsonb),
         CASE WHEN v_is_union THEN (
           SELECT jsonb_agg(jsonb_build_object(
                    'club_id', u.id, 'name', COALESCE(cl.name, 'Club'), 'slug', cl.slug,
                    'union_account', u.id = p_club_id,
                    'fee', round(COALESCE(bc.fee, 0), 2),
                    'total_winnings', round(COALESCE(bc.winnings, 0), 2))
                  ORDER BY (u.id = p_club_id), upper(COALESCE(cl.name, '')), u.id)
             FROM unnest(v_clubs) u(id)
             LEFT JOIN by_club bc ON bc.club_id = u.id
             LEFT JOIN public.clubs cl ON cl.id = u.id) END, ARRAY(SELECT fl.game_id FROM filtered fl WHERE fl.k='CASH')
    INTO v_sum, v_rows, v_club_rows, v_recon_ids;

  v_sum:=v_sum||jsonb_build_object('reconciliation',public.fn_ca_club_acct_reconciliation(p_club_id,v_start,v_end,v_sum,v_users,v_recon_ids));
  RETURN jsonb_build_object(
    'range', jsonb_build_object('start', v_start, 'end', v_end, 'days', (v_end - v_start) + 1),
    'filters', jsonb_build_object('game', v_game, 'stakes', v_stakes, 'search', v_q),
    'scope', v_scope, 'reporting_scope', CASE WHEN v_union=p_club_id THEN 'union' ELSE 'club' END, 'reporting_club_count', cardinality(v_clubs), 'accounting_basis', 'union_invoice_accounting', 'day_basis', 'America/Los_Angeles 00:00', 'accounting_coverage', public.fn_ca_club_acct_coverage(p_club_id, v_start, v_end),
    'viewer_role', v_role,
    'club_name', v_club_name,
    'facts_from', v_facts_from,
    'member_fees', v_member_fees, 'summary', v_sum,
    'rows', v_rows,
    'row_count', (v_sum->>'games')::int,
    'union_id', v_union,
    'generated_at', now())
    || CASE WHEN v_is_union THEN jsonb_build_object('clubs', COALESCE(v_club_rows, '[]'::jsonb)) ELSE '{}'::jsonb END;
END;
$function$
;

DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.ca_rake_snapshot_pacific_v2(text,uuid,uuid,date,date,uuid,integer,integer,text,text)'::regprocedure))<>'7e3d9acd5358ca92b553044c81098686' THEN RAISE EXCEPTION 'DATA_RECONCILIATION_PREIMAGE_CHANGED: ca_rake_snapshot_pacific_v2('; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.ca_rake_snapshot_pacific_v2(p_scope text DEFAULT 'club'::text, p_club_id uuid DEFAULT NULL::uuid, p_union_id uuid DEFAULT NULL::uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_agent_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text, p_sort text DEFAULT 'rake'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '20s'
 SET work_mem TO '64MB'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_pacific_final jsonb; v_pacific_previous jsonb; v_invoice boolean; v_prev_invoice boolean; v_context uuid; v_coverage jsonb;
  v_scope text := lower(COALESCE(NULLIF(btrim(p_scope),''),'club'));
  v_today date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_end date := LEAST(COALESCE(p_end, v_today), v_today);
  v_start date := COALESCE(p_start, v_end - 6);
  v_off int := GREATEST(COALESCE(p_offset,0),0);
  v_q text := NULLIF(btrim(COALESCE(p_search,'')),'');
  v_sort text := lower(COALESCE(NULLIF(btrim(p_sort),''),'rake'));
  v_days int; v_pstart date; v_pend date; v_bucket text;
  v_union uuid; v_clubs uuid[];
  v_cur jsonb; v_prev jsonb; v_series jsonb;
  v_pack jsonb := jsonb_build_object('rows','[]'::jsonb,'total',0,'total_direct',0);
  v_kind text := 'none'; v_label text;
  v_agent jsonb; v_agent_p jsonb; v_live boolean := false;
  v_w jsonb;
BEGIN
  IF v_scope NOT IN ('club','union','agent') THEN
    RAISE EXCEPTION 'unknown scope %', v_scope USING ERRCODE='22023'; END IF;
  IF v_start < v_end - 730 THEN v_start := v_end - 730; END IF;
  IF v_start > v_end THEN v_start := v_end; END IF;
  v_days := (v_end - v_start) + 1; v_pend := v_start - 1; v_pstart := v_pend - (v_days - 1);
  v_bucket := CASE WHEN v_days <= 62 THEN 'day' WHEN v_days <= 400 THEN 'week' ELSE 'month' END;

  IF v_scope = 'agent' THEN
    IF p_club_id IS NULL THEN RAISE EXCEPTION 'agent scope needs a club' USING ERRCODE='22023'; END IF;
    v_agent := public.fn_agent_downline_rake_summary(p_agent_user_id, p_club_id,
      (v_start::timestamp AT TIME ZONE 'America/Los_Angeles'), ((v_end+1)::timestamp AT TIME ZONE 'America/Los_Angeles'));
    v_agent_p := public.fn_agent_downline_rake_summary(p_agent_user_id, p_club_id,
      (v_pstart::timestamp AT TIME ZONE 'America/Los_Angeles'), ((v_pend+1)::timestamp AT TIME ZONE 'America/Los_Angeles'));
    IF v_sort NOT IN ('rake','name','hands') THEN v_sort := 'rake'; END IF;
    v_pack := public.fn_ca_rake_by_downline(p_agent_user_id, p_club_id,
      (v_start::timestamp AT TIME ZONE 'America/Los_Angeles'), ((v_end+1)::timestamp AT TIME ZONE 'America/Los_Angeles'),
      p_limit, v_off, v_q, v_sort);
    SELECT COALESCE(c.name,'Club') INTO v_label FROM public.clubs c WHERE c.id = p_club_id;
    RETURN jsonb_build_object(
      'scope','agent','scope_label',COALESCE(v_label,'Downline'),'club_id',p_club_id,
      'union_id',NULL,'agent_user_id',p_agent_user_id,
      'range',jsonb_build_object('start',v_start,'end',v_end,'days',v_days),
      'previous_range',jsonb_build_object('start',v_pstart,'end',v_pend,'days',v_days),
      'summary',jsonb_build_object(
        'fee',round(COALESCE((v_agent->>'rake_generated')::numeric,0),2),
        'cash_fee',NULL,'mtt_fee',NULL,'games',NULL,
        'hands',COALESCE((v_agent->>'hands')::bigint,0),
        'total_winnings',NULL,'mtt_winnings',NULL,'running_mtt_entries',NULL,
        'members',COALESCE((v_agent->>'members')::int,0),
        'active',COALESCE((v_agent->>'active')::int,0),
        'commission_rate',(v_agent->>'commission_rate')::numeric,
        'estimated_commission',round(COALESCE((v_agent->>'estimated_commission')::numeric,0),2)),
      'previous',jsonb_build_object('fee',round(COALESCE((v_agent_p->>'rake_generated')::numeric,0),2),
        'hands',COALESCE((v_agent_p->>'hands')::bigint,0)),
      'delta',jsonb_build_object(
        'fee_pct',CASE WHEN COALESCE((v_agent_p->>'rake_generated')::numeric,0)=0 THEN NULL
          ELSE round((COALESCE((v_agent->>'rake_generated')::numeric,0)-(v_agent_p->>'rake_generated')::numeric)
               /abs((v_agent_p->>'rake_generated')::numeric)*100,1) END,
        'fee_abs',round(COALESCE((v_agent->>'rake_generated')::numeric,0)-COALESCE((v_agent_p->>'rake_generated')::numeric,0),2),
        'games_pct',NULL,'winnings_abs',NULL),
      'series','[]'::jsonb,'series_bucket',v_bucket,
      'breakdown',v_pack->'rows','breakdown_kind','downline',
      'breakdown_total',(v_pack->>'total_direct')::numeric,
      'breakdown_count',(v_pack->>'total')::int,
      'breakdown_offset',v_off,'commission_total',(v_pack->>'total_commission')::numeric,
      'breakdown_live',true,'rake_complete_through',NULL,
      'applied_search',v_q,'applied_sort',v_sort,
      'top_earner',v_agent->'top_earner','accounting_basis','pacific_net_money_flow','day_basis','America/Los_Angeles 00:00','generated_at',now());
  END IF;

  IF v_scope = 'union' THEN
    v_union := p_union_id;
    IF v_union IS NULL AND p_club_id IS NOT NULL THEN
      SELECT uc.union_id INTO v_union FROM public.union_clubs uc WHERE uc.club_id=p_club_id LIMIT 1; END IF;
    IF v_union IS NULL THEN RAISE EXCEPTION 'no union for this context' USING ERRCODE='22023'; END IF;
    IF NOT public.ca_can_oversee_union(v_union) THEN
      RAISE EXCEPTION 'not authorized for this union' USING ERRCODE='42501'; END IF;
    v_clubs:=public.fn_ca_club_data_clubs(v_union);
    SELECT u.name INTO v_label FROM public.unions u WHERE u.id=v_union;
    IF v_sort NOT IN ('rake','name','hands') THEN v_sort := 'rake'; END IF;
    -- 20261022165130: the clubs' windows and the union's from one pass.
    v_context:=v_union; v_invoice:=public.fn_ca_club_data_reads_union_basis(v_context,v_start,v_end);
 v_coverage:=CASE WHEN v_invoice THEN public.fn_ca_club_acct_coverage(v_context,v_start,v_end)
 ELSE public.fn_ca_club_data_pacific_coverage(v_context,v_start,v_end,731) END;
 IF NOT coalesce((v_coverage->>'complete')::boolean,false) THEN
 RAISE EXCEPTION 'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE: selected report source is not qualified' USING ERRCODE='P0001'; END IF;
    v_w:=CASE WHEN v_invoice THEN public.fn_ca_rake_invoice_windows_v3(v_clubs,v_start,v_end,true) ELSE public.fn_ca_rake_windows_pacific_v3(v_clubs,v_start,v_end,true) END;
    v_pack := public.fn_ca_rake_by_club_from(v_clubs, v_w->'clubs', p_limit, v_off, v_q, v_sort);
    v_cur := v_w->'all';
    v_kind := 'club'; v_live := false;
  ELSE
    IF p_club_id IS NULL THEN RAISE EXCEPTION 'club scope needs a club' USING ERRCODE='22023'; END IF;
    IF NOT public.ca_can_read_whole_club_production(p_club_id) THEN
      RAISE EXCEPTION 'not authorized for this club' USING ERRCODE='42501'; END IF;
    v_context:=p_club_id; v_invoice:=public.fn_ca_club_data_reads_union_basis(v_context,v_start,v_end);
 v_coverage:=CASE WHEN v_invoice THEN public.fn_ca_club_acct_coverage(v_context,v_start,v_end)
 ELSE public.fn_ca_club_data_pacific_coverage(v_context,v_start,v_end,731) END;
 IF NOT coalesce((v_coverage->>'complete')::boolean,false) THEN
 RAISE EXCEPTION 'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE: selected report source is not qualified' USING ERRCODE='P0001'; END IF;
    v_clubs := ARRAY[p_club_id];
    SELECT uc.union_id INTO v_union FROM public.union_clubs uc WHERE uc.club_id=p_club_id LIMIT 1;
    SELECT c.name INTO v_label FROM public.clubs c WHERE c.id=p_club_id;
    IF v_sort NOT IN ('rake','name','cost','players') THEN v_sort := 'rake'; END IF;
    v_pack := public.fn_ca_rake_by_agent_pacific(p_club_id, v_start, v_end, p_limit, v_off, v_q, v_sort);
    v_kind := 'agent'; v_live := true;
  END IF;

  IF v_clubs IS NULL OR array_length(v_clubs,1) IS NULL THEN v_clubs := ARRAY[]::uuid[]; END IF;

  IF v_cur IS NULL THEN v_cur:=CASE WHEN v_invoice THEN public.fn_ca_rake_invoice_windows_v3(v_clubs,v_start,v_end,false)->'all' ELSE public.fn_ca_rake_window_pacific_v2(v_clubs,v_start,v_end) END; END IF;

 v_prev_invoice:=public.fn_ca_club_data_reads_union_basis(v_context,v_pstart,v_pend);
 v_pacific_previous:=CASE WHEN v_prev_invoice THEN public.fn_ca_club_acct_coverage(v_context,v_pstart,v_pend)
 ELSE public.fn_ca_club_data_pacific_coverage(v_context,v_pstart,v_pend,731) END;
 IF v_prev_invoice IS DISTINCT FROM v_invoice THEN v_pacific_previous:=v_pacific_previous||jsonb_build_object('complete',false,'basis_mismatch',true); END IF;
 v_prev:=CASE WHEN NOT coalesce((v_pacific_previous->>'complete')::boolean,false) THEN '{}'::jsonb
 WHEN v_prev_invoice THEN public.fn_ca_rake_invoice_windows_v3(v_clubs,v_pstart,v_pend,false)->'all'
 ELSE public.fn_ca_rake_window_pacific_v2(v_clubs,v_pstart,v_pend) END;

  v_series:=CASE WHEN v_invoice THEN public.fn_ca_rake_invoice_series_v2(v_clubs,v_start,v_end,v_bucket) ELSE public.fn_ca_rake_series_pacific_v2(v_clubs,v_start,v_end,v_bucket) END;

  IF v_invoice THEN v_cur:=v_cur||jsonb_build_object('reconciliation',public.fn_ca_club_acct_reconciliation(v_context,v_start,v_end,v_cur)); END IF;
  v_pacific_final := jsonb_build_object(
    'scope',v_scope,'scope_label',COALESCE(v_label,initcap(v_scope)),
    'club_id',p_club_id,'union_id',v_union,'club_count',CASE WHEN v_scope='union' THEN (SELECT count(DISTINCT uc.club_id) FROM public.union_clubs uc WHERE uc.union_id=v_union) ELSE array_length(v_clubs,1) END,
    'range',jsonb_build_object('start',v_start,'end',v_end,'days',v_days),
    'previous_range',jsonb_build_object('start',v_pstart,'end',v_pend,'days',v_days),
    'summary',v_cur,'previous',v_prev,
    'delta',jsonb_build_object(
      'fee_pct',CASE WHEN COALESCE((v_prev->>'fee')::numeric,0)=0 THEN NULL
        ELSE round(((v_cur->>'fee')::numeric-(v_prev->>'fee')::numeric)/abs((v_prev->>'fee')::numeric)*100,1) END,
      'games_pct',CASE WHEN COALESCE((v_prev->>'games')::numeric,0)=0 THEN NULL
        ELSE round(((v_cur->>'games')::numeric-(v_prev->>'games')::numeric)/abs((v_prev->>'games')::numeric)*100,1) END,
      'fee_abs',round((v_cur->>'fee')::numeric-(v_prev->>'fee')::numeric,2),
      'winnings_abs',round((v_cur->>'total_winnings')::numeric-(v_prev->>'total_winnings')::numeric,2)),
    'series',v_series,'series_bucket',v_bucket,
    'breakdown',v_pack->'rows','breakdown_kind',v_kind,
    'breakdown_total',(v_pack->>'total_direct')::numeric,
    'breakdown_count',(v_pack->>'total')::int,
    'breakdown_offset',v_off,'commission_total',(v_pack->>'total_commission')::numeric,
    'breakdown_live',v_live,'rake_complete_through',NULL,
    'applied_search',v_q,'applied_sort',v_sort,
    'data_updated_at',CASE WHEN v_w IS NOT NULL THEN (v_w->>'data_updated_at')::timestamptz ELSE CASE WHEN v_invoice THEN (SELECT max(g.last_at) FROM public.ca_club_acct_fact_ct g WHERE g.club_id=ANY(v_clubs) AND g.stat_date BETWEEN v_start AND v_end) ELSE (SELECT max(g.last_at) FROM public.ca_club_data_pacific_game_ct g
        WHERE g.club_id = ANY(v_clubs) AND g.stat_date BETWEEN v_start AND v_end) END END,
    'accounting_basis',CASE WHEN v_invoice THEN 'union_invoice_accounting' ELSE 'pacific_net_money_flow' END,'day_basis','America/Los_Angeles 00:00','generated_at',now());
  v_pacific_final:=v_pacific_final||jsonb_build_object('previous_coverage',v_pacific_previous,'accounting_coverage',v_coverage);
  IF NOT (v_pacific_previous->>'complete')::boolean THEN
    v_pacific_final:=jsonb_set(v_pacific_final,'{delta}',jsonb_build_object('fee_pct',NULL,'games_pct',NULL,'fee_abs',NULL,'winnings_abs',NULL));
  END IF;
  RETURN v_pacific_final;
END;
$function$
;

DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.ca_rake_export_start_pacific_v2(text,uuid,date,date,uuid,text,text,uuid)'::regprocedure))<>'8660674a7c6cbba76d67f47eee744bdb' THEN RAISE EXCEPTION 'DATA_RECONCILIATION_PREIMAGE_CHANGED: ca_rake_export_start_pacific_v2('; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.ca_rake_export_start_pacific_v2(p_scope_type text, p_scope_id uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_agent_user_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_sort text DEFAULT 'rake'::text, p_request_id uuid DEFAULT gen_random_uuid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '120s'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_scope text := lower(COALESCE(NULLIF(btrim(p_scope_type), ''), ''));
  v_scope_id uuid := p_scope_id;
  v_club_id uuid;
  v_union_id uuid;
  v_agent_user_id uuid;
  v_today date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_end date := LEAST(COALESCE(p_end, v_today), v_today);
  v_start date := COALESCE(p_start, v_end - 6);
  v_search text := NULLIF(left(btrim(COALESCE(p_search, '')), 160), '');
  v_sort text := lower(COALESCE(NULLIF(btrim(p_sort), ''), 'rake'));
  v_report_basis text; v_invoice boolean; v_request uuid := md5('ca-data-pacific:'||COALESCE(p_request_id,gen_random_uuid())::text)::uuid;
  v_chunk integer;
  v_max_rows constant integer := 20000;
  v_export_id uuid;
  v_expires_at timestamptz;
  v_existing public.ca_club_data_exports%ROWTYPE;
  v_response jsonb;
  v_reported integer;
  v_inserted integer;
  v_agent_overflow boolean;
  v_book_rows integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'sign in to prepare a Rake Snapshot export'
      USING ERRCODE = '42501';
  END IF;
  IF v_scope NOT IN ('club', 'union', 'agent') OR v_scope_id IS NULL THEN
    RAISE EXCEPTION 'Rake Snapshot export scope is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_start < v_end - 730 THEN v_start := v_end - 730; END IF;
  IF v_start > v_end THEN v_start := v_end; END IF;

  IF v_scope = 'club' THEN
    v_club_id := v_scope_id;
    v_agent_user_id := NULL;
    v_chunk := 200;
    IF v_sort NOT IN ('rake', 'name', 'cost', 'players') THEN v_sort := 'rake'; END IF;
    IF NOT public.ca_can_read_club_production(v_club_id) THEN
      RAISE EXCEPTION 'Rake Snapshot export is no longer authorized'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_scope = 'union' THEN
    v_union_id := v_scope_id;
    v_agent_user_id := NULL;
    v_chunk := 200;
    IF v_sort NOT IN ('rake', 'name', 'hands') THEN v_sort := 'rake'; END IF;
    IF NOT public.ca_can_oversee_union(v_union_id) THEN
      RAISE EXCEPTION 'Rake Snapshot export is no longer authorized'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    v_club_id := v_scope_id;
    v_agent_user_id := COALESCE(p_agent_user_id, v_user);
    v_chunk := 500;
    IF v_sort NOT IN ('rake', 'name', 'hands') THEN v_sort := 'rake'; END IF;
    IF NOT public.ca_can_read_rake_agent(v_agent_user_id, v_club_id) THEN
      RAISE EXCEPTION 'Rake Snapshot export is no longer authorized'
        USING ERRCODE = '42501';
    END IF;
  END IF;


 v_invoice:=v_scope IN('club','union') AND public.fn_ca_club_data_reads_union_basis(v_scope_id,v_start,v_end);
 v_report_basis:=CASE WHEN v_invoice THEN 'union_invoice_accounting' ELSE 'pacific_net_money_flow' END;
 IF v_invoice THEN v_request:=md5('ca-data-pacific-invoice:'||v_request::text)::uuid; END IF;
 -- One start per user at a time, refused immediately rather than queued.
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('ca-club-data-export-user:' || v_user::text, 0)
  ) THEN
    RAISE EXCEPTION 'Another Club Data export is already being prepared.'
      USING ERRCODE = '55000';
  END IF;

  -- A retried request resumes the same immutable job, and only a Rake job.
  SELECT *
    INTO v_existing
    FROM public.ca_club_data_exports existing_job
   WHERE existing_job.user_id = v_user
     AND existing_job.request_id = v_request
     AND existing_job.kind = 'rake'
     AND existing_job.expires_at >= now();

  IF v_existing.id IS NOT NULL THEN
    IF (v_invoice AND v_existing.metadata->>'accounting_basis' IS DISTINCT FROM v_report_basis) OR v_existing.metadata->>'day_basis' IS DISTINCT FROM 'America/Los_Angeles 00:00' OR v_existing.scope_type IS DISTINCT FROM v_scope
       OR v_existing.scope_id IS DISTINCT FROM v_scope_id
       OR v_existing.agent_user_id IS DISTINCT FROM v_agent_user_id
       OR v_existing.date_from IS DISTINCT FROM v_start
       OR v_existing.date_to IS DISTINCT FROM v_end
       OR v_existing.request_search IS DISTINCT FROM v_search
       OR v_existing.sort_key IS DISTINCT FROM v_sort THEN
      RAISE EXCEPTION 'Rake Snapshot request id was already used for different inputs'
        USING ERRCODE = '22023';
    END IF;
    IF v_existing.status <> 'ready' THEN
      RAISE EXCEPTION 'Rake Snapshot export is still being prepared'
        USING ERRCODE = '55000';
    END IF;
    IF COALESCE(
         (v_existing.metadata ->> 'contains_admin_commission')::boolean,
         false
       )
       AND NOT public.fn_is_club_admin_uid(v_existing.club_id) THEN
      RAISE EXCEPTION
        'Rake Snapshot export permissions changed; prepare a new export'
        USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object(
      'export_id', v_existing.id,
      'status', v_existing.status,
      'kind', v_existing.kind,
      'total_rows', v_existing.total_rows,
      'total_amount', v_existing.total_amount,
      'expires_at', v_existing.expires_at,
      'metadata', v_existing.metadata,
      'metadata_fingerprint', v_existing.metadata_fingerprint
    );
  END IF;

  -- The same request id held by a live job of another kind is a different
  -- request: refused, never replayed as Rake and never rebuilt over it.
  IF EXISTS (
    SELECT 1
      FROM public.ca_club_data_exports other_kind
     WHERE other_kind.user_id = v_user
       AND other_kind.request_id = v_request
       AND other_kind.kind <> 'rake'
       AND other_kind.expires_at >= now()
  ) THEN
    RAISE EXCEPTION 'Rake Snapshot request id was already used for different inputs'
      USING ERRCODE = '22023';
  END IF;

  -- The expired job owned by the caller is reclaimed first, and never behind
  -- the shared prune's try-lock: an owner whose previous export lost its
  -- cleanup must not be locked out of the next one. Bounded to one export
  -- (50,000 rows exceeds anything a door can prepare); SKIP LOCKED so a
  -- prune retiring the same parent from another session is never waited on.
  DELETE FROM public.ca_club_data_export_rows own_row
   USING (
     SELECT stale_row.export_id, stale_row.ordinal
       FROM public.ca_club_data_export_rows stale_row
       JOIN public.ca_club_data_exports expired_slot
         ON expired_slot.id = stale_row.export_id
      WHERE expired_slot.user_id = v_user
        AND expired_slot.expires_at < now()
      ORDER BY stale_row.export_id, stale_row.ordinal
      LIMIT 50000
      FOR UPDATE OF stale_row SKIP LOCKED
   ) doomed
   WHERE own_row.export_id = doomed.export_id
     AND own_row.ordinal = doomed.ordinal;

  DELETE FROM public.ca_club_data_exports expired_slot
   USING (
     SELECT reclaimable.id
       FROM public.ca_club_data_exports reclaimable
      WHERE reclaimable.user_id = v_user
        AND reclaimable.expires_at < now()
      FOR UPDATE SKIP LOCKED
   ) reclaimed
   WHERE expired_slot.id = reclaimed.id
     AND NOT EXISTS (
       SELECT 1
         FROM public.ca_club_data_export_rows export_row
        WHERE export_row.export_id = expired_slot.id
     );

  IF EXISTS (
    SELECT 1
      FROM public.ca_club_data_exports active_slot
     WHERE active_slot.user_id = v_user
  ) THEN
    RAISE EXCEPTION
      'Another Club Data export is already being prepared, downloaded, or cleaned up.'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.ca_club_data_exports(
    user_id, club_id, request_id, kind, scope_type, scope_id, union_id,
    agent_user_id, date_from, date_to, request_search, sort_key
  )
  VALUES (
    v_user, v_club_id, v_request, 'rake', v_scope, v_scope_id, v_union_id,
    v_agent_user_id, v_start, v_end, v_search, v_sort
  )
  RETURNING id, expires_at INTO v_export_id, v_expires_at;

  -- One data-changing statement owns the reporting snapshot. Its first call
  -- goes through ca_rake_snapshot, the public canonical door and authorization
  -- gate. Remaining pages call only the same private helpers that door uses.
  -- No Rake arithmetic or commission allocation is reimplemented here.
  WITH first_snapshot AS MATERIALIZED (
    SELECT public.ca_rake_snapshot_pacific_v2(
      v_scope,
      v_club_id,
      v_union_id,
      v_start,
      v_end,
      v_agent_user_id,
      v_chunk,
      0,
      v_search,
      v_sort
    ) AS document
  -- Search is applied after fn_ca_rake_by_downline's deliberately widened
  -- 20,001-row source walk. Count that unfiltered source independently: a
  -- narrow search must never turn a truncated downline into a "complete" file.
  ), agent_capacity AS MATERIALIZED (
    SELECT public.fn_ca_rake_by_downline(
             v_agent_user_id,
             v_club_id,
             (v_start::timestamp AT TIME ZONE 'America/Los_Angeles'),
             ((v_end + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'),
             1,
             0,
             NULL,
             'rake'
           ) AS document
     WHERE v_scope = 'agent'
  ), snapshot_shape AS MATERIALIZED (
    SELECT first_snapshot.document,
           GREATEST(
             COALESCE((first_snapshot.document ->> 'breakdown_count')::integer, 0),
             0
           ) AS total,
           (
             v_scope = 'club'
             AND public.fn_is_club_admin_uid(v_club_id)
           ) AS contains_admin_commission,
           COALESCE(
             (agent_capacity.document ->> 'total')::integer,
             0
           ) > v_max_rows AS agent_overflow
      FROM first_snapshot
      LEFT JOIN agent_capacity ON true
  ), bounded_snapshot AS MATERIALIZED (
    SELECT *
      FROM snapshot_shape
     WHERE snapshot_shape.total <= v_max_rows
       AND NOT snapshot_shape.agent_overflow
  ), page_offsets AS (
    SELECT generate_series(0, bounded_snapshot.total - 1, v_chunk)::integer AS page_offset,
           bounded_snapshot.document,
           bounded_snapshot.total,
           bounded_snapshot.contains_admin_commission
      FROM bounded_snapshot
  ), page_packs AS MATERIALIZED (
    SELECT page_offsets.page_offset,
           CASE
             WHEN page_offsets.page_offset = 0 THEN
               jsonb_build_object(
                 'rows', COALESCE(page_offsets.document -> 'breakdown', '[]'::jsonb)
               )
             WHEN v_scope = 'club' THEN public.fn_ca_rake_by_agent_pacific(
               v_club_id, v_start, v_end, v_chunk, page_offsets.page_offset,
               v_search, v_sort
             )
             WHEN v_scope = 'union' THEN public.fn_ca_rake_by_club_pacific_v2(
               public.fn_ca_club_data_clubs(v_union_id),
               v_start, v_end, v_chunk, page_offsets.page_offset, v_search, v_sort
             )
             ELSE public.fn_ca_rake_by_downline(
               v_agent_user_id,
               v_club_id,
               (v_start::timestamp AT TIME ZONE 'America/Los_Angeles'),
               ((v_end + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'),
               v_chunk,
               page_offsets.page_offset,
               v_search,
               v_sort
             )
           END AS page_document
      FROM page_offsets
  ), collected AS MATERIALIZED (
    SELECT page_row.row_data
      FROM page_packs
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(page_packs.page_document -> 'rows', '[]'::jsonb)
      ) WITH ORDINALITY AS page_row(row_data, page_ordinal)
  ), ordered AS (
    SELECT row_number() OVER (
             ORDER BY
               CASE WHEN v_scope = 'club' THEN
                 COALESCE((collected.row_data ->> 'is_unassigned')::boolean, false)
               END ASC NULLS LAST,
               CASE WHEN v_scope = 'club' AND v_sort = 'name' THEN
                 lower(COALESCE(collected.row_data ->> 'name', ''))
               END ASC NULLS LAST,
               CASE WHEN v_scope = 'club' AND v_sort = 'cost' THEN
                 NULLIF(collected.row_data ->> 'commission_earned', '')::numeric
               END DESC NULLS LAST,
               CASE WHEN v_scope = 'club' AND v_sort = 'players' THEN
                 COALESCE((collected.row_data ->> 'network_players')::numeric, 0)
               END DESC NULLS LAST,
               CASE WHEN v_scope = 'club' AND v_sort = 'rake' THEN
                 COALESCE((collected.row_data ->> 'network_rake')::numeric, 0)
               END DESC NULLS LAST,
               CASE WHEN v_scope = 'union' AND v_sort = 'name' THEN
                 lower(COALESCE(collected.row_data ->> 'name', ''))
               END ASC NULLS LAST,
               CASE WHEN v_scope = 'union' AND v_sort = 'hands' THEN
                 COALESCE((collected.row_data ->> 'hands')::numeric, 0)
               END DESC NULLS LAST,
               CASE WHEN v_scope = 'union' AND v_sort = 'rake' THEN
                 COALESCE((collected.row_data ->> 'fee')::numeric, 0)
               END DESC NULLS LAST,
               CASE WHEN v_scope = 'agent' AND v_sort = 'name' THEN
                 lower(COALESCE(collected.row_data ->> 'name', ''))
               END ASC NULLS LAST,
               CASE WHEN v_scope = 'agent' AND v_sort = 'hands' THEN
                 COALESCE((collected.row_data ->> 'hands')::numeric, 0)
               END DESC NULLS LAST,
               CASE WHEN v_scope = 'agent' AND v_sort = 'rake' THEN
                 COALESCE((collected.row_data ->> 'rake')::numeric, 0)
               END DESC NULLS LAST,
               lower(COALESCE(collected.row_data ->> 'name', '')) ASC,
               CASE WHEN v_scope = 'club' THEN
                 COALESCE(collected.row_data ->> 'agent_user_id', '')
               END ASC,
               CASE WHEN v_scope = 'union' THEN
                 COALESCE(collected.row_data ->> 'club_id', '')
               END ASC,
               CASE WHEN v_scope = 'agent' THEN
                 COALESCE(collected.row_data ->> 'player_id', '')
               END ASC
           )::integer AS ordinal,
           collected.row_data AS payload
      FROM collected
  ), inserted_rows AS (
    INSERT INTO public.ca_club_data_export_rows(export_id, ordinal, payload)
    SELECT v_export_id, ordered.ordinal, ordered.payload
      FROM ordered
     ORDER BY ordered.ordinal
    RETURNING ordinal
  ), ready_metadata AS MATERIALIZED (
    SELECT jsonb_build_object(
             'schema_version', 1,
             'kind', 'rake',
             'scope_type', v_scope,
             'scope_id', v_scope_id,
             'club_id', v_club_id,
             -- Scope identity, not incidental membership context: a club that
             -- belongs to a union is still a club-scoped immutable request.
             'union_id', v_union_id,
             'agent_user_id', v_agent_user_id,
             'date_from', v_start,
             'date_to', v_end,
             'search', v_search,
             'sort', v_sort,
             'reconciliation',snapshot_shape.document#>'{summary,reconciliation}','accounting_coverage',snapshot_shape.document->'accounting_coverage',
      'accounting_basis', snapshot_shape.document -> 'accounting_basis', 'day_basis', 'America/Los_Angeles 00:00', 'generated_at', snapshot_shape.document -> 'generated_at',
             'scope_label', snapshot_shape.document -> 'scope_label',
             'breakdown_kind', snapshot_shape.document -> 'breakdown_kind',
             'breakdown_total', COALESCE(
               (snapshot_shape.document ->> 'breakdown_total')::numeric,
               0
             ),
             'commission_total', snapshot_shape.document -> 'commission_total',
             'contains_admin_commission', snapshot_shape.contains_admin_commission
           ) AS metadata,
           snapshot_shape.total,
           COALESCE(
             (snapshot_shape.document ->> 'breakdown_total')::numeric,
             0
           ) AS total_amount
      FROM snapshot_shape
     WHERE snapshot_shape.total <= v_max_rows
       AND NOT snapshot_shape.agent_overflow
  ), finalized AS (
    UPDATE public.ca_club_data_exports export_job
       SET status = 'ready',
           total_rows = ready_metadata.total,
           total_amount = ready_metadata.total_amount,
           union_id = NULLIF(ready_metadata.metadata ->> 'union_id', '')::uuid,
           metadata = ready_metadata.metadata,
           metadata_fingerprint = md5(ready_metadata.metadata::text)
      FROM ready_metadata
     WHERE export_job.id = v_export_id
       AND (SELECT count(*) FROM inserted_rows) = ready_metadata.total
    RETURNING jsonb_build_object(
      'export_id', export_job.id,
      'status', export_job.status,
      'kind', export_job.kind,
      'total_rows', export_job.total_rows,
      'total_amount', export_job.total_amount,
      'expires_at', export_job.expires_at,
      'metadata', export_job.metadata,
      'metadata_fingerprint', export_job.metadata_fingerprint
    ) AS response
  )
  SELECT (SELECT finalized.response FROM finalized),
         snapshot_shape.total,
         (SELECT count(*)::integer FROM inserted_rows),
         snapshot_shape.agent_overflow
    INTO v_response, v_reported, v_inserted, v_agent_overflow
    FROM snapshot_shape;

  IF COALESCE(v_agent_overflow, false) THEN
    -- Refused before any search filtering, and the refusal names the whole
    -- unfiltered book, never the searched subset. The capacity walk above
    -- stops at its 20,001-row sentinel, so the book is counted once more
    -- here, uncapped, on this refusal path only.
    SELECT count(*)::integer
      INTO v_book_rows
      FROM public.fn_agent_downline_rake(
             v_agent_user_id,
             v_club_id,
             (v_start::timestamp AT TIME ZONE 'America/Los_Angeles'),
             ((v_end + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'),
             NULL,
             2147483647
           );
    RAISE EXCEPTION
      'Rake Snapshot export has % rows; the safe limit is %',
      v_book_rows,
      v_max_rows
      USING ERRCODE = '54000';
  END IF;
  IF v_reported > v_max_rows THEN
    RAISE EXCEPTION
      'Rake Snapshot export has % rows; the safe limit is %',
      v_reported,
      v_max_rows
      USING ERRCODE = '54000';
  END IF;
  IF v_reported IS NULL OR v_inserted IS DISTINCT FROM v_reported
     OR v_response IS NULL THEN
    RAISE EXCEPTION
      'Rake Snapshot export changed while it was being prepared'
      USING ERRCODE = '55000';
  END IF;

  -- Somebody else's stranded expired job, if any: bounded, non-blocking,
  -- and last, so the row locks it takes are held only until this commit.
  PERFORM public.ca_prune_expired_club_data_exports(2000);

  RETURN v_response;
END;
$function$
;

-- Reassert the original private/public doors; CREATE OR REPLACE keeps their
-- existing ACLs, and explicit declarations also qualify the maintained scanner.
REVOKE ALL ON FUNCTION public.fn_ca_club_acct_put(jsonb,smallint),public.fn_ca_club_acct_cash_fee_rows(jsonb),public.fn_ca_club_acct_admission_rows(jsonb),public.fn_ca_club_acct_bbj_rows(uuid,uuid,timestamptz),public.fn_ca_club_acct_seed_day(date,boolean),public.fn_ca_club_acct_seed_begin(date,boolean),public.fn_ca_club_acct_seed_finish(date,pg_snapshot,bigint,bigint,bigint),public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ca_rake_snapshot_pacific_v2(text,uuid,uuid,date,date,uuid,integer,integer,text,text),public.ca_rake_export_start_pacific_v2(text,uuid,date,date,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ca_rake_snapshot_pacific_v2(text,uuid,uuid,date,date,uuid,integer,integer,text,text),public.ca_rake_export_start_pacific_v2(text,uuid,date,date,uuid,text,text,uuid) TO authenticated,service_role;
COMMIT;
