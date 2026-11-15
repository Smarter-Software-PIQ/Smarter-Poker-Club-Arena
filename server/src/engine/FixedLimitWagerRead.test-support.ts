/**
 * Fixed-limit river spots and a seeded decision sweep for the Fixed-Limit
 * lane laws (SPEC-FL-01..03). Built on the heads-up variants support: the real
 * HandController deals and enforces the fixed-limit menu, the real
 * HorseLogic.decide answers with the live Hybrid persona, and opponent cards
 * never reach the policy. The laws run with the opponent-intelligence layer ON
 * (`mind: true`, the production default): the range reads live there.
 */
import type { HorseDecideOpts } from './HorseLogic.js';
import { cards, deal, decide, lcg, menuOf, type Table } from './HuVariantSpot.test-support.js';

export type Step = readonly [seat: number, action: 'fold' | 'check' | 'call' | 'bet' | 'raise'];

/** Deal `deck` (hero first, then each other seat, then the board) and play `steps` at the one legal fixed size. */
export function spot(variant: string, seats: number, deck: string, steps: readonly Step[]): Table {
  const t = deal({ variant, fmt: 'cash', stacks: Array(seats).fill(200), prefix: cards(deck) });
  for (const [seat, action] of steps) {
    const actor = t.controller.getCurrentPlayer();
    if (!actor || actor.seat !== seat)
      throw new Error(`expected seat ${seat} to act (${action}), controller says ${actor?.seat}`);
    const amount =
      action === 'bet' || action === 'raise' ? (menuOf(t).minRaiseTo ?? undefined) : undefined;
    if (!t.controller.performAction(seat, action, amount, 'player'))
      throw new Error(`controller rejected seat ${seat} ${action}`);
  }
  return t;
}

/** How often each action is chosen over `seeds` seeds (the seeds of the lane's probe: 500 + 17 s). */
export function tally(
  variant: string,
  seats: number,
  deck: string,
  steps: readonly Step[],
  opts: HorseDecideOpts,
  seeds = 12
): Record<string, number> {
  const out: Record<string, number> = {};
  for (let s = 0; s < seeds; s++) {
    const d = decide(spot(variant, seats, deck, steps), 500 + s * 17, opts).d;
    out[d.action] = (out[d.action] ?? 0) + 1;
  }
  return out;
}

// Heads-up: seat 1 is the button and small blind (first preflop, last postflop), seat 2 the big blind.
export const HU_PRE: readonly Step[] = [
  [1, 'raise'],
  [2, 'call'],
];
/** Heads-up, hero on the button: bet the flop and is called, the turn checks through, the big blind bets the river. Pot 16, 4 to call. */
export const HU_RIVER_DONK: readonly Step[] = [
  ...HU_PRE,
  [2, 'check'],
  [1, 'bet'],
  [2, 'call'],
  [2, 'check'],
  [1, 'check'],
  [2, 'bet'],
];
/** Heads-up, the big blind bets every street and hero calls. Pot 24, 4 to call on the river. */
export const HU_THREE_BARRELS: readonly Step[] = [
  ...HU_PRE,
  [2, 'bet'],
  [1, 'call'],
  [2, 'bet'],
  [1, 'call'],
  [2, 'bet'],
];
/** Heads-up, both streets check through, the big blind bets the river. Pot 12, 4 to call. */
export const HU_ONE_RIVER_BET: readonly Step[] = [
  ...HU_PRE,
  [2, 'check'],
  [1, 'check'],
  [2, 'check'],
  [1, 'check'],
  [2, 'bet'],
];
/** Heads-up, capped preflop, hero bets flop and turn and is called, the big blind bets the river. Pot 32, 4 to call. */
export const HU_LARGE_POT_DONK: readonly Step[] = [
  [1, 'raise'],
  [2, 'raise'],
  [1, 'raise'],
  [2, 'call'],
  [2, 'check'],
  [1, 'bet'],
  [2, 'call'],
  [2, 'check'],
  [1, 'bet'],
  [2, 'call'],
  [2, 'bet'],
];
/** Three-handed, seat 2 bets every street, seat 3 calls, hero (button) closes the river. Pot 38, 4 to call. */
export const THREE_WAY_BET_CALL: readonly Step[] = [
  [1, 'raise'],
  [2, 'call'],
  [3, 'call'],
  [2, 'bet'],
  [3, 'call'],
  [1, 'call'],
  [2, 'bet'],
  [3, 'call'],
  [1, 'call'],
  [2, 'bet'],
  [3, 'call'],
];
/** Heads-up, every street checked to hero on the button on the river. Pot 8. */
export const HU_CHECKED_TO_BUTTON: readonly Step[] = [
  ...HU_PRE,
  [2, 'check'],
  [1, 'check'],
  [2, 'check'],
  [1, 'check'],
  [2, 'check'],
];
/** Heads-up, flop and turn checked through, hero in the big blind first to act on the river. Pot 8. */
export const HU_BIG_BLIND_FIRST: readonly Step[] = [
  ...HU_PRE,
  [2, 'check'],
  [1, 'check'],
  [2, 'check'],
  [1, 'check'],
];

export interface SweepNode {
  variant: string;
  stage: string;
  facing: boolean;
  base: string;
  other: string;
}

/**
 * Play `hands` seeded random deals of `variant` forward with the BASE options,
 * and at every node also ask the brain with the OTHER options from the same
 * seed. Returns one row per decision: the two answers as text (action, amount
 * and think time). The base answer is the one played.
 */
export function sweep(
  variant: string,
  hands: number,
  base: HorseDecideOpts,
  other: HorseDecideOpts
): SweepNode[] {
  const rows: SweepNode[] = [];
  const text = (d: { action: string; amount?: number; thinkTime?: number }) =>
    JSON.stringify([d.action, d.amount ?? null, d.thinkTime ?? null]);
  for (let h = 0; h < hands; h++) {
    const seats = 2 + (h % 3);
    const t = deal({
      variant,
      fmt: 'cash',
      stacks: Array(seats).fill(200),
      rnd: lcg(20261114 + h * 7919),
    });
    for (let step = 0; step < 24; step++) {
      const actor = t.controller.getCurrentPlayer();
      const stage = t.controller.getState().stage;
      if (!actor || stage === 'showdown') break;
      const seed = 9000 + h * 31 + step;
      const a = decide(t, seed, base);
      const b = decide(t, seed, other).d;
      rows.push({ variant, stage, facing: a.menu.toCall > 0, base: text(a.d), other: text(b) });
      const act = a.d.action;
      const amount = act === 'bet' || act === 'raise' ? a.d.amount : undefined;
      if (!t.controller.performAction(actor.seat, act, amount, 'player')) break;
    }
  }
  return rows;
}
