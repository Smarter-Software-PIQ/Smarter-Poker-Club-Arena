// scripts/ops/horse-overfold-scoreboard-lib.mjs
// THE LIVE OVER-FOLD SCOREBOARD (2026-11-27 lead-8 over-fold wave 4, lane OFF). Pure core of
// horse-overfold-scoreboard.mjs: no I/O here, no hole cards anywhere (it counts public actions only).
//
// WHY. The over-fold alarm (horse-plo-overfold-gate.mjs, #12192) gates Horse folds facing a PERSON's FIRST bet of a
// street, table and Lightning pooled. Since the over-fold fixes went ON (omahaFacingBetPriorIsPeopleMeasured
// 2026-11-27 08:39Z, omahaFlopPressureCapIsPriced PLO5 18:13Z, PLO4 by runtime settings v15 18:28Z) almost no
// person has played PLO cash, so the alarm has nothing to read, and it never looked at raises, check-raises, the
// big-bet split or Lightning on its own. This board shows, on the hands the SERVING build actually dealt, what the
// Horses fold in every cell: facing a person (the headline, when people play) and facing a Horse (information:
// whether a pure bluff would print against today's engine).
//
// WHAT. Every Horse decision on the flop, turn or river that faces aggression (chips to call), by
//   game (PLO5, PLO4) x table / Lightning x street x heads-up / 3-way / 4-way+ x what it faces:
//   a bet (the street's first bet) of <0.4, 0.4-0.7, 0.7-1.1, 1.1+ pot, a raise, or a check-raise
//   x the bettor: a person or a Horse. In and out of position are shown as columns.
// The size of the faced aggression is s = the aggressor's added chips / the pot before his action, so a raise is
// priced exactly like a bet: a zero-equity raise of s pots profits when the field folds more than s/(1+s).
// Each cell holds its fold share against
//   (a) BREAK-EVEN: per decision s/(1+s) heads-up; multiway the minimum-defence share of one of the k opponents
//       left (s/(1+s))^(1/k) (the alarm's anchor; multiway the field's FOLD-THROUGH is the sharper test, below);
//   (b) the PEOPLE CEILING: facing a person's first bet heads-up the people prior table (the alarm's first ceiling,
//       foldCeiling with people's measured bluff share); otherwise people's OWN fold share in the same cell over the
//       trailing PEOPLE_DAYS days (people deciders only: profiles.is_horse = false, profile found, not on Horse
//       policy; never a HUD row), at least PEOPLE_MIN_N decisions, its sample error carried in the z.
// A cell with MIN_N decisions is flagged OVER at z >= FLAG_Z (2 SE) against either. It GATES only when the bettor
// is a person and the z clears the multiple-comparison bar correctedZ(FLAG_Z, person tests): Horse-bettor cells
// are information (the people ceiling is about people's ranges, not a Horse's).
// FOLD-THROUGH: every bet or raise into a field of Horses only, by the same cells: did every opponent fold on that
// street, against s/(1+s), with the bb value of a zero-equity bluff there (information).
// THE FIX SIGNAL is the alarm's: horse-overfold-owner-map.json + the live switch rows; a person cell over with its
// owner's fix ON for the whole range is BREACH-CLASS. Raises and check-raises have no owner (the map covers first
// bets); 0.7-1.1 and 1.1+ map to the map's "large".
import { correctedZ } from './horse-audit-multiple-tests.mjs';
import {
  fixClassOf,
  foldCeiling,
  minimumDefenceFold,
  ownerOf,
  ownerState,
  peoplePriorCell,
} from './horse-plo-overfold-gate-lib.mjs';

export const SB_GAMES = Object.freeze([
  { key: 'plo5', label: 'PLO5' },
  { key: 'plo4', label: 'PLO4' },
]);
export const SB_STREETS = Object.freeze(['flop', 'turn', 'river']);
export const VENUES = Object.freeze([
  { key: 'table', label: 'table' },
  { key: 'lightning', label: 'Lightning' },
]);
export const SB_PLAYERS = Object.freeze([
  { key: 'hu', label: 'heads-up' },
  { key: '3way', label: '3-way' },
  { key: '4way+', label: '4-way+' },
]);
export const FACING = Object.freeze([
  { key: 'b<0.4', label: 'bet <0.4 pot', kind: 'bet', owner: 'small' },
  { key: 'b0.4-0.7', label: 'bet 0.4-0.7 pot', kind: 'bet', owner: 'mid' },
  { key: 'b0.7-1.1', label: 'bet 0.7-1.1 pot', kind: 'bet', owner: 'large' },
  { key: 'b1.1+', label: 'bet 1.1+ pot', kind: 'bet', owner: 'large' },
  { key: 'raise', label: 'raise', kind: 'raise', owner: null },
  { key: 'check-raise', label: 'check-raise', kind: 'check-raise', owner: null },
]);
export const BETTORS = Object.freeze([
  { key: 'person', label: 'person' },
  { key: 'horse', label: 'Horse' },
]);
/** Decisions a cell needs before it is flagged. */
export const MIN_N = 20;
/** Flag bar (METHOD: 2 SE); the gate corrects it for the number of person cells tested. */
export const FLAG_Z = 2;
/** People's own fold share is a ceiling only with this many people decisions in the cell. */
export const PEOPLE_MIN_N = 30;
export const PEOPLE_DAYS = 14;
/** An aggression over this many pots is left out (a shove into a dry side pot is not a price). */
export const MAX_S = 3;

export function facingKeyOf(kind, s) {
  if (kind === 'raise') return 'raise';
  if (kind === 'check-raise') return 'check-raise';
  return s < 0.4 ? 'b<0.4' : s < 0.7 ? 'b0.4-0.7' : s < 1.1 ? 'b0.7-1.1' : 'b1.1+';
}
export const playersOf = (live) => (live <= 2 ? 'hu' : live === 3 ? '3way' : '4way+');
export const breakEven = (s, k = 1) => minimumDefenceFold(s, k);

/** The class of a seat: 'person' (profile found, not a Horse, the action not on Horse policy), 'horse', or null. */
function classOf(hand, uid, origin, known) {
  const p = hand.byUid.get(uid);
  if (!p) return null;
  if (p.isHorse === true) return 'horse';
  if (p.isHorse === false && (!known || known.has(uid)) && origin !== 'horse_policy')
    return 'person';
  return null;
}

/** bet | raise | check-raise of an aggressive decision a (its street's earlier decisions decide). */
function kindOf(decs, a) {
  if (a.firstWager) return 'bet';
  return decs.some((x) => x.street === a.street && x.u === a.u && x.i < a.i && x.act === 'check')
    ? 'check-raise'
    : 'raise';
}

/**
 * The aggression a decision faces: the last bet/raise on its street by the level setter (d.facing).
 * -> { a (the aggressor's decision), kind, s } or null.
 */
function facedAggression(decs, idx) {
  const d = decs[idx];
  if (!d.facing || !(d.toCall > 0)) return null;
  let a = null;
  for (let q = idx - 1; q >= 0; q--) {
    const x = decs[q];
    if (x.street !== d.street) break;
    if (x.u === d.facing && x.isRaise) {
      a = x;
      break;
    }
  }
  if (!a || !(a.pot > 0)) return null;
  const s = (a.amt - (a.myCom ?? 0)) / a.pot;
  if (!(s > 0) || !Number.isFinite(s) || s > MAX_S) return null;
  return { a, kind: kindOf(decs, a), s };
}

/**
 * The scoreboard spots of one parsed hand (parseHand of horse-hand-audit-omaha-lib/hand.mjs, with hand.venue set
 * to 'table' | 'lightning'): every decision facing aggression on the flop, turn or river by a Horse (who 'horse')
 * or by a person (who 'person', for people's own fold share).
 * -> [{ handId, t, gv, venue, street, players, opponents, facing, kind, s, be, bettor, who, oop, fold }]
 */
export function scoreboardSpots(hand, { known = null } = {}) {
  const out = [];
  if (!hand || !SB_GAMES.some((g) => g.key === hand.gv) || hand.bomb || hand.rit || hand.mtt)
    return out;
  const decs = hand.decisions ?? [];
  for (let i = 0; i < decs.length; i++) {
    const d = decs[i];
    if (!SB_STREETS.includes(d.street) || !(d.live >= 2)) continue;
    const fa = facedAggression(decs, i);
    if (!fa) continue;
    const who = classOf(hand, d.u, d.origin, known);
    const bettor = classOf(hand, fa.a.u, fa.a.origin, known);
    if (!who || !bettor || d.u === fa.a.u) continue;
    const opponents = d.live - 1;
    out.push({
      handId: hand.id,
      t: hand.t,
      gv: hand.gv,
      venue: hand.venue === 'lightning' ? 'lightning' : 'table',
      street: d.street,
      players: playersOf(d.live),
      opponents,
      facing: facingKeyOf(fa.kind, fa.s),
      kind: fa.kind,
      s: fa.s,
      be: breakEven(fa.s, opponents),
      bettor,
      who,
      oop: d.oop === true,
      fold: d.act === 'fold',
    });
  }
  return out;
}

/**
 * Every bet or raise on the flop, turn or river into a field of Horses only, and whether the field folded through
 * (every opponent folded on that street). -> [{ handId, gv, venue, street, players, facing, s, bettor, through, bluffBb }]
 */
export function scoreboardBets(hand, { known = null } = {}) {
  const out = [];
  if (!hand || !SB_GAMES.some((g) => g.key === hand.gv) || hand.bomb || hand.rit || hand.mtt)
    return out;
  const decs = hand.decisions ?? [];
  for (let i = 0; i < decs.length; i++) {
    const d = decs[i];
    if (!SB_STREETS.includes(d.street) || !d.isRaise || !(d.pot > 0)) continue;
    const bettor = classOf(hand, d.u, d.origin, known);
    if (!bettor) continue;
    const opp = (d.liveUids ?? []).filter((u) => u !== d.u);
    if (!opp.length || !opp.every((u) => hand.byUid.get(u)?.isHorse === true)) continue;
    const added = d.amt - (d.myCom ?? 0);
    const s = added / d.pot;
    if (!(s > 0) || !Number.isFinite(s) || s > MAX_S) continue;
    const kind = kindOf(decs, d);
    const rest = decs.slice(i + 1).filter((e) => e.street === d.street);
    const through =
      rest.length > 0 && rest.length >= opp.length && rest.every((e) => e.act === 'fold');
    out.push({
      handId: hand.id,
      gv: hand.gv,
      venue: hand.venue === 'lightning' ? 'lightning' : 'table',
      street: d.street,
      players: playersOf(opp.length + 1),
      facing: facingKeyOf(kind, s),
      kind,
      s,
      bettor,
      through,
      bluffBb: hand.bb > 0 ? (through ? d.pot : -added) / hand.bb : null,
    });
  }
  return out;
}

const fieldOf = (players) => (players === 'hu' ? 'hu' : 'mw');
const keyOf = (x, venue = x.venue) =>
  `${x.gv}|${venue}|${x.street}|${x.players}|${x.facing}|${x.bettor}`;
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '-');
const z2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');

/** Folds against per-decision expectations e_i (binomial each): the mean expectation and the z. */
function zAgainst(spots, expOf) {
  let f = 0;
  let e = 0;
  let v = 0;
  for (const x of spots) {
    const c = expOf(x);
    if (x.fold) f++;
    e += c;
    v += c * (1 - c);
  }
  return { mean: spots.length ? e / spots.length : null, z: v > 0 ? (f - e) / Math.sqrt(v) : null };
}

/**
 * The people ceiling of a cell. Person bettor heads-up first bet: the people prior table (bluff share as a price).
 * Else people's own fold share in the same cell (venues pooled) when n >= PEOPLE_MIN_N. Else none.
 */
function peopleCeiling(cell, people, prior) {
  const fc = FACING.find((f) => f.key === cell.facing);
  if (cell.bettor === 'person' && cell.players === 'hu' && fc.kind === 'bet' && prior) {
    const pc = peoplePriorCell(prior, cell.street, 'hu', fc.owner, 'bluff');
    if (pc)
      return {
        tier: 'people-prior',
        share: pc.share,
        n: pc.n,
        source: `people prior table (bluff share ${pct(pc.share)}, n ${pc.n})`,
      };
  }
  const ppl = people.filter(
    (x) =>
      x.gv === cell.gv &&
      x.street === cell.street &&
      x.players === cell.players &&
      x.facing === cell.facing
  );
  const n = ppl.length;
  if (n >= PEOPLE_MIN_N) {
    const p = ppl.filter((x) => x.fold).length / n;
    return {
      tier: 'people-own',
      p,
      n,
      source: `people's own folds, ${PEOPLE_DAYS} d (${pct(p)}, n ${n})`,
    };
  }
  return { tier: 'none', n, source: `no people ceiling (people n ${n} < ${PEOPLE_MIN_N})` };
}

/** z against a people ceiling (a price per decision, or a rate p with its own sample error). */
function zPeople(spots, pc) {
  if (pc.tier === 'people-prior') {
    const r = zAgainst(spots, (x) => foldCeiling(x.s, pc.share, x.opponents));
    return { ceiling: r.mean, z: r.z };
  }
  if (pc.tier === 'people-own') {
    const n = spots.length;
    if (!n) return { ceiling: pc.p, z: null };
    const f = spots.filter((x) => x.fold).length;
    // (folds + 0.5) / (n + 1): a people cell at 0% or 100% still carries an error
    const q = (pc.p * pc.n + 0.5) / (pc.n + 1);
    const v = n * q * (1 - q) + (n * n * q * (1 - q)) / pc.n;
    return { ceiling: pc.p, z: v > 0 ? (f - n * pc.p) / Math.sqrt(v) : null };
  }
  return { ceiling: null, z: null };
}

const order = (c) => [
  SB_GAMES.findIndex((g) => g.key === c.gv),
  ['table', 'lightning', 'all'].indexOf(c.venue),
  SB_STREETS.indexOf(c.street),
  SB_PLAYERS.findIndex((p) => p.key === c.players),
  FACING.findIndex((f) => f.key === c.facing),
  BETTORS.findIndex((b) => b.key === c.bettor),
];
const byCell = (a, b) => {
  const x = order(a);
  const y = order(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/**
 * The board.
 *   spots  : scoreboardSpots of the range (Horse deciders are counted; who 'person' rows are ignored here);
 *   people : scoreboardSpots of people deciders over the trailing PEOPLE_DAYS (who 'person');
 *   bets   : scoreboardBets of the range; prior, ownerMap, switches: as the alarm; sinceMs: the range start.
 * Cells exist per venue (table, Lightning) and pooled ('all'); only per-venue person cells are tested.
 * -> { cells, foldThrough, personTests, zBar, gating, exitCode (0 clean, 1 a person cell gates, 2 no person cell
 *      has MIN_N), lines }
 */
export function scoreboard({
  spots = [],
  people = [],
  bets = [],
  prior = null,
  ownerMap = null,
  switches = null,
  sinceMs = NaN,
  minN = MIN_N,
  z = FLAG_Z,
}) {
  const groups = new Map();
  for (const x of spots) {
    if (x.who !== 'horse') continue;
    for (const venue of [x.venue, 'all']) {
      const k = keyOf(x, venue);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
  }
  const cells = [];
  for (const [k, list] of groups) {
    const [gv, venue, street, players, facing, bettor] = k.split('|');
    const cell = { gv, venue, street, players, facing, bettor };
    const fc = FACING.find((f) => f.key === facing);
    const n = list.length;
    const folds = list.filter((x) => x.fold).length;
    const be = zAgainst(list, (x) => x.be);
    const pc = peopleCeiling(cell, people, prior);
    const zp = zPeople(list, pc);
    const oop = list.filter((x) => x.oop);
    const ip = list.filter((x) => !x.oop);
    const owner = fc.owner ? ownerOf(ownerMap, gv, street, fieldOf(players), fc.owner) : null;
    const st = ownerState(ownerMap, owner, switches);
    const tested = n >= minN;
    const overBe = tested && Number.isFinite(be.z) && be.z >= z;
    const overPeople = tested && Number.isFinite(zp.z) && zp.z >= z;
    cells.push({
      key: `scoreboard|${k}`,
      ...cell,
      game: SB_GAMES.find((g) => g.key === gv).label,
      venueLabel: venue === 'all' ? 'table+Lightning' : VENUES.find((v) => v.key === venue).label,
      playersLabel: SB_PLAYERS.find((p) => p.key === players).label,
      facingLabel: fc.label,
      kind: fc.kind,
      n,
      folds,
      rate: folds / n,
      breakEven: be.mean,
      zBe: be.z,
      peopleCeiling: zp.ceiling,
      peopleSource: pc.source,
      peopleTier: pc.tier,
      zPeople: zp.z,
      oopN: oop.length,
      oopRate: oop.length ? oop.filter((x) => x.fold).length / oop.length : null,
      ipN: ip.length,
      ipRate: ip.length ? ip.filter((x) => x.fold).length / ip.length : null,
      tested,
      overBe,
      overPeople,
      flag: !tested ? `n < ${minN}` : overBe || overPeople ? 'OVER' : 'clean',
      owner: st?.option ?? null,
      ownerText: st ? `${st.option} (${st.text})` : 'no owner',
      fixClass: fixClassOf(st, sinceMs),
    });
  }
  cells.sort(byCell);
  // the gate: person-bettor cells per venue (the pooled row repeats them), at the corrected bar
  const testable = cells.filter((c) => c.bettor === 'person' && c.venue !== 'all' && c.tested);
  const personTests = testable.reduce(
    (a, c) => a + (Number.isFinite(c.zBe) ? 1 : 0) + (Number.isFinite(c.zPeople) ? 1 : 0),
    0
  );
  const zBar = correctedZ(z, Math.max(1, personTests));
  for (const c of cells) {
    c.gating =
      c.bettor === 'person' &&
      c.venue !== 'all' &&
      c.tested &&
      ((Number.isFinite(c.zBe) && c.zBe >= zBar) ||
        (Number.isFinite(c.zPeople) && c.zPeople >= zBar));
    c.breachClass = c.gating && c.fixClass === 'fix-on';
    c.line = cellLine(c);
  }
  const gating = cells
    .filter((c) => c.gating)
    .sort((a, b) => (b.breachClass ? 1 : 0) - (a.breachClass ? 1 : 0));
  const ftGroups = new Map();
  for (const x of bets)
    for (const venue of [x.venue, 'all']) {
      const k = keyOf(x, venue);
      if (!ftGroups.has(k)) ftGroups.set(k, []);
      ftGroups.get(k).push(x);
    }
  const foldThrough = [];
  for (const [k, list] of ftGroups) {
    const [gv, venue, street, players, facing, bettor] = k.split('|');
    const n = list.length;
    const th = list.filter((x) => x.through).length;
    let e = 0;
    let v = 0;
    for (const x of list) {
      const c = x.s / (1 + x.s);
      e += c;
      v += c * (1 - c);
    }
    const zz = v > 0 ? (th - e) / Math.sqrt(v) : null;
    const vals = list.map((x) => x.bluffBb).filter((x) => Number.isFinite(x));
    const mean = vals.length ? vals.reduce((a, x) => a + x, 0) / vals.length : null;
    const sd =
      vals.length > 1
        ? Math.sqrt(vals.reduce((a, x) => a + (x - mean) ** 2, 0) / (vals.length - 1))
        : null;
    foldThrough.push({
      key: `scoreboard-ft|${k}`,
      gv,
      venue,
      street,
      players,
      facing,
      bettor,
      n,
      through: th,
      rate: th / n,
      breakEven: e / n,
      z: zz,
      bluffBb: mean,
      bluffBbSe: sd !== null ? sd / Math.sqrt(vals.length) : null,
      over: n >= minN && Number.isFinite(zz) && zz >= z,
    });
  }
  foldThrough.sort(byCell);
  const personCells = cells.filter((c) => c.bettor === 'person' && c.venue !== 'all');
  const exitCode = gating.length ? 1 : personCells.some((c) => c.tested) ? 0 : 2;
  const lines = [];
  for (const c of gating)
    lines.push(c.breachClass ? `BREACH-CLASS (scoreboard, fix ON): ${c.line}` : c.line);
  lines.push(
    exitCode === 1
      ? `OVER-FOLD SCOREBOARD: ${gating.length} person cell(s) over at the corrected bar ${zBar.toFixed(2)} (${personTests} tests).`
      : exitCode === 0
        ? `OVER-FOLD SCOREBOARD: clean facing people (${personTests} tests, bar ${zBar.toFixed(2)}).`
        : `OVER-FOLD SCOREBOARD: no person cell has ${minN} decisions (Horse-bettor cells are information only).`
  );
  return { cells, foldThrough, personTests, zBar, gating, exitCode, lines };
}

export function cellLine(c) {
  return `${c.game} ${c.venueLabel} ${c.street} ${c.playersLabel} facing a ${c.bettor === 'person' ? "person's" : "Horse's"} ${c.facingLabel}: n ${c.n}, Horse folds ${pct(c.rate)} vs break-even ${pct(c.breakEven)} (z ${z2(c.zBe)}), people ceiling ${pct(c.peopleCeiling)} (${c.peopleSource}; z ${z2(c.zPeople)}); ${c.flag}; owner ${c.ownerText}`;
}

/** The board as markdown rows. venues: which venue rows to show; bettor: 'person' | 'horse' | null (both). */
export function boardTable(cells, { venues = ['table', 'lightning', 'all'], bettor = null } = {}) {
  const head = [
    '| game | venue | street | players | facing | bettor | n | Horse fold | OOP fold (n) | IP fold (n) | break-even | z vs BE | people ceiling | z vs people | ceiling source | flag | owner (state) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const rows = cells
    .filter((c) => venues.includes(c.venue) && (!bettor || c.bettor === bettor))
    .map(
      (c) =>
        `| ${c.game} | ${c.venueLabel} | ${c.street} | ${c.playersLabel} | ${c.facingLabel} | ${c.bettor} | ${c.n} | ${pct(c.rate)} | ${pct(c.oopRate)} (${c.oopN}) | ${pct(c.ipRate)} (${c.ipN}) | ${pct(c.breakEven)} | ${z2(c.zBe)} | ${pct(c.peopleCeiling)} | ${z2(c.zPeople)} | ${c.peopleSource} | ${c.gating ? (c.breachClass ? 'BREACH-CLASS' : 'GATES') : c.flag} | ${c.ownerText} |`
    );
  return [...head, ...rows];
}

export function foldThroughBoard(
  ft,
  { venues = ['table', 'lightning', 'all'], bettor = null, minN = 1 } = {}
) {
  const head = [
    '| game | venue | street | players | aggression | bettor | bets | folded through | break-even | z | zero-equity bluff bb (SE) | flag |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const lab = (k) => FACING.find((f) => f.key === k)?.label ?? k;
  const pl = (k) => SB_PLAYERS.find((p) => p.key === k)?.label ?? k;
  const rows = ft
    .filter((x) => venues.includes(x.venue) && (!bettor || x.bettor === bettor) && x.n >= minN)
    .map(
      (x) =>
        `| ${x.gv.toUpperCase()} | ${x.venue === 'all' ? 'table+Lightning' : x.venue} | ${x.street} | ${pl(x.players)} | ${lab(x.facing)} | ${x.bettor} | ${x.n} | ${pct(x.rate)} | ${pct(x.breakEven)} | ${z2(x.z)} | ${z2(x.bluffBb)} (${z2(x.bluffBbSe)}) | ${x.n < MIN_N ? `n < ${MIN_N}` : x.over ? 'OVER' : 'clean'} |`
    );
  return [...head, ...rows];
}
