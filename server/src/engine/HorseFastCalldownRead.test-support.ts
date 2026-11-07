/**
 * Harness for the fast call-down read (2026-11-07): a seat ('opp3', the
 * opponent of the HorseV54RiverBluff fixtures) that first over-folds river
 * bets and then switches to calling every river bet, observed by the live
 * HorseMind through observeHandComplete exactly as completed hands are.
 *
 * One synthetic heads-up hand per call. A river hand: hero raises, opp3
 * calls, the flop and turn check through, opp3 checks the river, hero bets
 * and opp3 folds or calls. That is ONE river-call opportunity and the only
 * postflop bet opp3 faces, so the river read is all the hand teaches. A
 * blank hand: a limped pot checked down, no river bet (the fast window still
 * ages a hand, the long window's gated river statistic does not).
 *
 * The reads measured are the ones HorseLogic gives the river bluff layers:
 * the station flag, the riverFoldRate, and the fast call-down factor.
 */
import type { ActionRecord } from '../types.js';
import { HorseMind, readScopeOf } from './HorseMind.js';

export const FCA_OPP = 'opp3';
export const FCA_HERO = 'hero';

const FCA_TABLE = '50000000-0000-4000-8000-0000000000fc';
let handCounter = 1_000_000;

export type FcaAnswer = 'fold' | 'call';

/** One completed heads-up hand. `river` null: a checked-down blank. */
export function observeFcaHand(
  river: FcaAnswer | null,
  variant: 'nlh' | 'plo4' = 'nlh',
  opp: string = FCA_OPP
): void {
  const acts: ActionRecord[] = [];
  let ts = 1;
  const push = (userId: string, action: string, amount: number, stage: string) =>
    acts.push({
      seat: userId === FCA_HERO ? 1 : 3,
      userId,
      action,
      amount,
      timestamp: ts++,
      stage,
    } as ActionRecord);
  if (river === null) {
    push(FCA_HERO, 'call', 2, 'preflop');
    push(opp, 'check', 0, 'preflop');
  } else {
    push(FCA_HERO, 'raise', 6, 'preflop');
    push(opp, 'call', 6, 'preflop');
  }
  for (const stage of ['flop', 'turn'] as const) {
    push(opp, 'check', 0, stage);
    push(FCA_HERO, 'check', 0, stage);
  }
  push(opp, 'check', 0, 'river');
  if (river === null) push(FCA_HERO, 'check', 0, 'river');
  else {
    push(FCA_HERO, 'bet', 10, 'river');
    push(opp, river, river === 'call' ? 10 : 0, 'river');
  }
  handCounter++;
  // Production order (horseDecision/workerRuntime observeCompletedHandInMind):
  // the completed action stream through observe(), then the hand-complete
  // learner.
  const scope = readScopeOf(variant, 2);
  const prev = HorseMind.currentScope();
  HorseMind.setDecisionScope(scope, variant);
  try {
    HorseMind.observe(acts, [], { version: 1, tableId: FCA_TABLE, handNumber: handCounter }, 2);
  } finally {
    HorseMind.setDecisionScope(prev);
  }
  HorseMind.observeHandComplete(
    `${FCA_TABLE}:${handCounter}`,
    acts,
    2,
    null,
    readScopeOf(variant, 2)
  );
}

/**
 * Play `opps` river opportunities answered `answer`, with `blanksBetween`
 * blank hands before each one (the share of hands a player really faces a
 * river bet is small). Calls `after(i)` after the i-th opportunity (1-based).
 */
export function playFcaPhase(
  answer: FcaAnswer,
  opps: number,
  blanksBetween = 0,
  after: (i: number) => void = () => {},
  variant: 'nlh' | 'plo4' = 'nlh'
): void {
  for (let i = 1; i <= opps; i++) {
    for (let b = 0; b < blanksBetween; b++) observeFcaHand(null, variant);
    observeFcaHand(answer, variant);
    after(i);
  }
}
