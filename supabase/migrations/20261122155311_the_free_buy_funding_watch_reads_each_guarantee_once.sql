-- 20261122155311_the_free_buy_funding_watch_reads_each_guarantee_once.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE FREE BUY FUNDING WATCH READS EACH GUARANTEE ONCE
--
-- Production Alerts fleet, incident free-buy-funding-watch-timeout
-- (operational_alert_events 446169, alertmanager PgCronJobFailingRepeatedly,
-- job ca-free-buy-funding-watch-15m).
--
-- Measured on production 2026-11-20 05:40-05:50 UTC, read-only:
--   * the job runs `SET statement_timeout = '60s'; SELECT
--     public.fn_ca_free_buy_funding_watch();` every 15 minutes. Its runs took
--     54-59 s all night and three in a row (05:11, 05:26, 05:41) were
--     cancelled at 60 s ("canceling statement due to statement timeout",
--     inside the gtd CTE);
--   * the gtd CTE selects 433 finalized guaranteed events. Its window is
--     max(gross rule 2026-11-05 22:25, now - 14 days), so it filled on
--     2026-11-19 and the input set has now reached its steady size;
--   * evaluating fn_ca_guarantee_funding once per event costs 25.4 s;
--   * the same CTE as the watch writes it, inlined into finding with the
--     WHERE reading g.f twice, costs 41.4 s: Postgres inlines a CTE that is
--     referenced once, substituting the function call at every g.f
--     reference, so each event's funding was computed two or more times.
--   The rest of the watch (Free Buy vouchers, ticket books, early promo)
--   costs about 4 s.
--
-- ROOT CAUSE: the one-reference CTE is inlined, so the expensive per-event
-- funding call is repeated at each use of its result. The watch had no
-- headroom once its 14-day window filled.
--
-- FIX: `WITH gtd AS MATERIALIZED (`. Nothing else in the function changes;
-- its findings, alerts and resolution are byte-for-byte the same logic. The
-- timeout is NOT widened: the scan drops to about half of it.
--
-- REVISION 2026-11-22 (PRIMARY, operational_alert_events 447445): this was
-- first written as 20261120055128 and never merged. On 2026-11-21 migration
-- 20261121154220 gave every public.fn_ca_%_watch `SET lock_timeout = '2s'`
-- and `SET statement_timeout = '30s'` through ALTER FUNCTION, so the
-- 2026-11-20 pre-image (37dd9112a5a5830b1847e0fe31065f77) no longer matched
-- and the file would have refused at install. Re-reserved as 20261122155311.
-- Meanwhile the watch kept failing: 11 of 63 runs on 2026-11-22 up to 15:41
-- UTC hit the job's 60 s timeout, and the successful ones averaged 56.2 s.
--
-- The pre-image guard is the md5 of production's live definition read
-- 2026-11-22 15:50 UTC (81d72e4361a751945dc9087fff71a929). The body below is
-- that definition with exactly three changes: MATERIALIZED and its comment,
-- and the promo_head LIKE written as a literal prefix plus infix (same rows;
-- the merge gate refuses a chip_ledger LIKE prefix). The two SET clauses the
-- 20261121154220 sweep added are restated, because CREATE OR REPLACE resets
-- a function's settings to the ones it names, and that migration's live proof
-- requires lock_timeout on every fn_ca_%_watch. Reconstructing the live text
-- from this body by reverting the three changes gives md5 81d72e43 exactly.
--
-- No chips move. No hot-table lock (CREATE OR REPLACE FUNCTION only).
--
-- @probe-exempt: public.fn_ca_free_buy_funding_watch a probe would run the full 14-day funding scan (about 30 s) inside the install transaction and raise or resolve financial_alerts rows; its next 15-minute cron run executes it live, and the live proof below reads the installed definition
--
-- @live-proof: (SELECT strpos(pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure), 'WITH gtd AS MATERIALIZED (') > 0 AND strpos(pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure), 'early_prize_promo') > 0)

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

DO $pre$ BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure))
     IS DISTINCT FROM '81d72e4361a751945dc9087fff71a929' THEN
    RAISE EXCEPTION 'FREE_BUY_FUNDING_WATCH_PREIMAGE_CHANGED';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_ca_free_buy_funding_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private', 'pg_temp'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '30s'
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
  -- MATERIALIZED (20261122155311): finding reads g.f in its WHERE (twice),
  -- its CASE and its detail. Inlined, Postgres re-evaluated
  -- fn_ca_guarantee_funding at those references: 41 s of a 60 s budget on
  -- 433 events, measured 2026-11-20. Once per event: about 25 s.
  WITH gtd AS MATERIALIZED (
    SELECT t.id, t.name, public.fn_ca_guarantee_funding(t.id) AS f
      FROM public.tournaments t
     WHERE coalesce(t.guaranteed_prize, 0) > 0
       AND coalesce(t.prize_pool_finalized, false)
       AND coalesce(t.variant, '') NOT IN ('satellite', 'spin')
       AND coalesce(t.satellite_seats, 0) = 0
       AND coalesce(t.status, '') <> 'CANCELLED'
       AND t.start_time >= c_gross_since AND t.start_time >= v_window
  ), fb AS (
    SELECT t.id, t.name, t.status, t.start_time, coalesce(t.guaranteed_prize, 0) AS g,
           coalesce(t.prize_pool_finalized, false) AS fin,
           public.fn_ca_midway_free_buy_format(t.id) AS fmt
      FROM public.tournaments t
     WHERE coalesce(t.free_buy, false)
       AND (t.union_id = c_midway OR t.club_id = c_midway)
       AND t.start_time >= c_tickets_live AND t.start_time >= v_window
  ), voucher AS (
    SELECT fb.id, fb.name, fb.fmt,
      (SELECT count(*) FROM public.tournament_players p WHERE p.tournament_id = fb.id) AS v,
      (SELECT coalesce(sum(l.amount) FILTER (WHERE l.category = 'promo_send'), 0)
            - coalesce(sum(l.amount) FILTER (WHERE l.category = 'reversal'), 0)
         FROM public.chip_ledger l
        WHERE coalesce(l.status, 'posted') = 'posted'
          AND ((l.category = 'promo_send' AND l.from_type = 'union_wallet'
                AND l.to_type = 'prize_liability' AND l.to_entity_id = fb.id)
            OR (l.category = 'reversal' AND l.from_type = 'prize_liability'
                AND l.from_entity_id = fb.id AND l.to_type = 'union_wallet'
                AND l.to_label = 'union_wallets.promo_wallet'))) AS p
      FROM fb
     WHERE fb.fmt IS NOT NULL AND fb.g <= 0 AND fb.fin AND coalesce(fb.status, '') <> 'CANCELLED'
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
       -- Same rows as the live body's  idempotency_key LIKE 'tourney:%:promo_head:%' ,
       -- written as a literal prefix plus a literal infix after it, so the merge
       -- gate's chip_ledger LIKE-prefix refusal (scripts/ci/migration-cost-shape.mjs)
       -- holds; rows are already narrowed by to_entity_id = fb.id above.
       AND ((left(l.idempotency_key, 8) = 'tourney:'
             AND strpos(substr(l.idempotency_key, 9), ':promo_head:') > 0
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

COMMIT;
