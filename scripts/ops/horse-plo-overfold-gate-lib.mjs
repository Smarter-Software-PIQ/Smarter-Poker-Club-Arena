// scripts/ops/horse-plo-overfold-gate-lib.mjs
// THE PLO OVER-FOLD ALARM (2026-11-26, PLO-OWNER lead-7, lane HARDEN). Pure core of horse-plo-overfold-gate.mjs:
// no I/O here, no hole cards anywhere (it counts actions only).
//
// WHY. The Horses' PLO4/PLO5 over-folding was "fixed" and came back several times: fixes were layered on a verdict
// whose bluff prior was a constant fitted on 41-179 hands, some re-fits used the Horse field (which never bluffs),
// and nothing alarmed when live folding drifted. This is the alarm.
//
// WHAT. For every Horse decision in PLO4/PLO5 cash, heads-up (two players still in) on the turn or the river, facing
// a PERSON's first bet of the street (no raise yet), by street and the bet's share of the pot before it
// (<0.4, 0.4-0.7, 0.7+): the Horse's fold rate is held against a CEILING, per decision, averaged over the cell:
//   - break-even fold s / (1 + s) (s = bet / pot): folding more than this lets any two cards bet at a profit;
//   - where the people-measured prior (server/src/engine/HorseOmahaFacingBetPeoplePrior.data.ts, source
//     'people-only') has the cell with at least PRIOR_MIN_N people bets: people's measured bluff share b. Where b is
//     at least the balanced share s / (1 + 2s) a bluff-catcher's call pays, so the ceiling stays the break-even
//     fold; where people bluff less, folding more is right, and the ceiling rises linearly from the break-even fold
//     (b = balanced) to 1 (b = 0).
// The cell gates only when its folds are above the ceiling by z >= correctedZ(GATE_Z, cells tested) (one-sided,
// Bonferroni over the cells with at least MIN_N decisions; horse-audit-multiple-tests.mjs). The previous 3 days
// pooled are shown beside it (fold rate and z of the difference) and never gate on their own.
import { correctedZ } from './horse-audit-multiple-tests.mjs';

export const GAMES = Object.freeze(['plo4', 'plo5']);
export const STREETS = Object.freeze(['turn', 'river']);
export const BUCKETS = Object.freeze([
  { key: 'small', label: '<0.4 pot', prior: ['under40'] },
  { key: 'mid', label: '0.4-0.7 pot', prior: ['mid'] },
  { key: 'large', label: '0.7+ pot', prior: ['big', 'over'] },
]);
/** One-sided z before the multiple-comparison correction (the exploit report's REGRESSION_Z). */
export const GATE_Z = 3;
/** A cell with fewer decisions in the range is shown, not tested. */
export const MIN_N = 20;
/** A people-prior cell with fewer people bets than this is not used: the break-even fold is the ceiling there. */
export const PRIOR_MIN_N = 30;
/** The comparison window before the range. */
export const PREVIOUS_DAYS = 3;
/** The prior's source must say this (owner order 2026-11-26: every population stat is measured from people). */
export const PEOPLE_ONLY_SOURCE = 'people-only';

export function bucketOf(s) {
  return s < 0.4 ? 'small' : s < 0.7 ? 'mid' : 'large';
}
export const breakEvenFold = (s) => s / (1 + s);
export const balancedBluff = (s) => s / (1 + 2 * s);

/** The fold ceiling of one decision at bet share s, with people's measured bluff share b (null: break-even). */
export function foldCeiling(s, b = null) {
  const f = breakEvenFold(s);
  if (!(typeof b === 'number' && Number.isFinite(b))) return f;
  const bs = balancedBluff(s);
  if (b >= bs) return f;
  return f + (1 - f) * (1 - Math.max(0, b) / bs);
}

/** People's measured bluff share for a heads-up cell, or null (no prior, not people-only, or too few bets). */
export function peoplePriorCell(prior, street, bucket) {
  if (!prior || prior.source !== PEOPLE_ONLY_SOURCE) return null;
  const hu = prior?.bluff?.[street]?.hu;
  const keys = BUCKETS.find((x) => x.key === bucket)?.prior ?? [];
  let n = 0;
  let sum = 0;
  for (const k of keys) {
    const c = hu?.[k];
    if (c && Number.isFinite(c.n) && c.n > 0 && Number.isFinite(c.share)) {
      n += c.n;
      sum += c.n * c.share;
    }
  }
  return n >= PRIOR_MIN_N ? { n, share: sum / n } : null;
}

/**
 * The spots of one parsed hand (horse-hand-audit-omaha-lib/hand.mjs parseHand): a Horse, heads-up on the turn or
 * river, facing the street's first bet made by a person (a person's seat, not acting on Horse policy), before any
 * raise. -> [{ handId, t, gv, street, s, bucket, fold }]
 */
export function overfoldSpots(hand) {
  const out = [];
  if (!hand || !GAMES.includes(hand.gv) || hand.bomb || hand.rit) return out;
  const decs = hand.decisions ?? [];
  for (const d of decs) {
    if (!STREETS.includes(d.street)) continue;
    const me = hand.byUid.get(d.u);
    if (!me || me.isHorse !== true) continue;
    if (d.live !== 2 || d.nStreetRaises !== 1 || !(d.toCall > 0) || !d.facing) continue;
    const bettor = hand.byUid.get(d.facing);
    if (!bettor || bettor.isHorse !== false) continue;
    const bet = decs.find((x) => x.street === d.street && x.firstWager && x.u === d.facing);
    if (!bet || bet.origin === 'horse_policy' || !(bet.pot > 0) || !(bet.amt > 0)) continue;
    const s = bet.amt / bet.pot;
    if (!Number.isFinite(s)) continue;
    out.push({
      handId: hand.id,
      t: hand.t,
      gv: hand.gv,
      street: d.street,
      s,
      bucket: bucketOf(s),
      fold: d.act === 'fold',
    });
  }
  return out;
}

const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '-');
const z2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');

/**
 * The cells and the gate. current/previous = spots (overfoldSpots) of the range and of the PREVIOUS_DAYS before it.
 * -> { cells, tests, zBar, gating, exitCode (0 clean, 1 a cell gates, 2 no cell has MIN_N), line }
 */
export function gateCells({ current = [], previous = [], prior = null, z = GATE_Z, minN = MIN_N }) {
  const cells = [];
  for (const street of STREETS)
    for (const b of BUCKETS) {
      const cur = current.filter((x) => x.street === street && x.bucket === b.key);
      const prev = previous.filter((x) => x.street === street && x.bucket === b.key);
      const pc = peoplePriorCell(prior, street, b.key);
      let folds = 0;
      let e = 0;
      let v = 0;
      for (const x of cur) {
        const c = foldCeiling(x.s, pc ? pc.share : null);
        if (x.fold) folds++;
        e += c;
        v += c * (1 - c);
      }
      const n = cur.length;
      const rate = n ? folds / n : null;
      const ceiling = n ? e / n : null;
      const zCeiling = n && v > 0 ? (folds - e) / Math.sqrt(v) : null;
      const pn = prev.length;
      const pf = prev.filter((x) => x.fold).length;
      const prevRate = pn ? pf / pn : null;
      let zPrevious = null;
      if (n && pn) {
        const pool = (folds + pf) / (n + pn);
        const se = Math.sqrt(pool * (1 - pool) * (1 / n + 1 / pn));
        zPrevious = se > 0 ? (rate - prevRate) / se : null;
      }
      cells.push({
        key: `overfold|${street}|${b.key}`,
        street,
        bucket: b.key,
        size: b.label,
        n,
        folds,
        rate,
        ceiling,
        ceilingSource: pc
          ? `people-measured (bluff share ${pct(pc.share)}, n ${pc.n})`
          : 'break-even s/(1+s)',
        zCeiling,
        previousN: pn,
        previousRate: prevRate,
        zPrevious,
        tested: n >= minN,
      });
    }
  const tests = cells.filter((c) => c.tested).length;
  const zBar = correctedZ(z, Math.max(1, tests));
  for (const c of cells) {
    c.gating = c.tested && Number.isFinite(c.zCeiling) && c.zCeiling >= zBar;
    c.line =
      `PLO over-fold ${c.street} ${c.size} (heads-up, facing a person's first bet): n ${c.n}, Horse folds ` +
      `${pct(c.rate)} vs ceiling ${pct(c.ceiling)} (${c.ceilingSource}), previous ${PREVIOUS_DAYS} days ` +
      `${pct(c.previousRate)} (n ${c.previousN}${Number.isFinite(c.zPrevious) ? `, z ${z2(c.zPrevious)}` : ''}); ` +
      `z ${z2(c.zCeiling)} ${c.gating ? '>=' : 'against'} bar ${z2(zBar)} (${tests} cells tested)`;
  }
  const gating = cells.filter((c) => c.gating);
  const exitCode = gating.length ? 1 : tests === 0 ? 2 : 0;
  const line = gating.length
    ? gating.map((c) => c.line).join(' | ')
    : tests === 0
      ? `PLO over-fold: no cell has ${minN} decisions (too few to test)`
      : `PLO over-fold: clean (${tests} cells tested, bar z ${z2(zBar)})`;
  return { cells, tests, zBar, gating: gating.map((c) => c.key), exitCode, line };
}

/** Markdown rows of the cells for the daily summary. */
export function cellTable(cells) {
  const L = [
    '| street | size | n | Horse fold | ceiling | ceiling source | previous 3 days (n) | z vs previous | z vs ceiling | gate |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const c of cells ?? [])
    L.push(
      `| ${c.street} | ${c.size} | ${c.n} | ${pct(c.rate)} | ${pct(c.ceiling)} | ${c.ceilingSource} | ${pct(c.previousRate)} (${c.previousN}) | ${z2(c.zPrevious)} | ${z2(c.zCeiling)} | ${c.gating ? 'GATES' : c.tested ? 'clean' : `n < ${MIN_N}`} |`
    );
  return L;
}
