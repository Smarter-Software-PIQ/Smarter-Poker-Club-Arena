-- SUPERSEDED BY 20261105233756 (never installed; it exempted three events by id, which the owner forbids)
-- MIDWAY FREE BUY ROTATION AND PROMO RUNWAY WATCH (owner 2026-11-05)
--
-- Two things went unseen on 2026-11-05 until someone happened to look:
--   1. Saturday's 8:30 AM Midway Morning Free Buy was never created (a stuck
--      spawn claim), and Sunday's was created in the old PKO format.
--   2. The Midway promo wallet, which funds every Free Buy entry, spends far
--      faster than the Free Buys alone suggest (other promotions draw on it).
--
-- fn_sp_midway_free_buy_watch() returns attention items in the digest's own
-- shape {rule, severity, title, detail, key}. It reads every rotation slot of
-- the next 72 hours; the board is spawned about three days ahead, so a slot
-- within 48 hours that is not on it is missing, and a later one is checked
-- once it exists:
--   midway_free_buy_missing       a rotation slot starting in the next 48
--                                 hours has no live event on the board;
--   midway_free_buy_wrong_format  the event is there in the wrong format;
--   midway_free_buy_wrong_settings the format is right but the guarantee,
--                                 add-ons, 1-chip rebuy or zero fee is not;
--   midway_promo_runway_low       the promo wallet covers fewer than 30 days
--                                 of its recurring net spend (last 7 days;
--                                 the self-limiting weekly half-wallet
--                                 disbursement is reported, not projected).
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
  v_wallet_id uuid;
  v_spend7 numeric;
  v_disbursed7 numeric;
  v_income7 numeric;
  v_rate numeric;
  v_days numeric;
BEGIN
  -- The five daily slots (owner 2026-11-04), America/Chicago.
  FOR r IN
    WITH slots(name, local_time, fmt, guarantee, addon) AS (
      VALUES ('Morning Free Buy (NLH)',    time '08:30', 'regular', 250::numeric, true),
             ('Midday Free Buy (NLH)',     time '12:30', 'pko',     0::numeric,   false),
             ('Afternoon Free Buy (NLH)',  time '16:30', 'aiof',    500::numeric, false),
             ('Prime Time Free Buy (NLH)', time '20:30', 'mystery', 0::numeric,   true),
             ('Midnight Free Buy (NLH)',   time '00:30', 'pko',     0::numeric,   false)
    ), days AS (
      SELECT (p_now AT TIME ZONE 'America/Chicago')::date + g AS d FROM generate_series(0, 3) g
    ), due AS (
      SELECT s.name, s.fmt, s.guarantee, s.addon, ((dd.d + s.local_time) AT TIME ZONE 'America/Chicago') AS starts
        FROM slots s CROSS JOIN days dd
    )
    SELECT due.name, due.fmt, due.guarantee, due.addon, due.starts, ev.id, ev.guaranteed_prize, ev.add_on_available,
           ev.is_rebuy, ev.rebuy_cost, ev.buy_in_fee,
           CASE WHEN ev.id IS NULL THEN NULL ELSE public.fn_ca_midway_free_buy_format(ev.id) END AS got,
           COALESCE(ev.players, 0) AS players
      FROM due
      LEFT JOIN LATERAL (
        SELECT t.id, t.guaranteed_prize, t.add_on_available, t.is_rebuy, t.rebuy_cost, t.buy_in_fee,
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
       AND due.starts <= p_now + interval '72 hours'
     ORDER BY due.starts
  LOOP
    -- Slots 48-72 hours out may not be spawned yet; only their format and
    -- settings are checked once they exist.
    IF r.id IS NULL AND r.starts > p_now + interval '48 hours' THEN
      NULL;
    ELSIF r.id IS NULL THEN
      a := a || jsonb_build_object(
        'rule', 'midway_free_buy_missing',
        'severity', CASE WHEN r.starts <= p_now + interval '12 hours' THEN 'critical' ELSE 'warning' END,
        'title', format('Midway %s for %s is not on the board', r.name,
                        to_char(r.starts AT TIME ZONE 'America/Chicago', 'Dy Mon DD HH12:MI AM')),
        'detail', jsonb_build_object('name', r.name, 'starts', r.starts, 'expected_format', r.fmt),
        'key', r.name || '@' || r.starts::text);
    -- The approved exceptions (owner 2026-11-05): the three Nov 5 events that
    -- already had entries when the rotation went live keep the PKO terms their
    -- players joined under. They are named exactly, so the exception ends
    -- with them; no other event is ever exempt.
    ELSIF r.id IN ('930eee14-faaf-43cf-8f4a-bd8a92c48fd6'::uuid,   -- Thu Nov 5 08:30 Morning
                   '74ba8130-3ec5-48c2-b94b-409b7fb14a6b'::uuid,   -- Thu Nov 5 16:30 Afternoon
                   '1d115ff4-d0d5-48cc-8a3e-03ae3348d442'::uuid) THEN -- Thu Nov 5 20:30 Prime Time
      NULL;
    ELSIF r.got IS DISTINCT FROM r.fmt THEN
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
    -- The format is right; its material money settings must be too.
    ELSIF r.guaranteed_prize IS DISTINCT FROM r.guarantee OR r.add_on_available IS DISTINCT FROM r.addon
       OR r.is_rebuy IS DISTINCT FROM true OR r.rebuy_cost IS DISTINCT FROM 1 OR COALESCE(r.buy_in_fee, 0) <> 0 THEN
      a := a || jsonb_build_object(
        'rule', 'midway_free_buy_wrong_settings',
        'severity', CASE WHEN r.players = 0 AND r.starts <= p_now + interval '12 hours' THEN 'critical' ELSE 'warning' END,
        'title', format('Midway %s for %s has the wrong settings (guarantee %s, add-ons %s, rebuy %s at %s, fee %s)', r.name,
                        to_char(r.starts AT TIME ZONE 'America/Chicago', 'Dy Mon DD HH12:MI AM'),
                        r.guaranteed_prize, r.add_on_available, r.is_rebuy, r.rebuy_cost, r.buy_in_fee),
        'detail', jsonb_build_object('tournament_id', r.id, 'name', r.name, 'starts', r.starts,
                                     'guarantee', r.guaranteed_prize, 'expected_guarantee', r.guarantee,
                                     'add_ons', r.add_on_available, 'expected_add_ons', r.addon,
                                     'rebuy', r.is_rebuy, 'rebuy_cost', r.rebuy_cost, 'fee', r.buy_in_fee,
                                     'players', r.players),
        'key', r.id::text || ':settings');
    END IF;
  END LOOP;

  -- Promo runway (owner 2026-11-05), one ledger window: the last 7 days.
  --   Category 'promo' is discretionary: the weekly Union Promo Disbursement,
  --   which pays out HALF of the wallet each week (20261016132743) and so can
  --   never empty it, and one-time credits such as the 2026-11-04 relaunch
  --   25s. It is reported, not projected. Everything else that leaves the
  --   wallet (Free Buy entries, game prizes, leaderboards) is recurring spend; what comes in (the Bad Beat Jackpot promo share - ledgered with
  --   no destination label, verified 2026-11-05 to land in this wallet - and
  --   unplayed Free Buy returns) is recurring income. The wallet is ledgered
  --   under the union id or its wallet row id.
  --   Runway = balance / ((recurring spend - recurring income) / 7 days).
  SELECT w.promo_wallet, w.id INTO v_balance, v_wallet_id
    FROM public.union_wallets w WHERE w.union_id = 'fade0000-0000-0000-0000-000000000001'::uuid;
  SELECT COALESCE(sum(CASE WHEN l.from_label = 'union_wallets.promo_wallet' AND l.category <> 'promo' THEN l.amount END), 0),
         COALESCE(sum(CASE WHEN l.from_label = 'union_wallets.promo_wallet' AND l.category = 'promo' THEN l.amount END), 0),
         COALESCE(sum(CASE WHEN l.from_label IS DISTINCT FROM 'union_wallets.promo_wallet' THEN l.amount END), 0)
    INTO v_spend7, v_disbursed7, v_income7
    FROM public.chip_ledger l
   WHERE l.created_at > p_now - interval '7 days' AND l.created_at <= p_now
     AND ((l.from_label = 'union_wallets.promo_wallet'
           AND l.from_entity_id IN ('fade0000-0000-0000-0000-000000000001'::uuid, v_wallet_id))
       OR (l.to_label = 'union_wallets.promo_wallet'
           AND l.to_entity_id IN ('fade0000-0000-0000-0000-000000000001'::uuid, v_wallet_id))
       OR (l.to_label IS NULL AND l.from_type = 'bbj_pool' AND l.to_type = 'union_wallet'
           AND l.to_entity_id IN ('fade0000-0000-0000-0000-000000000001'::uuid, v_wallet_id)));
  v_rate := (v_spend7 - v_income7) / 7;
  IF v_balance IS NOT NULL AND v_rate > 0 THEN
    v_days := v_balance / v_rate;
    IF v_days < 30 THEN
      a := a || jsonb_build_object(
        'rule', 'midway_promo_runway_low',
        'severity', CASE WHEN v_days < 7 THEN 'critical' ELSE 'warning' END,
        'title', format('Midway promo funds cover about %s days of recurring spend (%s chips left, %s a day net)',
                        round(v_days), to_char(v_balance, 'FM999,999,990'), to_char(v_rate, 'FM999,999,990')),
        'detail', jsonb_build_object('balance', v_balance, 'spend_7d', v_spend7, 'income_7d', v_income7,
                                     'net_per_day', round(v_rate, 2), 'days_left', round(v_days, 1),
                                     'weekly_disbursement_7d', v_disbursed7,
                                     'rule', 'balance / ((7-day spend excluding the weekly half-wallet disbursement - 7-day income) / 7); warn under 30 days, page under 7'),
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
