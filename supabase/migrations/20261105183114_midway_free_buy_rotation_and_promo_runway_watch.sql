-- MIDWAY FREE BUY ROTATION AND PROMO RUNWAY WATCH (owner 2026-11-05)
--
-- Two things went unseen on 2026-11-05 until someone happened to look:
--   1. Saturday's 8:30 AM Midway Morning Free Buy was never created (a stuck
--      spawn claim), and Sunday's was created in the old PKO format.
--   2. The Midway promo wallet, which funds every Free Buy entry, spends far
--      faster than the Free Buys alone suggest (other promotions draw on it).
--
-- fn_sp_midway_free_buy_watch() returns attention items in the digest's own
-- shape {rule, severity, title, detail, key}:
--   midway_free_buy_missing       a rotation slot starting in the next 48
--                                 hours has no live event on the board;
--   midway_free_buy_wrong_format  the event is there in the wrong format;
--   midway_promo_runway_low       the promo wallet covers fewer than 30 days
--                                 at its last-7-day net spend.
-- Each is critical when it needs action today (a slot within 12 hours, or
-- under 7 days of promo funds), warning otherwise.
--
-- Wiring, both through the existing owner surfaces:
--   - fn_sp_digest_attention appends the items, so they appear under Needs
--     Your Attention in the 7:00 AM Daily Operations Digest and go to the
--     Production Alerts fleet exactly like every other attention rule;
--   - fn_sp_critical_scan pages the critical ones by email and text within
--     5 minutes, once each (deduplicated by key).
-- Both functions are patched in place against their exact live preimage.
--
-- @live-proof: (SELECT md5(prosrc) = '48feeada039c7988deabfefe15d768bc' FROM pg_proc WHERE oid = 'public.fn_sp_digest_attention(date,jsonb)'::regprocedure) AND (SELECT md5(prosrc) = 'cb8beaf3ece13ea54490bf75290561cf' FROM pg_proc WHERE oid = 'public.fn_sp_critical_scan()'::regprocedure) AND jsonb_typeof(public.fn_sp_midway_free_buy_watch()) = 'array'
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';

DO $pre$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_sp_digest_attention(date,jsonb)'::regprocedure)
     IS DISTINCT FROM 'c998e04f2ea0b12d0a4b271595306a9e' THEN
    RAISE EXCEPTION 'MIDWAY_WATCH_PREIMAGE_DRIFT fn_sp_digest_attention(date,jsonb)';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_sp_critical_scan()'::regprocedure)
     IS DISTINCT FROM '86831ab4d09afed41d5accfaaa7ff2b4' THEN
    RAISE EXCEPTION 'MIDWAY_WATCH_PREIMAGE_DRIFT fn_sp_critical_scan()';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_sp_midway_free_buy_watch(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  a jsonb := '[]'::jsonb;
  r record;
  v_balance numeric;
  v_net7 numeric;
  v_rate numeric;
  v_days numeric;
  v_top jsonb;
BEGIN
  -- The five daily slots (owner 2026-11-04), America/Chicago.
  FOR r IN
    WITH slots(name, local_time, fmt) AS (
      VALUES ('Morning Free Buy (NLH)',    time '08:30', 'regular'),
             ('Midday Free Buy (NLH)',     time '12:30', 'pko'),
             ('Afternoon Free Buy (NLH)',  time '16:30', 'aiof'),
             ('Prime Time Free Buy (NLH)', time '20:30', 'mystery'),
             ('Midnight Free Buy (NLH)',   time '00:30', 'pko')
    ), days AS (
      SELECT (p_now AT TIME ZONE 'America/Chicago')::date + g AS d FROM generate_series(0, 3) g
    ), due AS (
      SELECT s.name, s.fmt, ((dd.d + s.local_time) AT TIME ZONE 'America/Chicago') AS starts
        FROM slots s CROSS JOIN days dd
    )
    SELECT due.name, due.fmt, due.starts, ev.id, ev.created_at,
           CASE WHEN ev.id IS NULL THEN NULL ELSE public.fn_ca_midway_free_buy_format(ev.id) END AS got,
           COALESCE(ev.players, 0) AS players
      FROM due
      LEFT JOIN LATERAL (
        SELECT t.id, t.created_at,
               (SELECT count(*) FROM public.tournament_players tp WHERE tp.tournament_id = t.id) AS players
          FROM public.tournaments t
         WHERE t.union_id = 'fade0000-0000-0000-0000-000000000001'::uuid
           AND t.name = due.name
           AND t.start_time = due.starts
           AND upper(COALESCE(t.status, '')) <> 'CANCELLED'
         ORDER BY t.created_at
         LIMIT 1
      ) ev ON true
     WHERE due.starts > p_now + interval '1 hour'
       AND due.starts <= p_now + interval '48 hours'
     ORDER BY due.starts
  LOOP
    IF r.id IS NULL THEN
      a := a || jsonb_build_object(
        'rule', 'midway_free_buy_missing',
        'severity', CASE WHEN r.starts <= p_now + interval '12 hours' THEN 'critical' ELSE 'warning' END,
        'title', format('Midway %s for %s is not on the board', r.name,
                        to_char(r.starts AT TIME ZONE 'America/Chicago', 'Dy Mon DD HH12:MI AM')),
        'detail', jsonb_build_object('name', r.name, 'starts', r.starts, 'expected_format', r.fmt),
        'key', r.name || '@' || r.starts::text);
    -- An event created before the rotation went live (2026-11-05 10:06 UTC)
    -- keeps the PKO terms its players joined under, by design.
    ELSIF r.got IS DISTINCT FROM r.fmt AND r.created_at >= timestamptz '2026-11-05 10:06:00+00' THEN
      a := a || jsonb_build_object(
        'rule', 'midway_free_buy_wrong_format',
        -- With no entries it can still be reshaped, so it is urgent near the
        -- start; with entries the players' terms stand and it is a warning.
        'severity', CASE WHEN r.players = 0 AND r.starts <= p_now + interval '12 hours' THEN 'critical' ELSE 'warning' END,
        'title', format('Midway %s for %s is %s, not %s', r.name,
                        to_char(r.starts AT TIME ZONE 'America/Chicago', 'Dy Mon DD HH12:MI AM'),
                        COALESCE(r.got, 'no Free Buy format'), r.fmt),
        'detail', jsonb_build_object('tournament_id', r.id, 'name', r.name, 'starts', r.starts,
                                     'expected_format', r.fmt, 'format', r.got, 'players', r.players),
        'key', r.id::text);
    END IF;
  END LOOP;

  -- Promo runway: the wallet against its own last-7-day net spend, every
  -- promotion included (the Free Buys are only part of what it pays).
  SELECT promo_wallet INTO v_balance
    FROM public.union_wallets WHERE union_id = 'fade0000-0000-0000-0000-000000000001'::uuid;
  SELECT COALESCE(sum(CASE WHEN l.from_label = 'union_wallets.promo_wallet' THEN l.amount ELSE -l.amount END), 0)
    INTO v_net7
    FROM public.chip_ledger l
   WHERE l.created_at > p_now - interval '7 days' AND l.created_at <= p_now
     AND ((l.from_entity_id = 'fade0000-0000-0000-0000-000000000001'::uuid AND l.from_label = 'union_wallets.promo_wallet')
       OR (l.to_entity_id = 'fade0000-0000-0000-0000-000000000001'::uuid AND l.to_label = 'union_wallets.promo_wallet'));
  v_rate := v_net7 / 7;
  IF v_balance IS NOT NULL AND v_rate > 0 THEN
    v_days := v_balance / v_rate;
    IF v_days < 30 THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('category', c.category, 'chips', c.chips) ORDER BY c.chips DESC), '[]'::jsonb)
        INTO v_top
        FROM (SELECT l.category, round(sum(l.amount), 2) AS chips
                FROM public.chip_ledger l
               WHERE l.created_at > p_now - interval '7 days' AND l.created_at <= p_now
                 AND l.from_entity_id = 'fade0000-0000-0000-0000-000000000001'::uuid
                 AND l.from_label = 'union_wallets.promo_wallet'
               GROUP BY l.category ORDER BY sum(l.amount) DESC LIMIT 5) c;
      a := a || jsonb_build_object(
        'rule', 'midway_promo_runway_low',
        'severity', CASE WHEN v_days < 7 THEN 'critical' ELSE 'warning' END,
        'title', format('Midway promo funds cover about %s days at the last 7 days'' spend (%s chips left, %s a day)',
                        round(v_days), to_char(v_balance, 'FM999,999,990'), to_char(v_rate, 'FM999,999,990')),
        'detail', jsonb_build_object('balance', v_balance, 'net_spend_7d', v_net7, 'per_day', round(v_rate, 2),
                                     'days_left', round(v_days, 1), 'top_spend_7d', v_top),
        'key', 'midway_promo_runway:' || (p_now AT TIME ZONE 'America/Chicago')::date::text);
    END IF;
  END IF;

  RETURN a;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_sp_midway_free_buy_watch(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sp_midway_free_buy_watch(timestamptz) TO service_role;

DO $wire$
DECLARE b text; old text; replacement text;
BEGIN
  -- Needs Your Attention in the Daily Operations Digest.
  SELECT pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure) INTO b;
  old := E'\n  RETURN a;\nEND';
  replacement := E'\n  -- Midway Free Buy rotation and promo runway (2026-11-05).\n  a := a || public.fn_sp_midway_free_buy_watch();\n\n  RETURN a;\nEND';
  IF (length(b) - length(replace(b, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'MIDWAY_WATCH_PREIMAGE_DRIFT fn_sp_digest_attention return';
  END IF;
  EXECUTE replace(b, old, replacement);

  -- Instant email and text pages for the critical items.
  SELECT pg_get_functiondef('public.fn_sp_critical_scan()'::regprocedure) INTO b;
  old := E'      HAVING count(*) > 0)\n    SELECT p.* FROM pages p';
  replacement := E'      HAVING count(*) > 0\n      UNION ALL\n      SELECT ''midway_watch:'' || (w.x->>''key''), w.x->>''rule'', w.x->>''title'', w.x->''detail''\n        FROM jsonb_array_elements(public.fn_sp_midway_free_buy_watch()) AS w(x)\n       WHERE w.x->>''severity'' = ''critical'')\n    SELECT p.* FROM pages p';
  IF (length(b) - length(replace(b, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'MIDWAY_WATCH_PREIMAGE_DRIFT fn_sp_critical_scan pages';
  END IF;
  EXECUTE replace(b, old, replacement);
END $wire$;

COMMIT;
