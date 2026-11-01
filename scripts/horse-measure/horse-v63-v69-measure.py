#!/usr/bin/env python3
"""
Re-runnable, READ-ONLY measurement of the Hold'em horse decision classes that
V63-V69 change. Same CTE pipeline and hand classes as leak_pipeline.py (the
2026-10-31 leak report), cut to the postflop cells, over an explicit
[since, until) window on public.horse_hand_reviews (nlh only).

Every statement this script produces is a SELECT (plus one CREATE OR REPLACE
FUNCTION pg_temp.cls in the same call, which lives in the session's temp schema
and is never written to a public schema). Nothing is written anywhere.

Usage
  # 1. One command, if a read-only connection string is in $DATABASE_URL (psql):
  horse-v63-v69-measure.py run  '2026-11-01 10:05+00' '2026-11-02 10:05+00' [--chunks 2] > out.md

  # 2. Through the Supabase MCP (execute_sql), one call per printed statement:
  horse-v63-v69-measure.py sql  cash  SINCE UNTIL [--chunks K --chunk I]   # cells JSON
  horse-v63-v69-measure.py sql  mtt   SINCE UNTIL [--chunks K --chunk I]
  horse-v63-v69-measure.py fn-sql      SINCE                                # V61/V63 counter
  horse-v63-v69-measure.py telemetry-sql FIRST_DAY LAST_DAY                 # receipts
  # save each call's JSON result (the MCP's array of rows) to a file, then:
  horse-v63-v69-measure.py render --window 'SINCE..UNTIL' --engine <version> \
      --cells cash0.json cash1.json mtt0.json ... --fn fn.json --telemetry tele.json

Caveat: horse_hand_reviews holds only hands with |net_bb| >= 20, so every
cell is the big-pot subset. Compare before/after on the SAME subset only;
a call that wins a small pot is invisible, a call that loses 20bb+ is in.
"""
import json
import os
import subprocess
import sys

FEATURES = [
    'v61_river_one_pair_shade',
    'v63_large_river_bet_shade',
    'v64_river_raise_needs_two_pair',
    'v65_turn_one_pair_shade',
    'v66_bet_raised_one_pair',
    'v66_raise_stratum',  # extra: V66's second receipt, named in its changelog
    'v67_river_bet_raised_one_pair',
    'v67_river_raise_stratum',
    'v68_turn_air_draw_calls',
    'v69_turn_call_gaps',
]

# Hand class: identical to leak_pipeline.py (one_pair:top / one_pair:under /
# two_pair_plus / draw / air, hero-vs-board, n = board cards seen).
CLS = r"""
CREATE OR REPLACE FUNCTION pg_temp.cls(ranks int[], suits text[], n int) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $c$
DECLARE i int; j int; cnt int; s text; dr int[]; lo int; miss int; h1 int; h2 int; hits1 int := 0; hits2 int := 0; bmax int := 0; bpair boolean := false;
  made text := 'air'; fd boolean := false; sd boolean := false; sub text := '';
BEGIN
  IF ranks IS NULL OR array_length(ranks,1) < 2+n THEN RETURN NULL; END IF;
  h1 := ranks[1]; h2 := ranks[2];
  FOR i IN 3..(2+n) LOOP
    IF ranks[i] = h1 THEN hits1 := hits1 + 1; END IF;
    IF ranks[i] = h2 THEN hits2 := hits2 + 1; END IF;
    IF ranks[i] > bmax THEN bmax := ranks[i]; END IF;
    FOR j IN (i+1)..(2+n) LOOP IF ranks[i] = ranks[j] THEN bpair := true; END IF; END LOOP;
  END LOOP;
  IF h1 = h2 THEN
    IF hits1 > 0 THEN made := 'two_pair_plus'; ELSE made := 'one_pair'; sub := CASE WHEN h1 > bmax THEN 'top' ELSE 'under' END; END IF;
  ELSE
    IF hits1 >= 2 OR hits2 >= 2 OR (hits1 >= 1 AND hits2 >= 1) THEN made := 'two_pair_plus';
    ELSIF hits1 = 1 OR hits2 = 1 THEN
      IF bpair THEN made := 'two_pair_plus';
      ELSE made := 'one_pair'; sub := CASE WHEN (CASE WHEN hits1 = 1 THEN h1 ELSE h2 END) >= bmax THEN 'top' ELSE 'under' END; END IF;
    END IF;
  END IF;
  FOREACH s IN ARRAY ARRAY['s','h','d','c'] LOOP
    cnt := 0; FOR i IN 1..(2+n) LOOP IF suits[i] = s THEN cnt := cnt + 1; END IF; END LOOP;
    IF cnt >= 5 THEN made := 'two_pair_plus'; END IF;
    IF cnt = 4 AND n < 5 AND (suits[1] = s OR suits[2] = s) THEN fd := true; END IF;
  END LOOP;
  dr := ARRAY(SELECT DISTINCT x FROM unnest(ranks[1:(2+n)]) x);
  IF 13 = ANY(dr) THEN dr := dr || 0; END IF;
  FOR lo IN 0..9 LOOP
    miss := 0;
    FOR i IN 0..4 LOOP IF NOT ((lo+i) = ANY(dr)) THEN miss := miss + 1; END IF; END LOOP;
    IF miss = 0 THEN made := 'two_pair_plus'; END IF;
    IF miss = 1 AND n < 5 THEN sd := true; END IF;
  END LOOP;
  IF made = 'two_pair_plus' THEN RETURN made; END IF;
  IF made = 'one_pair' THEN RETURN 'one_pair:' || sub; END IF;
  IF fd OR sd THEN RETURN 'draw'; END IF;
  RETURN 'air';
END $c$;
"""

# Postflop part of leak_pipeline.py's PIPE, with three additions:
#  * full_raise carried on the decision, so an all-in that only calls is
#    labelled call_allin and an all-in raise raise_allin;
#  * eff_behind: the V68 effective stack behind after the call, read from the
#    hero decision's publicNode (min(hero stack - toCall, max over opponents
#    not folded of stack + street bet - currentBet)); seat tuple [seat, stack,
#    streetBet, total, ante, _, status] with status 0 active / 1 folded / 2 all-in;
#  * rr: the horse's first river RAISE (aggression facing a wager), for V64.
#  * hstack reads the seat with a STRICT jsonpath: leak_pipeline.py used lax mode,
#    which unwraps the seat tuples before the filter so its hstack was always NULL.
PIPE = r"""
SET LOCAL enable_nestloop = off;  -- the window/hash filter is estimated at ~20 rows; without this the planner nests loops over the materialized CTEs
WITH base AS (
  SELECT row_number() OVER () AS hid, net_bb, horse_user_id::text hero, seat hseat, hole_cards hc, board bd, actions ac
  FROM public.horse_hand_reviews
  WHERE game_variant='nlh' AND {segment}
    AND played_at >= '{since}'::timestamptz AND played_at < '{until}'::timestamptz
    AND abs(hashtext(horse_user_id::text||played_at::text)) % {chunks} = {chunk}
),
cards AS (
  SELECT hid, array_agg(rv ORDER BY o) ranks, array_agg(s ORDER BY o) suits, jsonb_array_length(bd) nb,
    bool_and(rv > 0 AND s IN ('s','h','d','c')) ok
  FROM base, LATERAL (
    SELECT o, CASE WHEN jsonb_typeof(c)='object' THEN position(upper(left(c->>'rank',1)) in '23456789TJQKA') ELSE position(upper(left(c#>>'{}',1)) in '23456789TJQKA') END rv,
           CASE WHEN jsonb_typeof(c)='object' THEN lower(left(c->>'suit',1)) ELSE lower(right(c#>>'{}',1)) END s
    FROM jsonb_array_elements(hc||bd) WITH ORDINALITY AS t(c,o)) x
  WHERE jsonb_typeof(hc)='array' AND jsonb_typeof(bd)='array' AND jsonb_array_length(hc)=2
  GROUP BY hid, bd
),
acts AS (
  SELECT b.hid, b.hero, b.hseat, t.o, a->>'stage' stage, a->>'userId' uid, a->>'action' act,
    CASE WHEN jsonb_typeof(a->'amount')='number' THEN (a->>'amount')::numeric ELSE 0 END amt,
    (a->>'seat')::int aseat,
    (p.pn->>'pot')::numeric pot, coalesce((p.pn->>'toCall')::numeric,0) tocall, coalesce((p.pn->>'currentBet')::numeric,0) curbet,
    (p.pn->>'bigBlind')::numeric bb,
    CASE WHEN a->>'userId' = b.hero THEN (jsonb_path_query_first(p.pn, 'strict $.seats[*] ? (@[0] == $s)', jsonb_build_object('s', b.hseat))->>1)::numeric END hstack,
    CASE WHEN a->>'userId' = b.hero AND coalesce((p.pn->>'toCall')::numeric,0) > 0 AND a->>'stage' IN ('turn','river') THEN
      (SELECT max((s->>1)::numeric + coalesce((s->>2)::numeric,0)) FROM jsonb_array_elements(p.pn->'seats') s
        WHERE (s->>0)::int <> b.hseat AND coalesce(s->>6,'0') <> '1') - coalesce((p.pn->>'currentBet')::numeric,0) END opp_behind,
    (a ? 'isFullRaise') full_raise, (p.pn IS NOT NULL) has_pn
  FROM base b, LATERAL jsonb_array_elements(b.ac) WITH ORDINALITY t(a,o), LATERAL (SELECT a->'publicNode' pn OFFSET 0) p
  WHERE jsonb_typeof(b.ac)='array' AND a->>'stage' IS NOT NULL AND a->>'userId' IS NOT NULL
),
acts3 AS (
  SELECT *,
    count(*) FILTER (WHERE is_aggr) OVER (PARTITION BY hid, stage ORDER BY o ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) st_aggr,
    coalesce(bool_or(uid=hero AND tocall=0 AND act IN ('bet','all_in')) OVER (PARTITION BY hid, stage ORDER BY o ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), false) hero_bet_before,
    (uid=hero AND voluntary AND has_pn) is_hero_dec
  FROM (SELECT *, (act IN ('bet','raise') OR (act='all_in' AND full_raise)) is_aggr,
          act NOT IN ('sb','bb','straddle','post','ante','return','uncalled') voluntary FROM acts) a2
),
hinfo AS (SELECT hid, max(bb) bb FROM acts3 GROUP BY hid),
dec AS (
  SELECT DISTINCT ON (hid, stage) hid, stage, tocall, pot, st_aggr, hero_bet_before,
    CASE WHEN act='call' THEN 'call' WHEN act='all_in' AND NOT full_raise THEN 'call_allin' WHEN act='all_in' THEN 'raise_allin' ELSE act END actk,
    CASE WHEN pot - tocall > 0 THEN tocall/(pot - tocall) ELSE 1 END frac,
    CASE WHEN hstack IS NULL OR opp_behind IS NULL THEN NULL
         WHEN greatest(least(hstack - tocall, opp_behind), 0) < 1.5 * (pot + tocall) THEN 'short' ELSE 'deep' END depth
  FROM acts3 WHERE stage IN ('flop','turn','river') AND is_hero_dec AND tocall > 0 ORDER BY hid, stage, o),
rbet AS (
  SELECT DISTINCT ON (hid) hid FROM acts3
  WHERE stage='river' AND is_hero_dec AND tocall=0 AND act IN ('bet','all_in') AND st_aggr=0 ORDER BY hid, o),
rr AS (
  SELECT DISTINCT ON (hid) hid, tocall rr_tocall, CASE WHEN pot - tocall > 0 THEN tocall/(pot - tocall) ELSE 1 END rr_frac
  FROM acts3 WHERE stage='river' AND is_hero_dec AND tocall > 0 AND is_aggr ORDER BY hid, o),
hands AS (
  SELECT b.hid, b.net_bb, (b.net_bb > 0) won, h.bb,
    pg_temp.cls(c.ranks, c.suits, 3) f_cls, f.actk f_act, f.frac f_frac, f.hero_bet_before f_own, f.tocall/h.bb f_tocall_bb,
    pg_temp.cls(c.ranks, c.suits, 4) t_cls, t.actk t_act, t.frac t_frac, t.hero_bet_before t_own, t.tocall/h.bb t_tocall_bb, t.depth t_depth,
    pg_temp.cls(c.ranks, c.suits, 5) r_cls, r.actk r_act, r.frac r_frac, r.st_aggr r_aggr, r.hero_bet_before r_own, r.tocall/h.bb r_tocall_bb,
    (rb.hid IS NOT NULL) r_bet, rr.rr_frac, rr.rr_tocall/h.bb rr_tocall_bb
  FROM base b JOIN cards c ON c.hid=b.hid AND c.ok JOIN hinfo h ON h.hid=b.hid AND h.bb > 0
  LEFT JOIN dec f ON f.hid=b.hid AND f.stage='flop' LEFT JOIN dec t ON t.hid=b.hid AND t.stage='turn' LEFT JOIN dec r ON r.hid=b.hid AND r.stage='river'
  LEFT JOIN rbet rb ON rb.hid=b.hid LEFT JOIN rr ON rr.hid=b.hid
),
cells AS (
  -- 1. river one-pair call facing a wager hero did not make (V61/V63)
  SELECT '1_river_onepair_vs_bet' cell, r_cls k1,
    CASE WHEN r_frac < 0.4 THEN 'a<0.4' WHEN r_frac < 0.7 THEN 'b0.4-0.7' WHEN r_frac < 1.05 THEN 'c0.7-1.05' ELSE 'd>=1.05' END k2,
    CASE WHEN r_aggr >= 2 THEN 'vs_raise' ELSE 'vs_bet' END k3, r_act act, won, net_bb, r_frac frac, r_tocall_bb tocall_bb
  FROM hands WHERE r_act IS NOT NULL AND NOT r_own AND r_cls LIKE 'one_pair%'
  UNION ALL
  -- 2. river raise by hero class (V64)
  SELECT '2_river_raise', r_cls,
    CASE WHEN rr_frac < 0.4 THEN 'a<0.4' WHEN rr_frac < 0.85 THEN 'b0.4-0.85' ELSE 'c>=0.85' END, 'all', 'raise', won, net_bb, rr_frac, rr_tocall_bb
  FROM hands WHERE rr_frac IS NOT NULL
  UNION ALL
  -- 3. turn one-pair call facing a wager hero did not make (V65, V69 gap 1 = depth split)
  SELECT '3_turn_onepair_vs_bet', t_cls,
    CASE WHEN t_frac < 0.4 THEN 'a<0.4' WHEN t_frac < 0.7 THEN 'b0.4-0.7' WHEN t_frac < 1.05 THEN 'c0.7-1.05' ELSE 'd>=1.05' END,
    coalesce(t_depth,'unknown'), t_act, won, net_bb, t_frac, t_tocall_bb
  FROM hands WHERE t_act IS NOT NULL AND NOT t_own AND t_cls LIKE 'one_pair%'
  UNION ALL
  -- 4. flop / turn: hero bet, was raised, then acted (V66)
  SELECT '4_bet_raised_' || st, cls, 'all', 'all', act, won, net_bb, frac, tocall_bb
  FROM (SELECT 'flop' st, f_cls cls, f_act act, won, net_bb, f_frac frac, f_tocall_bb tocall_bb FROM hands WHERE f_own AND f_act IS NOT NULL
        UNION ALL SELECT 'turn', t_cls, t_act, won, net_bb, t_frac, t_tocall_bb FROM hands WHERE t_own AND t_act IS NOT NULL) u
  UNION ALL
  -- 5. river: hero bet first; raised or not, then action (V67)
  SELECT '5_river_bet_raised', r_cls,
    CASE WHEN NOT coalesce(r_own,false) THEN 'not_raised' WHEN r_frac < 0.7 THEN 'raise<0.7' WHEN r_frac < 1.5 THEN 'raise0.7-1.5' ELSE 'raise>=1.5' END,
    'all', coalesce(CASE WHEN r_own THEN r_act END, 'not_raised'), won, net_bb, CASE WHEN r_own THEN r_frac END, CASE WHEN r_own THEN r_tocall_bb END
  FROM hands WHERE r_bet
  UNION ALL
  -- 6. turn high card (air / draw) facing a wager hero did not make (V68, V69 gap 3)
  SELECT '6_turn_highcard_vs_bet', t_cls,
    CASE WHEN t_frac < 0.4 THEN 'a<0.4' WHEN t_frac < 0.7 THEN 'b0.4-0.7' WHEN t_frac < 1.05 THEN 'c0.7-1.05' ELSE 'd>=1.05' END,
    coalesce(t_depth,'unknown'), t_act, won, net_bb, t_frac, t_tocall_bb
  FROM hands WHERE t_act IS NOT NULL AND NOT t_own AND t_cls IN ('air','draw')
  UNION ALL
  SELECT '0_sample', 'all', 'all', 'all', 'all', won, net_bb, null, null FROM hands
)
SELECT '{seg}' seg, {chunk} chunk, {chunks} chunks, (clock_timestamp() - now())::text elapsed,
  coalesce(jsonb_agg(jsonb_build_array(cell,k1,k2,k3,act,n,w,net,sf,sc) ORDER BY cell,k1,k2,k3,act), '[]'::jsonb) cells
FROM (SELECT cell, k1, k2, k3, act, count(*) n, count(*) FILTER (WHERE won) w, round(sum(net_bb),1) net,
        round(coalesce(sum(frac),0),3) sf, round(coalesce(sum(tocall_bb),0),1) sc
      FROM cells GROUP BY 1,2,3,4,5) g
"""

SEGMENTS = {'cash': 'tournament_id IS NULL', 'mtt': 'tournament_id IS NOT NULL'}


def cells_sql(seg, since, until, chunks=1, chunk=0):
    return (CLS + PIPE.replace('{segment}', SEGMENTS[seg]).replace('{since}', since).replace('{until}', until)
            .replace('{chunks}', str(chunks)).replace('{chunk}', str(chunk)).replace('{seg}', seg) + ';')


def fn_sql(since):
    return f"select public.fn_horse_river_one_pair_calls('{since}'::timestamptz, 20000) AS result;"


def telemetry_sql(first_day, last_day):
    vals = ','.join(f"('{f}')" for f in FEATURES)
    return (f"select d::date::text AS day, f.feature, coalesce(t.fires,0) AS fires, t.updated_at::text AS updated_at "
            f"from generate_series('{first_day}'::date, '{last_day}'::date, interval '1 day') d "
            f"cross join (values {vals}) f(feature) "
            f"left join public.horse_brain_telemetry t on t.day = d::date and t.feature = f.feature "
            f"order by 1, 2;")


# ---------------------------------------------------------------- rendering

def load_rows(path):
    """Accept the MCP execute_sql text (with untrusted-data wrapper), a JSON array of rows, or psql -At JSON."""
    txt = open(path).read()
    try:
        obj = json.loads(txt)
        if isinstance(obj, dict) and 'result' in obj:
            txt = obj['result']
        else:
            return obj if isinstance(obj, list) else [obj]
    except json.JSONDecodeError:
        pass
    i, j = txt.find('['), txt.rfind(']')
    return json.loads(txt[i:j + 1])


def merge_cells(rowsets):
    agg = {}
    meta = {}
    for rows in rowsets:
        for r in rows:
            cells = r['cells'] if isinstance(r['cells'], list) else json.loads(r['cells'])
            meta.setdefault(r['seg'], set()).add((int(r['chunk']), int(r['chunks']), r.get('elapsed')))
            for cell, k1, k2, k3, act, n, w, net, sf, sc in cells:
                key = (r['seg'], cell, k1, k2, k3, act)
                a = agg.setdefault(key, [0, 0, 0.0, 0.0, 0.0])
                a[0] += int(n); a[1] += int(w); a[2] += float(net); a[3] += float(sf); a[4] += float(sc)
    for seg, s in meta.items():
        chunks = {c for _, c, _ in s}
        got = {i for i, _, _ in s}
        if len(chunks) != 1 or got != set(range(next(iter(chunks)))):
            raise SystemExit(f'segment {seg}: incomplete chunk set {sorted(s)}')
    return agg, meta


def pick(agg, seg, cell, k1=None, k2=None, k3=None, acts=None):
    n = w = 0; net = sf = sc = 0.0
    for (s, c, a1, a2, a3, act), v in agg.items():
        if s != seg or c != cell: continue
        if k1 is not None and (a1 not in k1 if isinstance(k1, (set, tuple, list)) else a1 != k1): continue
        if k2 is not None and (a2 not in k2 if isinstance(k2, (set, tuple, list)) else a2 != k2): continue
        if k3 is not None and (a3 not in k3 if isinstance(k3, (set, tuple, list)) else a3 != k3): continue
        if acts is not None and act not in acts: continue
        n += v[0]; w += v[1]; net += v[2]; sf += v[3]; sc += v[4]
    return n, w, net, sf, sc


def fmt(n, w, net, sf=0.0, sc=0.0, folds=None):
    wp = f'{100.0 * w / n:.1f}%' if n else '-'
    af = f'{sf / n:.2f}' if n and sf else '-'
    ac = f'{sc / n:.1f}' if n and sc else '-'
    s = f'| {n:,} | {w:,} | {wp} | {net:+,.0f} | {af} | {ac} |'
    if folds is not None:
        tot = n + folds
        s += f' {folds:,} ({100.0 * folds / tot:.1f}%) |' if tot else ' - |'
    return s


CALLS = {'call', 'call_allin'}
ONEPAIR = ('one_pair:top', 'one_pair:under')
SIZES4 = ['a<0.4', 'b0.4-0.7', 'c0.7-1.05', 'd>=1.05']


KEY_ROWS = [
    ('1 River one-pair call vs a bet (not after own bet), <0.4 pot', '1_river_onepair_vs_bet', ONEPAIR, 'a<0.4', None, CALLS),
    ('1   same, 0.4-0.7 pot', '1_river_onepair_vs_bet', ONEPAIR, 'b0.4-0.7', None, CALLS),
    ('1   same, 0.7-1.05 pot', '1_river_onepair_vs_bet', ONEPAIR, 'c0.7-1.05', None, CALLS),
    ('1   same, >=1.05 pot', '1_river_onepair_vs_bet', ONEPAIR, 'd>=1.05', None, CALLS),
    ('2 River RAISE holding one pair (V64)', '2_river_raise', ONEPAIR, None, None, {'raise'}),
    ('2 River RAISE holding air (V64)', '2_river_raise', 'air', None, None, {'raise'}),
    ('3 Turn one-pair call vs a bet, <0.4 pot (V65)', '3_turn_onepair_vs_bet', ONEPAIR, 'a<0.4', None, CALLS),
    ('3   same, 0.4-0.7 pot', '3_turn_onepair_vs_bet', ONEPAIR, 'b0.4-0.7', None, CALLS),
    ('3   same, 0.7-1.05 pot', '3_turn_onepair_vs_bet', ONEPAIR, 'c0.7-1.05', None, CALLS),
    ('3   same, >=1.05 pot', '3_turn_onepair_vs_bet', ONEPAIR, 'd>=1.05', None, CALLS),
    ('3   >=0.7 pot, SHORT behind (V69 gap 1)', '3_turn_onepair_vs_bet', ONEPAIR, ('c0.7-1.05', 'd>=1.05'), 'short', CALLS),
    ('3   >=0.7 pot, deep behind', '3_turn_onepair_vs_bet', ONEPAIR, ('c0.7-1.05', 'd>=1.05'), 'deep', CALLS),
    ('4 Flop bet-raised-CALL, one pair/air (V66)', '4_bet_raised_flop', ONEPAIR + ('air',), None, None, {'call'}),
    ('4 Turn bet-raised-CALL, one pair/air (V66)', '4_bet_raised_turn', ONEPAIR + ('air',), None, None, {'call'}),
    ('5 River one-pair bet-raised-call/jam (V67)', '5_river_bet_raised', ONEPAIR, ('raise<0.7', 'raise0.7-1.5', 'raise>=1.5'), None, {'call', 'call_allin', 'raise_allin'}),
    ('6 Turn high-card call vs a bet, air (V68)', '6_turn_highcard_vs_bet', 'air', None, None, CALLS),
    ('6 Turn high-card call vs a bet, draw (V68)', '6_turn_highcard_vs_bet', 'draw', None, None, CALLS),
]


def key_table(agg):
    out = ['| cell | cash n | won | win% | net bb | MTT n | won | win% | net bb |',
           '|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for name, cell, k1, k2, k3, acts in KEY_ROWS:
        parts = []
        for seg in ('cash', 'mtt'):
            n, w, net, _, _ = pick(agg, seg, cell, k1, k2, k3, acts)
            parts.append(f'{n:,} | {w:,} | ' + (f'{100.0 * w / n:.1f}%' if n else '-') + f' | {net:+,.0f}')
        out.append(f'| {name} | ' + ' | '.join(parts) + ' |')
    return '\n'.join(out)


def render(agg, meta, fn_rows, tele_rows, window, engine):
    out = []
    p = out.append
    p(f'Window: `[{window})` (played_at, UTC). Serving engine at measurement: `{engine}`.')
    p('')
    for seg in ('cash', 'mtt'):
        if seg not in meta: continue
        n, w, net, _, _ = pick(agg, seg, '0_sample')
        el = ', '.join(sorted(str(e) for _, _, e in meta[seg]))
        p(f'- {seg}: {n:,} parsed nlh review hands, {w:,} won, net {net:+,.0f} bb (chunk elapsed: {el})')
    p('')
    p('### Key table (calls = call + call-all-in unless noted)')
    p('')
    p(key_table(agg))
    p('')
    p('Columns: n = decisions in the class, won = hands with net_bb > 0, net = whole-hand net_bb '
      'summed (leak-report convention), avg frac = wager / pot before the wager, avg call = toCall in bb. '
      '"folds" = folds at the same decision point (fold share of all call+fold decisions).')
    hdr = '| seg | class | size | n | won | win% | net bb | avg frac | avg call bb | folds |'
    sep = '|---|---|---|---:|---:|---:|---:|---:|---:|---:|'

    def table(title, cell, k1s, sizes, k3=None, acts=CALLS, with_folds=True, size_label=None):
        p(''); p(f'### {title}'); p('')
        p(hdr if with_folds else hdr.rsplit(' folds |', 1)[0]); p(sep if with_folds else sep[:-5])
        for seg in ('cash', 'mtt'):
            for k1 in k1s:
                k1v = k1 if not isinstance(k1, tuple) else k1[1]
                k1name = k1 if not isinstance(k1, tuple) else k1[0]
                for sz in sizes:
                    szv = sz if not isinstance(sz, tuple) else sz[1]
                    szname = sz if not isinstance(sz, tuple) else sz[0]
                    r = pick(agg, seg, cell, k1v, szv, k3, acts)
                    f = pick(agg, seg, cell, k1v, szv, k3, {'fold'})[0] if with_folds else None
                    p(f'| {seg} | {k1name} | {szname} ' + fmt(*r, folds=f))

    allsz = ('all', None)
    table('1. River one-pair CALLS facing a wager the horse did not make (V61/V63), call + call-all-in',
          '1_river_onepair_vs_bet', [('one pair (all)', ONEPAIR), 'one_pair:top', 'one_pair:under'], SIZES4 + [allsz])
    p('')
    p('Same cell, facing a raise (st_aggr >= 2, counted "large" by the DB function) vs a single bet, all sizes:')
    p(''); p(hdr); p(sep)
    for seg in ('cash', 'mtt'):
        for k3 in ('vs_bet', 'vs_raise'):
            r = pick(agg, seg, '1_river_onepair_vs_bet', ONEPAIR, None, k3, CALLS)
            f = pick(agg, seg, '1_river_onepair_vs_bet', ONEPAIR, None, k3, {'fold'})[0]
            p(f'| {seg} | one pair {k3} | all ' + fmt(*r, folds=f))
    if fn_rows:
        p(''); p('`fn_horse_river_one_pair_calls` (verbatim; no until bound, no cash/MTT split, unpaired boards only, latest 20,000 rows):')
        p(''); p('```json'); p(json.dumps(fn_rows[0].get('result', fn_rows[0]), indent=1)); p('```')

    table('2. River RAISES by hero class (V64)', '2_river_raise',
          [('one pair (all)', ONEPAIR), 'one_pair:top', 'one_pair:under', 'air', ('ref: two_pair_plus', 'two_pair_plus')],
          [('all', None), 'a<0.4', 'b0.4-0.85', 'c>=0.85'], acts={'raise'}, with_folds=False)

    table('3. TURN one-pair CALLS facing a wager the horse did not make, by size (V65), call + call-all-in',
          '3_turn_onepair_vs_bet', [('one pair (all)', ONEPAIR), 'one_pair:top', 'one_pair:under'], SIZES4 + [allsz])
    p('')
    p('V69 gap 1 split (wager >= 0.7 pot; short = V68 effective stack behind after the call < 1.5 x pot after the call):')
    p(''); p(hdr); p(sep)
    for seg in ('cash', 'mtt'):
        for d in ('short', 'deep', 'unknown'):
            r = pick(agg, seg, '3_turn_onepair_vs_bet', ONEPAIR, ('c0.7-1.05', 'd>=1.05'), d, CALLS)
            f = pick(agg, seg, '3_turn_onepair_vs_bet', ONEPAIR, ('c0.7-1.05', 'd>=1.05'), d, {'fold'})[0]
            if r[0] or f: p(f'| {seg} | one pair, {d} | >=0.7 ' + fmt(*r, folds=f))

    p(''); p('### 4. FLOP / TURN: horse bet, was raised, then CALLED (V66)'); p('')
    p(hdr); p(sep)
    for seg in ('cash', 'mtt'):
        for st in ('flop', 'turn'):
            cell = '4_bet_raised_' + st
            for name, k1, acts in [('one pair / air (all)', ONEPAIR + ('air',), {'call'}),
                                   ('one_pair:top', 'one_pair:top', {'call'}), ('one_pair:under', 'one_pair:under', {'call'}),
                                   ('air', 'air', {'call'}),
                                   ('one pair / air, call-all-in', ONEPAIR + ('air',), {'call_allin'}),
                                   ('ref: draw', 'draw', {'call'}), ('ref: two_pair_plus', 'two_pair_plus', {'call'})]:
                r = pick(agg, seg, cell, k1, None, None, acts)
                f = pick(agg, seg, cell, k1, None, None, {'fold'})[0]
                if 'call-all-in' in name:  # folds already shown on the matching call row
                    p(f'| {seg} | {st}: {name} | all ' + fmt(*r) + ' - |')
                else:
                    p(f'| {seg} | {st}: {name} | all ' + fmt(*r, folds=f))

    p(''); p('### 5. RIVER: horse bet one pair, was raised, then called / jammed (V67)'); p('')
    p('| seg | class | raise size | bets | raised | raised% | n call+jam | won | win% | net bb | avg frac | avg call bb | folds |')
    p('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    for seg in ('cash', 'mtt'):
        for name, k1 in [('one pair (all)', ONEPAIR), ('one_pair:top', 'one_pair:top'), ('one_pair:under', 'one_pair:under'),
                         ('ref: two_pair_plus', 'two_pair_plus')]:
            bets = pick(agg, seg, '5_river_bet_raised', k1)[0]
            raised = bets - pick(agg, seg, '5_river_bet_raised', k1, 'not_raised')[0]
            for sz in [('all', ('raise<0.7', 'raise0.7-1.5', 'raise>=1.5')), 'raise<0.7', 'raise0.7-1.5', 'raise>=1.5']:
                szn, szv = (sz if isinstance(sz, tuple) else (sz, sz))
                r = pick(agg, seg, '5_river_bet_raised', k1, szv, None, {'call', 'call_allin', 'raise_allin'})
                f = pick(agg, seg, '5_river_bet_raised', k1, szv, None, {'fold'})[0]
                head = f'| {seg} | {name} | {szn} | ' + (f'{bets:,} | {raised:,} | {100.0 * raised / bets:.1f}% ' if (szn == 'all' and bets) else '| | ')
                p(head + fmt(*r, folds=f))
    p('')
    p('"raised" = river bets that faced a raise; call+jam = call, call-all-in or all-in re-raise after the raise.')

    table('6. TURN high-card (air / draw) CALLS facing a wager the horse did not make (V68), call + call-all-in',
          '6_turn_highcard_vs_bet', [('air + draw (all)', ('air', 'draw')), 'air', 'draw'], SIZES4 + [allsz])
    p('')
    p('V68 / V69 depth split (wager >= 0.7 pot; short = effective behind after call < 1.5 x pot after call):')
    p(''); p(hdr); p(sep)
    for seg in ('cash', 'mtt'):
        for k1 in ('air', 'draw'):
            for d in ('short', 'deep'):
                r = pick(agg, seg, '6_turn_highcard_vs_bet', k1, ('c0.7-1.05', 'd>=1.05'), d, CALLS)
                f = pick(agg, seg, '6_turn_highcard_vs_bet', k1, ('c0.7-1.05', 'd>=1.05'), d, {'fold'})[0]
                p(f'| {seg} | {k1}, {d} | >=0.7 ' + fmt(*r, folds=f))

    if tele_rows:
        p(''); p('### Telemetry receipts (`public.horse_brain_telemetry`, daily fires)'); p('')
        days = sorted({r['day'] for r in tele_rows})
        p('| feature | ' + ' | '.join(days) + ' | last updated_at |')
        p('|---|' + '---:|' * len(days) + '---|')
        for feat in FEATURES:
            rs = [r for r in tele_rows if r['feature'] == feat]
            by = {r['day']: int(r['fires']) for r in rs}
            upd = max((r['updated_at'] for r in rs if r.get('updated_at')), default='-')
            p(f'| {feat} | ' + ' | '.join(f'{by.get(d, 0):,}' for d in days) + f' | {upd} |')
    p('')
    p('Caveat: `horse_hand_reviews` keeps only hands with |net_bb| >= 20. Call cells are biased '
      'negative (a call that wins a small pot is invisible) and fold cells only contain hands '
      'where the horse had already put 20bb+ in; compare before/after only on this same subset, '
      'and treat cells under n=50 as noise.')
    return '\n'.join(out)


def psql_rows(sql):
    """Run one generated statement through psql inside a transaction that is
    always ROLLED BACK (a READ ONLY transaction would refuse the pg_temp
    function). Returns the result rows as dicts."""
    url = os.environ.get('DATABASE_URL')
    if not url:
        raise SystemExit('run: set DATABASE_URL (or use sql/render via the MCP)')
    q = sql.rstrip().rstrip(';')
    marker = '$c$;'
    if marker in q:
        pre, sel = q.split(marker, 1)
        pre += marker
    else:
        pre, sel = '', q
    if sel.lstrip().startswith('SET LOCAL'):
        setl, sel = sel.split(';', 1)
        pre += '\n' + setl.strip() + ';'
    body = f"{pre}\nSELECT coalesce(json_agg(row_to_json(z)),'[]') FROM ({sel}) z"
    wrapped = f"BEGIN;\nSET LOCAL statement_timeout = '60s';\n{body};\nROLLBACK;"
    res = subprocess.run(['psql', url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', wrapped],
                         capture_output=True, text=True, check=True)
    lines = [l for l in res.stdout.splitlines() if l.startswith('[')]
    return json.loads(lines[-1])


def main(argv):
    if len(argv) < 2:
        print(__doc__); return 2
    mode = argv[1]
    opts = {}
    pos = []
    i = 2
    while i < len(argv):
        if argv[i].startswith('--'):
            k = argv[i][2:]
            if k in ('cells', 'fn', 'telemetry'):
                vals = []
                i += 1
                while i < len(argv) and not argv[i].startswith('--'):
                    vals.append(argv[i]); i += 1
                opts[k] = vals; continue
            opts[k] = argv[i + 1]; i += 2; continue
        pos.append(argv[i]); i += 1
    chunks = int(opts.get('chunks', 1))
    if mode == 'sql':
        seg, since, until = pos
        sys.stdout.write(cells_sql(seg, since, until, chunks, int(opts.get('chunk', 0))) + '\n')
    elif mode == 'fn-sql':
        print(fn_sql(pos[0]))
    elif mode == 'telemetry-sql':
        print(telemetry_sql(pos[0], pos[1]))
    elif mode == 'render':
        rowsets = [load_rows(f) for f in opts.get('cells', [])]
        agg, meta = merge_cells(rowsets)
        fn_rows = [r for f in opts.get('fn', []) for r in load_rows(f)]
        tele = [r for f in opts.get('telemetry', []) for r in load_rows(f)]
        print(render(agg, meta, fn_rows, tele, opts.get('window', '?'), opts.get('engine', '?')))
    elif mode == 'run':
        since, until = pos
        rowsets = [psql_rows(cells_sql(seg, since, until, chunks, c)) for seg in ('cash', 'mtt') for c in range(chunks)]
        agg, meta = merge_cells(rowsets)
        fn_rows = psql_rows(fn_sql(since))
        d0 = subprocess.run(['date', '-u', '-d', since, '+%F'], capture_output=True, text=True).stdout.strip()
        d1 = subprocess.run(['date', '-u', '-d', until, '+%F'], capture_output=True, text=True).stdout.strip()
        tele = psql_rows(telemetry_sql(d0, d1))
        try:
            eng = json.loads(subprocess.run(['curl', '-s', 'https://engine.smarter.poker/health'],
                                            capture_output=True, text=True).stdout)['version']
        except Exception:
            eng = 'unknown'
        print(render(agg, meta, fn_rows, tele, f'{since}, {until}', eng))
    else:
        print(__doc__); return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
