#!/usr/bin/env node
/**
 * PLO4 / PLO5 cash facing-bet range tables (omahaFacingBetRangeIsMeasuredByLine and its sibling options).
 *
 * Measures, from real shown-down hands only, the strength of the hand a player held when he made the first wager
 * of a street (by street, line, size and how many players he bet into), when he raised it, and when he called it;
 * how often players facing a first wager continue; how often the whole field folds; how often a flop bettor whose
 * bet was called fires the turn and the river; and how often a caller holds a flush draw. The tables are what the
 * pricing reads (server/src/engine/HorseOmahaFacingBetRangeTables.json). Nothing here runs in the engine.
 *
 *   pull --from <ISO> --to <ISO> --out <dir>      SELECT-only, read_only, through the Supabase Management API with
 *                                                  SUPABASE_ACCESS_TOKEN from the environment (no .env is read).
 *                                                  Hole cards are selected ONLY for players the showdown lists as
 *                                                  not mucked: no unshown card leaves the database.
 *   calibrate --states <state set dir> --decisions <replay dir> --tables <tables.json>
 *                                                  F6 (omahaFacingBetMinimumDefencePrior): per game, street and size
 *                                                  bucket under 0.7 pot, the smallest share of AIR (his weakest bin)
 *                                                  in a no-record prior under which the Horse's whole heads-up range
 *                                                  over the state set (facing a first wager; a raise the replay made
 *                                                  stays a raise) folds no more than the mean of s / (1 + s) + 0.05;
 *                                                  written into the tables as minDefence (a cell already within the
 *                                                  bound gets none). Priced with omahaFacingBetIndifferenceCalls on,
 *                                                  rake 0. Run from server/ with tsx.
 *   fit  --in <dir> --out <tables.json> --version <label>
 *                                                  run from server/ with `node --import tsx`: it scores hands with
 *                                                  the engine's own evaluator (HorseEval.scoreOmahaHiPartial) and
 *                                                  exact holding counts (HorseOmahaFacingBetEv.countHoldingsWithout).
 *
 * STRENGTH is the share of holdings of the player's own size (four or five cards, drawn from the cards unseen to
 * him) that beat his hand on the board of that street: 0 is the nuts. It is the same scale the engine's exact
 * counts use (omahaEvHandCounts.top), so a table bin [a, b) is "the strongest b of holdings less the strongest a".
 *
 * SHOWDOWN BIAS: a bettor who later folds, or who reaches the showdown and mucks a losing hand, is never shown. Each
 * cell records how many of its first wagers ended either way (laterFold); that share is added to the cell as weak
 * hands (the cell's own shown hands at strength >= WEAK_EDGE, by their shape), on every street.
 *
 * Identity-free: no user is keyed. Every cell pools every player who made that action.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const BIN_EDGES = [0, 0.01, 0.03, 0.07, 0.13, 0.2, 0.35, 0.55, 1];
export const WEAK_EDGE = 0.2;
/** Pseudo-samples of the parent cell behind a cell's own histogram. */
export const SHRINK_K = 30;

const SQL = `select h.id, h.created_at, h.game_variant gv, h.button_seat btn,
 h.community_cards cc, h.community_cards2 cc2, h.rit_boards rit, (h.bomb_pot is not null) bomb,
 (select jsonb_agg(jsonb_build_array(p->'seat',p->>'userId')) from jsonb_array_elements(h.players) p) pl,
 (select jsonb_agg(jsonb_build_array(a->'seat', a->>'stage', a->>'action', a->'amount', a->'dead', a->'publicNode'->'pot', a->'publicNode'->'toCall', a->>'userId') order by o)
    from jsonb_array_elements(h.actions) with ordinality t(a,o)) ac,
 (select jsonb_object_agg(e.key, e.value) from jsonb_each(case when jsonb_typeof(h.hole_cards)='object' then h.hole_cards else '{}'::jsonb end) e
   where exists (select 1 from jsonb_array_elements(case when jsonb_typeof(h.showdown)='array' then h.showdown else '[]'::jsonb end) s
     where s->>'user_id' = e.key and coalesce((s->>'mucked')::boolean, false) = false)) hc
from hand_history h
where h.created_at >= '%FROM%' and h.created_at < '%TO%' and h.tournament_id is null and h.game_variant in ('plo4','plo5')`;

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
}

async function pull() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const project = arg('project', 'kuklfnapbkmacvwxktbh');
  const from = new Date(arg('from'));
  const to = new Date(arg('to'));
  const out = resolve(arg('out'));
  mkdirSync(out, { recursive: true });
  for (let t = from; t < to; ) {
    const u = new Date(Math.min(t.getTime() + 2 * 3600e3, to.getTime()));
    const file = join(out, `${t.toISOString().slice(0, 13).replace(/[-:]/g, '')}.json`);
    if (!existsSync(file)) {
      const sql = SQL.replace('%FROM%', t.toISOString()).replace('%TO%', u.toISOString());
      if (!/^\s*select/i.test(sql)) throw new Error('select only');
      const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'readonly-fit',
        },
        body: JSON.stringify({ query: sql, read_only: true }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
      const body = await r.text();
      writeFileSync(file, body);
      console.log(file, body.length);
    }
    t = u;
  }
}

const STREETS = ['preflop', 'flop', 'turn', 'river'];
const NB = { flop: 3, turn: 4, river: 5 };
const FORCED = new Set([
  'sb',
  'bb',
  'ante',
  'post',
  'post_sb',
  'post_bb',
  'blind',
  'small_blind',
  'big_blind',
  'straddle',
  'bomb_ante',
  'return',
]);
const TO = new Set(['bet', 'raise', 'all_in', 'allin']);
const INC = new Set([
  'call',
  'sb',
  'bb',
  'post',
  'post_sb',
  'post_bb',
  'blind',
  'small_blind',
  'big_blind',
  'straddle',
  'ante',
  'bomb_ante',
]);

export function sizeBucket(f) {
  return f < 0.4 ? 'under40' : f < 0.7 ? 'mid' : f <= 1.1 ? 'big' : 'over';
}
export function binOf(p) {
  for (let b = 0; b < BIN_EDGES.length - 1; b++) if (p < BIN_EDGES[b + 1]) return b;
  return BIN_EDGES.length - 2;
}

/** One hand's public decisions, as the action log gives them (the pot and the price from the recorded node). */
function decisionsOf(h) {
  const pl = h.pl ?? [];
  const uidOf = new Map(pl.map((p) => [Number(p[0]), p[1]]));
  const level = { preflop: 0, flop: 0, turn: 0, river: 0 };
  const com = new Map();
  let dead = 0;
  const folded = new Set();
  const out = [];
  const pfRaises = [];
  for (const a of h.ac ?? []) {
    const [seat, stage, act0, amt0, dd, pnPot, pnToCall, auid] = a;
    const act = String(act0 ?? '').toLowerCase();
    if (act.startsWith('rit_board')) return null;
    if (!(stage in level)) continue;
    const amt = Number(amt0 ?? 0);
    const u = auid ?? uidOf.get(Number(seat));
    if (!u) continue;
    const k = `${u}|${stage}`;
    const c = com.get(k) ?? 0;
    if (!FORCED.has(act)) {
      const live = pl.filter((p) => !folded.has(p[1])).length;
      let pot = [...com.values()].reduce((x, y) => x + y, 0) + dead;
      if (pnPot !== null && pnPot !== undefined) pot = Number(pnPot);
      let toCall = Math.max(0, level[stage] - c);
      if (pnToCall !== null && pnToCall !== undefined) toCall = Number(pnToCall);
      const raise =
        act === 'bet' ||
        act === 'raise' ||
        ((act === 'all_in' || act === 'allin') && amt > level[stage] + 1e-9);
      out.push({ u, street: stage, act, amt, pot, toCall, raise, live, streetLevel: level[stage] });
    }
    if (act === 'fold') folded.add(u);
    else if (dd === true || act === 'ante' || act === 'bomb_ante') dead += amt;
    else if (TO.has(act)) {
      if (amt > level[stage] + 1e-9) {
        if (stage === 'preflop') pfRaises.push(u);
        level[stage] = amt;
      }
      com.set(k, Math.max(c, amt));
    } else if (INC.has(act)) {
      com.set(k, c + amt);
      if (c + amt > level[stage]) level[stage] = c + amt;
    }
  }
  return { decisions: out, pfRaises };
}

async function fit() {
  const { scoreOmahaHiPartial } = await import(resolve('src/engine/HorseEval.ts'));
  const { PairSet, countHoldingsWithout } = await import(
    resolve('src/engine/HorseOmahaFacingBetEv.ts')
  );
  const { omahaBetReadCard, omahaBetReadBeatsShare } = await import(
    resolve('src/engine/HorseOmahaBetRead.ts')
  );
  const RANKS = '23456789TJQKA';
  const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
  const DECK = [];
  for (const s of SUITS) for (const r of RANKS) DECK.push({ rank: r, suit: s });
  const ck = (c) => `${c.rank}${c.suit}`;
  const choose = (n, k) => {
    let o = 1;
    for (let i = 1; i <= k; i++) o = (o * (n - k + i)) / i;
    return Math.round(o);
  };
  const memo = new Map();
  /** share of holdings of his size (from the cards unseen to him) that beat his hand */
  function strength(hole, board) {
    const id = hole.map(ck).sort().join() + '|' + board.map(ck).join();
    if (memo.has(id)) return memo.get(id);
    const known = new Set([...hole, ...board].map(ck));
    const unseen = DECK.filter((c) => !known.has(ck(c)));
    const m = unseen.length;
    const mine = scoreOmahaHiPartial(hole, board);
    const bar = new PairSet(m);
    const two = [unseen[0], unseen[0]];
    for (let i = 0; i < m; i++) {
      two[0] = unseen[i];
      for (let j = i + 1; j < m; j++) {
        two[1] = unseen[j];
        if (scoreOmahaHiPartial(two, board) > mine) bar.add(i, j);
      }
    }
    const p = 1 - countHoldingsWithout(m, hole.length, bar) / choose(m, hole.length);
    memo.set(id, p);
    if (memo.size > 200000) memo.clear();
    return p;
  }
  const nbins = BIN_EDGES.length - 1;
  const cells = new Map();
  const cell = (key) => {
    let c = cells.get(key);
    if (!c) {
      c = { hist: new Array(nbins).fill(0), shown: 0, bets: 0, laterFold: 0, value: 0 };
      cells.set(key, c);
    }
    return c;
  };
  const counters = new Map();
  const count = (key, hit) => {
    const c = counters.get(key) ?? { n: 0, k: 0 };
    c.n += 1;
    if (hit) c.k += 1;
    counters.set(key, c);
  };
  const sums = new Map();
  const sum = (key, x) => {
    const c = sums.get(key) ?? { n: 0, s: 0 };
    c.n += 1;
    c.s += x;
    sums.set(key, c);
  };
  let hands = 0;
  let used = 0;
  let from = null;
  let to = null;
  const dir = resolve(arg('in'));
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.json'))
    .sort()) {
    let rows;
    try {
      rows = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const h of rows) {
      hands++;
      if (h.bomb === true || h.cc2 || (Array.isArray(h.rit) && h.rit.length)) continue;
      const board = (h.cc ?? []).map(omahaBetReadCard);
      if (board.length < 3 || board.some((c) => !c)) continue;
      const parsed = decisionsOf(h);
      if (!parsed) continue;
      used++;
      const t = String(h.created_at);
      if (!from || t < from) from = t;
      if (!to || t > to) to = t;
      const v = String(h.gv).toLowerCase();
      const shown = new Map();
      for (const [u, cs] of Object.entries(h.hc ?? {})) {
        const cards = (Array.isArray(cs) ? cs : []).map(omahaBetReadCard);
        if ((cards.length === 4 || cards.length === 5) && cards.every(Boolean)) shown.set(u, cards);
      }
      const { decisions, pfRaises } = parsed;
      const wagered = (u, st) => decisions.some((d) => d.u === u && d.street === st && d.raise);
      const pfa = pfRaises.length ? pfRaises[pfRaises.length - 1] : null;
      for (const st of ['flop', 'turn', 'river']) {
        const nb = NB[st];
        if (board.length < nb) continue;
        const sb = board.slice(0, nb);
        const sd = decisions.filter((d) => d.street === st);
        const i0 = sd.findIndex((d) => d.raise && d.streetLevel === 0);
        if (i0 < 0) continue;
        const bet = sd[i0];
        const size = bet.amt / Math.max(bet.pot, 1e-9);
        const bucket = sizeBucket(size);
        const into = bet.live <= 2 ? 'hu' : 'mw';
        const prev = st === 'flop' ? null : STREETS[STREETS.indexOf(st) - 1];
        const line =
          st === 'flop' ? (pfa === bet.u ? 'agg' : 'non') : wagered(bet.u, prev) ? 'agg' : 'non';
        const bk = `bettor|${v}|${st}|${line}|${bucket}|${into}`;
        const bc = cell(bk);
        bc.bets++;
        const laterFold = decisions.some(
          (d, j) => d.u === bet.u && d.act === 'fold' && decisions.indexOf(bet) < j
        );
        if (laterFold) bc.laterFold++;
        // a showdown happened (somebody's cards are shown), he did not fold and his cards are not shown: he mucked a
        // losing hand, which the shown sample never sees
        else if (shown.size > 0 && !shown.has(bet.u)) bc.laterFold++;
        const hole = shown.get(bet.u);
        if (hole && board.length === 5) {
          const p = strength(hole, sb);
          bc.hist[binOf(p)]++;
          bc.shown++;
          const vs = omahaBetReadBeatsShare(hole, sb);
          if (vs !== null && vs >= 0.8) bc.value++;
        }
        // responders to the first wager, up to the next raise
        let raiser = null;
        const seen = new Set();
        let cont = 0;
        let resp = 0;
        for (let j = i0 + 1; j < sd.length; j++) {
          const d = sd[j];
          if (d.u === bet.u || seen.has(d.u)) break;
          seen.add(d.u);
          resp++;
          const ck2 = `cont|${v}|${st}|${bucket}|${into}`;
          const continued = d.act !== 'fold';
          count(ck2, continued);
          if (continued) cont++;
          if (d.raise) {
            raiser = d;
            break;
          }
          if (d.act === 'call' || d.act === 'all_in' || d.act === 'allin') {
            const ch = shown.get(d.u);
            const cc = cell(`caller|${v}|${st}|${bucket}|${into}`);
            cc.bets++;
            if (ch && board.length === 5) {
              const p = strength(ch, sb);
              cc.hist[binOf(p)]++;
              cc.shown++;
              // a flush draw (two or more cards of the suit two board cards share) where no flush is made yet
              if (st !== 'river') {
                const suitCount = new Map();
                for (const c of sb) suitCount.set(c.suit, (suitCount.get(c.suit) ?? 0) + 1);
                for (const [s, k] of suitCount)
                  if (k === 2) {
                    const mine = ch.filter((c) => c.suit === s).length;
                    count(`fd|${v}|${st}|${binOf(p)}`, mine >= 2);
                  }
              }
            }
          }
        }
        if (into === 'mw' && resp > 0)
          count(`allfold|${v}|${st}|${bucket}|${bet.live - 1 >= 3 ? '3+' : '2'}`, cont === 0);
        if (raiser) {
          const rk = `bettor|${v}|${st}|raise|any|${raiser.live <= 2 ? 'hu' : 'mw'}`;
          const rc = cell(rk);
          rc.bets++;
          const rh = shown.get(raiser.u);
          if (rh && board.length === 5) {
            const p = strength(rh, sb);
            rc.hist[binOf(p)]++;
            rc.shown++;
            const vs = omahaBetReadBeatsShare(rh, sb);
            if (vs !== null && vs >= 0.8) rc.value++;
          }
          if (
            decisions.some(
              (d, j) => d.u === raiser.u && d.act === 'fold' && decisions.indexOf(raiser) < j
            )
          )
            rc.laterFold++;
          else if (shown.size > 0 && !shown.has(raiser.u)) rc.laterFold++;
        }
        // the two-street tree: a heads-up first wager called by one player, no raise; does he fire the next streets
        if (st !== 'river' && into === 'hu' && !raiser && cont === 1) {
          const nxt = STREETS[STREETS.indexOf(st) + 1];
          const nd = decisions.filter((d) => d.street === nxt);
          if (nd.length && board.length >= NB[nxt]) {
            const first = nd.find((d) => d.raise && d.streetLevel === 0);
            const fired = !!first && first.u === bet.u;
            count(`fire|${v}|${nxt}`, fired);
            if (fired) sum(`firesize|${v}|${nxt}`, first.amt / Math.max(first.pot, 1e-9));
          }
        }
      }
    }
  }
  // shrink every histogram toward its parent: (variant, street, line, size, into) -> (variant, street, size, into)
  // -> (variant, street, into) -> (variant, street); bias correction for flop and turn bettor cells
  const norm = (h) => {
    const s = h.reduce((a, b) => a + b, 0);
    return s > 0 ? h.map((x) => x / s) : null;
  };
  const mix = (own, n, parent) => {
    if (!parent) return own;
    if (!own || n <= 0) return parent;
    return own.map((x, i) => (n * x + SHRINK_K * parent[i]) / (n + SHRINK_K));
  };
  const sumOf = (pred) => {
    const h = new Array(nbins).fill(0);
    let n = 0;
    let bets = 0;
    let lf = 0;
    let value = 0;
    for (const [k, c] of cells)
      if (pred(k.split('|'))) {
        c.hist.forEach((x, i) => (h[i] += x));
        n += c.shown;
        bets += c.bets;
        lf += c.laterFold;
        value += c.value;
      }
    return { h, n, bets, lf, value };
  };
  const out = { bettor: {}, caller: {} };
  const corrected = (street, s) => {
    let base = norm(s.h);
    if (!base) return null;
    if (s.bets <= 0) return base;
    const f = Math.max(0, Math.min(0.9, s.lf / s.bets));
    const weak = base.map((x, i) => (BIN_EDGES[i] >= WEAK_EDGE ? x : 0));
    const wn = norm(weak) ?? base.map((_, i) => (i === nbins - 1 ? 1 : 0));
    return base.map((x, i) => (1 - f) * x + f * wn[i]);
  };
  for (const v of ['plo4', 'plo5'])
    for (const st of ['flop', 'turn', 'river']) {
      const top = corrected(
        st,
        sumOf(([kind, vv, s]) => kind === 'bettor' && vv === v && s === st && true)
      );
      for (const into of ['hu', 'mw']) {
        const s2 = sumOf(
          ([kind, vv, s, l, , i]) =>
            kind === 'bettor' && vv === v && s === st && l !== 'raise' && i === into
        );
        const p2 = mix(corrected(st, s2), s2.n, top);
        for (const bucket of ['under40', 'mid', 'big', 'over']) {
          const s3 = sumOf(
            ([kind, vv, s, l, b, i]) =>
              kind === 'bettor' &&
              vv === v &&
              s === st &&
              l !== 'raise' &&
              b === bucket &&
              i === into
          );
          const p3 = mix(corrected(st, s3), s3.n, p2);
          for (const line of ['agg', 'non']) {
            const s4 = sumOf(
              ([kind, vv, s, l, b, i]) =>
                kind === 'bettor' &&
                vv === v &&
                s === st &&
                l === line &&
                b === bucket &&
                i === into
            );
            const p4 = mix(corrected(st, s4), s4.n, p3);
            out.bettor[`${v}|${st}|${line}|${bucket}|${into}`] = {
              hist: p4.map((x) => +x.toFixed(5)),
              shown: s4.n,
              bets: s4.bets,
              laterFold: s4.lf,
              valueShown: s4.value,
            };
          }
        }
        const sr = sumOf(
          ([kind, vv, s, l, , i]) =>
            kind === 'bettor' && vv === v && s === st && l === 'raise' && i === into
        );
        const pr = mix(
          corrected(st, sr),
          sr.n,
          mix(
            norm(
              sumOf(
                ([kind, vv, s, l]) => kind === 'bettor' && vv === v && s === st && l === 'raise'
              ).h
            ),
            sumOf(([kind, vv, s, l]) => kind === 'bettor' && vv === v && s === st && l === 'raise')
              .n,
            null
          ) ?? p2
        );
        out.bettor[`${v}|${st}|raise|any|${into}`] = {
          hist: pr.map((x) => +x.toFixed(5)),
          shown: sr.n,
          bets: sr.bets,
          laterFold: sr.lf,
          valueShown: sr.value,
        };
        const cs = sumOf(
          ([kind, vv, s, , i]) => kind === 'caller' && vv === v && s === st && i === into
        );
        const cp =
          norm(cs.h) ?? norm(sumOf(([kind, vv, s]) => kind === 'caller' && vv === v && s === st).h);
        for (const bucket of ['under40', 'mid', 'big', 'over']) {
          const c4 = sumOf(
            ([kind, vv, s, b, i]) =>
              kind === 'caller' && vv === v && s === st && b === bucket && i === into
          );
          const p = mix(norm(c4.h), c4.n, cp);
          if (p)
            out.caller[`${v}|${st}|${bucket}|${into}`] = {
              hist: p.map((x) => +x.toFixed(5)),
              shown: c4.n,
            };
        }
      }
    }
  const rate = (prefix) => {
    const o = {};
    for (const [k, c] of counters)
      if (k.startsWith(prefix + '|'))
        o[k.slice(prefix.length + 1)] = { n: c.n, rate: +(c.k / c.n).toFixed(4) };
    return o;
  };
  const tables = {
    version: arg('version', 'v1'),
    note: 'Measured by scripts/ops/omaha-facing-bet-range-fit.mjs from PLO4/PLO5 cash hand_history (shown cards only). Strength = share of holdings of his size that beat his hand on that street (0 = the nuts).',
    source: { from, to, handsRead: hands, handsUsed: used },
    binEdges: BIN_EDGES,
    weakEdge: WEAK_EDGE,
    shrinkK: SHRINK_K,
    bettor: out.bettor,
    caller: out.caller,
    continueRate: rate('cont'),
    fieldAllFold: rate('allfold'),
    fire: rate('fire'),
    fireSize: Object.fromEntries(
      [...sums].map(([k, c]) => [
        k.slice('firesize|'.length),
        { n: c.n, mean: +(c.s / c.n).toFixed(4) },
      ])
    ),
    flushDrawByBin: rate('fd'),
  };
  writeFileSync(resolve(arg('out')), JSON.stringify(tables, null, 1) + '\n');
  console.log(`hands ${hands} used ${used} cells ${cells.size} from ${from} to ${to}`);
}

async function calibrate() {
  const ENG = resolve('src/engine');
  const fb = await import(join(ENG, 'HorseOmahaFacingBetEv.ts'));
  const ff = await import(join(ENG, 'HorseOmahaFlopFacingBetEv.ts'));
  const pr = await import(join(ENG, 'HorseOmahaFacingBetPriced.ts'));
  const ft = await import(join(ENG, 'HorseOmahaFlopCallTree.ts'));
  const mr = await import(join(ENG, 'HorseOmahaMeasuredBettorRange.ts'));
  const tablesPath = resolve(arg('tables'));
  const decisions = new Map();
  const ddir = resolve(arg('decisions'));
  for (const f of readdirSync(ddir).filter((x) => x.startsWith('dec-') && x.endsWith('.ndjson')))
    for (const l of readFileSync(join(ddir, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      const r = JSON.parse(l);
      if (!decisions.has(r.k)) decisions.set(r.k, r.action);
    }
  const inPos = (player, gs) => {
    const live = gs.players
      .filter((p) => !p.is_folded && !p.is_sitting_out)
      .map((p) => p.seat)
      .sort((a, b) => a - b);
    const i = live.findIndex((x) => x > gs.dealerSeat);
    const rot = [...live.slice(i < 0 ? 0 : i), ...live.slice(0, i < 0 ? 0 : i)];
    return rot.indexOf(player.seat) === rot.length - 1;
  };
  const cells = new Map();
  const sdir = resolve(arg('states'));
  for (const f of readdirSync(sdir).filter((x) => x.startsWith('states-') && x.endsWith('.ndjson')))
    for (const l of readFileSync(join(sdir, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      const { k, gs, player } = JSON.parse(l);
      const st = gs.stage;
      if (st !== 'flop' && st !== 'turn' && st !== 'river') continue;
      const live = gs.players.filter((p) => !p.is_folded && !p.is_sitting_out).length;
      if (live !== 2) continue;
      const action = decisions.get(k);
      if (!action) continue;
      const spot =
        st === 'flop'
          ? ff.omahaFlopFacingBetEvSpot(player, gs)
          : fb.omahaFacingBetEvSpot(player, gs);
      if (!spot || spot.isRaise) continue;
      const bucket = mr.omahaMeasuredBucketOf(spot.potFrac);
      if (bucket !== 'under40' && bucket !== 'mid') continue;
      const v = String(gs.gameVariant).toLowerCase();
      const key = `${v}|${st}|${bucket}`;
      const tc = Math.max(0, gs.currentBet - player.bet);
      const raised = action === 'raise' || (action === 'all_in' && player.stack > tc + 0.005);
      const line = mr.omahaMeasuredLineOf(gs.actionHistory, st, spot.bettorSeat, false);
      let foldNow;
      if (raised) foldNow = () => false;
      else if (st === 'flop') {
        const bettor = gs.players.find((p) => p.seat === spot.bettorSeat);
        foldNow = () => {
          const r = ft.omahaFlopCallTreeVerdict(
            {
              variant: v,
              spot,
              hole: player.cards,
              board: gs.communityCards,
              dead: [],
              line,
              record: null,
              readFactor: 1,
              rake: 0,
              left: Math.min(player.stack - spot.paid, bettor?.stack ?? Infinity),
              counters: null,
            },
            { minDefence: true, indifference: true, nutShare: false }
          );
          return r ? !r.call : false;
        };
      } else {
        const base = fb.omahaFacingBetEvVerdict(spot, player.cards, gs.communityCards, [], null, {
          rake: 0,
          realization: st === 'turn' ? (inPos(player, gs) ? 0.92 : 0.85) : 1,
        });
        if (!base) continue;
        foldNow = () => {
          const r = pr.omahaPricedFacingVerdict(
            {
              variant: v,
              spot,
              base,
              hole: player.cards,
              board: gs.communityCards,
              dead: [],
              line,
              record: null,
              readFactor: 1,
              rake: 0,
            },
            {
              range: true,
              indifference: true,
              minDefence: true,
              jointField: false,
              nutShare: false,
            }
          );
          return r ? !r.call : false;
        };
      }
      const c = cells.get(key) ?? { states: [] };
      c.states.push({ foldNow, s: spot.potFrac });
      cells.set(key, c);
    }
  const out = {};
  for (const [key, c] of [...cells].sort()) {
    const n = c.states.length;
    if (n < 30) continue;
    const target = c.states.reduce((a, x) => a + x.s / (1 + x.s), 0) / n + 0.05;
    const foldShare = (air) => {
      mr.omahaMeasuredMinDefenceFitSeam(key, air);
      let f = 0;
      for (const x of c.states) if (x.foldNow()) f++;
      return f / n;
    };
    const at0 = foldShare(0);
    let bound = null;
    if (at0 > target) {
      let lo = 0;
      let hi = 0.9;
      const atHi = foldShare(hi);
      if (atHi > target) bound = hi;
      else {
        for (let it = 0; it < 8; it++) {
          const mid = (lo + hi) / 2;
          if (foldShare(mid) > target) lo = mid;
          else hi = mid;
        }
        bound = +hi.toFixed(4);
      }
      console.log(
        `${key} n=${n} target=${target.toFixed(3)} fold@table=${at0.toFixed(3)} fold@0.9=${atHi.toFixed(3)} airBound=${bound} fold@bound=${foldShare(bound).toFixed(3)}`
      );
    } else
      console.log(
        `${key} n=${n} target=${target.toFixed(3)} fold@table=${at0.toFixed(3)} airBound=none`
      );
    mr.omahaMeasuredMinDefenceFitSeam(key, null);
    if (bound !== null) out[key] = bound;
  }
  const t = JSON.parse(readFileSync(tablesPath, 'utf8'));
  t.minDefence = out;
  t.minDefenceNote = `F6 calibration (scripts/ops/omaha-facing-bet-range-fit.mjs calibrate) over the PLO4/PLO5 cash league state set of plo-overfold/abl/states (heads-up first wagers under 0.7 pot; omahaFacingBetIndifferenceCalls on; rake 0; no record): the minimum share of air (weakest bin) at which the whole range folds at most mean s/(1+s) + 0.05; bets of 0.7 pot or more get no bound`;
  writeFileSync(tablesPath, JSON.stringify(t, null, 1) + '\n');
}

const cmd = process.argv[2];
if (cmd === 'pull') await pull();
else if (cmd === 'fit') await fit();
else if (cmd === 'calibrate') await calibrate();
else {
  console.error('usage: pull --from --to --out | fit --in --out --version');
  process.exit(2);
}
