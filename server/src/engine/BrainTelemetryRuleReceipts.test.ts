/**
 * The per-decision rule receipts (BrainTelemetry.noteDecisionRuleReceipt): a
 * receipted rule that changed a decision records the action it was given and
 * the action it left, inside that decision's scope only, as a copy, bounded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Telemetry = typeof import('./BrainTelemetry.js');
let telemetry: Telemetry;

/** A fresh module graph per test: the scope and the enabled flag are module state. */
async function load(enable = true): Promise<Telemetry> {
  vi.resetModules();
  const t = await import('./BrainTelemetry.js');
  if (enable) t.enableBrainTelemetry();
  return t;
}
beforeEach(async () => {
  telemetry = await load();
});

const raise = { action: 'raise', amount: 314.35, thinkTime: 0 };
const call = { action: 'call', amount: 184, thinkTime: 0 };
const fold = { action: 'fold', thinkTime: 0 };

describe('per-decision rule receipts', () => {
  it('records each change in order inside the scope, as action and amount only', () => {
    const run = telemetry.withDecisionFireScope(() => {
      telemetry.noteDecisionRuleReceipt('omaha_river_non_nut_raise_flatted', raise, call);
      telemetry.noteDecisionRuleReceipt('v81_river_set_big_bet_fold', call, fold);
      return 'decided';
    });
    expect(run.value).toBe('decided');
    expect(run.ruleReceipts).toEqual([
      {
        receipt: 'omaha_river_non_nut_raise_flatted',
        before: { action: 'raise', amount: 314.35 },
        after: { action: 'call', amount: 184 },
      },
      {
        receipt: 'v81_river_set_big_bet_fold',
        before: { action: 'call', amount: 184 },
        after: { action: 'fold', amount: null },
      },
    ]);
  });

  it('a rule that produced the action itself has no prior action', () => {
    const run = telemetry.withDecisionFireScope(() =>
      telemetry.noteDecisionRuleReceipt('omaha_turn_set_pound', null, {
        action: 'bet',
        amount: 90,
      })
    );
    expect(run.ruleReceipts).toEqual([
      { receipt: 'omaha_turn_set_pound', before: null, after: { action: 'bet', amount: 90 } },
    ]);
  });

  it('copies: changing the decision afterwards does not change its receipt', () => {
    const before = { action: 'bet', amount: 30 };
    const after = { action: 'bet', amount: 56 };
    const run = telemetry.withDecisionFireScope(() => {
      telemetry.noteDecisionRuleReceipt('omaha_nut_class_pot_wager', before, after);
      const soFar = telemetry.decisionRuleReceiptsSoFar()!;
      soFar[0].after.amount = 1;
      after.amount = 2;
      before.action = 'check';
    });
    expect(run.ruleReceipts[0]).toEqual({
      receipt: 'omaha_nut_class_pot_wager',
      before: { action: 'bet', amount: 30 },
      after: { action: 'bet', amount: 56 },
    });
  });

  it('decisionRuleReceiptsSoFar is undefined outside a scope and while nothing was recorded', () => {
    expect(telemetry.decisionRuleReceiptsSoFar()).toBeUndefined();
    telemetry.withDecisionFireScope(() => {
      expect(telemetry.decisionRuleReceiptsSoFar()).toBeUndefined();
      telemetry.noteFire('decide_postflop');
      expect(telemetry.decisionRuleReceiptsSoFar()).toBeUndefined();
      telemetry.noteDecisionRuleReceipt('omaha_river_non_nut_raise_flatted', raise, call);
      expect(telemetry.decisionRuleReceiptsSoFar()).toHaveLength(1);
    });
    expect(telemetry.decisionRuleReceiptsSoFar()).toBeUndefined();
  });

  it('records nothing outside a scope, from a suspended evaluation, or with telemetry off', async () => {
    telemetry.noteDecisionRuleReceipt('omaha_river_non_nut_raise_flatted', raise, call);
    const run = telemetry.withDecisionFireScope(() =>
      telemetry.withBrainTelemetrySuspended(() =>
        telemetry.noteDecisionRuleReceipt('omaha_river_non_nut_raise_flatted', raise, call)
      )
    );
    expect(run.ruleReceipts).toEqual([]);
    const off = await load(false);
    expect(
      off.withDecisionFireScope(() =>
        off.noteDecisionRuleReceipt('omaha_river_non_nut_raise_flatted', raise, call)
      ).ruleReceipts
    ).toEqual([]);
  });

  it('gives each decision its own list: the next decision does not inherit the last one', () => {
    const first = telemetry.withDecisionFireScope(() =>
      telemetry.noteDecisionRuleReceipt('omaha_river_non_nut_raise_flatted', raise, call)
    );
    const second = telemetry.withDecisionFireScope(() => 0);
    expect(first.ruleReceipts).toHaveLength(1);
    expect(second.ruleReceipts).toEqual([]);
  });

  it('hands a nested scope its receipts to the outer one, and restores it after a throw', () => {
    const outer = telemetry.withDecisionFireScope(() => {
      telemetry.noteDecisionRuleReceipt('omaha_turn_set_pound', null, {
        action: 'bet',
        amount: 90,
      });
      const inner = telemetry.withDecisionFireScope(() =>
        telemetry.noteDecisionRuleReceipt(
          'omaha_nut_class_pot_wager',
          { action: 'bet', amount: 90 },
          {
            action: 'bet',
            amount: 100,
          }
        )
      );
      expect(inner.ruleReceipts.map((r) => r.receipt)).toEqual(['omaha_nut_class_pot_wager']);
      expect(() =>
        telemetry.withDecisionFireScope(() => {
          telemetry.noteDecisionRuleReceipt('v81_river_set_big_bet_fold', call, fold);
          throw new Error('brain threw');
        })
      ).toThrow('brain threw');
      telemetry.noteDecisionRuleReceipt('omaha_river_non_nut_raise_flatted', raise, call);
    });
    expect(outer.ruleReceipts.map((r) => r.receipt)).toEqual([
      'omaha_turn_set_pound',
      'omaha_nut_class_pot_wager',
      'v81_river_set_big_bet_fold',
      'omaha_river_non_nut_raise_flatted',
    ]);
    expect(telemetry.decisionRuleReceiptsSoFar()).toBeUndefined();
  });

  it('is bounded per decision, and the fire counters are unaffected', () => {
    const run = telemetry.withDecisionFireScope(() => {
      for (let i = 0; i < telemetry.DECISION_RULE_RECEIPTS_MAX + 5; i++) {
        telemetry.noteFire('omaha_nut_class_pot_wager');
        telemetry.noteDecisionRuleReceipt('omaha_nut_class_pot_wager', call, raise);
      }
    });
    expect(run.ruleReceipts).toHaveLength(telemetry.DECISION_RULE_RECEIPTS_MAX);
    expect(telemetry.drainFires()).toEqual([
      { feature: 'omaha_nut_class_pot_wager', fires: telemetry.DECISION_RULE_RECEIPTS_MAX + 5 },
    ]);
  });

  it('captures DEEP second-look rule receipts on the capture without leaking into the outer FAST scope', () => {
    const run = telemetry.withDecisionFireScope(() => {
      const deep = telemetry.withSecondLookFireCapture(() =>
        telemetry.noteDecisionRuleReceipt('omaha_river_non_nut_raise_flatted', raise, call)
      );
      expect(deep.fired.size).toBe(0);
      expect(deep.ruleReceipts.map((r) => r.receipt)).toEqual([
        'omaha_river_non_nut_raise_flatted',
      ]);
      telemetry.noteDecisionRuleReceipt('v81_river_set_big_bet_fold', call, fold);
    });
    expect(run.ruleReceipts.map((r) => r.receipt)).toEqual(['v81_river_set_big_bet_fold']);
  });

  it('a non-finite or missing amount is recorded as no amount', () => {
    const run = telemetry.withDecisionFireScope(() =>
      telemetry.noteDecisionRuleReceipt(
        'omaha_river_non_nut_raise_fold_restored',
        { action: 'raise', amount: Number.NaN },
        { action: 'fold' }
      )
    );
    expect(run.ruleReceipts[0].before).toEqual({ action: 'raise', amount: null });
    expect(run.ruleReceipts[0].after).toEqual({ action: 'fold', amount: null });
  });
});
