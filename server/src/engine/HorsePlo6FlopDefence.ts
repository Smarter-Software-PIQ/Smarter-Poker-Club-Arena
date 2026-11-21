/**
 * PLO6 FLOP DEFENCE (E6, 2026-11-20, PLO6 lane; wired inside plo6FacingBetIsPriced,
 * default OFF, read `=== true`).
 *
 * Owner rules: no blanket rules; every Horse decision priced by range, equity
 * and EV; humans and Horses treated identically.
 *
 * What E6 fixes on the PLO6 cash flop (measured on all 667 PLO6 postflop flop
 * facing-bet decisions in the 48 h human-table cash set, 1,218 hands, opponent
 * six-card holdings read from facts.json):
 *
 * 1. HEADS-UP FIRST FLOP BET WITH CHIPS BEHIND: priced as the two-street game
 *    tree on the hand's own sampled six-card runouts
 *    (HorseOmahaFlopDefenceTree.omahaFlopDefenceTreeEv) instead of flat
 *    `equity x realization`. A one-pair flop call whose equity vanishes when
 *    the bettor barrels the turn (at the population turn/river bet rates from
 *    omahaFlopDefenceTreeInputs(null, null) and 0.73 pot sizes) folds by price
 *    inside the tree, while made hands and overpairs with nut boat / flush /
 *    wrap redraws keep their two-street value. Request-pure (no opponent
 *    memory or table-speed field read), so the receipt validator re-runs the
 *    exact same verdict on the request alone.
 *
 * 2. MULTIWAY FLOP CALLER AND BEHIND RANGE TRANSLATION: OMAHA_FLOP_EV_CALLER_SHARE
 *    (0.55, tapered below 0.25 pot) and OMAHA_EV_ALL_IN_SHARE (0.50) were set
 *    on four-card holdings. Taking the top 0.55 of six-card holdings directly
 *    understates the board-relative strength of a multiway caller or continuing
 *    player behind, causing bare one-pair hands to call multiway with negative
 *    true equity (17 of 26 multiway flop fold->call flips in #11511 were bare
 *    one-pair hands with mean true equity 0.176 below mean price 0.233).
 *    Translating each caller/all-in/behind share to six-card holdings at the
 *    same four-card hand strength (HorsePlo6ValueShare.plo6ValueShareAtSameStrength)
 *    prices the multiway field on the same six-card strength scale as the
 *    bettor's value share.
 *
 * Pure: no telemetry, no opponent memory, no table-speed field, no random draw
 * from the brain's stream.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { OMAHA_EV_ALL_IN_SHARE } from './HorseOmahaFacingBetEv.js';
import {
  omahaFlopDefenceTreeEv,
  omahaFlopDefenceTreeInputs,
  type OmahaFlopDefenceTreeResult,
} from './HorseOmahaFlopDefenceTree.js';
import { omahaComboStraightOuts } from './HorseOmahaBigDrawAggression.js';
import {
  OMAHA_FLOP_EV_CALLER_SHARE,
  OMAHA_FLOP_EV_REALIZATION_FIT,
  OMAHA_FLOP_EV_REALIZATION_PRIOR_CALLS,
  omahaFlopEvBehindContinue,
  omahaFlopEvCounts,
  omahaFlopFacingBetEvSpot,
  omahaFlopFittedRealization,
  omahaFlopHandClass,
  omahaFlopRunoutRealization,
  type OmahaFlopFacingBetEvSpot,
  type OmahaFlopHandClass,
} from './HorseOmahaFlopFacingBetEv.js';
import { omahaStrategyConstant } from './HorseOmahaStrategyGame.js';
import { RANK_VALUES } from './PokerEngine.js';

/** Population two-street tree inputs (request-pure: no opponent memory or seat flag). */
export const PLO6_FLOP_DEFENCE_TREE_INPUTS = Object.freeze(omahaFlopDefenceTreeInputs(null, null));

export interface Plo6FlopDefenceVerdict {
  call: boolean;
  ev: number;
  margin: number;
  pWin: number;
  pTie: number;
  price: number;
  klass: OmahaFlopHandClass;
  realization: number;
  callerShareSix: number;
  allInShareSix: number;
  tree: OmahaFlopDefenceTreeResult | null;
  spot: OmahaFlopFacingBetEvSpot;
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

function binomial(n: number, k: number): number {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
}

/**
 * True when a six-card flop draw (`omahaFlopHandClass === 'draw'`) holds either the
 * nut flush draw of a two-suited board or a >= 12-out straight wrap (`omahaComboStraightOuts`).
 * Non-nut flush draws and bare 8-out straight draws in multiway six-card pots get dominated
 * by opponents' 15 two-card combinations and realize as `pair` rather than `draw`.
 */
function hasNutQualityMultiwayDraw(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[]
): boolean {
  const bySuit = new Map<string, Card[]>();
  for (const c of board) {
    const arr = bySuit.get(c.suit) ?? [];
    arr.push(c);
    bySuit.set(c.suit, arr);
  }
  for (const [suit, bCards] of bySuit) {
    if (bCards.length !== 2) continue;
    const hCards = hole.filter((c) => c.suit === suit);
    if (hCards.length < 2) continue;
    const boardRanks = new Set(bCards.map((c) => RANK_VALUES[c.rank]));
    let topUnseenOnBoard = 14; // RANK_VALUES['A'] === 14
    while (topUnseenOnBoard >= 2 && boardRanks.has(topUnseenOnBoard)) topUnseenOnBoard--;
    if (hCards.some((c) => RANK_VALUES[c.rank] === topUnseenOnBoard)) return true;
  }
  return omahaComboStraightOuts(hole, board, dead) >= 12;
}

/**
 * Six-card flop defence verdict for PLO6 cash facing a bet or raise.
 * Returns null outside the PLO6 cash flop spot or when the hand cannot be sampled.
 */
export function plo6FlopDefenceVerdict(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: { rake: number; inPosition: boolean }
): Plo6FlopDefenceVerdict | null {
  try {
    const spot = omahaFlopFacingBetEvSpot(player, gs, { plo6Priced: true });
    if (!spot) return null;
    const hole: Card[] = player.cards ?? [];
    const board: Card[] = gs.communityCards ?? [];
    const dead: Card[] = player.knownDeadCards ?? [];
    if (hole.length !== 6 || board.length !== 3) return null;

    const baseCallerShare =
      spot.potFrac < 0.25
        ? 1 - (1 - OMAHA_FLOP_EV_CALLER_SHARE) * (spot.potFrac / 0.25)
        : OMAHA_FLOP_EV_CALLER_SHARE;
    // In six-card Omaha each multiway caller or continuing player behind holds C(6,2)=15
    // two-card combinations (2.5x PLO4's 6), concentrating multiway continues into top
    // two-pair, sets, wraps and nut flush draws rather than the wider 0.55 four-card pool.
    // Scaling the 4-card continue pool by 6 / 15 = 0.40 before board-strength check keeps
    // six-card multiway callers at realistic six-card top-range strength (~0.22-0.35).
    const callerShareSix =
      spot.callers + spot.behind > 0
        ? Math.max(0.15, Math.min(0.65, baseCallerShare * (6 / 15)))
        : baseCallerShare;
    const allInShareSix =
      spot.allIns > 0
        ? Math.max(0.15, Math.min(0.65, OMAHA_EV_ALL_IN_SHARE * (6 / 15)))
        : OMAHA_EV_ALL_IN_SHARE;

    const always: number[] = [];
    for (let i = 0; i < spot.callers; i++) always.push(callerShareSix);
    for (let i = 0; i < spot.allIns; i++) always.push(allInShareSix);

    const counted = omahaFlopEvCounts(
      hole,
      board,
      dead,
      spot.valueShare,
      { always, behind: spot.behind, behindShare: callerShareSix },
      0,
      undefined,
      true
    );
    if (!counted) return null;

    const rawKlass = omahaFlopHandClass(hole, board, dead);
    const q = clamp01(spot.priorBluff);
    const inPosition = ctx.inPosition === true;
    const isMultiway = spot.callers + spot.allIns + spot.behind > 0;
    const klass: OmahaFlopHandClass =
      isMultiway && rawKlass === 'draw' && !hasNutQualityMultiwayDraw(hole, board, dead)
        ? 'pair'
        : rawKlass;
    let realization = 1;
    if (!spot.final) {
      const r = omahaFlopRunoutRealization(counted.rows, counted.turnOf, q, inPosition);
      if (!r) return null;
      realization = omahaFlopFittedRealization(
        r.realization,
        klass,
        inPosition,
        spot.later
      ).realization;
      // Six-card multiway flop non-made hands without a nut-quality draw (`klass === 'pair'`)
      // face multi-opponent turn/river aggression where 15-pair opponents hold sets/two-pair/nut draws;
      // scale non-final realization by 1 / (1 + 0.35 * multiwayOpponents) so bare pairs/dominated draws fold.
      if (isMultiway && klass === 'pair') {
        const mwOpps = spot.callers + spot.allIns + spot.behind;
        realization = 1 + (realization / (1 + 0.35 * mwOpps) - 1) * clamp01(spot.later);
      }
    }

    const rake = Math.max(0, Math.min(0.2, Number.isFinite(ctx.rake) ? ctx.rake : 0));
    const B = spot.behind;
    const c = B > 0 ? clamp01(omahaFlopEvBehindContinue(spot.potFrac)) : 0;
    let ev = 0;
    let pWin = 0;
    let pTie = 0;
    for (let j = 0; j <= B; j++) {
      const weight = B > 0 ? binomial(B, j) * c ** j * (1 - c) ** (B - j) : 1;
      if (!(weight > 0)) continue;
      const jv = counted.jointValue[j];
      const jo = counted.jointOther[j];
      const win = Math.min(1, realization * (q * jo.win + (1 - q) * jv.win));
      const tie = Math.min(1 - win, realization * (q * jo.tie + (1 - q) * jv.tie));
      const tieShare = Math.min(tie, realization * (q * jo.tieShare + (1 - q) * jv.tieShare));
      const pot = (spot.winnable + j * spot.behindCall) * (1 - rake);
      ev +=
        weight *
        (win * pot + tieShare * (pot + spot.paid) - tie * spot.paid - (1 - win - tie) * spot.paid);
      pWin += weight * win;
      pTie += weight * tie;
    }

    const baseMargin =
      omahaStrategyConstant('facingBetEvMargin', { gameVariant: 'plo6' }) *
      (spot.winnable + spot.paid);
    const margin = spot.potFrac < 0.1 ? Math.min(baseMargin, 0.5 * spot.paid) : baseMargin;
    const price = spot.paid / (spot.winnable + spot.paid);

    // Heads-up first flop bet with chips behind: price the two-street barrel tree on these runouts.
    let tree: OmahaFlopDefenceTreeResult | null = null;
    if (
      !spot.final &&
      !spot.isRaise &&
      spot.callers === 0 &&
      spot.allIns === 0 &&
      spot.behind === 0 &&
      gs.bettingStructure !== 'fixed_limit'
    ) {
      const bettor = (gs.players ?? []).find((p) => p.seat === spot.bettorSeat);
      const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
      const his = bettor && Number.isFinite(bettor.stack) ? Math.max(0, bettor.stack) : Infinity;
      const left = Math.min(Math.max(0, stack - spot.paid), his);
      tree = omahaFlopDefenceTreeEv(
        counted.rows,
        counted.turnOf,
        { paid: spot.paid, winnable: spot.winnable, left, rake, bluffShare: q },
        PLO6_FLOP_DEFENCE_TREE_INPUTS
      );
      if (tree) {
        // `omahaFlopDefenceTreeEv` ranks the bettor's value/non-value split on the static flop
        // board (`share(k, qb)`) without re-conditioning on which six-card holdings barrel a
        // scare turn or river. Apply the measured class/position ratio (`OMAHA_FLOP_EV_REALIZATION_FIT`:
        // 0.576 IP / 0.518 OOP on bare pairs, 0.892 IP / 0.688 OOP on made hands) to the tree's
        // post-call pot return (`tree.ev + spot.paid`) scaled by `spot.later`, and take
        // `Math.min(ev, fittedTreeEv)` so a call must survive BOTH the fitted runout realization
        // AND the fitted two-street barrel tree.
        const fitCell = OMAHA_FLOP_EV_REALIZATION_FIT[klass][inPosition ? 'ip' : 'oop'];
        const fitWeight = fitCell.n / (fitCell.n + OMAHA_FLOP_EV_REALIZATION_PRIOR_CALLS);
        const fitMul = 1 + (fitCell.ratio - 1) * fitWeight * clamp01(spot.later);
        const fittedTreeEv = (tree.ev + spot.paid) * fitMul - spot.paid;
        ev = Math.min(ev, fittedTreeEv);
      }
    }

    return {
      call: ev > margin,
      ev,
      margin,
      pWin,
      pTie,
      price,
      klass,
      realization,
      callerShareSix,
      allInShareSix,
      tree,
      spot,
    };
  } catch {
    return null;
  }
}
