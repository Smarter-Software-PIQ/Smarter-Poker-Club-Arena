// scripts/ops/horse-overfold-fix-validation-lib.mjs
// DID THE OVER-FOLD FIX WORK? (2026-11-27, lead-8 over-fold swarm, lane of-validate). Pure core of
// horse-overfold-fix-validation.mjs: no I/O. Docs: docs/ops/horse-overfold-fix-validation.md.
//
// For one option of scripts/ops/horse-overfold-owner-map.json and the instant it went ON, it holds the cells that
// option owns BEFORE (the same clock hours on each of the 7 days before ON) against AFTER (ON .. until):
//   - the Horse fold rate facing a person's first bet, by game, street, players and size, with n and the z against
//     the over-fold alarm's own ceiling (gateCells of horse-plo-overfold-gate-lib.mjs: same ceilings, same bar);
//   - the fold-through of that bet (everyone folds) against the pure-bluff break-even s/(1+s);
//   - the realized result of each Horse call (bb won from that decision on) against folding (0);
//   - three watch cells of the river (l8-payoff): a Horse's call of a person's river bet with a non-nut flush on a
//     paired board, a straight on a flush board without the nut-flush card, a nut flush on a paired board, classed
//     ONLY from the Horse's own cards when the showdown list records them as shown (never an unshown card).
// Verdict per cell: VALIDATED / NOT YET (n needed) / REGRESSED. Nothing here gates a release; the daily audit lists it.
import { correctedZ } from './horse-audit-multiple-tests.mjs';
import { category, isNutsExact, omaha } from './horse-hand-audit-omaha-lib/omaha.mjs';
import {
  GATE_Z,
  MIN_N,
  foldThroughBets,
  gateCells,
  overfoldSpots,
} from './horse-plo-overfold-gate-lib.mjs';

export const DAY = 86400_000;
export const BEFORE_DAYS = 7;
/** AFTER worse than BEFORE by this one-sided z (and AFTER at or over the ceiling): REGRESSED. */
export const WORSE_Z = 2;
/** A watch cell needs this many AFTER calls before it is judged. */
export const WATCH_MIN_N = 5;
export const WATCH_CELLS = Object.freeze([
  'non-nut flush on paired board',
  'straight on flush board without the nut-flush card',
  'nut flush on paired board',
]);
const CONTINUE = new Set(['call', 'all_in', 'raise']);

/** BEFORE windows: the same clock hours as [onMs, untilMs) on each of the 7 days before (one 7-day block past 24 h). */
export function beforeWindows(onMs, untilMs, days = BEFORE_DAYS) {
  const span = untilMs - onMs;
  if (!(span > 0)) return [];
  if (span >= DAY) return [[onMs - days * DAY, onMs]];
  const out = [];
  for (let d = days; d >= 1; d--) out.push([onMs - d * DAY, onMs - d * DAY + span]);
  return out;
}
const inAny = (t, wins) => wins.some(([a, b]) => t >= a && t < b);

/** The cells an owner entry covers (heads-up and multiway alike), as gate cell keys without the size row 'all'. */
export function ownsCell(owner, c) {
  const games = c.group === 'plo' ? ['plo4', 'plo5'] : [c.group];
  return (
    !!owner &&
    games.every((g) => owner.games?.includes(g)) &&
    owner.streets?.includes(c.street) &&
    owner.fields?.includes(c.field ?? (c.players === 'hu' ? 'hu' : 'mw')) &&
    (c.bucket === 'all'
      ? ['small', 'mid', 'large'].every((s) => owner.sizes?.includes(s))
      : owner.sizes?.includes(c.bucket))
  );
}

/** A Horse's own shown river hand into one of the watch classes, or null. hole/board: card ints (omaha.mjs). */
export function watchClass(hole, board) {
  if (!hole || !board || board.length !== 5) return null;
  const suits = [0, 0, 0, 0];
  for (const c of board) suits[c & 3]++;
  const fs = suits.findIndex((n) => n >= 3);
  const ranks = new Map();
  for (const c of board) ranks.set(c >> 2, (ranks.get(c >> 2) ?? 0) + 1);
  const paired = [...ranks.values()].some((n) => n >= 2);
  const cat = category(omaha(hole, board));
  if (fs < 0 || (cat !== 5 && cat !== 4)) return null;
  let top = -1;
  for (let r = 12; r >= 0; r--)
    if (!board.includes(r * 4 + fs)) {
      top = r * 4 + fs;
      break;
    }
  if (cat === 4)
    return hole.includes(top) ? null : 'straight on flush board without the nut-flush card';
  if (!paired) return null;
  const nut = hole.includes(top) && hole.filter((c) => (c & 3) === fs).length >= 2;
  return nut || isNutsExact(hole, board)
    ? 'nut flush on paired board'
    : 'non-nut flush on paired board';
}

/**
 * The Horse decision behind each over-fold spot of a hand, in order (the gate lib's spot filter, matched back to
 * the decision so its action and the Horse's result after it can be read). -> [{ spot, d, me }]
 */
function spotDecisions(hand, spots) {
  const used = new Set();
  const out = [];
  for (const x of spots) {
    const d = hand.decisions.find(
      (e, i) =>
        !used.has(i) &&
        e.street === x.street &&
        e.nStreetRaises === 1 &&
        e.toCall > 0 &&
        e.live - 1 === x.opponents &&
        hand.byUid.get(e.u)?.isHorse === true &&
        e.facing &&
        hand.byUid.get(e.facing)?.isHorse === false &&
        (used.add(i) || true)
    );
    if (d) out.push({ spot: x, d, me: hand.byUid.get(d.u) });
  }
  return out;
}

/**
 * Spots of parsed hands (hand.mjs parseHand, PLO cash): Horse spots and people spots for the ceilings, fold-through
 * bets, Horse calls with their realized result in bb, and watch-cell river calls. side: 'before' | 'after' | null.
 */
export function collect(hands, { onMs, untilMs, before }) {
  const S = {
    before: { spots: [], bets: [], calls: [], watch: [] },
    after: { spots: [], bets: [], calls: [], watch: [] },
    people: [],
  };
  const peopleFrom = untilMs - 14 * DAY;
  for (const hand of hands) {
    const t = Date.parse(
      String(hand.t)
        .replace(' ', 'T')
        .replace(/\+00(:00)?$/, 'Z')
    );
    const side = t >= onMs && t < untilMs ? 'after' : inAny(t, before) ? 'before' : null;
    const spots = overfoldSpots(hand);
    for (const x of spots)
      if (x.who === 'person' && t >= peopleFrom && t < untilMs) S.people.push(x);
    if (!side) continue;
    const H = S[side];
    const hs = spots.filter((x) => x.who === 'horse');
    H.spots.push(...hs);
    H.bets.push(...foldThroughBets(hand));
    for (const { spot, d, me } of spotDecisions(hand, hs)) {
      if (!CONTINUE.has(d.act) || !(hand.bb > 0)) continue;
      // chips from this decision on: what he won minus what he put in from here (folding here = 0)
      const bb = (me.won - (me.inv - d.totalInBefore)) / hand.bb;
      H.calls.push({ ...spot, bb });
      if (d.street === 'river' && d.act === 'call') {
        const hole = hand.shown.get(me.uid); // shown at showdown only (hand.mjs shownCards)
        const w = hole ? watchClass(hole, hand.board) : null;
        if (w) H.watch.push({ cls: w, bb, won: me.won > 0, s: spot.s });
      }
    }
  }
  return S;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function meanSe(xs) {
  const m = mean(xs);
  if (xs.length < 2) return { n: xs.length, mean: m, se: null };
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return { n: xs.length, mean: m, se: Math.sqrt(v / xs.length) };
}

/** One cell's verdict from its BEFORE and AFTER gate cells (n, rate, ceiling, zCeiling) and the alarm's bar. */
export function cellVerdict(b, a, zBar, minN = MIN_N) {
  let zWorse = null;
  if (a.n && b.n) {
    const p = (a.folds + b.folds) / (a.n + b.n);
    const se = Math.sqrt(p * (1 - p) * (1 / a.n + 1 / b.n));
    zWorse = se > 0 ? (a.rate - b.rate) / se : null;
  }
  if (a.n >= minN && Number.isFinite(a.zCeiling) && a.zCeiling >= zBar)
    return {
      verdict: 'REGRESSED',
      why: `after over its ceiling with the fix ON (z ${a.zCeiling.toFixed(2)} >= bar ${zBar.toFixed(2)})`,
      zWorse,
    };
  if (a.n >= minN && Number.isFinite(zWorse) && zWorse >= WORSE_Z && a.rate > a.ceiling)
    return {
      verdict: 'REGRESSED',
      why: `after folds more than before (z ${zWorse.toFixed(2)}) and above its ceiling`,
      zWorse,
    };
  if (a.n >= minN && Number.isFinite(a.zCeiling) && a.zCeiling <= 1)
    return {
      verdict: 'VALIDATED',
      why: `after within one SE of its ceiling or under it (z ${a.zCeiling.toFixed(2)})`,
      zWorse,
    };
  const need =
    a.n < minN
      ? minN - a.n
      : Math.max(1, Math.ceil(a.n * (zBar / Math.max(1e-9, a.zCeiling)) ** 2) - a.n);
  return {
    verdict: 'NOT YET',
    why: a.n < minN ? `n ${a.n} < ${minN}` : `between (z ${a.zCeiling.toFixed(2)})`,
    need,
    zWorse,
  };
}

/** A watch cell's verdict: AFTER calls judged on their realized bb (VALIDATED >= 0, REGRESSED 2 SE below 0). */
export function watchVerdict(after) {
  const m = meanSe(after.map((x) => x.bb));
  if (m.n < WATCH_MIN_N) return { ...m, verdict: 'NOT YET', need: WATCH_MIN_N - m.n };
  if (m.mean >= 0) return { ...m, verdict: 'VALIDATED' };
  if (m.se && m.mean <= -2 * m.se) return { ...m, verdict: 'REGRESSED' };
  return { ...m, verdict: 'NOT YET', need: null };
}

/**
 * The validation of one option. owner: its owner-map entry; S: collect(); prior/ownerMap as the gate takes them.
 * -> { cells: [...], watch: [...], verdict, exitCode (0 no REGRESSED, 1 a REGRESSED cell) }
 */
export function validate({ option, owner, S, prior = null, ownerMap = null }) {
  const g = (side) =>
    gateCells({
      current: S[side].spots,
      people: S.people,
      prior,
      ownerMap,
      bets: S[side].bets,
      rangeBets: S[side].bets,
      ftSinceMs: -Infinity,
    });
  const B = g('before');
  const A = g('after');
  const owned = A.cells.filter((c) => ownsCell(owner, c) && c.bucket !== 'all');
  const zBar = correctedZ(GATE_Z, Math.max(1, owned.length));
  const cells = [];
  for (const a of owned) {
    const b = B.cells.find((x) => x.key === a.key);
    if (!(a.n || b?.n)) continue;
    const inCell = (x) =>
      x.street === a.street &&
      x.bucket === a.bucket &&
      (a.group === 'plo' ? true : x.gv === a.group) &&
      (x.field ?? 'hu') === a.field;
    const callsOf = (side) => meanSe(S[side].calls.filter(inCell).map((x) => x.bb));
    // heads-up: its own fold-through; multiway: the 3-way fold-through row (the cell's people-first bets)
    const ftOf = (G) =>
      G.foldThrough.find(
        (x) =>
          x.key ===
          `foldthru|${a.group}|${a.street}|${a.field === 'hu' ? 'hu' : '3way'}|${a.bucket}`
      );
    const v = cellVerdict(b ?? { n: 0 }, a, zBar);
    cells.push({
      key: a.key,
      game: a.game,
      street: a.street,
      field: a.field,
      size: a.size,
      before: {
        n: b?.n ?? 0,
        rate: b?.rate ?? null,
        ceiling: b?.ceiling ?? null,
        z: b?.zCeiling ?? null,
        ft: ftOf(B),
        calls: callsOf('before'),
      },
      after: {
        n: a.n,
        rate: a.rate,
        ceiling: a.ceiling,
        z: a.zCeiling,
        ft: ftOf(A),
        calls: callsOf('after'),
      },
      ceilingSource: a.ceilingSource,
      zBar,
      ...v,
    });
  }
  const watch = WATCH_CELLS.map((cls) => {
    const bf = S.before.watch.filter((x) => x.cls === cls);
    const af = S.after.watch.filter((x) => x.cls === cls);
    return {
      cls,
      before: { ...meanSe(bf.map((x) => x.bb)), won: bf.filter((x) => x.won).length },
      after: { won: af.filter((x) => x.won).length },
      ...watchVerdict(af),
    };
  });
  const all = [...cells, ...watch];
  const verdict = all.some((c) => c.verdict === 'REGRESSED')
    ? 'REGRESSED'
    : all.length && all.every((c) => c.verdict === 'VALIDATED')
      ? 'VALIDATED'
      : 'NOT YET';
  return { option, cells, watch, verdict, exitCode: verdict === 'REGRESSED' ? 1 : 0 };
}

const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '-');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');
/** The bb-weighted value of a zero-equity bluff (fold-through x pot - (1 - fold-through) x bet, real pots). */
const bbOf = (ft) =>
  Number.isFinite(ft?.evBb)
    ? `${f2(ft.evBb)}${Number.isFinite(ft.evBbSe) ? ` +/- ${f2(ft.evBbSe)}` : ''}`
    : '-';
const pm = (m) => (m && m.n ? `${f2(m.mean)}${m.se ? ` +/- ${f2(m.se)}` : ''} (n ${m.n})` : '-');

/** The page (markdown). */
export function formatPage(r, { onIso, untilIso, beforeText, hands }) {
  const L = [];
  L.push(`# Over-fold fix validation: ${r.option}`, '');
  L.push(
    `ON ${onIso}; AFTER ${onIso} .. ${untilIso}; BEFORE ${beforeText}. Hands read: ${hands}. Verdict: **${r.verdict}**.`,
    ''
  );
  L.push(
    "Horse fold rate facing a person's first bet (ceiling and bar = the over-fold alarm's); fold-through vs pure-bluff break-even; realized bb per Horse call from that decision on (folding = 0).",
    ''
  );
  L.push(
    '| cell | before n | before fold | after n | after fold | ceiling | z after vs ceiling | z after vs before | fold-through before / after (break-even; zero-equity bluff bb per bet) | bb per call before | bb per call after | verdict |'
  );
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of r.cells)
    L.push(
      `| ${c.game} ${c.street} ${c.field === 'hu' ? 'heads-up' : 'multiway'} ${c.size} | ${c.before.n} | ${pct(c.before.rate)} | ${c.after.n} | ${pct(c.after.rate)} | ${pct(c.after.ceiling)} | ${f2(c.after.z)} (bar ${f2(c.zBar)}) | ${f2(c.zWorse)} | ${c.before.ft ? `${pct(c.before.ft.rate)} (${pct(c.before.ft.breakEven)}, n ${c.before.ft.n}; bluff ${bbOf(c.before.ft)} bb)` : '-'} / ${c.after.ft ? `${pct(c.after.ft.rate)} (${pct(c.after.ft.breakEven)}, n ${c.after.ft.n}; bluff ${bbOf(c.after.ft)} bb)` : '-'} | ${pm(c.before.calls)} | ${pm(c.after.calls)} | ${c.verdict}${c.verdict === 'NOT YET' && c.need ? ` (n needed ~${c.need})` : ''} |`
    );
  if (!r.cells.length)
    L.push('| (no decision in any owned cell in either window) | | | | | | | | | | | |');
  L.push(
    '',
    "River watch cells (Horse calls of a person's river bet; the Horse's own cards only when shown at showdown):",
    ''
  );
  L.push(
    '| watch cell | before calls (won) | before bb per call | after calls (won) | after bb per call | verdict |'
  );
  L.push('|---|---|---|---|---|---|');
  for (const w of r.watch)
    L.push(
      `| ${w.cls} | ${w.before.n} (${w.before.won}) | ${pm(w.before)} | ${w.n} (${w.after.won}) | ${pm(w)} | ${w.verdict}${w.verdict === 'NOT YET' && w.need ? ` (n needed ${w.need})` : ''} |`
    );
  return L.join('\n');
}
