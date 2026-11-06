-- 20261106194903_free_buy_vouchers_and_ticket_books_are_watched_and_every_fun
--
-- Reserved by scripts/new-migration.mjs on 2026-11-06.
--
-- FREE BUY VOUCHERS AND TICKET BOOKS ARE WATCHED, AND EVERY FUNDING VARIANCE
-- REACHES PRODUCTION ALERTS
--
-- Owner rules (2026-11-05): a buy-in guarantee's house/promo funding is
-- H = max(0, G - C) in total and zero once C >= G; a Free Buy without a
-- guarantee is funded H = V, one promo chip per valid first entry; every
-- player has five Free Buy tickets per gaming day, one per event, first
-- entries only; Phase 2 requires monitoring that detects both underfunding and
-- overfunding.
--
-- READ FROM PRODUCTION 2026-11-06 19:30 UTC, before this file was written:
--
--  * 20261105233808 records guaranteed events whose posted house funding
--    differs from H in ca_guarantee_funding_variances. 72 runs, 0 failures,
--    0 rows. But it is detection only: a row reaches nobody, and a row is
--    never closed when the variance is corrected.
--  * Nothing watches a Free Buy WITHOUT a guarantee. Its funding is the
--    one-chip promo head per registration (fn_ca_midway_free_buy_promo_head),
--    so posted promo must equal the event's first entries. Recomputed by hand
--    for every Free Buy since tickets went live: 236/236, 213/213 (214 sent,
--    1 returned), 170/170, 164/164 - exact, so this watch starts silent.
--  * Nothing watches the ticket books. Recomputed by hand: 741 redemptions,
--    0 day counters that disagree with their live redemptions, 0 live
--    redemptions without their registration, 0 on a cancelled event, highest
--    use 3 of 5. The 38 Free Buy registrations with no ticket all registered
--    before the first redemption (2026-11-05 23:18:46 UTC, when 20261105223835
--    was actually installed): they are the rollout entries the owner kept
--    free, not a door around the ticket.
--
-- WHAT THIS ADDS (no chips move; nothing existing is replaced)
--
--  ca_free_buy_watch_findings, one row per open or closed finding, and
--  fn_ca_free_buy_funding_watch(), every 15 minutes:
--
--   guarantee_overfunded / guarantee_underfunded (critical)
--       a finalized guaranteed event (from 2026-11-05 22:25:02 UTC, the gross
--       rule) whose posted house/promo funding differs from H, read from
--       fn_ca_guarantee_funding exactly as the 20261105233808 scan does.
--   voucher_overfunded / voucher_underfunded (critical)
--       a finalized Midway Free Buy without a guarantee whose net promo
--       (promo_send in, minus promo returned) differs from V = its first
--       entries (one registration row per player per event).
--   ticket_day_mismatch (warning)
--       a player's day counter differs from his live redemptions that day.
--   ticket_without_entry (warning)
--       a live redemption whose registration no longer exists (a spent
--       ticket with no entry behind it).
--   ticket_on_cancelled_event (warning)
--       a live redemption on a cancelled event (the ticket was not given back).
--   entry_without_ticket (warning)
--       a Free Buy registration made after tickets went live that holds no
--       live ticket (a registration door around the ticket).
--   free_buy_without_format (warning)
--       a Midway Free Buy whose format reads NULL, so neither the ticket nor
--       the voucher applies to it.
--
--  A new finding raises one financial alert (the Production Alerts channel,
--  fn_raise_server_financial_alert, deduplicated per finding). A finding that
--  is no longer true is closed and its alert resolved, so an alert never
--  outlives the thing it reported. A finding whose event has left the 14-day
--  window stays open: an unresolved variance is not cleared by age.
--
--  Detection only. A posted variance after finalization needs an authorized,
--  auditable correction; this function never makes one.
--
-- Native proof: scripts/ci/test-guarantee-funding-watch.py (accounting shard 1),
-- on production's definitions of fn_ca_guarantee_funding and
-- fn_ca_midway_free_buy_format.
--
-- @live-proof: to_regclass('public.ca_free_buy_watch_findings') IS NOT NULL AND to_regprocedure('public.fn_ca_free_buy_funding_watch()') IS NOT NULL AND NOT has_function_privilege('authenticated','public.fn_ca_free_buy_funding_watch()','execute') AND NOT has_table_privilege('authenticated','public.ca_free_buy_watch_findings','SELECT') AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='ca-free-buy-funding-watch-15m')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

DO $pre$ BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_guarantee_funding(uuid)'::regprocedure))
     IS DISTINCT FROM '6d99e12842f473688ef656d577561863' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_ca_guarantee_funding';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_midway_free_buy_format(uuid)'::regprocedure))
     IS DISTINCT FROM 'f9522dffe07a3d8d446e5e3bebd11f68' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_ca_midway_free_buy_format';
  END IF;
  IF to_regprocedure('public.fn_raise_server_financial_alert(text,text,text,jsonb,text,text)') IS NULL THEN
    RAISE EXCEPTION 'fn_raise_server_financial_alert(text,text,text,jsonb,text,text) is missing';
  END IF;
  IF to_regclass('smarter_private.free_buy_ticket_redemptions') IS NULL
     OR to_regclass('smarter_private.free_buy_ticket_days') IS NULL THEN
    RAISE EXCEPTION 'Free Buy ticket books (20261105223835) are not installed';
  END IF;
  IF to_regclass('public.ca_free_buy_watch_findings') IS NOT NULL THEN
    RAISE EXCEPTION 'Free Buy funding watch already installed';
  END IF;
END $pre$;

CREATE TABLE public.ca_free_buy_watch_findings (
  kind text NOT NULL CHECK (kind IN (
    'guarantee_overfunded', 'guarantee_underfunded',
    'voucher_overfunded', 'voucher_underfunded',
    'ticket_day_mismatch', 'ticket_without_entry', 'ticket_on_cancelled_event',
    'entry_without_ticket', 'free_buy_without_format')),
  subject text NOT NULL,
  tournament_id uuid,
  detail jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cleared_at timestamptz,
  alert_id uuid,
  PRIMARY KEY (kind, subject));
COMMENT ON TABLE public.ca_free_buy_watch_findings IS
 'Guarantee (H = max(0, G - C)) and Free Buy voucher (H = V) funding variances and Free Buy ticket book defects (owner rules 2026-11-05). cleared_at NULL = still true. Detection only; nothing here moves chips.';
ALTER TABLE public.ca_free_buy_watch_findings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_free_buy_watch_findings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_free_buy_watch_findings TO service_role;

CREATE FUNCTION public.fn_ca_free_buy_funding_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private', 'pg_temp'
AS $function$
DECLARE
  -- The gross guarantee rule shipped at 20261105222502; the first Free Buy
  -- ticket was redeemed (20261105223835 installed) at 23:18:46 UTC.
  c_gross_since constant timestamptz := '2026-11-05 22:25:02+00';
  c_tickets_live constant timestamptz := '2026-11-05 23:18:46+00';
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
  WITH gtd AS (
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
       AND p.registered_at >= c_tickets_live AND p.registered_at < v_grace
       AND NOT EXISTS (SELECT 1 FROM smarter_private.free_buy_ticket_redemptions r
                        WHERE r.registration_id = p.id AND r.returned_at IS NULL)
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
      CASE WHEN f.kind LIKE 'guarantee_%' OR f.kind LIKE 'voucher_%' THEN 'critical' ELSE 'warning' END,
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

-- periodic-work: the owner requires that a guarantee is never under- or over-funded (H = max(0, G - C)), that a Free Buy without a guarantee is funded exactly V, and that the five-ticket books stay exact; this reports any finding to Production Alerts within 15 minutes and closes it when it is no longer true. Read-only toward money.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ca-free-buy-funding-watch-15m';
SELECT cron.schedule('ca-free-buy-funding-watch-15m', '11,26,41,56 * * * *',
  $c$SET statement_timeout = '60s'; SELECT public.fn_ca_free_buy_funding_watch();$c$);

COMMIT;
