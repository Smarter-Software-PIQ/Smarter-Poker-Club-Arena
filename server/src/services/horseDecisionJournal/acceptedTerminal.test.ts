import { test } from 'vitest';
import assert from 'node:assert/strict';
import { captureAcceptedTerminal, readAcceptedTerminal } from './acceptedTerminal.js';
const sourceRelease = 'a'.repeat(40);
const tableId = '11111111-1111-4111-8111-111111111111';
const lease = '22222222-2222-4222-8222-222222222222';
const handId = '33333333-3333-4333-8333-333333333333';
const expected = { sourceRelease, tableId, handNumber: 7, handId };
const observation = () => ({
  generation: 7,
  fence: `${tableId}:7:${lease}:observe`,
  handKey: `${tableId}:7`,
  committedHandId: handId,
  actions: [{ userId: 'hero', action: 'call', stage: 'river', amount: 12 }],
  bigBlind: 2,
  showdown: null,
});
test('capture preserves original terminal through mutation and duplicate recovery', () => {
  const input = observation();
  const packet = captureAcceptedTerminal(sourceRelease, lease, input)!;
  input.actions[0]!.amount = 99;
  const first = readAcceptedTerminal(packet, expected)!;
  assert.equal(first.actions![0]!.amount, 12);
  first.actions![0]!.amount = 44;
  assert.equal(readAcceptedTerminal(packet, expected)!.actions![0]!.amount, 12);
});
test('legacy, cross-release, wrong hand, lease and changed action stay unaccepted', () => {
  const packet = captureAcceptedTerminal(sourceRelease, lease, observation())!;
  assert.equal(readAcceptedTerminal(null, expected), null);
  assert.equal(captureAcceptedTerminal(null, lease, observation()), null);
  assert.equal(readAcceptedTerminal(packet, { ...expected, sourceRelease: 'b'.repeat(40) }), null);
  assert.equal(readAcceptedTerminal(packet, { ...expected, handNumber: 8 }), null);
  assert.equal(readAcceptedTerminal({ ...packet, originalLease: tableId }, expected), null);
  const changed = structuredClone(packet);
  changed.observation.actions![0]!.amount = 13;
  assert.equal(readAcceptedTerminal(changed, expected), null);
});
