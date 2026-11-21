/**
 * A STAGED SHADOW RECEIPT IS NEVER A DECISION OR AN EXECUTION OF ITS TURN (2026-11-20, PLO-OWNER lane SHADOW,
 * VERIFIER V59).
 *
 * The shadow stage journals the counterfactual receipt of a staged option as its own record, kind
 * `option_shadow_receipt`, under the hand and turn keys of the decision it re-decided. The hand review joins a turn's
 * decision and execution by that key: a receipt it took for an execution would make every such hand conflicted. Held
 * here: with a receipt present the review concludes exactly what it concludes without it (only the retained-record
 * count and manifest differ).
 */
import { describe, expect, it } from 'vitest';
import { correctiveFixture, HAND_KEY } from '../horseCorrectiveReview/fixture.test-support.js';
import { horseLifecycleRequestDigest } from './lifecycle.js';
import { reconcileHorseJournalHand } from './review.js';

const RECEIPT = {
  version: 1,
  option: 'omahaFourBetFoldPricedCall',
  flippedTo: true,
  changed: true,
  actual: { action: 'fold', amount: null },
  would: { action: 'call', amount: 40 },
  street: 'preflop',
  variant: 'plo5',
  format: 'cash',
  personDealt: true,
  personLive: true,
};

function records(receipts: number) {
  const f = correctiveFixture();
  const requestDigest = horseLifecycleRequestDigest(f.snapshot);
  return [
    f.make('request_lifecycle', 1, {
      version: 1,
      phase: 'requested',
      origin: 'worker_compute',
      request: f.snapshot,
      requestDigest,
    }),
    f.make('decision', 2, { ...f.capture, lifecycleVersion: 1 }),
    f.make('request_lifecycle', 3, {
      version: 1,
      phase: 'terminal',
      requestDigest,
      outcome: 'success',
    }),
    // journaled after the answer, before the execution witness arrives
    ...Array.from({ length: receipts }, (_, i) => f.make('option_shadow_receipt', 4 + i, RECEIPT)),
    f.make('execution', 4 + receipts, f.witness),
    f.make('accepted_hand', 5 + receipts, f.hand),
  ];
}

describe('the hand review with a staged shadow receipt in the hand', () => {
  it('the fixture hand reconciles clean without a receipt', () => {
    const plain = reconcileHorseJournalHand(records(0), HAND_KEY);
    expect(plain.gaps).toEqual([]);
    expect(plain.status).toBe('reconciled');
  });
  it.each([1, 2])('%i receipt(s): same status, no gap, same decisions and executions', (n) => {
    const all = records(n);
    expect(all.filter((r) => r.kind === 'option_shadow_receipt')).toHaveLength(n);
    // the receipt shares the turn key of its decision
    const decision = all.find((r) => r.kind === 'decision')!;
    for (const r of all.filter((x) => x.kind === 'option_shadow_receipt'))
      expect(r.turnKey).toBe(decision.turnKey);
    const plain = reconcileHorseJournalHand(records(0), HAND_KEY);
    const withReceipt = reconcileHorseJournalHand(all, HAND_KEY);
    // the receipt is one more retained record (count and manifest say so); everything the review concludes is equal
    const { manifest: m1, retainedRecords: n1, ...concluded } = withReceipt;
    const { manifest: m0, retainedRecords: n0, ...expected } = plain;
    expect(concluded).toEqual(expected);
    expect(n1).toBe(n0 + n);
    expect(m1).not.toBe(m0);
    expect(withReceipt.status).toBe('reconciled');
    expect(withReceipt.gaps).toEqual([]);
  });
});
