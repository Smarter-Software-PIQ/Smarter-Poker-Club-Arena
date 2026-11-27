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
 *           (0.8 <= p < 0.9) (the three together: the top fifth), mid (0.5 <= p < 0.8), bottom (p < 0.5)
 *   mucked  he reached the showdown and did not show (he lost it): counted mid (a hand that went to showdown; the
 *           conservative class: it is never counted as air)
 *   a bet that won without a showdown is not counted (its cards are unknown: it keeps the shown mix)
 * Cells (counts [nut, strong, good, mid, bottom]):  river|<fmt>|<size>|<line>|<pot>  and every coarser cell with 'all' in a place;
 *   fmt  cash (tournament_id null) | any (cash and tournaments)
 *   size a<40 | b40-70 | c70-110 | d>110 per cent of the pot before the bet
 *   line b: the bettor made the last bet or raise of the turn; c: the other player did; x: the turn was checked through
 *   pot  limped (no preflop raise) | single (one) | reraised (two or more)
 * And PEOPLE's rate of betting when no bet is to be faced postflop, the engine's own counter definition
 * (HorseOpponentExploit betCheckedTo / betCheckedToOpp: every non-fold action on a postflop street before its first
 * wager is an opportunity, a wager is a bet), NLH cash, with the between-player prior strength (beta-binomial method
 * of moments on people with at least 30 opportunities). And PEOPLE's rate of making the first wager on an unopened
 * heads-up river (riverUnopenedOf; people with at least 10 opportunities for the prior strength).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
/** Region floors, strongest first: nut [0.95, 1], strong [0.9, 0.95), good [0.8, 0.9), mid [0.5, 0.8), bottom below. */
export const REGION_FROM = [0.95, 0.9, 0.8, 0.5, 0];
export const MID_REGION = 3;
export const regionOf = (p) => REGION_FROM.findIndex((from) => p >= from);

/** The share of every other two-card holding on this five-card board that the holding (a, b) beats, ties half. */
export function percentileOnBoard(board, a, b) {
  const used = new Uint8Array(52);
  for (const c of board) used[c] = 1;
  const cards = new Int8Array(7);
  for (let i = 0; i < 5; i++) cards[i] = board[i];
  cards[5] = a;
  cards[6] = b;
  const v = evalCards(cards, 7);
  let lo = 0;
  let eq = 0;
  let tot = 0;
  for (let k = 0; k < NC; k++) {
    const x = COMBO_A[k];
    const y = COMBO_B[k];
    if (used[x] || used[y] || x === a || x === b || y === a || y === b) continue;
    cards[5] = x;
    cards[6] = y;
    const w = evalCards(cards, 7);
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
  } else if (sd && sd.mucked) region = MID_REGION;
  return {
    uid: seat.uid,
    fmt: H.fmt === 'cash' ? 'cash' : 'tour',
    size: sizeOf(d.inc / d.P),
    line,
    pot,
    region,
  };
}

/** People's (bets, opportunities) of the engine's betCheckedTo counter in one NLH cash hand, per person. */
export function checkedToOf(H, into) {
  let street = null;
  let wagered = false;
  for (const d of H.decisions) {
    if (d.street === 'preflop') continue;
    if (d.street !== street) {
      street = d.street;
      wagered = false;
    }
    const aggr = d.kind === 'bet' || d.kind === 'raise';
    if (!wagered && d.kind !== 'fold') {
      const seat = H.seats.get(d.seat);
      if (seat && !seat.horse && d.origin !== 'horse_policy') {
        const r = into.get(seat.uid) ?? { bets: 0, opps: 0 };
        r.opps++;
        if (aggr) r.bets++;
        into.set(seat.uid, r);
      }
    }
    if (aggr) wagered = true;
  }
}

/**
 * People's (first wagers, opportunities) on an UNOPENED heads-up river in one NLH cash hand, per person: every check or
 * wager made on the river before its first wager, two players live, is an opportunity; a wager is a first wager
 * (OPPONENT-HUD's x.stab + x.lead river heads-up cells; the fixed grading harness counts the same).
 */
export function riverUnopenedOf(H, into) {
  let wagered = false;
  for (const d of H.decisions) {
    if (d.street !== 'river' || wagered) continue;
    const aggr = d.kind === 'bet' || d.kind === 'raise';
    if (d.opp.length === 1 && (d.kind === 'check' || aggr)) {
      const seat = H.seats.get(d.seat);
      if (seat && !seat.horse && d.origin !== 'horse_policy') {
        const r = into.get(seat.uid) ?? { bets: 0, opps: 0 };
        r.opps++;
        if (aggr) r.bets++;
        into.set(seat.uid, r);
      }
    }
    if (aggr) wagered = true;
  }
}

/** Pooled rate and the between-player prior strength (beta-binomial method of moments, people with >= minOpps). */
function rateOf(per, minOpps) {
  let bets = 0;
  let opps = 0;
  const rated = [];
  for (const r of per.values()) {
    bets += r.bets;
    opps += r.opps;
    if (r.opps >= minOpps) rated.push(r);
  }
  // between-player variance of the rate less the mean binomial variance
  let k = null;
  if (rated.length >= 5) {
    const pm = rated.reduce((s, r) => s + r.bets / r.opps, 0) / rated.length;
    const v = rated.reduce((s, r) => s + (r.bets / r.opps - pm) ** 2, 0) / (rated.length - 1);
    const within = rated.reduce((s, r) => s + (pm * (1 - pm)) / r.opps, 0) / rated.length;
    const tau2 = v - within;
    k = tau2 > 0 ? (pm * (1 - pm)) / tau2 - 1 : null;
  }
  return {
    bets,
    opps,
    rate: +(opps > 0 ? bets / opps : 0).toFixed(4),
    people: per.size,
    ratedPeople: rated.length,
    priorStrength: k === null ? null : +k.toFixed(1),
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
    const c = (cells[key] ??= [0, 0, 0, 0, 0]);
    c[region]++;
  };
  const seen = new Set();
  const per = new Map();
  const perRiver = new Map();
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
          checkedToOf(H, per);
          riverUnopenedOf(H, perRiver);
        }
        const r = riverFirstBetOf(H);
        if (!r || r.region === null) continue;
        used++;
        bettors.add(r.uid);
        if (!H.shown.get(r.uid)) mucked++;
        for (const fmt of r.fmt === 'cash' ? ['cash', 'any'] : ['any'])
          for (const size of [r.size, 'all'])
            for (const ln of [r.line, 'all'])
              for (const pt of [r.pot, 'all']) add(`river|${fmt}|${size}|${ln}|${pt}`, r.region);
      }
  const sorted = {};
  for (const key of Object.keys(cells).sort()) sorted[key] = cells[key];
  const out = {
    version: arg('version', 'unversioned'),
    note: "People-only FIRST bets of a heads-up NLH river (the bettor a person; shown cards only), by where the bettor's hand stood among every other holding on that board: [nut (p >= 0.95), strong (0.9 <= p < 0.95), good (0.8 <= p < 0.9), mid (0.5 <= p < 0.8; a hand mucked at showdown counts here), bottom (p < 0.5)]. Key river|fmt|size|line|pot ('all' = pooled). checkedTo: people's NLH cash rate of betting when no bet is to be faced postflop (the engine's betCheckedTo counter definition). riverUnopened: people's NLH cash rate of making the first wager on an unopened heads-up river (OPPONENT-HUD x.stab + x.lead). scripts/ops/holdem-people-facing-bet-prior-fit.mjs.",
    source: {
      from,
      to,
      handsRead: hands,
      cashHands: cash,
      betsUsed: used,
      muckedAtShowdown: mucked,
      bettors: bettors.size,
    },
    regions: { from: REGION_FROM, top: 3, mid: MID_REGION },
    sizes: { 'a<40': [0, 0.4], 'b40-70': [0.4, 0.7], 'c70-110': [0.7, 1.1], 'd>110': [1.1, null] },
    checkedTo: rateOf(per, 30),
    riverUnopened: rateOf(perRiver, 10),
    cells: sorted,
  };
  writeFileSync(arg('out'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ ...out, cells: Object.keys(sorted).length }, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) main();
