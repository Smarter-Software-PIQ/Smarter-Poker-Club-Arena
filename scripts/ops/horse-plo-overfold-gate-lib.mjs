// scripts/ops/horse-plo-overfold-gate-lib.mjs
// THE OVER-FOLD ALARM, EVERY CELL (2026-11-26 PLO-OWNER lead-7 lane HARDEN; every cell and Hold'em 2026-11-27
// lead-8 lane ALARM). Pure core of horse-plo-overfold-gate.mjs: no I/O here, no hole cards anywhere (it counts
// actions only). The file keeps its first name; it now watches Hold'em too.
//
// WHY. The Horses' over-folding was "fixed" and came back several times, and the first alarm watched only PLO
// heads-up turn and river. The over-folds measured on Nov 19-27 that it did not watch: PLO5 heads-up flop 51.0% vs
// people 31.9%, multiway turn 76.6% vs 47.7%, multiway flop 66.0% vs 47.8%, the same in PLO4, and Hold'em had no
// alarm at all. A leak nobody watches comes back unseen. This watches every cell and says whether the cell's fix
// is ON (then it is a regression) or OFF.
//
// WHAT. Every Horse decision facing a PERSON's first bet of a postflop street (no raise yet), in
//   PLO5 cash, PLO4 cash, the two pooled, Hold'em cash, Hold'em tournaments          (GROUPS)
//   x flop / turn / river x heads-up (two players in) / multiway x bet under 0.4, 0.4-0.7, 0.7+ of the pot,
//   and an "all sizes" row per game, street and players (each decision against the ceiling of its own size cell:
//   a multiway cell holds a handful of decisions a day, and a leak spread over three sizes is seen there first).
// Each cell's fold rate is held against a CEILING, taken in this order and named in every row:
//   1. PEOPLE PRIOR TABLE: server/src/engine/HorseOmahaFacingBetPeoplePrior.data.ts (source 'people-only'; PLO
//      only), where it has the cell with at least PRIOR_MIN_N people decisions.
//      Heads-up: people's measured bluff share b (turn and river under bluff.<street>.hu, the flop under flop.hu
//      once that fit is on main). Per decision: the minimum-defence fold while b is at least the balanced share
//      s/(1+2s) a bluff-catcher's call pays, rising linearly to 1 as b falls to 0 (people who bluff less may be
//      folded to more). This is the ceiling of the first alarm, unchanged.
//      Multiway: the table's measured people fold share of the cell (fold.<street>.mw; turn and river) is SHOWN
//      (the bluff-share price is one caller's break-even, not a per-player ceiling). It never gates: see below.
//   2. PEOPLE'S OWN FOLDS: people's measured fold rate in the same cell over the trailing PEOPLE_DAYS days, with
//      its sample (people only: profiles.is_horse = false and not acting on Horse policy; never a HUD '*' row),
//      at least PEOPLE_MIN_N decisions (bettor: anyone; people almost never face a person's bet). The test
//      carries the people sample's error.
//   3. MINIMUM DEFENCE (the equilibrium anchor): heads-up a bet of s pots profits with any two cards when the
//      fold share is above s/(1+s). Multiway the bet profits only when EVERY remaining opponent folds, so the k
//      players left share that one fold budget: each may fold (s/(1+s))^(1/k) when they share it equally and fold
//      independently (k = players still in besides the decider, i.e. the bettor's remaining opponents). It is a
//      bound on the shared burden, not a solved multiway strategy (the last to act carries more than the first):
//      that is why the two people-measured ceilings come first.
// A cell is tested on the range and on the range pooled with the PREVIOUS_DAYS before it (a 24-hour cell holds
// about 30 decisions; the pooled window is what sees a 15-point drift). It gates when either is above the ceiling
// by z >= correctedZ(GATE_Z, all tests of the run) (one-sided, Bonferroni; horse-audit-multiple-tests.mjs). A cell
// needs MIN_N decisions to be tested (the pooled window also POOLED_MIN_RANGE_N of them inside the range, so the
// previous days never gate alone). The z of the range against the previous days is shown, never gates.
//
// MULTIWAY GATES ON FOLD-THROUGH, NOT ON A PEOPLE FOLD RATE (lead-8, 2026-11-27, from the multiway analysis
// l8-mwfold). People over-call multiway: the Horse calls today's engine folds lost 4.2 bb each over 31 days, so
// "Horses fold more than people" is not a leak there and a people fold rate is not a valid multiway ceiling. The
// multiway decision cells are therefore shown as INFORMATION ONLY and never gate. The multiway signal is the
// FOLD-THROUGH of a person's first bet into a field of Horses (every opponent folds on that street) against the
// pure-bluff break-even s/(1+s): a zero-equity bet profits exactly when the field folds through more often than
// that, whatever anyone holds. Cells: game group x street x 3-way / 4-way+ x size (and all sizes), over the trailing
// FT_DAYS days, n >= FT_MIN_N, z >= correctedZ(FT_GATE_Z, fold-through tests). The same fold-through numbers are
// shown beside every heads-up cell as a second column ("can a pure bluff print"); heads-up still gates on its
// people-measured ceiling.
//
// THE FIX SIGNAL. horse-overfold-owner-map.json names the option that owns each cell. With the option's live state
// (ca_horse_style_switch) a gating cell is one of: over its ceiling WITH ITS FIX ON for the whole tested window (a
// regression: breach-class, listed first), fix ON for part of the window (mixed), fix OFF (expected until the fix
// is switched on), or no owner yet.
import { correctedZ } from './horse-audit-multiple-tests.mjs';

export const GROUPS = Object.freeze([
  { key: 'plo5', label: 'PLO5 cash', gv: ['plo5'], mtt: false, prior: true },
  { key: 'plo4', label: 'PLO4 cash', gv: ['plo4'], mtt: false, prior: true },
  { key: 'plo', label: 'PLO4+PLO5 cash', gv: ['plo4', 'plo5'], mtt: false, prior: true },
  { key: 'nlh-cash', label: "Hold'em cash", gv: ['nlh'], mtt: false, prior: false },
  { key: 'nlh-mtt', label: "Hold'em tournaments", gv: ['nlh'], mtt: true, prior: false },
]);
export const GAMES = Object.freeze(['plo4', 'plo5', 'nlh']);
export const STREETS = Object.freeze(['flop', 'turn', 'river']);
export const FIELDS = Object.freeze([
  { key: 'hu', label: 'heads-up' },
  { key: 'mw', label: 'multiway' },
]);
export const BUCKETS = Object.freeze([
  { key: 'small', label: '<0.4 pot', prior: ['under40'] },
  { key: 'mid', label: '0.4-0.7 pot', prior: ['mid'] },
  { key: 'large', label: '0.7+ pot', prior: ['big', 'over'] },
]);
/** The row that pools the three sizes of a game, street and players (per-decision ceilings of the size cells). */
export const ALL_SIZES = Object.freeze({ key: 'all', label: 'all sizes' });
export const SIZE_ROWS = Object.freeze([...BUCKETS, ALL_SIZES]);
/** One-sided z before the multiple-comparison correction (the exploit report's REGRESSION_Z). */
export const GATE_Z = 3;
/** A cell with fewer decisions in a window is shown, not tested. */
export const MIN_N = 20;
/** A people-prior cell with fewer people bets than this is not used. */
export const PRIOR_MIN_N = 30;
/** People's own folds are a ceiling only with at least this many people decisions in the cell. */
export const PEOPLE_MIN_N = 30;
/** The pooled window is tested only when the range itself has at least this many decisions in the cell. */
export const POOLED_MIN_RANGE_N = 5;
/** Fold-through: the trailing window (it ends where the range ends), the trip and the sample it needs. */
export const FT_DAYS = 7;
export const FT_GATE_Z = 2.5;
export const FT_MIN_N = 60;
/** A first bet over this many pots is left out of the fold-through count (a shove into a dry side pot). */
export const FT_MAX_S = 3;
export const PLAYERS = Object.freeze([
  { key: 'hu', label: 'heads-up', field: 'hu' },
  { key: '3way', label: '3-way', field: 'mw' },
  { key: '4way+', label: '4-way+', field: 'mw' },
]);
/** The comparison window before the range. */
export const PREVIOUS_DAYS = 3;
/** The trailing window people's own folds are measured over (it ends where the range ends). */
export const PEOPLE_DAYS = 14;
/** The prior's source must say this (owner order 2026-11-26: every population stat is measured from people). */
export const PEOPLE_ONLY_SOURCE = 'people-only';
/** Switch states that act with the option true. */
export const ON_STATES = Object.freeze(['on', 'on_shadow']);
/** The order gating cells are listed in: the regression first. */
export const FIX_CLASSES = Object.freeze([
  'fix-on',
  'fix-on-partial',
  'fix-off',
  'fix-unknown',
  'no-owner',
]);

export function bucketOf(s) {
  return s < 0.4 ? 'small' : s < 0.7 ? 'mid' : 'large';
}
export const breakEvenFold = (s) => s / (1 + s);
export const balancedBluff = (s) => s / (1 + 2 * s);
/** The minimum-defence fold of one of k opponents left against a bet of s pots (k = 1: heads-up). */
export function minimumDefenceFold(s, k = 1) {
  const kk = Number.isFinite(k) && k >= 1 ? k : 1;
  return Math.pow(breakEvenFold(s), 1 / kk);
}

/** The fold ceiling of one decision at bet share s with k opponents left; b = people's measured bluff share. */
export function foldCeiling(s, b = null, k = 1) {
  const f = minimumDefenceFold(s, k);
  if (!(typeof b === 'number' && Number.isFinite(b))) return f;
  const bs = balancedBluff(s);
  if (b >= bs) return f;
  return f + (1 - f) * (1 - Math.max(0, b) / bs);
}

/**
 * A cell of the people prior table, or null: people's measured bluff share (kind 'bluff': bluff.<street>.<field>,
 * the flop under flop.<field>) or their measured fold share (kind 'fold': fold.<street>.<field>). field: 'hu' | 'mw'.
 */
export function peoplePriorCell(prior, street, field, bucket, kind = 'bluff') {
  if (!prior || prior.source !== PEOPLE_ONLY_SOURCE) return null;
  const table =
    kind === 'fold'
      ? prior?.fold?.[street]?.[field]
      : street === 'flop'
        ? prior?.flop?.[field]
        : prior?.bluff?.[street]?.[field];
  const keys = BUCKETS.find((x) => x.key === bucket)?.prior ?? [];
  let n = 0;
  let sum = 0;
  for (const k of keys) {
    const c = table?.[k];
    if (c && Number.isFinite(c.n) && c.n > 0 && Number.isFinite(c.share)) {
      n += c.n;
      sum += c.n * c.share;
    }
  }
  return n >= PRIOR_MIN_N ? { n, share: sum / n } : null;
}

/**
 * The spots of one parsed hand (horse-hand-audit-omaha-lib/hand.mjs parseHand; hand.mtt = a tournament hand):
 * a player facing the street's first bet on the flop, turn or river before any raise.
 *   who 'horse'  : a Horse facing a PERSON's bet (a person's seat, not acting on Horse policy): the gated spots;
 *   who 'person' : a person (not acting on Horse policy) facing anyone's bet: people's own folds (ceiling 2).
 * known = the user ids with a profile row (is_horse read, not assumed); null = every seat's flag is trusted.
 * -> [{ handId, t, gv, mtt, street, field, opponents, s, bucket, fold, who }]
 */
export function overfoldSpots(hand, { known = null } = {}) {
  const out = [];
  if (!hand || !GAMES.includes(hand.gv) || hand.bomb || hand.rit) return out;
  const mtt = hand.mtt === true;
  if (mtt && hand.gv !== 'nlh') return out;
  const isKnown = (u) => !known || known.has(u);
  const decs = hand.decisions ?? [];
  for (const d of decs) {
    if (!STREETS.includes(d.street)) continue;
    if (!(d.live >= 2) || d.nStreetRaises !== 1 || !(d.toCall > 0) || !d.facing) continue;
    const me = hand.byUid.get(d.u);
    const bettor = hand.byUid.get(d.facing);
    if (!me || !bettor || d.u === d.facing) continue;
    const bet = decs.find((x) => x.street === d.street && x.firstWager && x.u === d.facing);
    if (!bet || !(bet.pot > 0) || !(bet.amt > 0)) continue;
    const s = bet.amt / bet.pot;
    if (!Number.isFinite(s)) continue;
    let who = null;
    if (me.isHorse === true) {
      if (bettor.isHorse === false && isKnown(bettor.uid) && bet.origin !== 'horse_policy')
        who = 'horse';
    } else if (me.isHorse === false && isKnown(me.uid) && d.origin !== 'horse_policy')
      who = 'person';
    if (!who) continue;
    out.push({
      handId: hand.id,
      t: hand.t,
      gv: hand.gv,
      mtt,
      street: d.street,
      field: d.live === 2 ? 'hu' : 'mw',
      opponents: d.live - 1,
      s,
      bucket: bucketOf(s),
      fold: d.act === 'fold',
      who,
    });
  }
  return out;
}

/**
 * The first bets of one parsed hand made by a PERSON (not on Horse policy) into a field of Horses only, on the
 * flop, turn or river, and whether the field folded through (every opponent folded on that street). Public actions
 * only. -> [{ handId, t, gv, mtt, street, players, opponents, s, bucket, through }]
 */
export function foldThroughBets(hand, { known = null } = {}) {
  const out = [];
  if (!hand || !GAMES.includes(hand.gv) || hand.bomb || hand.rit) return out;
  const mtt = hand.mtt === true;
  if (mtt && hand.gv !== 'nlh') return out;
  const decs = hand.decisions ?? [];
  for (let i = 0; i < decs.length; i++) {
    const d = decs[i];
    if (!STREETS.includes(d.street) || !d.firstWager) continue;
    const bettor = hand.byUid.get(d.u);
    if (!bettor || bettor.isHorse !== false || d.origin === 'horse_policy') continue;
    if (known && !known.has(bettor.uid)) continue;
    const opp = (d.liveUids ?? []).filter((u) => u !== d.u);
    if (!opp.length || !opp.every((u) => hand.byUid.get(u)?.isHorse === true)) continue;
    const s = (d.amt - (d.myCom ?? 0)) / Math.max(1e-9, d.pot);
    if (!(s > 0) || s > FT_MAX_S) continue;
    const rest = decs.slice(i + 1).filter((e) => e.street === d.street);
    const through =
      rest.length > 0 && rest.length >= opp.length && rest.every((e) => e.act === 'fold');
    out.push({
      handId: hand.id,
      t: hand.t,
      gv: hand.gv,
      mtt,
      street: d.street,
      players: opp.length === 1 ? 'hu' : opp.length === 2 ? '3way' : '4way+',
      opponents: opp.length,
      s,
      bucket: bucketOf(s),
      through,
      // bb-weighted value of a zero-equity bluff here (information only): the pot if it folds through, else -bet
      bluffBb: hand.bb > 0 ? (through ? d.pot : -(d.amt - (d.myCom ?? 0))) / hand.bb : null,
    });
  }
  return out;
}

const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '-');
const z2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const arr = (x) => (Array.isArray(x) ? x : []);

/** The owner entry of a cell in the owner map (the option must cover every game of the group), or null. */
export function ownerOf(ownerMap, group, street, field, bucket) {
  const g = GROUPS.find((x) => x.key === group);
  if (!g) return null;
  const games = g.mtt ? g.gv.map((x) => `${x}-mtt`) : g.gv;
  for (const o of arr(ownerMap?.owners))
    if (
      games.every((x) => arr(o.games).includes(x)) &&
      arr(o.streets).includes(street) &&
      arr(o.fields).includes(field) &&
      (bucket === ALL_SIZES.key
        ? BUCKETS.every((b) => arr(o.sizes).includes(b.key))
        : arr(o.sizes).includes(bucket))
    )
      return o;
  return null;
}

/**
 * The live state of a cell's owner option. switches = { <option>: { state, since } } read from
 * ca_horse_style_switch (null = not read). -> { option, state, text, since } or null (no owner).
 */
export function ownerState(ownerMap, owner, switches) {
  if (!owner) return null;
  const option = owner.option;
  if (!switches) return { option, state: 'unknown', text: 'unknown (switch table not read)' };
  const row = switches[option];
  if (row && typeof row.state === 'string') {
    const since = Number.isFinite(Date.parse(row.since)) ? row.since : null;
    return { option, state: row.state, since, text: row.state.toUpperCase() };
  }
  const waiting = ownerMap?.awaitingRegistration?.[option];
  return waiting
    ? { option, state: 'off', text: `OFF (not registered yet: ${waiting})` }
    : { option, state: 'off', text: 'OFF (no switch row: release default)' };
}

/** fix-on only when the option acted for the whole tested window (windowStartMs); see FIX_CLASSES. */
export function fixClassOf(st, windowStartMs) {
  if (!st) return 'no-owner';
  if (st.state === 'unknown') return 'fix-unknown';
  if (ON_STATES.includes(st.state)) {
    const t = st.since ? Date.parse(st.since) : NaN;
    if (Number.isFinite(t) && Number.isFinite(windowStartMs) && t > windowStartMs)
      return 'fix-on-partial';
    return 'fix-on';
  }
  if (st.state === 'canary') return 'fix-on-partial';
  return 'fix-off';
}

/**
 * Folds of spots against the ceiling of each spot's own size cell (specOf(bucket) -> { tier, share | p, n }).
 * -> { n, folds, rate, ceiling, z }. Where the ceiling is people's own rate p (n people decisions), the Horse
 * folds are binomial at p and p carries the people sample's error: the variance adds m^2 p (1 - p) / n for the m
 * decisions held against it.
 */
function measure(spots, specOf) {
  const n = spots.length;
  let folds = 0;
  let e = 0;
  let v = 0;
  const held = new Map();
  for (const x of spots) {
    if (x.fold) folds++;
    const spec = specOf(x.bucket);
    let c;
    if (typeof spec.p === 'number') {
      c = spec.p;
      held.set(x.bucket, (held.get(x.bucket) ?? 0) + 1);
    } else c = foldCeiling(x.s, spec.tier === 'people-prior' ? spec.share : null, x.opponents ?? 1);
    e += c;
    v += c * (1 - c);
  }
  if (!n) return { n, folds, rate: null, ceiling: null, z: null };
  for (const [bucket, m] of held) {
    const spec = specOf(bucket);
    // (folds + 0.5) / (n + 1): a people cell at 0% or 100% still carries an error
    const q = (spec.p * spec.n + 0.5) / (spec.n + 1);
    v += m * q * (1 - q) - m * spec.p * (1 - spec.p) + (m * m * q * (1 - q)) / spec.n;
  }
  return {
    n,
    folds,
    rate: folds / n,
    ceiling: e / n,
    z: v > 0 ? (folds - e) / Math.sqrt(v) : null,
  };
}

/**
 * The cells and the gate.
 *   current / previous : Horse spots (overfoldSpots, who 'horse') of the range and of the PREVIOUS_DAYS before it;
 *   people             : people's spots (who 'person') over the trailing PEOPLE_DAYS;
 *   prior              : the people prior table or null; ownerMap, switches: the fix signal (see ownerState);
 *   sinceMs / previousSinceMs : where the range and the pooled window start (for fix ON "the whole window").
 * -> { cells, tests, zBar, gating, fixOn, exitCode (0 clean, 1 a cell gates, 2 nothing has MIN_N), line, lines }
 */
export function gateCells({
  current = [],
  previous = [],
  people = [],
  prior = null,
  ownerMap = null,
  switches = null,
  bets = [],
  rangeBets = [],
  sinceMs = NaN,
  previousSinceMs = NaN,
  ftSinceMs = NaN,
  z = GATE_Z,
  minN = MIN_N,
}) {
  const horse = (x) => x.who === undefined || x.who === 'horse';
  const cells = [];
  for (const g of GROUPS)
    for (const street of STREETS)
      for (const f of FIELDS) {
        const inField = (x) =>
          g.gv.includes(x.gv) &&
          (x.mtt === true) === g.mtt &&
          x.street === street &&
          (x.field ?? 'hu') === f.key;
        const anchorName =
          f.key === 'hu' ? 'minimum-defence s/(1+s)' : 'minimum-defence (s/(1+s))^(1/k)';
        // the ceiling of each size cell, in order: people prior table, people's own folds, minimum defence
        const specs = {};
        for (const b of BUCKETS) {
          const ppl = people.filter((x) => x.who === 'person' && inField(x) && x.bucket === b.key);
          const pn = ppl.length;
          const pf = ppl.filter((x) => x.fold).length;
          // heads-up: the bluff cell (a price); multiway: the measured fold cell (a rate)
          const kind = f.key === 'hu' ? 'bluff' : 'fold';
          const pc = g.prior ? peoplePriorCell(prior, street, f.key, b.key, kind) : null;
          specs[b.key] = pc
            ? kind === 'bluff'
              ? {
                  tier: 'people-prior',
                  share: pc.share,
                  n: pc.n,
                  source: `people prior table (bluff share ${pct(pc.share)}, n ${pc.n})`,
                }
              : {
                  tier: 'people-prior',
                  p: pc.share,
                  n: pc.n,
                  source: `people prior table (people's fold share ${pct(pc.share)}, n ${pc.n})`,
                }
            : pn >= PEOPLE_MIN_N
              ? {
                  tier: 'people-14d',
                  p: pf / pn,
                  n: pn,
                  source: `people's own folds, trailing ${PEOPLE_DAYS} days (${pct(pf / pn)}, n ${pn})`,
                }
              : {
                  tier: 'minimum-defence',
                  source: `${anchorName} (${g.prior ? 'no people prior cell; ' : ''}people n ${pn} < ${PEOPLE_MIN_N})`,
                };
          specs[b.key].peopleN = pn;
          specs[b.key].peopleRate = pn ? pf / pn : null;
        }
        const specOf = (bucket) => specs[bucket];
        for (const b of SIZE_ROWS) {
          const all = b.key === ALL_SIZES.key;
          const inCell = (x) => inField(x) && (all || x.bucket === b.key);
          const cur = current.filter((x) => horse(x) && inCell(x));
          const prev = previous.filter((x) => horse(x) && inCell(x));
          const m = measure(cur, specOf);
          const pooled = measure([...cur, ...prev], specOf);
          const tiers = all ? [...new Set(BUCKETS.map((x) => specs[x.key].tier))] : null;
          const tierName = {
            'people-prior': 'people prior table',
            'people-14d': "people's own folds",
            'minimum-defence': anchorName,
          };
          const ceilingSource = all
            ? `each decision against its size cell: ${tiers.map((t) => tierName[t]).join(', ')}`
            : specs[b.key].source;
          const pn = all
            ? BUCKETS.reduce((a, x) => a + specs[x.key].peopleN, 0)
            : specs[b.key].peopleN;
          const pRate = all
            ? pn
              ? BUCKETS.reduce(
                  (a, x) => a + specs[x.key].peopleN * (specs[x.key].peopleRate ?? 0),
                  0
                ) / pn
              : null
            : specs[b.key].peopleRate;
          const prevN = prev.length;
          const prevF = prev.filter((x) => x.fold).length;
          const prevRate = prevN ? prevF / prevN : null;
          let zPrevious = null;
          if (m.n && prevN) {
            const pool = (m.folds + prevF) / (m.n + prevN);
            const se = Math.sqrt(pool * (1 - pool) * (1 / m.n + 1 / prevN));
            zPrevious = se > 0 ? (m.rate - prevRate) / se : null;
          }
          const owner = ownerOf(ownerMap, g.key, street, f.key, b.key);
          const st = ownerState(ownerMap, owner, switches);
          cells.push({
            key: `overfold|${g.key}|${street}|${f.key}|${b.key}`,
            group: g.key,
            game: g.label,
            street,
            field: f.key,
            fieldLabel: f.label,
            bucket: b.key,
            size: b.label,
            n: m.n,
            folds: m.folds,
            rate: m.rate,
            ceiling: m.ceiling,
            ceilingTier: all ? tiers.join('+') : specs[b.key].tier,
            ceilingSource,
            peopleN: pn,
            peopleRate: pRate,
            zCeiling: m.z,
            previousN: prevN,
            previousRate: prevRate,
            zPrevious,
            pooledN: pooled.n,
            pooledRate: pooled.rate,
            pooledCeiling: pooled.ceiling,
            zPooled: pooled.z,
            // multiway decision cells are information only: multiway gates on fold-through (see the header)
            infoOnly: f.key !== 'hu',
            tested: f.key === 'hu' && m.n >= minN,
            // the pooled window is a second test only where the previous days add decisions and the range has
            // decisions of its own (the previous days never gate alone)
            testedPooled:
              f.key === 'hu' && prevN > 0 && m.n >= POOLED_MIN_RANGE_N && pooled.n >= minN,
            owner: owner ? owner.option : null,
            ownerState: st
              ? st.text
              : all && BUCKETS.some((x) => ownerOf(ownerMap, g.key, street, f.key, x.key))
                ? 'no single owner (see the size rows)'
                : 'no owner yet',
            ownerSince: st?.since ?? null,
            _st: st,
          });
        }
      }
  const tests = cells.reduce((a, c) => a + (c.tested ? 1 : 0) + (c.testedPooled ? 1 : 0), 0);
  const zBar = correctedZ(z, Math.max(1, tests));
  for (const c of cells) {
    const g24 = c.tested && Number.isFinite(c.zCeiling) && c.zCeiling >= zBar;
    const gPool = c.testedPooled && Number.isFinite(c.zPooled) && c.zPooled >= zBar;
    c.gating = g24 || gPool;
    c.gatingWindow = g24 ? 'range' : gPool ? 'pooled' : null;
    const st = c._st;
    delete c._st;
    c.fixClass = c.gating ? fixClassOf(st, g24 ? sinceMs : previousSinceMs) : null;
    const fix = !c.owner
      ? c.ownerState
      : c.fixClass === 'fix-on'
        ? `WITH ITS FIX ON (${c.owner} ${c.ownerState}${c.ownerSince ? ` since ${c.ownerSince}` : ''}): REGRESSION, breach-class`
        : c.fixClass === 'fix-on-partial'
          ? `its fix ${c.owner} is ${c.ownerState}${c.ownerSince ? ` since ${c.ownerSince}` : ''}, for part of the window (mixed)`
          : `while its fix ${c.owner} is ${c.ownerState}`;
    c.line =
      `Over-fold ${c.game} ${c.street} ${c.fieldLabel} ${c.size} (facing a person's first bet): n ${c.n}, Horse ` +
      `folds ${pct(c.rate)} vs ceiling ${pct(c.ceiling)} (${c.ceilingSource}), z ${z2(c.zCeiling)}; with the ` +
      `previous ${PREVIOUS_DAYS} days n ${c.pooledN}, ${pct(c.pooledRate)} vs ${pct(c.pooledCeiling)}, z ${z2(c.zPooled)}` +
      `${Number.isFinite(c.zPrevious) ? ` (range against previous z ${z2(c.zPrevious)})` : ''}; ` +
      `${c.gating ? `OVER ITS CEILING on the ${c.gatingWindow === 'range' ? 'range' : 'pooled window'}` : c.infoOnly ? 'information only (multiway gates on fold-through), no' : 'against'} ` +
      `bar ${z2(zBar)} (${tests} tests); ${fix}`;
  }
  // FOLD-THROUGH: a person's first bet into Horses against the pure-bluff break-even
  const ft = [];
  for (const g of GROUPS)
    for (const street of STREETS)
      for (const pl of PLAYERS)
        for (const b of SIZE_ROWS) {
          const all = b.key === ALL_SIZES.key;
          const inCell = (x) =>
            g.gv.includes(x.gv) &&
            (x.mtt === true) === g.mtt &&
            x.street === street &&
            x.players === pl.key &&
            (all || x.bucket === b.key);
          const stat = (rows) => {
            let n = 0;
            let through = 0;
            let be = 0;
            let v = 0;
            let ev = 0;
            let nb = 0;
            let sb = 0;
            let sb2 = 0;
            for (const x of rows) {
              if (!inCell(x)) continue;
              n++;
              if (x.through) through++;
              const c = breakEvenFold(x.s);
              be += c;
              v += c * (1 - c);
              ev += x.through ? 1 : -x.s;
              if (Number.isFinite(x.bluffBb)) {
                nb++;
                sb += x.bluffBb;
                sb2 += x.bluffBb * x.bluffBb;
              }
            }
            const mb = nb ? sb / nb : null;
            return {
              n,
              through,
              rate: n ? through / n : null,
              breakEven: n ? be / n : null,
              z: v > 0 ? (through - be) / Math.sqrt(v) : null,
              evPot: n ? ev / n : null,
              evBb: mb,
              evBbSe: nb > 1 ? Math.sqrt(Math.max(0, sb2 / nb - mb * mb) / nb) : null,
            };
          };
          const w = stat(bets);
          const r = stat(rangeBets);
          const owner = pl.field === 'mw' ? ownerOf(ownerMap, g.key, street, 'mw', b.key) : null;
          const st = ownerState(ownerMap, owner, switches);
          ft.push({
            key: `foldthru|${g.key}|${street}|${pl.key}|${b.key}`,
            group: g.key,
            game: g.label,
            street,
            players: pl.key,
            playersLabel: pl.label,
            bucket: b.key,
            size: b.label,
            n: w.n,
            through: w.through,
            rate: w.rate,
            breakEven: w.breakEven,
            z: w.z,
            evPot: w.evPot,
            evBb: w.evBb,
            evBbSe: w.evBbSe,
            rangeN: r.n,
            rangeRate: r.rate,
            // heads-up fold-through is the second column of the heads-up cells: shown, never a gate of its own
            tested: pl.field === 'mw' && w.n >= FT_MIN_N,
            owner: owner ? owner.option : null,
            ownerState: st
              ? st.text
              : all && BUCKETS.some((x) => ownerOf(ownerMap, g.key, street, 'mw', x.key))
                ? 'no single owner (see the size rows)'
                : 'no owner yet',
            ownerSince: st?.since ?? null,
            _st: st,
          });
        }
  const ftTests = ft.filter((c) => c.tested).length;
  const ftZBar = correctedZ(FT_GATE_Z, Math.max(1, ftTests));
  for (const c of ft) {
    c.gating = c.tested && Number.isFinite(c.z) && c.z >= ftZBar;
    const st = c._st;
    delete c._st;
    c.fixClass = c.gating ? fixClassOf(st, ftSinceMs) : null;
    const fix = !c.owner
      ? c.ownerState
      : c.fixClass === 'fix-on'
        ? `WITH ITS FIX ON (${c.owner} ${c.ownerState}${c.ownerSince ? ` since ${c.ownerSince}` : ''}): REGRESSION, breach-class`
        : c.fixClass === 'fix-on-partial'
          ? `its fix ${c.owner} is ${c.ownerState}${c.ownerSince ? ` since ${c.ownerSince}` : ''}, for part of the window (mixed)`
          : `while its fix ${c.owner} is ${c.ownerState}`;
    c.line =
      `Fold-through ${c.game} ${c.street} ${c.playersLabel} ${c.size} (a person's first bet into Horses, everyone ` +
      `folds): n ${c.n} over ${FT_DAYS} days, folded through ${pct(c.rate)} vs the pure-bluff break-even ` +
      `${pct(c.breakEven)}, z ${z2(c.z)} (a zero-equity bet earns ${Number.isFinite(c.evPot) ? c.evPot.toFixed(2) : '-'} pot, ` +
      `${Number.isFinite(c.evBb) ? `${c.evBb.toFixed(2)}${Number.isFinite(c.evBbSe) ? ` +/- ${c.evBbSe.toFixed(2)}` : ''}` : '-'} bb per bet weighted by real pots); ` +
      `in the range n ${c.rangeN}, ${pct(c.rangeRate)}; ` +
      `${c.gating ? 'OVER THE BREAK-EVEN on' : c.tested ? 'against' : 'not tested against'} bar ${z2(ftZBar)} (${ftTests} tests); ${fix}`;
  }
  // the heads-up cells carry their fold-through as a second column
  const ftBy = new Map(ft.map((c) => [`${c.group}|${c.street}|${c.players}|${c.bucket}`, c]));
  for (const c of cells) {
    if (c.field !== 'hu') continue;
    const x = ftBy.get(`${c.group}|${c.street}|hu|${c.bucket}`);
    c.ftN = x?.n ?? 0;
    c.ftRate = x?.rate ?? null;
    c.ftBreakEven = x?.breakEven ?? null;
    c.ftZ = x?.z ?? null;
  }
  const rank = (c) => FIX_CLASSES.indexOf(c.fixClass);
  const strength = (c) => c.zPooled ?? c.z ?? 0;
  const gating = [...cells, ...ft]
    .filter((c) => c.gating)
    .sort((a, b2) => rank(a) - rank(b2) || strength(b2) - strength(a));
  const count = (k) => gating.filter((c) => c.fixClass === k).length;
  const exitCode = gating.length ? 1 : tests + ftTests === 0 ? 2 : 0;
  const head = gating.length
    ? `Over-fold: ${gating.length} cell(s) over their ceiling: ${count('fix-on')} WITH ITS FIX ON (regression, ` +
      `breach-class), ${count('fix-on-partial')} with the fix ON for part of the window, ` +
      `${count('fix-off') + count('fix-unknown')} while the fix is OFF, ${count('no-owner')} with no owner yet ` +
      `(heads-up ${tests} tests, bar z ${z2(zBar)}; multiway fold-through ${ftTests} tests, bar z ${z2(ftZBar)})`
    : tests + ftTests === 0
      ? `Over-fold: no heads-up cell has ${minN} decisions and no multiway fold-through cell has ${FT_MIN_N} bets (too few to test)`
      : `Over-fold: clean (heads-up ${tests} tests, bar z ${z2(zBar)}; multiway fold-through ${ftTests} tests, bar z ${z2(ftZBar)})`;
  return {
    cells,
    foldThrough: ft,
    tests,
    zBar,
    ftTests,
    ftZBar,
    gating: gating.map((c) => c.key),
    fixOn: gating.filter((c) => c.fixClass === 'fix-on').map((c) => c.key),
    exitCode,
    line: head,
    lines: gating.map((c) => c.line),
  };
}

const gateWord = (c) =>
  c.gating
    ? c.fixClass === 'fix-on'
      ? 'OVER, FIX ON (regression)'
      : c.fixClass === 'fix-on-partial'
        ? 'OVER, fix ON part of window'
        : c.fixClass === 'no-owner'
          ? 'OVER, no owner'
          : 'OVER, fix OFF'
    : c.infoOnly
      ? 'information only'
      : c.tested || c.testedPooled
        ? 'clean'
        : `n < ${MIN_N}`;

/** Markdown rows of the cells. all = false leaves out cells with no decision in either window. */
export function cellTable(cells, { all = false } = {}) {
  const L = [
    '| game | street | players | size | n | Horse fold | ceiling | ceiling source | z vs ceiling | previous 3 days (n) | z vs previous | pooled n | pooled fold | pooled z | fold-through 7 days: n, rate vs break-even, z | owner option (state) | gate |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const c of cells ?? []) {
    if (!all && !(c.n > 0) && !(c.previousN > 0)) continue;
    L.push(
      `| ${c.game ?? 'PLO4+PLO5 cash'} | ${c.street} | ${c.fieldLabel ?? 'heads-up'} | ${c.size} | ${c.n} | ${pct(c.rate)} | ${pct(c.ceiling)} | ${c.ceilingSource} | ${z2(c.zCeiling)} | ${pct(c.previousRate)} (${c.previousN ?? 0}) | ${z2(c.zPrevious)} | ${c.pooledN ?? '-'} | ${pct(c.pooledRate)} | ${z2(c.zPooled)} | ${c.field === 'mw' ? 'see the fold-through table' : c.ftN ? `${c.ftN}, ${pct(c.ftRate)} vs ${pct(c.ftBreakEven)}, ${z2(c.ftZ)}` : '-'} | ${c.owner ? `${c.owner} (${c.ownerState})` : (c.ownerState ?? 'no owner yet')} | ${gateWord(c)} |`
    );
  }
  return L;
}

const ftWord = (c) =>
  c.gating
    ? c.fixClass === 'fix-on'
      ? 'OVER, FIX ON (regression)'
      : c.fixClass === 'fix-on-partial'
        ? 'OVER, fix ON part of window'
        : c.fixClass === 'no-owner'
          ? 'OVER, no owner'
          : 'OVER, fix OFF'
    : c.players === 'hu'
      ? 'shown with the heads-up cell'
      : c.tested
        ? 'clean'
        : `n < ${FT_MIN_N}`;

/** Markdown rows of the multiway fold-through cells (all = true: heads-up and empty cells too). */
export function foldThroughTable(ft, { all = false } = {}) {
  const L = [
    '| game | street | players | size | bets (7 days) | folded through | pure-bluff break-even | z | zero-equity bet earns (pot) | zero-equity bet earns (bb per bet, real pots) | in the range (n) | owner option (state) | gate |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const c of ft ?? []) {
    if (!all && (c.players === 'hu' || !(c.n > 0))) continue;
    L.push(
      `| ${c.game} | ${c.street} | ${c.playersLabel} | ${c.size} | ${c.n} | ${pct(c.rate)} | ${pct(c.breakEven)} | ${z2(c.z)} | ${Number.isFinite(c.evPot) ? c.evPot.toFixed(2) : '-'} | ${Number.isFinite(c.evBb) ? `${c.evBb.toFixed(2)}${Number.isFinite(c.evBbSe) ? ` +/- ${c.evBbSe.toFixed(2)}` : ''}` : '-'} | ${pct(c.rangeRate)} (${c.rangeN}) | ${c.owner ? `${c.owner} (${c.ownerState})` : c.ownerState} | ${ftWord(c)} |`
    );
  }
  return L;
}
