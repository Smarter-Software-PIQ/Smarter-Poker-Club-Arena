-- 20261127172908_cron_watchers_materialize_and_prune_without_deadlock.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- CRON WATCHERS MATERIALIZE THEIR READS AND PRUNE WITHOUT DEADLOCK (2026-11-27)
--
-- Follow-up root-cause hardening for drift incident f8222046-da2b-4f24-a5a7-22a68fe8c783
-- (ca-horse-exposure-watch-hourly past deadline in Daily Digest 2026-11-26) and the
-- sibling scheduled-job timeout / deadlock failure modes observed in cron.job_run_details:
--
-- 1. ca-horse-exposure-watch-hourly (fn_ca_horse_exposure_hands / fn_ca_horse_exposure_watch):
--    Migration 20261127043816 fixed Step 3 (flagged-person breakdown), but Step 1 still
--    scans ~90,390 human hand_history rows through idx_hand_history_human_created every
--    hour (~89,981 buffers, discarding ~58,943 non-PLO4/5/tournament/bomb-pot rows) and
--    fn_ca_horse_exposure_watch still sets statement_timeout='120s' under a '150s' cron.
--    Fix: partial covering index idx_hand_history_human_plo45_cash_created on
--    (created_at) INCLUDE (id) for has_human PLO4/PLO5 non-bomb cash hands, and align
--    fn_ca_horse_exposure_watch's statement_timeout with its 150s cron budget.
--
-- 2. ca-free-buy-funding-watch-15m (fn_ca_free_buy_funding_watch):
--    28 statement-timeout failures in 7 days, still running 10-20s every 15 minutes
--    against a function-level statement_timeout='30s' that overrides the cron's '60s'.
--    Root cause: `WITH gtd AS (...)` was not MATERIALIZED, so PG17 inlined `gtd` and
--    evaluated `public.fn_ca_guarantee_funding(t.id)` up to 7 times per tournament row;
--    `fb` was also unmaterialized across 4 branches; and `t.start_time >= c_gross_since
--    AND t.start_time >= v_window` used the fixed Nov-5 constant as the index range,
--    discarding 56,712 older tournaments per pass.
--    Benchmarked read-only on production: `WITH gtd AS MATERIALIZED` runs in 824 ms.
--    Fix: MATERIALIZE `gtd` and `fb`, bound `t.start_time >= GREATEST(..., v_window)`,
--    and align statement_timeout to '60s'.
--
-- 3. ca-guarantee-funding-variance-15m (fn_ca_guarantee_funding_variance_scan):
--    Same defect class: `WITH cov AS (...)` was not MATERIALIZED (evaluating
--    `public.fn_ca_guarantee_funding(t.id)` up to 9 times per tournament row) and scanned
--    from the fixed Nov-5 constant instead of GREATEST(v_since, now() - interval '14 days').
--    Fix: MATERIALIZE `cov`, bound with GREATEST(...), and set lock_timeout='2s' /
--    statement_timeout='60s'.
--
-- 4. ca-diamond-prune-history-daily (fn_ca_diamond_prune_history):
--    Failed on 2026-11-23 with `ERROR: deadlock detected` because unbounded DELETE
--    statements on public.user_daily_challenges locked rows in arbitrary physical heap
--    order while live player writes locked rows in primary-key order.
--    Fix: deterministic primary-key-ordered batched deletes (`ORDER BY id LIMIT 2000
--    FOR UPDATE SKIP LOCKED`) with lock_timeout='2s' and statement_timeout='120s'.
--    Retention floors (7 / 400 / 45 days), service_role check, and return JSON are unchanged.
--
-- No money moves, no game table is locked, and every grant is restated exactly as live
-- (postgres and service_role only). Pinned by
-- tests/cron-watchers-materialize-and-prune-without-deadlock.law.test.ts.
--
-- Install-budget hardening (incident 37a45c05-e9bb-4d31-a579-0e9363a56a64, run 46054847104):
--   - fn_ca_free_buy_funding_watch() is a zero-arg 14-day multi-table watcher (60s budget)
--     that timed out at 9,952 ms (ERROR 57014) when called inside DO $probe$ under the 8s/12s
--     install budget -> marked @probe-exempt and checked statically by plpgsql_check in CI.
--   - fn_ca_diamond_prune_history(...) is a daily 120s pruner whose queries scan
--     public.user_daily_challenges (no created_at index) twice and ca_diamond_incidents once
--     even for distant retention cutoffs -> marked @probe-exempt and checked by plpgsql_check.
--   - fn_ca_guarantee_funding_variance_scan(...) probe uses clock_timestamp() + interval '100 years'
--     so idx_tournaments_start_time matches zero rows regardless of scheduled future majors.
--
-- @live-proof: (SELECT bool_and(i.indisvalid AND i.indisready) AND count(*) = 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_hand_history_human_plo45_cash_created'))
-- @live-proof: position('WITH gtd AS MATERIALIZED' in pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure)) > 0 AND position('GREATEST(c_gross_since, v_window)' in pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure)) > 0 AND position('WITH cov AS MATERIALIZED' in pg_get_functiondef('public.fn_ca_guarantee_funding_variance_scan(timestamp with time zone)'::regprocedure)) > 0 AND position('FOR UPDATE SKIP LOCKED' in pg_get_functiondef('public.fn_ca_diamond_prune_history(integer,integer,integer)'::regprocedure)) > 0
-- @live-proof: (SELECT NOT has_function_privilege('authenticated', 'public.fn_ca_free_buy_funding_watch()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_ca_guarantee_funding_variance_scan(timestamp with time zone)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_ca_diamond_prune_history(integer,integer,integer)', 'EXECUTE'))
-- @replaces-md5: public.fn_ca_free_buy_funding_watch()=81d72e4361a751945dc9087fff71a929
-- @replaces-md5: public.fn_ca_guarantee_funding_variance_scan(timestamp with time zone)=a6b8f0d440d2651c42630c4c9d8d40cd
-- @replaces-md5: public.fn_ca_diamond_prune_history(integer,integer,integer)=a4f628c380968183c041058bfa15135f
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hand_history_human_plo45_cash_created
 ON public.hand_history USING btree (created_at) INCLUDE (id)
 WHERE (has_human AND (game_variant = ANY (ARRAY['plo4'::text, 'plo5'::text])) AND (tournament_id IS NULL) AND (bomb_pot IS NULL));

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '8s';

DO $verify_index$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ic.relam
    WHERE i.indexrelid = to_regclass('public.idx_hand_history_human_plo45_cash_created')
      AND i.indrelid = 'public.hand_history'::regclass
      AND am.amname = 'btree'
      AND i.indisvalid AND i.indisready AND i.indislive
      AND NOT i.indisunique AND i.indexprs IS NULL
      AND i.indnkeyatts = 1 AND i.indnatts = 2
      AND ARRAY(SELECT pg_get_indexdef(i.indexrelid, n, true) FROM generate_series(1, 2) n) = ARRAY['created_at', 'id']
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%has_human%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%plo4%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%plo5%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%tournament_id IS NULL%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%bomb_pot IS NULL%'
  ) THEN
    RAISE EXCEPTION 'CRON_WATCH_INDEX_NOT_QUALIFIED: public.idx_hand_history_human_plo45_cash_created' USING ERRCODE = '55000';
  END IF;
END
$verify_index$;

-- 1. Align fn_ca_horse_exposure_watch statement_timeout with its 150s cron command.
ALTER FUNCTION public.fn_ca_horse_exposure_watch(timestamp with time zone, boolean)
  SET statement_timeout = '150s';

-- 2. Materialize gtd and fb in fn_ca_free_buy_funding_watch and bound start_time by GREATEST.
CREATE OR REPLACE FUNCTION public.fn_ca_free_buy_funding_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private', 'pg_temp'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  -- The gross guarantee rule shipped at 20261105222502; the first Free Buy
  -- ticket was redeemed (20261105223835 installed) at 23:18:46 UTC.
  c_gross_since constant timestamptz := '2026-11-05 22:25:02+00';
  c_tickets_live constant timestamptz := '2026-11-05 23:18:46+00';
  -- #9726: a first entry's prize promo is posted at registration close;
  -- the last sign-up head carrying a prize part is 21:05:26 UTC (20261107041909).
  c_cutoff_live constant timestamptz := '2026-11-06 21:06:19+00';
  c_midway constant uuid := 'fade0000-0000-0000-0000-000000000001';
  c_source constant text := 'fn_ca_free_buy_funding_watch';
  v_now timestamptz := clock_timestamp();
  v_window timestamptz := clock_timestamp() - interval '14 days';
  v_grace timestamptz := clock_timestamp() - interval '2 minutes';
  v_found jsonb;
  v_open integer := 0; v_new integer := 0; v_closed integer := 0;
  v_alert uuid;
  f record;  -- not r: the finding query aliases the redemptions r
BEGIN
  WITH gtd AS MATERIALIZED (
    SELECT t.id, t.name, public.fn_ca_guarantee_funding(t.id) AS f
      FROM public.tournaments t
     WHERE coalesce(t.guaranteed_prize, 0) > 0
       AND coalesce(t.prize_pool_finalized, false)
       AND coalesce(t.variant, '') NOT IN ('satellite', 'spin')
       AND coalesce(t.satellite_seats, 0) = 0
       AND coalesce(t.status, '') <> 'CANCELLED'
       AND t.start_time >= GREATEST(c_gross_since, v_window)
  ), fb AS MATERIALIZED (
    SELECT t.id, t.name, t.status, t.start_time, coalesce(t.guaranteed_prize, 0) AS g,
           coalesce(t.prize_pool_finalized, false) AS fin,
           public.fn_ca_midway_free_buy_format(t.id) AS fmt
      FROM public.tournaments t
     WHERE coalesce(t.free_buy, false)
       AND (t.union_id = c_midway OR t.club_id = c_midway)
       AND t.start_time >= GREATEST(c_tickets_live, v_window)
  ), fb_voucher AS MATERIALIZED (
    SELECT fb.id, fb.name, fb.fmt
      FROM fb
     WHERE fb.fmt IS NOT NULL AND fb.g <= 0 AND fb.fin AND coalesce(fb.status, '') <> 'CANCELLED'
  ), voucher_entries AS (
    SELECT p.tournament_id, count(*) AS v
      FROM public.tournament_players p
      JOIN fb_voucher fv ON fv.id = p.tournament_id
     GROUP BY p.tournament_id
  ), voucher_send AS (
    SELECT l.to_entity_id AS tournament_id, coalesce(sum(l.amount), 0) AS amt
      FROM public.chip_ledger l
      JOIN fb_voucher fv ON fv.id = l.to_entity_id
     WHERE coalesce(l.status, 'posted') = 'posted'
       AND l.category = 'promo_send'
       AND l.from_type = 'union_wallet'
       AND l.to_type = 'prize_liability'
     GROUP BY l.to_entity_id
  ), voucher_rev AS (
    SELECT l.from_entity_id AS tournament_id, coalesce(sum(l.amount), 0) AS amt
      FROM public.chip_ledger l
      JOIN fb_voucher fv ON fv.id = l.from_entity_id
     WHERE coalesce(l.status, 'posted') = 'posted'
       AND l.category = 'reversal'
       AND l.from_type = 'prize_liability'
       AND l.to_type = 'union_wallet'
       AND l.to_label = 'union_wallets.promo_wallet'
     GROUP BY l.from_entity_id
  ), voucher AS (
    SELECT fv.id, fv.name, fv.fmt,
           coalesce(ve.v, 0) AS v,
           coalesce(vs.amt, 0) - coalesce(vr.amt, 0) AS p
      FROM fb_voucher fv
      LEFT JOIN voucher_entries ve ON ve.tournament_id = fv.id
      LEFT JOIN voucher_send vs ON vs.tournament_id = fv.id
      LEFT JOIN voucher_rev vr ON vr.tournament_id = fv.id
  ), live AS (
    SELECT r.user_id, r.gaming_day, count(*) AS n
      FROM smarter_private.free_buy_ticket_redemptions r
     WHERE r.returned_at IS NULL AND r.gaming_day >= (v_window AT TIME ZONE 'America/Chicago')::date
     GROUP BY 1, 2
  ), finding AS (
    SELECT CASE WHEN (g.f->>'house_posted')::numeric > (g.f->>'house_required')::numeric
                THEN 'guarantee_overfunded' ELSE 'guarantee_underfunded' END AS kind,
           g.id::text AS subject, g.id AS tournament_id,
           g.f || jsonb_build_object('name', g.name, 'variance',
             round((g.f->>'house_posted')::numeric - (g.f->>'house_required')::numeric, 2)) AS detail
      FROM gtd g
     WHERE abs((g.f->>'house_posted')::numeric - (g.f->>'house_required')::numeric) > 0.01
    UNION ALL
    SELECT CASE WHEN v.p > v.v THEN 'voucher_overfunded' ELSE 'voucher_underfunded' END,
           v.id::text, v.id,
           jsonb_build_object('name', v.name, 'format', v.fmt, 'first_entries', v.v,
             'promo_net', v.p, 'variance', round(v.p - v.v, 2))
      FROM voucher v
     WHERE abs(v.p - v.v) > 0.01
    UNION ALL
    SELECT 'ticket_day_mismatch', coalesce(d.user_id, x.user_id)::text || ':' || coalesce(d.gaming_day, x.gaming_day)::text,
           NULL::uuid,
           jsonb_build_object('user_id', coalesce(d.user_id, x.user_id),
             'gaming_day', coalesce(d.gaming_day, x.gaming_day),
             'day_counter', coalesce(d.used, 0), 'live_redemptions', coalesce(x.n, 0))
      FROM (SELECT * FROM smarter_private.free_buy_ticket_days
             WHERE gaming_day >= (v_window AT TIME ZONE 'America/Chicago')::date) d
      FULL JOIN live x ON x.user_id = d.user_id AND x.gaming_day = d.gaming_day
     WHERE coalesce(d.used, 0) <> coalesce(x.n, 0)
    UNION ALL
    SELECT 'ticket_without_entry', r.registration_id::text, r.tournament_id,
           jsonb_build_object('user_id', r.user_id, 'gaming_day', r.gaming_day, 'redeemed_at', r.redeemed_at)
      FROM smarter_private.free_buy_ticket_redemptions r
     WHERE r.returned_at IS NULL AND r.redeemed_at >= v_window AND r.redeemed_at < v_grace
       AND NOT EXISTS (SELECT 1 FROM public.tournament_players p WHERE p.id = r.registration_id)
    UNION ALL
    SELECT 'ticket_on_cancelled_event', r.registration_id::text, r.tournament_id,
           jsonb_build_object('user_id', r.user_id, 'gaming_day', r.gaming_day, 'redeemed_at', r.redeemed_at)
      FROM smarter_private.free_buy_ticket_redemptions r
      JOIN public.tournaments t ON t.id = r.tournament_id
     WHERE r.returned_at IS NULL AND r.redeemed_at >= v_window AND t.status = 'CANCELLED'
    UNION ALL
    SELECT 'entry_without_ticket', p.id::text, fb.id,
           jsonb_build_object('name', fb.name, 'user_id', p.user_id, 'registered_at', p.registered_at)
      FROM fb JOIN public.tournament_players p ON p.tournament_id = fb.id
     WHERE fb.fmt IS NOT NULL
       AND fb.status <> 'CANCELLED'
       AND p.registered_at < v_grace
       AND NOT EXISTS (SELECT 1 FROM smarter_private.free_buy_ticket_redemptions r
                        WHERE r.registration_id = p.id AND r.returned_at IS NULL)
       -- The approved exception is a record, not a clock (20261106205705).
       AND NOT EXISTS (SELECT 1 FROM smarter_private.free_buy_rollout_entries g
                        WHERE g.registration_id = p.id)
    UNION ALL
    SELECT 'early_prize_promo', l.id::text, fb.id,
           jsonb_build_object('name', fb.name, 'ledger_id', l.id, 'idempotency_key', l.idempotency_key,
             'amount', l.amount, 'prize_part', l.metadata->>'prize_part', 'created_at', l.created_at,
             'finalized', fb.fin)
      FROM fb JOIN public.chip_ledger l ON l.to_entity_id = fb.id
     WHERE l.to_type = 'prize_liability' AND l.category = 'promo_send' AND l.from_type = 'union_wallet'
       AND coalesce(l.status, 'posted') = 'posted'
       AND l.metadata->>'kind' = 'midway_free_buy_promo_head'
       AND l.created_at >= c_cutoff_live
       AND ((split_part(l.idempotency_key, ':', 1) = 'tourney'
             AND split_part(l.idempotency_key, ':', 3) = 'promo_head'
             AND split_part(l.idempotency_key, ':', 4) <> ''
             AND coalesce((l.metadata->>'prize_part')::numeric, l.amount) > 0)
         OR (l.idempotency_key = 'tourney:' || fb.id::text || ':free_buy_cutoff_funding'
             AND NOT fb.fin))
    UNION ALL
    SELECT 'free_buy_without_format', fb.id::text, fb.id,
           jsonb_build_object('name', fb.name, 'status', fb.status, 'start_time', fb.start_time)
      FROM fb
     WHERE fb.fmt IS NULL AND coalesce(fb.status, '') <> 'CANCELLED'
  )
  SELECT coalesce(jsonb_agg(to_jsonb(finding)), '[]'::jsonb) INTO v_found FROM finding;

  FOR f IN SELECT * FROM jsonb_to_recordset(v_found)
             AS x(kind text, subject text, tournament_id uuid, detail jsonb) LOOP
    v_open := v_open + 1;
    IF EXISTS (SELECT 1 FROM public.ca_free_buy_watch_findings w
                WHERE w.kind = f.kind AND w.subject = f.subject AND w.cleared_at IS NULL) THEN
      UPDATE public.ca_free_buy_watch_findings w
         SET detail = f.detail, last_seen_at = v_now
       WHERE w.kind = f.kind AND w.subject = f.subject;
      CONTINUE;
    END IF;
    v_new := v_new + 1;
    v_alert := public.fn_raise_server_financial_alert(
      CASE WHEN f.kind LIKE 'guarantee_%' OR f.kind LIKE 'voucher_%' OR f.kind = 'early_prize_promo'
           THEN 'critical' ELSE 'warning' END,
      c_source,
      CASE f.kind
        WHEN 'guarantee_overfunded' THEN format('%s received %s house/promo chips above H = max(0, G - C) = %s.',
          coalesce(f.detail->>'name', f.subject), f.detail->>'variance', f.detail->>'house_required')
        WHEN 'guarantee_underfunded' THEN format('%s received %s house/promo chips less than H = max(0, G - C) = %s.',
          coalesce(f.detail->>'name', f.subject), abs((f.detail->>'variance')::numeric), f.detail->>'house_required')
        WHEN 'voucher_overfunded' THEN format('%s (Free Buy, no guarantee) holds %s promo chips for %s first entries; H = V.',
          coalesce(f.detail->>'name', f.subject), f.detail->>'promo_net', f.detail->>'first_entries')
        WHEN 'voucher_underfunded' THEN format('%s (Free Buy, no guarantee) holds %s promo chips for %s first entries; H = V.',
          coalesce(f.detail->>'name', f.subject), f.detail->>'promo_net', f.detail->>'first_entries')
        WHEN 'ticket_day_mismatch' THEN format('Free Buy ticket day %s for player %s counts %s used but holds %s live redemptions.',
          f.detail->>'gaming_day', f.detail->>'user_id', f.detail->>'day_counter', f.detail->>'live_redemptions')
        WHEN 'ticket_without_entry' THEN format('A Free Buy ticket (registration %s) is spent with no registration behind it.', f.subject)
        WHEN 'ticket_on_cancelled_event' THEN format('A Free Buy ticket (registration %s) is still spent on a cancelled event.', f.subject)
        WHEN 'entry_without_ticket' THEN format('A %s registration (%s) holds no Free Buy ticket.', coalesce(f.detail->>'name', 'Free Buy'), f.subject)
        WHEN 'early_prize_promo' THEN format('%s holds a prize promo of %s chips posted while registration was open (ledger %s); prize promo is posted once, at registration close.',
          coalesce(f.detail->>'name', f.subject), coalesce(f.detail->>'prize_part', f.detail->>'amount'), f.subject)
        ELSE format('Midway Free Buy %s has no Free Buy format, so no ticket or voucher applies to it.', coalesce(f.detail->>'name', f.subject))
      END,
      jsonb_build_object('kind', f.kind, 'subject', f.subject, 'tournament_id', f.tournament_id, 'detail', f.detail),
      f.kind || ':' || f.subject,
      coalesce(f.tournament_id::text, f.subject));
    INSERT INTO public.ca_free_buy_watch_findings AS w
      (kind, subject, tournament_id, detail, first_seen_at, last_seen_at, alert_id)
    VALUES (f.kind, f.subject, f.tournament_id, f.detail, v_now, v_now, v_alert)
    ON CONFLICT (kind, subject) DO UPDATE
       SET detail = EXCLUDED.detail, first_seen_at = v_now, last_seen_at = v_now,
           cleared_at = NULL, alert_id = EXCLUDED.alert_id;
  END LOOP;

  -- Close what is no longer true, inside the window the scan still reads.
  FOR f IN
    SELECT w.kind, w.subject FROM public.ca_free_buy_watch_findings w
     WHERE w.cleared_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_found) AS x(kind text, subject text)
                        WHERE x.kind = w.kind AND x.subject = w.subject)
       AND (w.tournament_id IS NULL
            OR EXISTS (SELECT 1 FROM public.tournaments t
                        WHERE t.id = w.tournament_id AND t.start_time >= v_window))
       AND (w.kind <> 'ticket_day_mismatch'
            OR (w.detail->>'gaming_day')::date >= (v_window AT TIME ZONE 'America/Chicago')::date)
  LOOP
    UPDATE public.ca_free_buy_watch_findings w SET cleared_at = v_now
     WHERE w.kind = f.kind AND w.subject = f.subject;
    UPDATE public.financial_alerts a
       SET resolved = true, resolved_at = v_now,
           resolution = 'No longer true at the next Free Buy funding watch pass.'
     WHERE a.source = c_source AND a.resolved IS NOT TRUE
       AND a.context->>'dedupe_key' = f.kind || ':' || f.subject;
    v_closed := v_closed + 1;
  END LOOP;

  RETURN jsonb_build_object('open', v_open, 'new', v_new, 'closed', v_closed);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_free_buy_funding_watch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_free_buy_funding_watch() TO service_role;

-- 3. Materialize cov in fn_ca_guarantee_funding_variance_scan and bound start_time by GREATEST.
CREATE OR REPLACE FUNCTION public.fn_ca_guarantee_funding_variance_scan(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  -- The gross rule shipped at 2026-11-05 22:25 UTC (20261105222502); events
  -- funded before it are reconciled in its own manifest, not here.
  v_since timestamptz := COALESCE(p_since, '2026-11-05 22:25:02+00'::timestamptz);
  n integer;
BEGIN
  WITH cov AS MATERIALIZED (
    SELECT t.id, t.name, public.fn_ca_guarantee_funding(t.id) AS f
      FROM public.tournaments t
     WHERE COALESCE(t.guaranteed_prize, 0) > 0
       AND COALESCE(t.prize_pool_finalized, false)
       AND COALESCE(t.variant, '') NOT IN ('satellite', 'spin')
       AND COALESCE(t.satellite_seats, 0) = 0
       AND t.start_time >= GREATEST(v_since, now() - interval '14 days'))
  INSERT INTO public.ca_guarantee_funding_variances AS v
    (tournament_id, name, guarantee, gross_coverage, house_required, house_posted, variance, detail)
  SELECT id, name, (f->>'guarantee')::numeric, (f->>'gross_coverage')::numeric,
         (f->>'house_required')::numeric, (f->>'house_posted')::numeric,
         round((f->>'house_posted')::numeric - (f->>'house_required')::numeric, 2), f
    FROM cov
   WHERE abs((f->>'house_posted')::numeric - (f->>'house_required')::numeric) > 0.01
  ON CONFLICT (tournament_id) DO UPDATE
     SET variance = EXCLUDED.variance, house_posted = EXCLUDED.house_posted,
         house_required = EXCLUDED.house_required, gross_coverage = EXCLUDED.gross_coverage,
         detail = EXCLUDED.detail, last_seen_at = clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_guarantee_funding_variance_scan(timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_funding_variance_scan(timestamp with time zone) TO service_role;

-- 4. Prune diamond incidents and daily challenges in deterministic PK-ordered batches
--    with FOR UPDATE SKIP LOCKED so concurrent player updates never deadlock.
CREATE OR REPLACE FUNCTION public.fn_ca_diamond_prune_history(p_incident_days integer DEFAULT 30, p_challenge_days integer DEFAULT 400, p_abandoned_days integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_incidents integer := 0;
  v_challenges integer := 0;
  v_abandoned integer := 0;
  v_batch integer := 0;
  v_iter integer := 0;
  c_batch_size constant integer := 2000;
  c_max_batches constant integer := 200;
BEGIN
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  -- The challenge floor is 400 days and not 60, because this table is also the streak ledger:
  -- get_challenge_streak reads every completed row with no lower bound and walks back to the
  -- first gap, so deleting completed rows inside any plausible streak horizon would make a long
  -- streak uncomputable (D2). 400 days is beyond a year-long streak.
  IF p_incident_days < 7 OR p_challenge_days < 400 OR p_abandoned_days < 45 THEN
    RAISE EXCEPTION 'retention below the floor: incidents 7 days, challenges 400 days, abandoned 45 days';
  END IF;

  v_iter := 0;
  LOOP
    v_iter := v_iter + 1;
    EXIT WHEN v_iter > c_max_batches;
    WITH doomed AS (
      SELECT id FROM public.ca_diamond_incidents
       WHERE resolved_at IS NOT NULL
         AND severity IN ('info', 'warning')
         AND occurred_at < now() - make_interval(days => p_incident_days)
       ORDER BY id
       LIMIT c_batch_size
       FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.ca_diamond_incidents t
     USING doomed d
     WHERE t.id = d.id;
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_incidents := v_incidents + v_batch;
    EXIT WHEN v_batch < c_batch_size;
  END LOOP;

  v_iter := 0;
  LOOP
    v_iter := v_iter + 1;
    EXIT WHEN v_iter > c_max_batches;
    WITH doomed AS (
      SELECT id FROM public.user_daily_challenges
       WHERE (claimed OR expired_at IS NOT NULL)
         AND created_at < now() - make_interval(days => p_challenge_days)
       ORDER BY id
       LIMIT c_batch_size
       FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.user_daily_challenges t
     USING doomed d
     WHERE t.id = d.id;
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_challenges := v_challenges + v_batch;
    EXIT WHEN v_batch < c_batch_size;
  END LOOP;

  -- Assigned and never completed: no expiry reaches it and no claim will ever come, so it was the
  -- one class the first version could not remove even though it grows fastest (D8). Not part of
  -- any streak, because a streak counts completions.
  v_iter := 0;
  LOOP
    v_iter := v_iter + 1;
    EXIT WHEN v_iter > c_max_batches;
    WITH doomed AS (
      SELECT id FROM public.user_daily_challenges
       WHERE NOT completed
         AND created_at < now() - make_interval(days => p_abandoned_days)
       ORDER BY id
       LIMIT c_batch_size
       FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.user_daily_challenges t
     USING doomed d
     WHERE t.id = d.id;
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_abandoned := v_abandoned + v_batch;
    EXIT WHEN v_batch < c_batch_size;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'incidents_pruned', v_incidents,
                            'challenges_pruned', v_challenges, 'abandoned_pruned', v_abandoned,
                            'incident_days', p_incident_days, 'challenge_days', p_challenge_days,
                            'abandoned_days', p_abandoned_days);
END $function$;

REVOKE ALL ON FUNCTION public.fn_ca_diamond_prune_history(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_diamond_prune_history(integer, integer, integer) TO service_role;

-- @probe-exempt: public.fn_ca_free_buy_funding_watch Zero-argument 14-day multi-table cron watcher (60s runtime budget) cannot be bounded to an empty window inside the 8s/12s install transaction (run 46054847104 timed out at 9,952 ms); statically validated by plpgsql_check in CI and exercised every 15m by ca-free-buy-funding-watch-15m.

-- @probe-for: public.fn_ca_guarantee_funding_variance_scan
DO $probe$
BEGIN
  PERFORM public.fn_ca_guarantee_funding_variance_scan(clock_timestamp() + interval '100 years');
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-exempt: public.fn_ca_diamond_prune_history Daily 120s maintenance pruner scans public.user_daily_challenges (no created_at index) twice and public.ca_diamond_incidents (no resolved_at IS NOT NULL index) once even with distant retention cutoffs, risking cold-buffer timeout inside the 8s/12s install budget; statically validated by plpgsql_check in CI and exercised daily by ca-diamond-prune-history-daily.

COMMIT;
