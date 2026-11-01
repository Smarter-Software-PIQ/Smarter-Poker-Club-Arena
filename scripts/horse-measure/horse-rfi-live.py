#!/usr/bin/env python3
"""
Re-runnable, READ-ONLY measurement of what Club Arena Hold'em (nlh) players
actually open (raise first in) live, per position, table size and effective
stack, for cash and tournaments, horses and humans separately (is_horse is used
only to label the row, as data).

Source: public.hand_history (every dealt hand, full action log with a
publicNode on every voluntary decision) for actions, positions and stacks;
public.ca_hand_facts (hand_id, user_id) -> hand_class for the 13x13 grids
(hand_history keeps hole cards only for showdown hands, and
horse_hand_reviews keeps only |net| >= 20bb hands, so neither can give an
unbiased open-frequency denominator).

Every statement is a single SELECT (plus SET LOCAL enable_nestloop = off).
Nothing is written anywhere.

Definitions
  * Unopened decision: a voluntary preflop action (not sb/bb/ante/post/
    straddle/return) taken before any voluntary non-fold action in the hand.
    The BB never has one (a walk ends the hand). Hands with a straddle, a
    posted dead blind, a bomb pot, no single bb poster or a small blind that
    is not the seat immediately before the BB are dropped.
  * Action: R = raise or all-in for more than 1bb (open), L = call / all-in
    for <= 1bb (limp), F = fold (timeout folds included).
  * Open size: raise-to amount / bb (the engine records raise amounts as the
    street total); shoves (action all_in) are counted separately and kept out
    of the average open size.
  * Position, from the dealt seats in players[] and the bb poster: d = seats
    clockwise from the BB. d = n-1 SB (HU: the button/SB), otherwise
    k = n-2-d seats from the button: BTN, CO, HJ, LJ; first to act is UTG at
    6+ handed, then UTG+1 (8+), UTG+2 (9+). 6-max: UTG HJ CO BTN SB.
  * Effective stack: min(hero start stack, largest start stack among the
    players not yet folded) read from the hero's own decision publicNode
    (seat tuple [seat, stack, streetBet, total, ante, _, status]; start =
    stack + total), in bb.
  * Buckets: cash a<60, b60-150, c>150; MTT a<=15, b15-25, c25-40, d40-80, e>80.

Sampling (horse stream): minutes :10-:30 of every hour of the window (contiguous
blocks read the heap far faster than a hash sample: ~1 ms/hand against ~2.5 ms),
every hand with 4+ dealt players inside a block, and a 25% hash sample
(abs(hashtext(id)) % 100 < 25) of 2-3 handed hands. Rates are computed within
(table size, position, bucket), so the different 2-3 handed rate does not bias
them. Blocks are interleaved over 3 statements (~10-20 s each). Humans: every
has_human hand in the window (not sampled), non-horse seats only. One extra
grid-only statement (first chunk's blocks) covers the flagged deep contexts in
EXTRA_CTX. Every statement output carries checksums (agg_check, grid tot_n/tot_r)
that render verifies, so a hand-copied MCP result that was mistyped is refused.

Usage
  # 1. One command, with a connection string in $DATABASE_URL (psql, rolled back):
  horse-rfi-live.py run 'SINCE' 'UNTIL' > body.md
  # 2. Through the Supabase MCP (execute_sql): write the statements, run each,
  #    save each JSON result to a file, then render:
  horse-rfi-live.py plan 'SINCE' 'UNTIL' --out DIR          # DIR/c0.sql c1.sql c2.sql hum.sql x0.sql
  horse-rfi-live.py render --window 'SINCE..UNTIL' [--engine VER] \
      --agg c0.json c1.json c2.json --hum hum.json --grid x0.json > body.md
  Options: --chunks 3, --minutes 10-30, --small-keep 25.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

SKIP_ACTS = "('sb','bb','ante','post','straddle','return','uncalled')"

CTE = r"""
SET LOCAL enable_nestloop = off;
WITH horses AS MATERIALIZED (SELECT id::text uid FROM public.profiles WHERE is_horse),
base AS MATERIALIZED (
  SELECT h.id, (h.tournament_id IS NULL) cash, h.big_blind bb, h.players, h.actions
  FROM public.hand_history h
  WHERE ({timepred})
    AND h.game_variant = 'nlh' AND h.bomb_pot IS NULL AND h.big_blind > 0
    AND {sample}
),
ring AS (
  SELECT id, array_agg((p->>'seat')::int ORDER BY (p->>'seat')::int) seats
  FROM base, jsonb_array_elements(players) p GROUP BY id),
pf AS MATERIALIZED (
  SELECT b.id, b.cash, b.bb, t.o, x->>'action' act, (x->>'seat')::int seat, x->>'userId' uid,
    CASE WHEN jsonb_typeof(x->'amount')='number' THEN (x->>'amount')::numeric ELSE 0 END amt,
    x->'publicNode'->'seats' pseats
  FROM base b, jsonb_array_elements(b.actions) WITH ORDINALITY t(x,o)
  WHERE x->>'stage' = 'preflop'),
hand AS (
  SELECT id, min(seat) FILTER (WHERE act='bb') bb_seat, min(seat) FILTER (WHERE act='sb') sb_seat,
    count(*) FILTER (WHERE act='bb') n_bb, coalesce(bool_or(act IN ('straddle','post')), false) odd,
    min(o) FILTER (WHERE act NOT IN """ + SKIP_ACTS + r""" AND act <> 'fold') first_nf
  FROM pf GROUP BY id),
opp0 AS (
  SELECT p.id, p.cash, p.bb, p.act, p.seat, p.uid, p.amt, p.pseats, cardinality(r.seats) n,
    ((array_position(r.seats, p.seat) - array_position(r.seats, hd.bb_seat)) % cardinality(r.seats) + cardinality(r.seats)) % cardinality(r.seats) d,
    ((array_position(r.seats, hd.sb_seat) - array_position(r.seats, hd.bb_seat)) % cardinality(r.seats) + cardinality(r.seats)) % cardinality(r.seats) sbd
  FROM pf p JOIN hand hd ON hd.id = p.id JOIN ring r ON r.id = p.id
  WHERE hd.n_bb = 1 AND NOT hd.odd AND hd.sb_seat IS NOT NULL
    AND p.act NOT IN """ + SKIP_ACTS + r""" AND p.o <= coalesce(hd.first_nf, 1000000)
    AND p.seat <> hd.bb_seat AND p.pseats IS NOT NULL AND p.uid IS NOT NULL),
opp AS (
  SELECT o.*, (hz.uid IS NOT NULL) horse,
    CASE WHEN o.d = o.n - 1 THEN 'SB'
         WHEN o.d = 1 AND o.n >= 6 THEN 'UTG'
         WHEN o.d = 2 AND o.n >= 8 THEN 'UTG+1'
         WHEN o.d = 3 AND o.n >= 9 THEN 'UTG+2'
         ELSE (ARRAY['BTN','CO','HJ','LJ','MP','MP','MP'])[o.n - 2 - o.d + 1] END pos,
    CASE WHEN o.act = 'fold' THEN 'F'
         WHEN o.act = 'call' OR (o.act = 'all_in' AND o.amt <= o.bb) THEN 'L'
         WHEN o.act IN ('raise','all_in','bet') THEN 'R' ELSE 'X' END ac,
    (o.act = 'all_in' AND o.amt > o.bb) shove,
    least(st.hero, st.opp) / o.bb eff_bb
  FROM opp0 o LEFT JOIN horses hz ON hz.uid = o.uid,
  LATERAL (SELECT max(CASE WHEN (s->>0)::int = o.seat THEN (s->>1)::numeric + coalesce((s->>3)::numeric, 0) END) hero,
                  max(CASE WHEN (s->>0)::int <> o.seat AND coalesce(s->>6, '0') <> '1' THEN (s->>1)::numeric + coalesce((s->>3)::numeric, 0) END) opp
           FROM jsonb_array_elements(o.pseats) s) st
  WHERE o.sbd = o.n - 1),
opk AS (
  SELECT *, CASE WHEN cash THEN 'c' ELSE 'm' END seg,
    CASE WHEN cash THEN CASE WHEN eff_bb < 60 THEN 'a<60' WHEN eff_bb <= 150 THEN 'b60-150' ELSE 'c>150' END
         ELSE CASE WHEN eff_bb <= 15 THEN 'a<=15' WHEN eff_bb <= 25 THEN 'b15-25' WHEN eff_bb <= 40 THEN 'c25-40'
                   WHEN eff_bb <= 80 THEN 'd40-80' ELSE 'e>80' END END bkt
  FROM opp WHERE eff_bb IS NOT NULL)
"""

# Final SELECT: one row, two compact strings.
#  agg : "seg h n pos bkt opps R L shoves sum_open_bb sum_eff_bb" joined by ';'
#        (seg c/m, h 1 horse / 0 not; opps = unopened decisions; R opens, L limps,
#         shoves = open all-ins; sum_open_bb over non-shove opens)
#  grid: "seg|ng|pos|bkt|unknown|tot_n|tot_r|<169 cells>" joined by ';', horses only, contexts
#        GRID_CTX; cells in AKQJT98765432 row-major order (row a, col b: a==b pair,
#        a<b suited, a>b offsuit), each "n[/R[/L[/shoves]]]" (trailing zeros dropped,
#        "0" = no decision); tot_n / tot_r are the context totals, a transcription check.
#  agg_check: "<opps> <opens>" over the agg rows, a transcription check.
FINAL = r"""{grid_ctes}
SELECT '{tag}' tag, (SELECT count(*) FROM base) hands_scanned, (SELECT count(DISTINCT id) FROM opk) hands_used,
  (SELECT count(*) || ' ' || count(*) FILTER (WHERE ac = 'R') FROM opk {where}) agg_check,
  (SELECT coalesce(string_agg(concat_ws(' ', seg, h, n, pos, bkt, cnt, r, l, shv, osum, esum), ';' ORDER BY seg, h, n, pos, bkt), '')
   FROM (SELECT seg, horse::int h, n, pos, bkt, count(*) cnt, count(*) FILTER (WHERE ac = 'R') r, count(*) FILTER (WHERE ac = 'L') l,
           count(*) FILTER (WHERE shove) shv,
           round(coalesce(sum(amt / bb) FILTER (WHERE ac = 'R' AND NOT shove), 0), 1) osum, round(sum(eff_bb)) esum
         FROM opk {where} GROUP BY 1, 2, 3, 4, 5) g) agg,
  {grid_col} poscheck,
  (clock_timestamp() - now())::text elapsed
"""

GRID_CTES = r""",
fx AS MATERIALIZED (
  -- ca_hand_facts rows for the same blocks (played_at precedes created_at by the hand's length,
  -- so each block is widened 5 minutes backwards; unmatched rows are counted as 'unknown'); a hash join, never a per-row index probe
  -- (a cold probe of this 94 GB table costs ~15 ms).
  SELECT f.hand_id, f.user_id::text uid, f.hand_class, f.position
  FROM public.ca_hand_facts f
  WHERE ({factpred}) AND f.game_variant = 'nlh' AND f.players_dealt >= 6),
g AS (
  SELECT k.seg, {ng_expr} ng, k.pos, k.bkt, k.ac, k.shove, fx.hand_class hc, fx.position fpos
  FROM opk k LEFT JOIN fx ON fx.hand_id = k.id AND fx.uid = k.uid
  WHERE k.horse AND ({ctx})),
rk AS (SELECT i, substr('AKQJT98765432', i, 1) r FROM generate_series(1, 13) i),
cls AS (SELECT a.i * 13 + b.i ord, CASE WHEN a.i = b.i THEN a.r || b.r WHEN a.i < b.i THEN a.r || b.r || 's' ELSE b.r || a.r || 'o' END hc FROM rk a, rk b),
cnt AS (SELECT seg, ng, pos, bkt, coalesce(hc, '?') hc, count(*) c, count(*) FILTER (WHERE ac = 'R') r, count(*) FILTER (WHERE ac = 'L') l,
          count(*) FILTER (WHERE shove) s FROM g GROUP BY 1, 2, 3, 4, 5),
ctx AS (SELECT seg, ng, pos, bkt, coalesce(sum(c) FILTER (WHERE hc NOT IN (SELECT hc FROM cls)), 0) unknown FROM cnt GROUP BY 1, 2, 3, 4),
gridrows AS (
  SELECT x.seg, x.ng, x.pos, x.bkt, x.unknown,
    sum(c.c) tot_n, sum(c.r) tot_r,
    string_agg(CASE WHEN c.c IS NULL THEN '0' ELSE c.c || CASE WHEN c.r > 0 OR c.l > 0 OR c.s > 0 THEN '/' || c.r ELSE '' END
      || CASE WHEN c.l > 0 OR c.s > 0 THEN '/' || c.l ELSE '' END || CASE WHEN c.s > 0 THEN '/' || c.s ELSE '' END END, ' ' ORDER BY cl.ord) cells
  FROM ctx x CROSS JOIN cls cl LEFT JOIN cnt c ON c.seg = x.seg AND c.ng = x.ng AND c.pos = x.pos AND c.bkt = x.bkt AND c.hc = cl.hc
  GROUP BY 1, 2, 3, 4, 5)"""

GRID_COL = ("(SELECT coalesce(string_agg(concat_ws('|', seg, ng, pos, bkt, unknown, tot_n, tot_r, cells), ';' ORDER BY seg, ng, pos, bkt), '') FROM gridrows) grid, "
            "(SELECT string_agg(seg || ' ' || pos || '=' || coalesce(fpos, '?') || ' ' || c, ';' ORDER BY seg, pos, fpos) "
            "FROM (SELECT seg, pos, fpos, count(*) c FROM g GROUP BY 1, 2, 3) q)")

# Default grid contexts: the two asked for (cash 6-handed 60-150bb; MTT 6+-handed 25-40bb).
GRID_CTX = [
    "(k.seg = 'c' AND k.n = 6 AND k.bkt = 'b60-150')",
    "(k.seg = 'm' AND k.n >= 6 AND k.bkt = 'c25-40')",
]


def time_pred(blocks):
    return ' OR '.join(f"(h.created_at >= '{a}'::timestamptz AND h.created_at < '{b}'::timestamptz)" for a, b in blocks)


def sample_clause(mod, keep, human, small_keep=None):
    """Hash sample within the time blocks: keep/mod of hands with 4+ dealt players, small_keep/mod of 2-3 handed."""
    if small_keep is None and keep >= mod:
        s = 'true'
    else:
        sk = keep if small_keep is None else small_keep
        s = (f"abs(hashtext(h.id::text)) % {mod} < CASE WHEN jsonb_array_length(h.players) <= 3 "
             f"THEN {sk} ELSE {keep} END")
    return f"h.has_human AND {s}" if human else s


NG_DEFAULT = "CASE WHEN k.n >= 6 THEN '6+' ELSE k.n::text END"

# Extra grids for flagged contexts outside the two default ones (run as grid-only statements).
EXTRA_CTX = [
    "(k.seg = 'c' AND k.n = 6 AND k.bkt = 'c>150' AND k.pos IN ('CO', 'BTN', 'SB'))",
    "(k.seg = 'm' AND k.n IN (8, 9) AND k.bkt = 'e>80' AND k.pos IN ('UTG', 'CO', 'BTN'))",
]
NG_EXTRA = "CASE WHEN k.seg = 'm' THEN '8-9' ELSE '6' END"


def stmt(blocks, mod=100, keep=100, small_keep=None, human=False, grid=True, ctx=None, tag='s',
         agg=True, ng_expr=NG_DEFAULT):
    sql = (CTE.replace('{timepred}', time_pred(blocks))
              .replace('{sample}', sample_clause(mod, keep, human, small_keep)))
    fin = FINAL.replace('{tag}', tag).replace('{where}', 'WHERE NOT horse' if human else '')
    if not agg:
        i0 = fin.index('  (SELECT count(*) ||'); i1 = fin.index('  {grid_col}')
        fin = fin[:i0] + "  '' agg_check, '' agg,\n" + fin[i1:]
    fin = fin.replace('{ng_expr}', ng_expr)
    if grid and not human:
        fpred = ' OR '.join(f"(f.played_at >= '{a}'::timestamptz - interval '5 minutes' AND f.played_at < '{b}'::timestamptz)" for a, b in blocks)
        fin = (fin.replace('{grid_ctes}', GRID_CTES.replace('{ctx}', ' OR '.join(ctx or GRID_CTX)).replace('{factpred}', fpred)
                   .replace('{ng_expr}', ng_expr))
                  .replace('{grid_col}', GRID_COL))
    else:
        fin = fin.replace('{grid_ctes}', '').replace('{grid_col}', "'' grid, ''")
    return sql + fin + ';'


def parse_ts(t):
    return datetime.fromisoformat(t.replace(' ', 'T').replace('Z', '+00:00'))


def blocks_for(since, until, m0, m1):
    """Minute-of-hour blocks [m0, m1) of every hour in [since, until)."""
    a, b = parse_ts(since), parse_ts(until)
    h = a.replace(minute=0, second=0, microsecond=0)
    out = []
    while h < b:
        lo, hi = max(a, h + timedelta(minutes=m0)), min(b, h + timedelta(minutes=m1))
        if lo < hi:
            out.append((lo.isoformat(sep=' '), hi.isoformat(sep=' ')))
        h += timedelta(hours=1)
    return out


def chunk(lst, k):
    """Split blocks into k interleaved groups so each call sees the whole day."""
    return [lst[i::k] for i in range(k)]


# ------------------------------------------------------------------ render

RANKS = 'AKQJT98765432'
GTO = {
    # (seg, position) -> (lo, hi) RFI %, the comparison bands given with the task
    ('c', 'UTG'): (15, 18), ('c', 'HJ'): (19, 23), ('c', 'CO'): (26, 30), ('c', 'BTN'): (40, 48), ('c', 'SB'): (40, 50),
    ('m', 'UTG'): (17, 20), ('m', 'HJ'): (20, 24), ('m', 'CO'): (28, 32), ('m', 'BTN'): (45, 55),
}
POS_ORDER = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'MP', 'HJ', 'CO', 'BTN', 'SB']
BKTS = {'c': ['a<60', 'b60-150', 'c>150'], 'm': ['a<=15', 'b15-25', 'c25-40', 'd40-80', 'e>80']}
BKT_LABEL = {'a<60': '<60', 'b60-150': '60-150', 'c>150': '>150', 'a<=15': '<=15', 'b15-25': '15-25',
             'c25-40': '25-40', 'd40-80': '40-80', 'e>80': '>80'}
SEGN = {'c': 'cash', 'm': 'MTT'}


def load_rows(path):
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


def merge_agg(files):
    """(seg, h, n, pos, bkt) -> [opps, R, L, shoves, open_bb_sum, eff_bb_sum]; verifies agg_check."""
    agg, meta = {}, []
    for f in files:
        for r in load_rows(f):
            rows = [x.split(' ') for x in r['agg'].split(';') if x]
            n = sum(int(x[5]) for x in rows); R = sum(int(x[6]) for x in rows)
            if r.get('agg_check') and r['agg_check'] != f'{n} {R}':
                raise SystemExit(f'{f}: agg_check {r["agg_check"]} != {n} {R} (bad transcription)')
            meta.append((r.get('tag'), int(r['hands_scanned']), int(r['hands_used']), r.get('elapsed'), r.get('poscheck', '')))
            for seg, h, nn, pos, bkt, cnt, rr, ll, shv, osum, esum in rows:
                a = agg.setdefault((seg, int(h), int(nn), pos, bkt), [0, 0, 0, 0, 0.0, 0.0])
                for k, v in enumerate((int(cnt), int(rr), int(ll), int(shv), float(osum), float(esum))):
                    a[k] += v
    return agg, meta


def classes_169():
    out = []
    for i, a in enumerate(RANKS):
        for j, b in enumerate(RANKS):
            out.append(a + b if i == j else (a + b + 's' if i < j else b + a + 'o'))
    return out


def merge_grid(files):
    """(seg, ng, pos, bkt) -> {class: [n, R, L, shoves]}; verifies tot_n / tot_r per context."""
    cls = classes_169()
    g, unknown = {}, {}
    for f in files:
        for r in load_rows(f):
            for row in [x for x in r.get('grid', '').split(';') if x]:
                seg, ng, pos, bkt, unk, tn, tr, cells = row.split('|')
                cells = cells.split(' ')
                vals = [[int(v) for v in c.split('/')] + [0] * (4 - len(c.split('/'))) for c in cells]
                if len(vals) != 169 or sum(v[0] for v in vals) != int(tn) or sum(v[1] for v in vals) != int(tr):
                    raise SystemExit(f'{f}: grid {seg} {pos} {bkt} fails its checksum (bad transcription)')
                d = g.setdefault((seg, ng, pos, bkt), {})
                for hc, v in zip(cls, vals):
                    a = d.setdefault(hc, [0, 0, 0, 0])
                    for k in range(4): a[k] += v[k]
                unknown[(seg, ng, pos, bkt)] = unknown.get((seg, ng, pos, bkt), 0) + int(unk)
    return g, unknown


def cell(agg, seg, h, ns=None, pos=None, bkt=None):
    """opps, R, L, F, shoves, open_bb_sum (non-shove), eff_bb_sum"""
    t = [0, 0, 0, 0, 0.0, 0.0]
    for (s, hh, n, p, b), v in agg.items():
        if s != seg or hh != h: continue
        if ns is not None and n not in ns: continue
        if pos is not None and p != pos: continue
        if bkt is not None and b not in (bkt if isinstance(bkt, (list, tuple, set)) else [bkt]): continue
        for k in range(6): t[k] += v[k]
    return t[0], t[1], t[2], t[0] - t[1] - t[2], t[3], t[4], t[5]


def pct(a, b, d=1):
    return f'{100.0 * a / b:.{d}f}%' if b else '-'


def flag_for(seg, pos, n_tbl, r, n):
    """Band verdict; only for the table sizes the bands describe (cash 6-max, MTT 8-9 handed)."""
    if (seg, pos) not in GTO or n < 100: return ''
    if seg == 'c' and n_tbl != 6: return ''
    if seg == 'm' and n_tbl not in (8, 9): return ''
    lo, hi = GTO[(seg, pos)]
    v = 100.0 * r / n
    return f'**HIGH** (band {lo}-{hi})' if v > hi else (f'**LOW** (band {lo}-{hi})' if v < lo else f'in band ({lo}-{hi})')


HDR = '| position | unopened decisions | opens | RFI % | limp % | open-shove % | avg open, bb (non-shove) | avg eff stack, bb | vs band |'
SEP = '|---|---:|---:|---:|---:|---:|---:|---:|---|'


def row_md(label, c, flag=''):
    n, r, l, f, shv, osum, esum = c
    nsh = r - shv
    return (f'| {label} | {n:,} | {r:,} | {pct(r, n)} | {pct(l, n)} | {pct(shv, n)} | '
            f'{(f"{osum / nsh:.2f}" if nsh else "-")} | {(esum / n if n else 0):.0f} | {flag} |')


def sizes_present(agg, seg, h):
    out = {}
    for (s, hh, n, p, b), v in agg.items():
        if s == seg and hh == h: out[n] = out.get(n, 0) + v[0]
    return dict(sorted(out.items()))


def positions_for(n):
    if n == 2: return ['SB']
    res = []
    for d in range(1, n):
        if d == n - 1: res.append('SB')
        elif d == 1 and n >= 6: res.append('UTG')
        elif d == 2 and n >= 8: res.append('UTG+1')
        elif d == 3 and n >= 9: res.append('UTG+2')
        else: res.append(['BTN', 'CO', 'HJ', 'LJ', 'MP', 'MP', 'MP'][n - 2 - d])
    return res


def bucket_cell_md(c, seg, pos, n_tbl, h, b=None):
    n, r, l, f, shv, osum, esum = c
    if not n: return '-'
    nsh = r - shv
    fl = flag_for(seg, pos, n_tbl, r, n) if h == 1 and not (seg == 'm' and b in ('a<=15', 'b15-25')) else ''
    mark = ' **HIGH**' if fl.startswith('**HIGH') else (' **LOW**' if fl.startswith('**LOW') else '')
    extra = []
    if l: extra.append(f'L {pct(l, n)}')
    if shv: extra.append(f'shove {pct(shv, n)}')
    if nsh: extra.append(f'{osum / nsh:.2f}bb')
    return f'{pct(r, n)}{mark} n={n:,}' + (f' ({", ".join(extra)})' if extra else '')


# Approximate reference opening ranges used ONLY to name the hand classes that drive a
# deviation (not solver output; typical published 100bb 6-max cash / 8-max BB-ante MTT
# charts, within a few percent of the bands above).
def expand(spec):
    """'22+ A2s+ K9s+ ATo+ KJo+ T8s+ 76s' style -> set of classes."""
    out = set()
    for tok in spec.split():
        plus = tok.endswith('+'); t = tok.rstrip('+')
        if len(t) == 2 and t[0] == t[1]:
            i = RANKS.index(t[0])
            out.update(RANKS[k] * 2 for k in range(0, i + 1) if plus or k == i)
            continue
        hi, lo, kind = t[0], t[1], t[2]
        ih, il = RANKS.index(hi), RANKS.index(lo)
        if plus:
            for k in range(ih + 1, il + 1): out.add(hi + RANKS[k] + kind)
        else:
            out.add(t)
    return out


REF = {
    ('c', 'UTG'): '22+ A2s+ K9s+ Q9s+ J9s+ T9s 98s 87s 76s ATo+ KJo+ QJo',
    ('c', 'HJ'): '22+ A2s+ K7s+ Q9s+ J9s+ T8s+ 98s 87s 76s 65s A9o+ KTo+ QTo+ JTo',
    ('c', 'CO'): '22+ A2s+ K4s+ Q6s+ J7s+ T7s+ 97s+ 86s+ 75s+ 65s 54s A7o+ A5o K9o+ Q9o+ J9o+ T9o',
    ('c', 'BTN'): '22+ A2s+ K2s+ Q2s+ J4s+ T6s+ 95s+ 85s+ 74s+ 63s+ 53s+ 43s A2o+ K8o+ Q8o+ J8o+ T8o+ 97o+ 87o',
    ('c', 'SB'): '22+ A2s+ K2s+ Q4s+ J6s+ T6s+ 96s+ 86s+ 75s+ 64s+ 54s A2o+ K8o+ Q9o+ J9o+ T9o',
    ('m', 'UTG'): '22+ A2s+ K8s+ Q9s+ J9s+ T9s 98s 87s 76s ATo+ KJo+ QJo',
    ('m', 'UTG+1'): '22+ A2s+ K7s+ Q9s+ J9s+ T9s 98s 87s 76s ATo+ KTo+ QJo',
    ('m', 'UTG+2'): '22+ A2s+ K6s+ Q8s+ J8s+ T8s+ 98s 87s 76s 65s A9o+ KTo+ QTo+ JTo',
    ('m', 'LJ'): '22+ A2s+ K6s+ Q8s+ J8s+ T8s+ 97s+ 87s 76s 65s A9o+ KTo+ QTo+ JTo',
    ('m', 'HJ'): '22+ A2s+ K5s+ Q8s+ J8s+ T8s+ 97s+ 86s+ 76s 65s A8o+ KTo+ QTo+ JTo',
    ('m', 'CO'): '22+ A2s+ K3s+ Q5s+ J7s+ T7s+ 96s+ 86s+ 75s+ 64s+ 54s A5o+ K9o+ Q9o+ J9o+ T9o',
    ('m', 'BTN'): '22+ A2s+ K2s+ Q2s+ J3s+ T5s+ 95s+ 84s+ 74s+ 63s+ 53s+ 43s A2o+ K6o+ Q8o+ J8o+ T8o+ 97o+ 87o 76o',
    ('m', 'SB'): '22+ A2s+ K2s+ Q2s+ J4s+ T6s+ 96s+ 85s+ 75s+ 64s+ 54s A2o+ K7o+ Q9o+ J9o+ T9o',
}


def combos(hc):
    return 6 if len(hc) == 2 else (4 if hc.endswith('s') else 12)


def grid_md(d):
    lines = ['| | ' + ' | '.join(RANKS) + ' |', '|---|' + '---:|' * 13]
    for i, a in enumerate(RANKS):
        cells = []
        for j, b in enumerate(RANKS):
            hc = a + b if i == j else (a + b + 's' if i < j else b + a + 'o')
            v = d.get(hc, [0, 0, 0, 0])
            if v[0] == 0: cells.append('.')
            elif v[0] < 3: cells.append(f'({v[1]}/{v[0]})')
            else: cells.append(f'{round(100.0 * v[1] / v[0])}/{v[0]}')
        lines.append(f'| **{a}** | ' + ' | '.join(cells) + ' |')
    return '\n'.join(lines)


def combo_weighted_rfi(d):
    """Open % with each class weighted by its combo count (removes the sampling noise of
    which classes happened to be dealt); returns (weighted %, raw %)."""
    num = den = 0.0
    for hc, v in d.items():
        if v[0]:
            num += combos(hc) * v[1] / v[0]; den += combos(hc)
    N = sum(v[0] for v in d.values()); R = sum(v[1] for v in d.values())
    return (100.0 * num / den if den else 0.0), (100.0 * R / N if N else 0.0)


def drivers(d, seg, pos, k=14):
    ref = REF.get((seg, pos))
    if not ref: return None
    ref = expand(ref)
    loose, tight = [], []
    for hc, v in d.items():
        if v[0] < 3: continue
        f = v[1] / v[0]
        if hc not in ref and f >= 0.34: loose.append((hc, v, f))
        if hc in ref and f <= 0.66: tight.append((hc, v, f))
    loose.sort(key=lambda t: -(t[2] * combos(t[0])))
    tight.sort(key=lambda t: -((1 - t[2]) * combos(t[0])))
    ref_pct = 100.0 * sum(combos(h) for h in ref) / 1326
    lc = sum(combos(h) * f for h, v, f in loose) / 13.26
    tc = sum(combos(h) * (1 - f) for h, v, f in tight) / 13.26
    return ref_pct, loose[:k], tight[:k], lc, tc


def render(agg, meta, hum, hmeta, grid, unknown, window, engine, sample_note):
    out = []
    p = out.append
    hs = sum(m[1] for m in meta); hu = sum(m[2] for m in meta)
    p(f'- Window: `[{window})` (hand_history.created_at, UTC). Serving engine at measurement: `{engine}`.')
    p(f'- Horse stream: {sample_note}; {hs:,} nlh hands scanned, {hu:,} with a usable unopened decision '
      f'({len(meta)} statements, elapsed {", ".join(str(m[3])[:8] for m in meta)}).')
    if hmeta:
        p(f'- Human stream: every `has_human` nlh hand in the window, not sampled: {sum(m[1] for m in hmeta):,} hands, '
          f'{sum(m[2] for m in hmeta):,} used; only non-horse seats counted.')
    p('')

    def section(src, h, title, min_n=200):
        for seg in ('c', 'm'):
            sz = sizes_present(src, seg, h)
            if not sz: continue
            p(f'### {title}, {SEGN[seg]}')
            p('')
            p('Unopened decisions by table size (players dealt): ' + ', '.join(f'{n}-handed {v:,}' for n, v in sz.items()))
            p('')
            for n in sz:
                if sz[n] < min_n: continue
                p(f'**{SEGN[seg]}, {n}-handed, all stacks**')
                p('')
                p(HDR); p(SEP)
                for pos in positions_for(n):
                    c = cell(src, seg, h, [n], pos)
                    if c[0]: p(row_md(pos if n > 2 else 'SB (=BTN, HU)', c, flag_for(seg, pos, n, c[1], c[0]) if h == 1 else ''))
                p('')
                if sz[n] >= 4 * min_n and h == 1:
                    p(f'**{SEGN[seg]}, {n}-handed, by effective stack (bb)**: RFI % and n (L = limp %, shove = open-shove %, then avg non-shove open size)')
                    p('')
                    p('| position | ' + ' | '.join(BKT_LABEL[b] for b in BKTS[seg]) + ' |')
                    p('|---|' + '---|' * len(BKTS[seg]))
                    for pos in positions_for(n):
                        p(f'| {pos} | ' + ' | '.join(bucket_cell_md(cell(src, seg, h, [n], pos, b), seg, pos, n, h, b) for b in BKTS[seg]) + ' |')
                    p('')

    p('## 1. Horse contexts outside the comparison bands (n >= 100)')
    p('')
    p('Bands apply to cash 6-handed and MTT 8-9 handed, by the given position; MTT buckets under 25bb are push/fold and are not graded here.')
    p('')
    p('| context | position | RFI % | n | band | verdict |')
    p('|---|---|---:|---:|---|---|')
    for seg, sizes, bk in (('c', [6], [None] + BKTS['c']), ('m', [8], [None, 'c25-40', 'd40-80', 'e>80']), ('m', [9], [None, 'c25-40', 'd40-80', 'e>80'])):
        for b in bk:
            for pos in POS_ORDER:
                if (seg, pos) not in GTO: continue
                c = cell(agg, seg, 1, sizes, pos, b)
                if c[0] < 100: continue
                fl = flag_for(seg, pos, sizes[0], c[1], c[0])
                if fl.startswith('**'):
                    lo, hi = GTO[(seg, pos)]
                    p(f'| {SEGN[seg]} {sizes[0]}-handed, {"all stacks" if b is None else BKT_LABEL[b] + "bb"} | {pos} | '
                      f'{pct(c[1], c[0])} | {c[0]:,} | {lo}-{hi} | {fl.split(" ")[0]} |')
    p('')
    p('## 2. Horses: RFI by position, table size and effective stack')
    p('')
    section(agg, 1, 'Horses')
    if grid:
        p('## 3. Horse 13x13 open grids')
        p('')
        p('Cell = open % / unopened decisions with that class (`(r/n)` when n < 3, `.` when none). Rows are the first card; '
          'upper right suited, lower left offsuit, diagonal pairs. Class from `ca_hand_facts.hand_class` (hash-joined on hand_id, user_id). '
          '"Combo-weighted" re-weights each class by its 4/6/12 combos so a class dealt more or less often than expected does not move the total.')
        p('')
        for key in sorted(grid, key=lambda t: (t[0], t[3], POS_ORDER.index(t[2]) if t[2] in POS_ORDER else 99)):
            seg, ng, pos, bkt = key
            d = grid[key]
            N = sum(v[0] for v in d.values()); R = sum(v[1] for v in d.values())
            w, raw = combo_weighted_rfi(d)
            tbl = {'6+': '6-handed' if seg == 'c' else '6-9 handed (labels by distance from the button; UTG = first to act)',
                   '6': '6-handed', '8-9': '8-9 handed'}.get(ng, f'{ng}-handed')
            p(f'### {SEGN[seg]} {tbl}, {BKT_LABEL[bkt]}bb, {pos}: {R:,}/{N:,} opens = {raw:.1f}% raw, {w:.1f}% combo-weighted'
              + (f', {unknown[key]} decisions without a class' if unknown.get(key) else ''))
            p('')
            p(grid_md(d))
            p('')
            dv = drivers(d, seg, pos)
            if dv:
                ref_pct, loose, tight, lc, tc = dv
                p(f'Against the reference range ({ref_pct:.1f}% of combos): opens outside it add about {lc:.1f} points, '
                  f'reference hands folded take away about {tc:.1f} points.')
                if loose:
                    p('- Opened though outside the reference (open/n): ' + ', '.join(f'{hc} {v[1]}/{v[0]}' for hc, v, f in loose))
                if tight:
                    p('- In the reference but mostly folded (open/n): ' + ', '.join(f'{hc} {v[1]}/{v[0]}' for hc, v, f in tight))
                p('')
    if hum:
        p('## 4. Humans (data only; non-horse seats in has_human hands)')
        p('')
        section(hum, 0, 'Humans', min_n=10)
    return '\n'.join(out)


def psql_rows(sql):
    """Run one generated statement with psql inside a transaction that is always ROLLED BACK."""
    url = os.environ.get('DATABASE_URL')
    if not url:
        raise SystemExit('run: set DATABASE_URL (or use plan/render through the Supabase MCP)')
    q = sql.rstrip().rstrip(';')
    setl, sel = q.split(';', 1)
    body = f"{setl};\nSELECT coalesce(json_agg(row_to_json(z)),'[]') FROM ({sel}) z"
    wrapped = f"BEGIN;\nSET LOCAL statement_timeout = '120s';\n{body};\nROLLBACK;"
    res = subprocess.run(['psql', url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', wrapped],
                         capture_output=True, text=True, check=True)
    lines = [l for l in res.stdout.splitlines() if l.startswith('[')]
    return json.loads(lines[-1])


def engine_version():
    try:
        d = json.loads(subprocess.run(['curl', '-s', 'https://engine.smarter.poker/health'],
                                      capture_output=True, text=True, timeout=20).stdout)
        return d.get('version', 'unknown')
    except Exception:
        return 'unknown'


def plan(since, until, chunks=3, m0=10, m1=30, small_keep=25):
    """The statements of one measurement: `chunks` horse statements (interleaved 20-minute blocks)
    and one human statement over the whole window."""
    blocks = blocks_for(since, until, m0, m1)
    stmts = [(f'c{i}', stmt(c, 100, 100, small_keep, tag=f'c{i}')) for i, c in enumerate(chunk(blocks, chunks))]
    a, b = parse_ts(since).isoformat(sep=' '), parse_ts(until).isoformat(sep=' ')
    stmts.append(('hum', stmt([(a, b)], 100, 100, None, human=True, grid=False, tag='hum')))
    # grid-only statement for the flagged deep contexts, over the first chunk's blocks
    stmts.append(('x0', stmt(chunk(blocks, chunks)[0], 100, 100, 0, tag='x0', agg=False, ctx=EXTRA_CTX, ng_expr=NG_EXTRA)))
    note = (f'minutes :{m0:02d}-:{m1:02d} of every hour ({len(blocks)} blocks, {100.0 * (m1 - m0) / 60:.0f}% of the window); '
            f'inside a block every hand with 4+ dealt players and a {small_keep}% hash sample '
            f'(abs(hashtext(id)) % 100 < {small_keep}) of 2-3 handed hands')
    return stmts, note


def main(argv):
    if len(argv) < 2:
        print(__doc__); return 2
    mode = argv[1]
    opts, pos = {}, []
    i = 2
    while i < len(argv):
        a = argv[i]
        if a.startswith('--'):
            k = a[2:]
            if k in ('agg', 'hum', 'grid'):
                vals = []; i += 1
                while i < len(argv) and not argv[i].startswith('--'):
                    vals.append(argv[i]); i += 1
                opts[k] = vals; continue
            opts[k] = argv[i + 1]; i += 2; continue
        pos.append(a); i += 1
    chunks = int(opts.get('chunks', 3)); m0, m1 = (int(x) for x in opts.get('minutes', '10-30').split('-'))
    small = int(opts.get('small-keep', 25))
    if mode == 'plan':
        since, until = pos
        stmts, note = plan(since, until, chunks, m0, m1, small)
        outdir = opts.get('out')
        for tag, sql in stmts:
            if outdir:
                os.makedirs(outdir, exist_ok=True)
                open(os.path.join(outdir, f'{tag}.sql'), 'w').write(sql + '\n')
            else:
                print(f'-- {tag}\n{sql}\n')
        print(f'-- sample: {note}', file=sys.stderr)
    elif mode == 'render':
        since, until = opts['window'].split('..')
        _, note = plan(since, until, chunks, m0, m1, small)
        agg, meta = merge_agg(opts.get('agg', []))
        hum, hmeta = merge_agg(opts.get('hum', [])) if opts.get('hum') else ({}, [])
        grid, unknown = merge_grid(opts.get('agg', []) + opts.get('grid', []))
        print(render(agg, meta, hum, hmeta, grid, unknown, f'{since}, {until}', opts.get('engine') or engine_version(), note))
    elif mode == 'run':
        since, until = pos
        import tempfile
        tmp = tempfile.mkdtemp()
        stmts, note = plan(since, until, chunks, m0, m1, small)
        files = {'c': [], 'hum': [], 'x': []}
        for tag, sql in stmts:
            fn = os.path.join(tmp, f'{tag}.json')
            json.dump(psql_rows(sql), open(fn, 'w'))
            files['hum' if tag == 'hum' else ('x' if tag.startswith('x') else 'c')].append(fn)
        agg, meta = merge_agg(files['c'])
        hum, hmeta = merge_agg(files['hum'])
        grid, unknown = merge_grid(files['c'] + files['x'])
        print(render(agg, meta, hum, hmeta, grid, unknown, f'{since}, {until}', engine_version(), note))
    else:
        print(__doc__); return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
