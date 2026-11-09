CREATE OR REPLACE FUNCTION public.fn_sp_digest_free_buy_funding(p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private', 'pg_temp'
AS $function$
  WITH b AS (
    SELECT (p_day::timestamp AT TIME ZONE 'America/Chicago') AS s,
           ((p_day + 1)::timestamp AT TIME ZONE 'America/Chicago') AS e
  ), ev AS (
    SELECT t.id, t.name, t.status, t.start_time,
           coalesce(t.prize_pool_finalized, false) AS fin,
           round(greatest(coalesce(t.guaranteed_prize, 0), 0), 2) AS g,
           CASE WHEN coalesce(t.free_buy, false)
                 AND (t.union_id = 'fade0000-0000-0000-0000-000000000001'::uuid
                      OR t.club_id = 'fade0000-0000-0000-0000-000000000001'::uuid)
                THEN public.fn_ca_midway_free_buy_format(t.id) END AS fmt,
           coalesce(t.variant, '') NOT IN ('satellite', 'spin') AND coalesce(t.satellite_seats, 0) = 0 AS prize_event
      FROM public.tournaments t, b
     WHERE t.start_time >= b.s AND t.start_time < b.e
       AND t.start_time >= '2026-11-05 22:25:02+00'
       AND coalesce(t.status, '') <> 'CANCELLED'
  ), scoped AS (
    SELECT ev.* FROM ev WHERE (ev.g > 0 AND ev.prize_event) OR ev.fmt IS NOT NULL
  ), m AS (
    SELECT s.*,
      CASE WHEN s.g > 0 THEN public.fn_ca_guarantee_funding(s.id) END AS gf,
      (SELECT count(*) FROM public.tournament_players p WHERE p.tournament_id = s.id) AS entries,
      (SELECT count(*) FROM smarter_private.free_buy_ticket_redemptions x
        WHERE x.tournament_id = s.id AND x.returned_at IS NULL) AS tickets,
      (SELECT coalesce(sum(l.amount), 0) FROM public.chip_ledger l
        WHERE l.to_entity_id = s.id AND l.to_type = 'prize_liability' AND coalesce(l.status, 'posted') = 'posted'
          AND l.category = 'promo_send' AND l.from_type = 'union_wallet')
      - (SELECT coalesce(sum(l.amount), 0) FROM public.chip_ledger l
        WHERE l.from_entity_id = s.id AND l.from_type = 'prize_liability' AND coalesce(l.status, 'posted') = 'posted'
          AND l.category = 'reversal' AND l.to_type = 'union_wallet') AS promo,
      (SELECT coalesce(sum(l.amount), 0) FROM public.chip_ledger l
        WHERE l.to_entity_id = s.id AND l.to_type = 'prize_liability' AND coalesce(l.status, 'posted') = 'posted'
          AND l.category IN ('overlay', 'promo_send') AND l.from_type IN ('union_bank', 'club_treasury'))
      - (SELECT coalesce(sum(l.amount), 0) FROM public.chip_ledger l
        WHERE l.from_entity_id = s.id AND l.from_type = 'prize_liability' AND coalesce(l.status, 'posted') = 'posted'
          AND l.category = 'reversal' AND l.to_type IN ('union_bank', 'club_treasury')) AS house
      FROM scoped s
  ), r AS (
    SELECT m.*,
      CASE WHEN m.g > 0 THEN (m.gf->>'gross_coverage')::numeric ELSE 0 END AS player_coverage,
      CASE WHEN m.g > 0 THEN (m.gf->>'house_required')::numeric ELSE m.entries::numeric END AS required,
      CASE WHEN m.g > 0 THEN (m.gf->>'house_posted')::numeric ELSE round(m.promo, 2) END AS posted
      FROM m
  ), v AS (
    SELECT r.*,
      CASE WHEN NOT r.fin THEN 'pending'
           WHEN abs(r.posted - r.required) <= 0.01 THEN 'exact'
           WHEN r.posted > r.required THEN 'over' ELSE 'under' END AS verdict
      FROM r
  ), ej AS (
    SELECT jsonb_build_object(
      'tournament_id', v.id, 'name', v.name, 'status', v.status,
      'starts', v.start_time,
      'starts_ct', to_char(v.start_time AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM'),
      'free_buy_format', v.fmt, 'guarantee', v.g, 'finalized', v.fin,
      'entries', v.entries, 'tickets', v.tickets,
      'player_coverage', round(v.player_coverage, 2),
      'required', round(v.required, 2), 'posted', round(v.posted, 2),
      'promo', round(v.promo, 2), 'house', round(v.house, 2),
      'variance', round(v.posted - v.required, 2), 'verdict', v.verdict) AS j,
      v.fmt IS NOT NULL AS is_free_buy, v.verdict, v.start_time,
      v.required, v.posted, v.promo, v.house
      FROM v
  ), tk AS (
    SELECT count(*) FILTER (WHERE x.returned_at IS NULL) AS redeemed,
           count(*) FILTER (WHERE x.returned_at IS NOT NULL) AS returned,
           count(DISTINCT x.user_id) FILTER (WHERE x.returned_at IS NULL) AS players
      FROM smarter_private.free_buy_ticket_redemptions x WHERE x.gaming_day = p_day
  ), lim AS (
    SELECT count(*) AS at_limit FROM smarter_private.free_buy_ticket_days d
     WHERE d.gaming_day = p_day AND d.used >= 5
  ), wf AS (
    SELECT coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb) AS by_kind, coalesce(sum(k.n), 0) AS total
      FROM (SELECT w.kind, count(*) AS n FROM public.ca_free_buy_watch_findings w
             WHERE w.cleared_at IS NULL GROUP BY w.kind) k
  )
  SELECT jsonb_build_object(
    'day', p_day,
    'rule', 'Guaranteed: H = max(0, G - C), where C is every qualifying player buy-in, rebuy and add-on. Free Buy without a guarantee: H = V, one chip per first entry. Promo is the Midway Union Promo Wallet; house is the union bank or club treasury.',
    'events', (SELECT count(*) FROM ej),
    'free_buy_events', (SELECT count(*) FROM ej WHERE is_free_buy),
    'exact', (SELECT count(*) FROM ej WHERE verdict = 'exact'),
    'over', (SELECT count(*) FROM ej WHERE verdict = 'over'),
    'under', (SELECT count(*) FROM ej WHERE verdict = 'under'),
    'pending', (SELECT count(*) FROM ej WHERE verdict = 'pending'),
    'required_total', (SELECT round(coalesce(sum(required) FILTER (WHERE verdict <> 'pending'), 0), 2) FROM ej),
    'posted_total', (SELECT round(coalesce(sum(posted) FILTER (WHERE verdict <> 'pending'), 0), 2) FROM ej),
    'promo_total', (SELECT round(coalesce(sum(promo) FILTER (WHERE verdict <> 'pending'), 0), 2) FROM ej),
    'house_total', (SELECT round(coalesce(sum(house) FILTER (WHERE verdict <> 'pending'), 0), 2) FROM ej),
    'free_buy', (SELECT coalesce(jsonb_agg(j ORDER BY start_time), '[]'::jsonb) FROM ej WHERE is_free_buy),
    'off', (SELECT coalesce(jsonb_agg(o.j ORDER BY abs((o.j->>'variance')::numeric) DESC), '[]'::jsonb)
              FROM (SELECT j FROM ej WHERE verdict IN ('over', 'under')
                     ORDER BY abs(posted - required) DESC LIMIT 20) o),
    'tickets', (SELECT jsonb_build_object('gaming_day', p_day, 'allotment', 5,
                  'redeemed', tk.redeemed, 'returned', tk.returned,
                  'players', tk.players, 'players_at_limit', lim.at_limit) FROM tk, lim),
    'open_findings', (SELECT jsonb_build_object('total', wf.total, 'by_kind', wf.by_kind) FROM wf),
    'generated_at', clock_timestamp());
$function$
