import { describe, expect, it } from 'vitest';
import { optionShadowReceiptOf } from './HorseOptionShadow.js';
import { summariseOptionShadow } from './HorseOptionShadowSummary.js';

const receipt = (over: Partial<Parameters<typeof optionShadowReceiptOf>[0]>) =>
  optionShadowReceiptOf({
    option: 'streetIQ',
    flippedTo: false,
    actual: { action: 'fold' },
    would: { action: 'call', amount: 2 },
    street: 'flop',
    variant: 'plo5',
    format: 'cash',
    personDealt: true,
    personLive: true,
    ...over,
  });
const row = (atMs: number, r: unknown, asExport = false) => {
  const record = {
    kind: 'decision',
    atMs,
    body: JSON.stringify({ decision: { action: 'fold', optionShadowReceipt: r } }),
  };
  return asExport ? { record } : record;
};

describe('the option shadow summary', () => {
  it('splits person-present and Horse-only, counts changes by pair, street and variant, inside the window', () => {
    const rows = [
      row(1_000, receipt({})),
      row(2_000, receipt({ personDealt: false, personLive: false }), true),
      row(3_000, receipt({ would: { action: 'fold' } })),
      row(4_000, receipt({ would: null })),
      row(5_000, receipt({ option: 'handReading', street: 'river', variant: 'nlh' })),
      row(9_000, receipt({})), // outside the window
      { kind: 'execution', atMs: 1_500, body: '{}' },
      row(1_200, { version: 2 }), // not a receipt
      'not an object',
    ];
    const s = summariseOptionShadow(rows, { sinceMs: 0, untilMs: 9_000 });
    expect(s.recordsRead).toBe(9);
    expect(s.decisionsWithReceipt).toBe(5);
    expect(s.options.streetIQ!.person).toMatchObject({
      decisions: 3,
      changed: 1,
      same: 1,
      unknown: 1,
      changes: { 'fold>call': 1 },
    });
    expect(s.options.streetIQ!.horseOnly).toMatchObject({
      decisions: 1,
      changed: 1,
      changedByStreet: { flop: 1 },
      changedByVariant: { plo5: 1 },
    });
    expect(s.options.handReading!.person.changedByStreet).toEqual({ river: 1 });
    expect(summariseOptionShadow(rows, { option: 'handReading' }).decisionsWithReceipt).toBe(1);
  });
});
