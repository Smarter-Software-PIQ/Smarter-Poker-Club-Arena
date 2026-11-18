/**
 * EVERY PLO RULE FIRING NAMES THE DECISION IT CHANGED (2026-11-15).
 *
 * omahaRiverNutRaiseOnly (omaha_river_non_nut_raise_flatted / _fold_restored and
 * the V81 set cell v81_river_set_big_bet_fold), omahaTurnSetPound
 * (omaha_turn_set_pound) and omahaNutClassValueSize (omaha_nut_class_pot_wager)
 * were proven live only by day totals. Each now also records, inside the
 * decision's own fire scope, the action it was given and the action it left
 * (BrainTelemetry.noteDecisionRuleReceipt); the worker journals that list with
 * the decision, whose fence names the table and hand
 * (ruleReceiptsAreJournaledWithTheirHand.test.ts).
 *
 * Pinned here, on the public records of hands 59401453 and 59414191 (the same
 * complaint fixtures the rules' own tests use):
 *  - each receipted fire of a decision has exactly one receipt in that
 *    decision's list, and nothing else does;
 *  - the receipts chain in the order the rules acted, and the last one is the
 *    action the decision returned;
 *  - recording changes nothing: the same seed decides the same action and
 *    amount inside a scope and outside one, and a rule switched off leaves
 *    no receipt.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import {
  drainFires,
  enableBrainTelemetry,
  withDecisionFireScope,
  type DecisionRuleReceipt,
} from './BrainTelemetry.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintFixture,
  type ComplaintPublicNode,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import TOP_SET_RIVER from './horseComplaints/plo5-top-set-jams-over-a-pot-river-lead.fixture.json';
import SET_RAISES_TURN from './horseComplaints/plo5-set-raises-a-pot-turn-lead-on-the-straight-card.fixture.json';

const RECEIPTED = [
  'omaha_river_non_nut_raise_flatted',
  'omaha_river_non_nut_raise_fold_restored',
  'v81_river_set_big_bet_fold',
  'omaha_turn_set_pound',
  'omaha_nut_class_pot_wager',
] as const;
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  (text.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUITS[x[1]] }));

function spot(
  base: unknown,
  ord: number,
  v: { hole?: string; node?: (pn: ComplaintPublicNode) => void } = {}
) {
  const fx = JSON.parse(JSON.stringify(base)) as ComplaintFixture;
  const node = fx.actions.find((a) => a.ord === ord)!;
  if (v.hole) fx.hole[String(node.seat)] = cards(v.hole);
  v.node?.(node.publicNode!);
  return stateAt(fx, node);
}
type Built = ReturnType<typeof spot>;

interface Scoped {
  action: string;
  amount: number | null;
  fired: string[];
  receipts: DecisionRuleReceipt[];
}

/** One live-shaped decision inside a decision scope, as the worker's FAST execution runs it. */
function scoped(s: Built, seed: number, opts: Record<string, unknown> = {}): Scoped {
  enableBrainTelemetry();
  seedFastRandom(seed);
  HorseMind.reset();
  drainFires();
  const run = withDecisionFireScope(() =>
    HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: true,
      ...opts,
    } as never)
  );
  return {
    action: run.value.action,
    amount: typeof run.value.amount === 'number' ? run.value.amount : null,
    fired: [...run.fired],
    receipts: run.ruleReceipts.map((r) => ({ ...r })),
  };
}

/** The same decision with no scope open (a league or benchmark call, or before this change). */
function unscoped(s: Built, seed: number, opts: Record<string, unknown> = {}) {
  enableBrainTelemetry();
  seedFastRandom(seed);
  HorseMind.reset();
  drainFires();
  const d = HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
    mind: false,
    telemetry: true,
    ...opts,
  } as never);
  return { action: d.action, amount: typeof d.amount === 'number' ? d.amount : null };
}

/** The receipts name exactly the receipted rules that fired, chain in order, and end at the decision. */
function expectReceiptsOfTheDecision(run: Scoped) {
  const firedReceipted = RECEIPTED.filter((k) => run.fired.includes(k));
  expect(run.receipts.map((r) => r.receipt).sort()).toEqual([...firedReceipted].sort());
  for (let i = 1; i < run.receipts.length; i++)
    expect(
      run.receipts[i].before,
      `${run.receipts[i].receipt} takes what the rule before it left`
    ).toEqual(run.receipts[i - 1].after);
  if (run.receipts.length)
    expect(run.receipts.at(-1)!.after).toEqual({ action: run.action, amount: run.amount });
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.reset();
});

describe('hand 59401453, river: the raise the nut-raise rule flatted, then the V81 set cell folded', () => {
  const river = () => spot(TOP_SET_RIVER, 23);

  it('records raise -> call -> fold at every seed, in the order the rules acted', () => {
    for (const seed of SEEDS) {
      const run = scoped(river(), seed);
      expectReceiptsOfTheDecision(run);
      expect(run.receipts.map((r) => r.receipt)).toEqual([
        'omaha_river_non_nut_raise_flatted',
        'v81_river_set_big_bet_fold',
      ]);
      const [flatted, folded] = run.receipts;
      // The recorded jam was more than the call (stack 314.35 facing 184).
      expect(['raise', 'all_in']).toContain(flatted.before!.action);
      expect(flatted.after.action).toBe('call');
      expect(folded.after).toEqual({ action: 'fold', amount: null });
      expect(run.action).toBe('fold');
    }
  });

  it('decides the same with or without a scope, and leaves no receipt with the rule off', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const s = river();
      const run = scoped(s, seed);
      expect({ action: run.action, amount: run.amount }).toEqual(unscoped(s, seed));
      const off = scoped(s, seed, { omahaRiverNutRaiseOnly: false });
      expect(off.receipts).toEqual([]);
      expect(off.fired.filter((k) => (RECEIPTED as readonly string[]).includes(k))).toEqual([]);
    }
  });
});

describe('hand 59401453, turn: the set pound', () => {
  const turn = () => spot(TOP_SET_RIVER, 20);

  it('records the bet the rule sized, with no prior action, and it is the bet the decision made', () => {
    for (const seed of SEEDS) {
      const run = scoped(turn(), seed);
      expectReceiptsOfTheDecision(run);
      const pound = run.receipts.filter((r) => r.receipt === 'omaha_turn_set_pound');
      expect(pound).toHaveLength(1);
      expect(pound[0].before).toBeNull();
      expect(pound[0].after.action).toBe('bet');
      expect(pound[0].after.amount!).toBeGreaterThanOrEqual(75);
      expect({ action: run.action, amount: run.amount }).toEqual(unscoped(turn(), seed));
    }
  });

  it('with the rule off there is no receipt and the decision is the one the rule-off brain makes', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const off = scoped(turn(), seed, { omahaTurnSetPound: false });
      expect(off.receipts.filter((r) => r.receipt === 'omaha_turn_set_pound')).toEqual([]);
      expectReceiptsOfTheDecision(off);
      expect({ action: off.action, amount: off.amount }).toEqual(
        unscoped(turn(), seed, { omahaTurnSetPound: false })
      );
    }
  });
});

describe('hand 59414191, flop: a nut-class hand sized to the pot', () => {
  // Top set on a board with no straight or flush possible (HorseOmahaMadeHandDefense.test.ts).
  const flop = () => spot(SET_RAISES_TURN, 15, { hole: 'KcKh7c7hAs' });
  // omahaNutClassValueSize ships OFF (#10989, after its Nov 15 evaluation failed): opt in, as the rule's own
  // test does (HorseOmahaMadeHandDefense.test.ts), so the receipt is measured where the rule acts.
  const SIZE_ON = { omahaNutClassValueSize: true };

  it('records the smaller wager the rule was given and the pot it left', () => {
    let sized = 0;
    for (const seed of SEEDS) {
      const run = scoped(flop(), seed, SIZE_ON);
      expectReceiptsOfTheDecision(run);
      for (const r of run.receipts.filter((x) => x.receipt === 'omaha_nut_class_pot_wager')) {
        sized++;
        expect(r.before).not.toBeNull();
        expect(['bet', 'raise', 'all_in']).toContain(r.before!.action);
        expect(r.after).toEqual({ action: 'bet', amount: 56 });
        expect(r.before).not.toEqual(r.after);
      }
      expect({ action: run.action, amount: run.amount }).toEqual(unscoped(flop(), seed, SIZE_ON));
    }
    expect(sized, 'not a vacuous pass: the rule sized at least one seed').toBeGreaterThan(0);
  });
});

describe('what records nothing', () => {
  it('a decision outside telemetry (league, benchmark, replay) inside a scope', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const run = scoped(spot(TOP_SET_RIVER, 23), seed, { telemetry: false });
      expect(run.receipts).toEqual([]);
      expect(run.fired.filter((k) => (RECEIPTED as readonly string[]).includes(k))).toEqual([]);
    }
  });
});
