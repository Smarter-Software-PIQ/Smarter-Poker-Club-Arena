/**
 * Fits the population priors of the Hold'em tournament raise-defence price
 * (server/src/engine/HorseHoldemTournamentRaiseDefencePriors.data.ts) from exported hand_history rows.
 *
 * Input: one or more JSON files, each the result of holdem-tournament-raise-defence-export.sql (read-only SELECT on
 * public.hand_history for no-limit hold'em tournament hands in a time window): per hand the big blind, every preflop
 * action that carries its publicNode ([seat, action, street total, the actor's stack and bet before acting, the
 * current bet, live opponents not all in, the largest other live stack, All-In-Or-Fold, ante, seats dealt, format,
 * near bubble, dealer]) and the cards of the seats that SHOWED at showdown (mucked and folded cards are never read).
 *
 * Measured (frequencies over every player, people and Horses alike; nobody is singled out):
 *   open         first-in non-all-in raise share by players behind (heads-up apart) and effective depth;
 *   openFoldToJam  an opener (non-all-in) facing one all-in re-raise and nobody else in: fold share by the price
 *                  of his call (two dealt apart);
 *   threeBet     facing one non-all-in open, no caller: non-all-in re-raise share by depth;
 *   threeBetJam  the same spot: all-in re-raise share;
 *   fourBet      an opener facing one non-all-in 3-bet: non-all-in 4-bet share by depth (of the opens);
 *   fourBetJam   the same spot: all-in 4-bet share;
 *   openJam      first-in all-in share (the voluntary first-in range is open + openJam);
 *   threeBetFoldToJam  a non-all-in 3-bettor facing the opener's all-in 4-bet: fold share by his price;
 *   overcall / squeeze  facing one non-all-in open and one caller: the call share and the re-raise share.
 * Shown hands are used only as a check of the range shape (see the report): the mean strength rank of shown
 * non-all-in opens against the rank the top-width model expects. Showdown hands are a biased sample, so they set
 * no number in the table.
 *
 * Run from server/: npx tsx scripts/holdem-tournament-raise-defence-fit.ts <out.data.ts> <export.json>...
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  HOLDEM_CLASSES,
  holdemClassComboCount,
  STRENGTH_ORDER,
} from '../src/engine/HorseHoldemTournamentAllInCall.js';

type Row = [
  // [seat, action, street total, stack, bet, currentBet, live others, max other, aof, ante, seats, format, near bubble, dealer, pot]

  number,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  boolean,
  number,
  number,
  string | null,
  boolean | null,
  number,
];
interface Hand {
  id: string;
  bb: number;
  acts: Row[] | null;
  shown: Record<string, Array<{ rank: string; suit: string }>> | null;
}

export const DEPTH_EDGES = [10, 15, 20, 30, 50] as const; // buckets <10, 10-15, 15-20, 20-30, 30-50, 50+
export const BEHIND_GROUPS = ['hu', '1', '2', '3', '4', '5+'] as const;
const bucketOf = (d: number) => {
  let i = 0;
  while (i < DEPTH_EDGES.length && d >= DEPTH_EDGES[i]) i++;
  return i;
};
const NB = DEPTH_EDGES.length + 1;
const zero = () => Array.from({ length: NB }, () => ({ n: 0, k: 0 }));
/** The caller's price buckets (required equity of the call): <30%, 30-35, 35-40, 40-45, 45%+. */
export const PRICE_EDGES = [0.3, 0.35, 0.4, 0.45] as const;
const NP = PRICE_EDGES.length + 1;
const priceBucketOf = (r: number) => {
  let i = 0;
  while (i < PRICE_EDGES.length && r >= PRICE_EDGES[i]) i++;
  return i;
};
const zeroP = () => Array.from({ length: NP }, () => ({ n: 0, k: 0 }));

const [outFile, ...inputs] = process.argv.slice(2);
const open: Record<string, Array<{ n: number; k: number }>> = Object.fromEntries(
  BEHIND_GROUPS.map((g) => [g, zero()])
);
const openJam: Record<string, Array<{ n: number; k: number }>> = Object.fromEntries(
  BEHIND_GROUPS.map((g) => [g, zero()])
);
const openFoldToJam = { hu: zeroP(), ring: zeroP() };
const threeBet = zero();
const threeBetJam = zero();
const fourBet = zero();
const fourBetJam = zero();
const threeBetFoldToJam = zeroP();
const overcall = zero();
const squeeze = zero();
const rankOf = new Map<number, number>();
{
  let cum = 0;
  for (const i of STRENGTH_ORDER) {
    const n = holdemClassComboCount(HOLDEM_CLASSES[i]);
    rankOf.set(i, (cum + n / 2) / 1326);
    cum += n;
  }
}
const shownOpen: Array<{ g: string; b: number; rank: number }> = [];
const RANK = 'AKQJT98765432';
const classOf = (c: Array<{ rank: string; suit: string }>) => {
  const a = RANK.indexOf(c[0].rank),
    b = RANK.indexOf(c[1].rank);
  const hi = RANK[Math.min(a, b)],
    lo = RANK[Math.max(a, b)];
  return a === b ? hi + lo : hi + lo + (c[0].suit === c[1].suit ? 's' : 'o');
};
let hands = 0,
  used = 0;
const windows: string[] = [];
for (const f of inputs) {
  windows.push(f.split('/').pop()!);
  const rows = JSON.parse(readFileSync(f, 'utf8')) as Array<{ j: Hand }>;
  for (const { j: h } of rows) {
    hands++;
    const acts = h.acts;
    if (!acts || acts.length === 0 || acts.some((a) => a[8] === true)) continue;
    const bb = Number(h.bb);
    if (!(bb > 0)) continue;
    used++;
    let raises = 0,
      callers = 0,
      level = bb;
    const raisers: Array<{ seat: number; jam: boolean }> = [];
    const called = new Set<number>();
    const opener = { seat: -1, depth: 0, behind: '', bucket: 0 };
    for (const a of acts) {
      const [seat, action, amount, stack, bet, currentBet, liveOthers, maxOther, , , nSeats] = a;
      const pot = Number((a as unknown as unknown[])[14] ?? NaN);
      const call = Math.min(currentBet - bet, stack);
      const price = call > 0 && pot > 0 ? priceBucketOf(call / (pot + call)) : -1;
      const total = stack + bet;
      const depth = Math.min(total, maxOther ?? total) / bb;
      const b = bucketOf(depth);
      const isRaise =
        (action === 'raise' || action === 'bet' || action === 'all_in') && amount > level + 1e-9;
      const isJam = action === 'all_in' || (isRaise && amount >= total - 1e-9);
      const isCall = action === 'call' || (action === 'all_in' && !isRaise);
      // first in
      if (raises === 0 && callers === 0) {
        const g = nSeats === 2 ? 'hu' : liveOthers >= 5 ? '5+' : String(Math.max(1, liveOthers));
        if (action !== 'check') {
          open[g][b].n++;
          openJam[g][b].n++;
          if (isJam) openJam[g][b].k++;
          if (isRaise && !isJam) {
            open[g][b].k++;
            opener.seat = seat;
            opener.depth = depth;
            opener.behind = g;
            opener.bucket = b;
            const cards = h.shown?.[String(seat)];
            if (cards && cards.length === 2) {
              const idx = HOLDEM_CLASSES.indexOf(classOf(cards));
              if (idx >= 0) shownOpen.push({ g, b, rank: rankOf.get(idx)! });
            }
          }
        }
      } else if (raises === 1 && callers === 0 && !raisers[0].jam && seat !== raisers[0].seat) {
        // facing one non-all-in open, nobody in yet
        if (action !== 'check') {
          threeBet[b].n++;
          threeBetJam[b].n++;
          if (isRaise && !isJam) threeBet[b].k++;
          if (isJam) threeBetJam[b].k++;
        }
      } else if (
        raises === 1 &&
        callers === 1 &&
        !raisers[0].jam &&
        seat !== raisers[0].seat &&
        !called.has(seat)
      ) {
        // facing one non-all-in open and exactly one caller: the overcall and the squeeze (all in or not)
        if (action !== 'check') {
          overcall[b].n++;
          squeeze[b].n++;
          if (isCall) overcall[b].k++;
          if (isRaise) squeeze[b].k++;
        }
      } else if (raises === 2 && seat === raisers[0].seat && !raisers[0].jam && callers === 0) {
        if (raisers[1].jam) {
          const g = nSeats === 2 ? 'hu' : 'ring';
          if (price >= 0) {
            openFoldToJam[g][price].n++;
            if (action === 'fold') openFoldToJam[g][price].k++;
          }
        } else {
          fourBet[b].n++;
          fourBetJam[b].n++;
          if (isRaise && !isJam) fourBet[b].k++;
          if (isJam) fourBetJam[b].k++;
        }
      } else if (
        raises === 3 &&
        callers === 0 &&
        seat === raisers[1].seat &&
        !raisers[1].jam &&
        raisers[2].seat === raisers[0].seat &&
        raisers[2].jam
      ) {
        if (price >= 0) {
          threeBetFoldToJam[price].n++;
          if (action === 'fold') threeBetFoldToJam[price].k++;
        }
      }
      if (isRaise) {
        raises++;
        level = amount;
        raisers.push({ seat, jam: isJam });
        callers = 0;
      } else if (isCall) {
        callers++;
        called.add(seat);
      }
    }
  }
}
const share = (c: { n: number; k: number }) => (c.n > 0 ? c.k / c.n : null);
// A cell with fewer than MIN_N opportunities borrows its neighbours (pooled with the nearest buckets until MIN_N).
const MIN_N = 40;
function smooth(
  cells: Array<{ n: number; k: number }>
): Array<{ p: number; n: number; pooled: boolean }> {
  return cells.map((c, i) => {
    let n = c.n,
      k = c.k,
      r = 1;
    while (n < MIN_N && r < cells.length) {
      for (const j of [i - r, i + r])
        if (j >= 0 && j < cells.length) {
          n += cells[j].n;
          k += cells[j].k;
        }
      r++;
    }
    return { p: n > 0 ? k / n : NaN, n: c.n, pooled: r > 1 };
  });
}
/**
 * The heads-up cells are thin (a few dozen jams faced per price): each is shrunk toward the three-or-more-dealt cell
 * at the same price with the weight of HU_SHRINK_N opportunities (empirical Bayes), p = (k + N p_ring) / (n + N).
 */
const HU_SHRINK_N = 100;
function shrinkToward(
  cells: Array<{ n: number; k: number }>,
  toward: Array<{ p: number; n: number; pooled: boolean }>
): Array<{ p: number; n: number; pooled: boolean }> {
  return cells.map((c, i) => ({
    p: (c.k + HU_SHRINK_N * toward[i].p) / (c.n + HU_SHRINK_N),
    n: c.n,
    pooled: true,
  }));
}
const table = {
  open: Object.fromEntries(BEHIND_GROUPS.map((g) => [g, smooth(open[g])])),
  openJam: Object.fromEntries(BEHIND_GROUPS.map((g) => [g, smooth(openJam[g])])),
  openFoldToJam: {
    hu: shrinkToward(openFoldToJam.hu, smooth(openFoldToJam.ring)),
    ring: smooth(openFoldToJam.ring),
  },
  threeBet: smooth(threeBet),
  threeBetJam: smooth(threeBetJam),
  fourBet: smooth(fourBet),
  fourBetJam: smooth(fourBetJam),
  threeBetFoldToJam: smooth(threeBetFoldToJam),
  overcall: smooth(overcall),
  squeeze: smooth(squeeze),
};
// Shape check: mean strength rank of shown non-all-in opens vs the top-width model's expectation (width / 2).
const shape: string[] = [];
for (const g of BEHIND_GROUPS)
  for (let b = 0; b < NB; b++) {
    const s = shownOpen.filter((x) => x.g === g && x.b === b);
    if (s.length < 15) continue;
    const mean = s.reduce((a, x) => a + x.rank, 0) / s.length;
    const w = table.open[g][b].p;
    const v = w + table.openJam[g][b].p;
    shape.push(
      `${g}/${b}: shown ${s.length}, mean rank ${mean.toFixed(3)}, top-raise-width model ${(w / 2).toFixed(3)}, spread-over-voluntary-range model ${(v / 2).toFixed(3)}`
    );
  }
const fmt = (cells: Array<{ p: number; n: number; pooled: boolean }>) =>
  `[${cells.map((c) => `{ p: ${c.p.toFixed(4)}, n: ${c.n}${c.pooled ? ', pooled: true' : ''} }`).join(', ')}]`;
const version = `holdem-tournament-raise-defence-priors-v2`;
const body = `/**
 * GENERATED by server/scripts/holdem-tournament-raise-defence-fit.ts from server/scripts/holdem-tournament-raise-defence-export.sql
 * (read-only hand_history export, no-limit hold'em tournaments, All-In-Or-Fold hands excluded). Do not edit by hand.
 * ${hands} hands read, ${used} used. Windows: ${windows.join(', ')}.
 * Each cell: p = the measured share, n = opportunities in that cell (a cell under ${MIN_N} is pooled with its neighbours:
 * pooled: true). Depth buckets (effective big blinds): <10, 10-15, 15-20, 20-30, 30-50, 50+.
 * Shape check (shown hands only; a showdown sample is stronger than the range it comes from, so a model whose
 * expected rank sits ABOVE the shown mean is too strong): ${shape.length ? shape.join('; ') : 'too few shown opens'}.
 */
export const HOLDEM_TOURNAMENT_RAISE_DEFENCE_PRIORS_VERSION = '${version}' as const;
export const HOLDEM_TOURNAMENT_RAISE_DEFENCE_DEPTH_EDGES: readonly number[] = [${DEPTH_EDGES.join(', ')}];
export const HOLDEM_TOURNAMENT_RAISE_DEFENCE_PRICE_EDGES: readonly number[] = [${PRICE_EDGES.join(', ')}];
export interface PriorCell { p: number; n: number; pooled?: true }
export const HOLDEM_TOURNAMENT_RAISE_DEFENCE_PRIORS = {
  /** First-in non-all-in raise share, by players behind ('hu' = two dealt) and depth bucket. */
  open: {
${BEHIND_GROUPS.map((g) => `    '${g}': ${fmt(table.open[g])},`).join('\n')}
  } as Readonly<Record<string, readonly PriorCell[]>>,
  /** First-in all-in share, same cells (the voluntary range is open + openJam). */
  openJam: {
${BEHIND_GROUPS.map((g) => `    '${g}': ${fmt(table.openJam[g])},`).join('\n')}
  } as Readonly<Record<string, readonly PriorCell[]>>,
  /** An opener (non-all-in) facing one all-in re-raise and nobody else in: fold share by his price (the required
   *  equity of his call: <30%, 30-35, 35-40, 40-45, 45%+), two dealt apart (each heads-up cell shrunk toward the
   *  three-or-more-dealt cell with the weight of ${HU_SHRINK_N} opportunities; pooled: true). */
  openFoldToJam: {
    hu: ${fmt(table.openFoldToJam.hu)},
    ring: ${fmt(table.openFoldToJam.ring)},
  } as Readonly<Record<'hu' | 'ring', readonly PriorCell[]>>,
  /** Facing one non-all-in open, no caller: non-all-in re-raise share. */
  threeBet: ${fmt(table.threeBet)} as readonly PriorCell[],
  /** Facing one non-all-in open, no caller: all-in re-raise share. */
  threeBetJam: ${fmt(table.threeBetJam)} as readonly PriorCell[],
  /** An opener facing one non-all-in 3-bet: non-all-in 4-bet share (of the opens). */
  fourBet: ${fmt(table.fourBet)} as readonly PriorCell[],
  /** An opener facing one non-all-in 3-bet: all-in 4-bet share (of the opens). */
  fourBetJam: ${fmt(table.fourBetJam)} as readonly PriorCell[],
  /** A non-all-in 3-bettor facing the opener's all-in 4-bet: fold share by his price (as above). */
  threeBetFoldToJam: ${fmt(table.threeBetFoldToJam)} as readonly PriorCell[],
  /** Facing one non-all-in open and one caller: the overcall share. */
  overcall: ${fmt(table.overcall)} as readonly PriorCell[],
  /** The same spot: the squeeze share (any re-raise, all in or not). */
  squeeze: ${fmt(table.squeeze)} as readonly PriorCell[],
} as const;
`;
writeFileSync(outFile, body);
console.log(body);
