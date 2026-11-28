#!/usr/bin/env node
/**
 * NLH HEADS-UP RIVER FIRST BETS BY PEOPLE: WHAT THE BET WAS, MEASURED (PLO-OWNER lead-9 lane nlof, 2026-11-27; owner
 * orders "the stats need to be used against human players, not horses" and "all overfolding fixes for PLO4, PLO5 and
 * No Limit"). Feeds server/src/engine/HorseHoldemFacingBetPeoplePriorTables.json (HorseHoldemFacingBetPeoplePrior.ts,
 * option holdemRiverFacingBetPriorIsPeopleMeasured).
 *
 *   fit --in <dir[,dir...]> --out <tables.json> --version <label>
 *
 * Input: folders of *.ndjson.gz chunks of the Hold'em hand audit's own SELECT (horse-hand-audit-holdem-lib.mjs
 * buildHandsSql, peopleOnly, mode all): public actions, and hole cards ONLY of hands shown at showdown (mucked = false).
 * No unshown card is read anywhere.
 *
 * One row per FIRST bet of a heads-up river made by a PERSON (profiles.is_horse false and the action not a Horse
 * policy action); the player answering may be a person or a Horse. A bet by a Horse never enters a cell.
 *   shown   his cards were shown: the bet is placed by the percentile p of his hand among every other two-card
 *           holding on that board (share it beats, ties half): nut (p >= 0.95), strong (0.9 <= p < 0.95), good
 *           (0.8 <= p < 0.9) (the three together: the top fifth), upper middle (0.7 <= p < 0.8), lower middle
 *           (0.5 <= p < 0.7), bottom (p < 0.5). The middle is cut in two because people's river bets from it are not
 *           spread evenly (355 shown bets, all formats: 30 in [0.7, 0.8), 31 in [0.5, 0.7), a band twice as wide)
 *   mucked  he reached the showdown and did not show (he lost it): counted lower middle (a hand that went to
 *           showdown; the conservative class: it is never counted as air)
 *   a bet that won without a showdown is not counted (its cards are unknown: it keeps the shown mix)
 * Cells (counts [nut, strong, good, upper middle, lower middle, bottom]):  river|<fmt>|<size>|<line>|<pot>  and every coarser cell with 'all' in a place;
 *   fmt  cash (tournament_id null) | any (cash and tournaments)
 *   size a<40 | b40-70 | c70-110 | d>110 per cent of the pot before the bet
 *   line b: the bettor made the last bet or raise of the turn; c: the other player did; x: the turn was checked through
 *   pot  limped (no preflop raise) | single (one) | reraised (two or more)
 * TURN cells (turn|<fmt>|<size>|<line>|<pot>, turnFirstBetOf): the same count for the FIRST bet of a heads-up turn, the
 * region taken on the four-card board, the line taken from the flop, and the hidden bets counted (mucked at the
 * showdown: lower middle; given up, he checked the river and folded to a bet: bottom). Feeds
 * a turn facing-bet piece (the turn's first bet after a checked-through flop) that is NOT shipped: graded 2026-11-27
 * it failed its delayed-stab bluffer bar; nothing reads the turn cells.
 * And how much one person's river bets differ from another's (ownShown): the between-bettor prior strength of the
 * not-top share of a person's shown river first bets, every format (one-way analysis of variance intraclass
 * correlation rho over bettors; strength = (1 - rho) / rho pseudo-bets): the weight people's cell keeps against a
 * bettor's own shown river bets (HorseHoldemBetRead).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseHand } from './horse-hand-audit-holdem-lib.mjs';
import { COMBO_A, COMBO_B, NC, evalCards } from './horse-hand-audit-holdem-eval.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
export const sizeOf = (f) =>
  f < 0.4 ? 'a<40' : f < 0.7 ? 'b40-70' : f <= 1.1 ? 'c70-110' : 'd>110';
/** Region floors, strongest first: nut [0.95, 1], strong [0.9, 0.95), good [0.8, 0.9), upper middle [0.7, 0.8),
 *  lower middle [0.5, 0.7), bottom below. */
export const REGION_FROM = [0.95, 0.9, 0.8, 0.7, 0.5, 0];
export const TOP_REGIONS = 3;
/** A hand mucked at the showdown is counted here (lower middle). */
export const MUCKED_REGION = 4;
export const regionOf = (p) => REGION_FROM.findIndex((from) => p >= from);

/** The share of every other two-card holding on this board (four or five cards) that the holding (a, b) beats as
 *  the hands stand, ties half. */
export function percentileOnBoard(board, a, b) {
  const used = new Uint8Array(52);
  for (const c of board) used[c] = 1;
  const nb = board.length;
  const cards = new Int8Array(7);
  for (let i = 0; i < nb; i++) cards[i] = board[i];
  cards[nb] = a;
  cards[nb + 1] = b;
  const v = evalCards(cards, nb + 2);
  let lo = 0;
  let eq = 0;
  let tot = 0;
  for (let k = 0; k < NC; k++) {
    const x = COMBO_A[k];
    const y = COMBO_B[k];
    if (used[x] || used[y] || x === a || x === b || y === a || y === b) continue;
    cards[nb] = x;
    cards[nb + 1] = y;
    const w = evalCards(cards, nb + 2);
    tot++;
    if (w < v) lo++;
    else if (w === v) eq++;
  }
  return (lo + eq / 2) / tot;
}

/** The river first-bet row of one parsed hand, or null: { uid, fmt, size, line, pot, region } (region null: not counted). */
export function riverFirstBetOf(H) {
  const ds = H.decisions;
  const i = ds.findIndex((d) => d.street === 'river' && (d.kind === 'bet' || d.kind === 'raise'));
  if (i < 0) return null;
  const d = ds[i];
  if (d.kind !== 'bet' || d.opp.length !== 1 || !(d.P > 0) || !(d.inc > 0)) return null;
  const seat = H.seats.get(d.seat);
  if (!seat || seat.horse || d.origin === 'horse_policy') return null;
  const wagers = (st) =>
    ds.filter((e) => e.street === st && (e.kind === 'bet' || e.kind === 'raise'));
  const turn = wagers('turn');
  const line = turn.length === 0 ? 'x' : turn[turn.length - 1].seat === d.seat ? 'b' : 'c';
  const pre = wagers('preflop').length;
  const pot = pre === 0 ? 'limped' : pre === 1 ? 'single' : 'reraised';
  const shown = H.shown.get(seat.uid);
  const sd = H.sd.get(d.seat);
  let region = null;
  if (shown && H.board.length === 5) {
    const p = percentileOnBoard(H.board, shown[0], shown[1]);
    region = regionOf(p);
  } else if (sd && sd.mucked) region = MUCKED_REGION;
  return {
    uid: seat.uid,
    fmt: H.fmt === 'cash' ? 'cash' : 'tour',
    size: sizeOf(d.inc / d.P),
    line,
    pot,
    region,
  };
}

/**
 * The turn first-bet row of one parsed hand, or null: the FIRST bet of a heads-up turn made by a PERSON, with his line
 * on the flop (x: the flop was checked through; b: he made its last wager; c: the other player did). The region is
 * where his hand stood ON THE TURN (the four-card board) when his cards were shown. A turn bet is also counted when
 * its cards were never seen but the public record says it was not value (the hidden bets; the shown sample alone
 * over-states value, as the Omaha fit found): he reached the showdown and mucked (lower middle), or he gave the hand
 * up (he checked the river and then folded to a bet: bottom). A fold to a raise of his own bet is NOT counted (his
 * hand is unknown), and neither is a bet that won without a showdown.
 */
export function turnFirstBetOf(H) {
  const ds = H.decisions;
  const i = ds.findIndex((d) => d.street === 'turn' && (d.kind === 'bet' || d.kind === 'raise'));
  if (i < 0) return null;
  const d = ds[i];
  if (d.kind !== 'bet' || d.opp.length !== 1 || !(d.P > 0) || !(d.inc > 0)) return null;
  const seat = H.seats.get(d.seat);
  if (!seat || seat.horse || d.origin === 'horse_policy') return null;
  const wagers = (st) =>
    ds.filter((e) => e.street === st && (e.kind === 'bet' || e.kind === 'raise'));
  const flop = wagers('flop');
  const line = flop.length === 0 ? 'x' : flop[flop.length - 1].seat === d.seat ? 'b' : 'c';
  const pre = wagers('preflop').length;
  const pot = pre === 0 ? 'limped' : pre === 1 ? 'single' : 'reraised';
  const shown = H.shown.get(seat.uid);
  const sd = H.sd.get(d.seat);
  let region = null;
  let hidden = null;
  if (shown && H.board.length >= 4) {
    region = regionOf(percentileOnBoard(H.board.slice(0, 4), shown[0], shown[1]));
  } else if (sd && sd.mucked) {
    region = MUCKED_REGION;
    hidden = 'mucked';
  } else {
    // a give-up: nobody raised his turn bet, he checked the river and then folded to a bet
    const raised = ds.some(
      (e, j) => j > i && e.street === 'turn' && e.seat !== d.seat && e.kind === 'raise'
    );
    const river = ds.filter((e) => e.street === 'river' && e.seat === d.seat);
    if (!raised && river.length >= 2 && river[0].kind === 'check' && river[1].kind === 'fold') {
      region = REGION_FROM.length - 1;
      hidden = 'gaveUp';
    }
  }
  return {
    uid: seat.uid,
    fmt: H.fmt === 'cash' ? 'cash' : 'tour',
    size: sizeOf(d.inc / d.P),
    line,
    pot,
    region,
    hidden,
  };
}

/**
 * The between-bettor prior strength of the not-top share: `per` maps a bettor to [bets not top, bets]. One-way
 * analysis of variance intraclass correlation; null when it is not positive.
 */
export function shownStrengthOf(per) {
  const g = [...per.values()].filter((r) => r[1] > 0);
  const k = g.length;
  const N = g.reduce((s, r) => s + r[1], 0);
  if (k < 5 || N <= k) return { bettors: k, bets: N, notTop: null, priorStrength: null };
  const p = g.reduce((s, r) => s + r[0], 0) / N;
  const n0 = (N - g.reduce((s, r) => s + r[1] * r[1], 0) / N) / (k - 1);
  const msb = g.reduce((s, r) => s + r[1] * (r[0] / r[1] - p) ** 2, 0) / (k - 1);
  const msw = g.reduce((s, r) => s + r[0] * (1 - r[0] / r[1]), 0) / (N - k);
  const rho = (msb - msw) / (msb + (n0 - 1) * msw);
  return {
    bettors: k,
    bets: N,
    notTop: +p.toFixed(4),
    priorStrength: rho > 0 ? +((1 - rho) / rho).toFixed(1) : null,
  };
}

function main() {
  if (argv[0] !== 'fit') {
    console.error('usage: fit --in <dir[,dir]> --out <tables.json> --version <label>');
    process.exit(64);
  }
  const dirs = String(arg('in', '')).split(',').filter(Boolean);
  const cells = {};
  const add = (key, region) => {
    const c = (cells[key] ??= REGION_FROM.map(() => 0));
    c[region]++;
  };
  const seen = new Set();
  const perShown = new Map();
  const perTurn = new Map();
  const turn = { betsUsed: 0, shown: 0, mucked: 0, gaveUp: 0 };
  const turnBettors = new Set();
  let hands = 0;
  let cash = 0;
  let from = null;
  let to = null;
  let used = 0;
  let mucked = 0;
  const bettors = new Set();
  for (const dir of dirs)
    for (const f of readdirSync(dir)
      .filter((x) => x.endsWith('.ndjson.gz'))
      .sort())
      for (const line of gunzipSync(readFileSync(`${dir}/${f}`))
        .toString('utf8')
        .split('\n')) {
        if (!line.trim()) continue;
        let H;
        try {
          H = parseHand(JSON.parse(line));
        } catch {
          continue;
        }
        if (!H || seen.has(H.id)) continue;
        seen.add(H.id);
        hands++;
        const ts = new Date(H.ts).toISOString();
        if (from === null || ts < from) from = ts;
        if (to === null || ts > to) to = ts;
        if (H.fmt === 'cash') {
          cash++;
        }
        const t = turnFirstBetOf(H);
        if (t && t.region !== null) {
          turn.betsUsed++;
          turn[t.hidden ?? 'shown']++;
          turnBettors.add(t.uid);
          if (t.line === 'x') {
            const pt = perTurn.get(t.uid) ?? [0, 0];
            pt[1]++;
            if (t.region >= TOP_REGIONS) pt[0]++;
            perTurn.set(t.uid, pt);
          }
          for (const fmt of t.fmt === 'cash' ? ['cash', 'any'] : ['any'])
            for (const size of [t.size, 'all'])
              for (const ln of [t.line, 'all'])
                for (const pt of [t.pot, 'all']) add(`turn|${fmt}|${size}|${ln}|${pt}`, t.region);
        }
        const r = riverFirstBetOf(H);
        if (!r || r.region === null) continue;
        used++;
        bettors.add(r.uid);
        if (!H.shown.get(r.uid)) mucked++;
        const ps = perShown.get(r.uid) ?? [0, 0];
        ps[1]++;
        if (r.region >= TOP_REGIONS) ps[0]++;
        perShown.set(r.uid, ps);
        for (const fmt of r.fmt === 'cash' ? ['cash', 'any'] : ['any'])
          for (const size of [r.size, 'all'])
            for (const ln of [r.line, 'all'])
              for (const pt of [r.pot, 'all']) add(`river|${fmt}|${size}|${ln}|${pt}`, r.region);
      }
  const sorted = {};
  for (const key of Object.keys(cells).sort()) sorted[key] = cells[key];
  const out = {
    version: arg('version', 'unversioned'),
    note: "People-only FIRST bets of a heads-up NLH river (the bettor a person; shown cards only), by where the bettor's hand stood among every other holding on that board: [nut (p >= 0.95), strong (0.9 <= p < 0.95), good (0.8 <= p < 0.9), upper middle (0.7 <= p < 0.8), lower middle (0.5 <= p < 0.7; a hand mucked at showdown counts here), bottom (p < 0.5)]. Key river|fmt|size|line|pot ('all' = pooled). ownShown: the between-bettor prior strength of the not-top share of a person's shown river first bets (pseudo-bets people's cell keeps against a bettor's own shown river bets). Key turn|fmt|size|line|pot: people's FIRST bets of a heads-up turn by where the hand stood on the four-card board (line x: the flop was checked through; b: he made the flop's last wager; c: the other player did), shown cards, plus the hidden bets the public record marks as not value: mucked at the showdown (lower middle) and given up (he checked the river and folded to a bet: bottom); ownShownTurn: the same prior strength for a person's turn bets after a checked flop. scripts/ops/holdem-people-facing-bet-prior-fit.mjs.",
    source: {
      from,
      to,
      handsRead: hands,
      cashHands: cash,
      betsUsed: used,
      muckedAtShowdown: mucked,
      bettors: bettors.size,
    },
    regions: { from: REGION_FROM, top: TOP_REGIONS, mucked: MUCKED_REGION },
    sizes: { 'a<40': [0, 0.4], 'b40-70': [0.4, 0.7], 'c70-110': [0.7, 1.1], 'd>110': [1.1, null] },
    ownShown: shownStrengthOf(perShown),
    turn: { ...turn, bettors: turnBettors.size },
    ownShownTurn: shownStrengthOf(perTurn),
    cells: sorted,
  };
  writeFileSync(arg('out'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ ...out, cells: Object.keys(sorted).length }, null, 1));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
