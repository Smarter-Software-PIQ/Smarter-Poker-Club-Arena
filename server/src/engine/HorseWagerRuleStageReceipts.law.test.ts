/**
 * EVERY WAGER_RULES STAGE THAT CHANGES A DECISION NAMES ITSELF (LEAKMAP, 2026-11-19).
 *
 * In the 48 hours to 6:49 PM Chicago on Nov 19, 1,267 PLO5 cash decisions were
 * changed by the policy graph's wager_rules node and only 11 of them named the
 * rule that changed them. Examples: 194 preflop calls facing a 3-bet turned
 * into folds, and 71 turn plus 47 river calls turned into folds. Each stage of
 * the node's chain now records a per-decision rule receipt `wager_rules.<stage>`
 * when it changes the action or the amount, unless the stage recorded its own
 * named receipt meanwhile.
 *
 * Pinned here:
 *  - measurement only: the stage's decision is returned untouched, with
 *    telemetry on or off;
 *  - no receipt without telemetry, and none for a stage that changes nothing;
 *  - a stage that already recorded its own named receipt is not recorded twice;
 *  - on the public record of hand 59401453 (river), the same seed decides the
 *    same action and amount inside a scope and outside one, and every receipt
 *    chains from the action the previous one left.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, receiptWagerRuleStage } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import {
  drainFires,
  enableBrainTelemetry,
  noteDecisionRuleReceipt,
  withDecisionFireScope,
} from './BrainTelemetry.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import type { HorseDecision } from '../types.js';
import TOP_SET_RIVER from './horseComplaints/plo5-top-set-jams-over-a-pot-river-lead.fixture.json';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const call: HorseDecision = { action: 'call', amount: 40, thinkTime: 900 };
const fold: HorseDecision = { action: 'fold', thinkTime: 900 };

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.reset();
});

describe('receiptWagerRuleStage', () => {
  it('records a changing stage by name, inside a decision scope with telemetry on', () => {
    enableBrainTelemetry();
    const run = withDecisionFireScope(() =>
      receiptWagerRuleStage(true, 'omaha_big_bet_call_fold', call, () => fold)
    );
    expect(run.value).toBe(fold);
    expect(run.ruleReceipts).toEqual([
      {
        receipt: 'wager_rules.omaha_big_bet_call_fold',
        before: { action: 'call', amount: 40 },
        after: { action: 'fold', amount: null },
      },
    ]);
  });

  it('records nothing with telemetry off, and returns the stage decision untouched', () => {
    enableBrainTelemetry();
    const run = withDecisionFireScope(() =>
      receiptWagerRuleStage(false, 'omaha_big_bet_call_fold', call, () => fold)
    );
    expect(run.value).toBe(fold);
    expect(run.ruleReceipts).toEqual([]);
  });

  it('records nothing for a stage that changes neither action nor amount', () => {
    enableBrainTelemetry();
    const same: HorseDecision = { ...call };
    const run = withDecisionFireScope(() =>
      receiptWagerRuleStage(true, 'paired_board_fold', call, () => same)
    );
    expect(run.value).toBe(same);
    expect(run.ruleReceipts).toEqual([]);
  });

  it('records an amount-only change (a resize)', () => {
    enableBrainTelemetry();
    const bet: HorseDecision = { action: 'bet', amount: 10, thinkTime: 1 };
    const resized: HorseDecision = { action: 'bet', amount: 30, thinkTime: 1 };
    const run = withDecisionFireScope(() =>
      receiptWagerRuleStage(true, 'omaha_own_bet_rules', bet, () => resized)
    );
    expect(run.ruleReceipts.map((r) => r.receipt)).toEqual(['wager_rules.omaha_own_bet_rules']);
  });

  it('does not double-record a stage that wrote its own named receipt', () => {
    enableBrainTelemetry();
    const run = withDecisionFireScope(() =>
      receiptWagerRuleStage(true, 'omaha_big_bet_call_fold', call, () => {
        noteDecisionRuleReceipt('v81_river_set_big_bet_fold', call, fold);
        return fold;
      })
    );
    expect(run.ruleReceipts.map((r) => r.receipt)).toEqual(['v81_river_set_big_bet_fold']);
  });

  it('reads the action before the stage runs, even if the stage mutates its input', () => {
    enableBrainTelemetry();
    const input: HorseDecision = { action: 'call', amount: 40, thinkTime: 1 };
    const run = withDecisionFireScope(() =>
      receiptWagerRuleStage(true, 'mutating_stage', input, () => {
        (input as { action: string }).action = 'fold';
        delete input.amount;
        return input;
      })
    );
    expect(run.ruleReceipts[0]?.before).toEqual({ action: 'call', amount: 40 });
  });
});

describe('hand 59401453 river: stage receipts change no decision and chain in order', () => {
  const spot = () => {
    const fx = JSON.parse(JSON.stringify(TOP_SET_RIVER)) as ComplaintFixture;
    const node = fx.actions.find((a) => a.ord === 23)!;
    return stateAt(fx, node);
  };
  it('decides identically with and without a scope at 12 seeds; receipts chain to the decision', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = spot();
      enableBrainTelemetry();
      seedFastRandom(seed);
      HorseMind.reset();
      drainFires();
      const run = withDecisionFireScope(() =>
        HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
          mind: false,
          telemetry: true,
        } as never)
      );
      const s2 = spot();
      seedFastRandom(seed);
      HorseMind.reset();
      drainFires();
      const bare = HorseLogic.decide(s2.hero, s2.gs, LIVE.style, LIVE.mods, {
        mind: false,
        telemetry: false,
      } as never);
      expect(run.value.action).toBe(bare.action);
      expect(run.value.amount ?? null).toBe(bare.amount ?? null);
      const rs = run.ruleReceipts;
      for (let i = 1; i < rs.length; i++) expect(rs[i].before).toEqual(rs[i - 1].after);
      if (rs.length)
        expect(rs.at(-1)!.after).toEqual({
          action: run.value.action,
          amount: typeof run.value.amount === 'number' ? run.value.amount : null,
        });
    }
  });
});
