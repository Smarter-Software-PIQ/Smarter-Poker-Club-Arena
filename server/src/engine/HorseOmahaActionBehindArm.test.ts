/**
 * PLO6-AUDIT-005 as an opt-in arm. Two real nodes: production hand 58751512
 * decision 10 (the opener calls a four-bet for half its stack with two players
 * still to act) and hand 0d1cddfa decision 11 (a cold call of a four-bet with
 * action behind). By default the brain makes the recorded call; opted in, no
 * profile calls at any seed. The rule is off in production because the value
 * check does not support folding these hands (HorseLogic option comment).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { replayHand, type ComplaintFixture } from './HorseComplaintReplay.js';
import OPENER from './fixtures/horse-plo6-action-behind-opener-58751512.json';
import COLD from './fixtures/horse-plo6-action-behind-cold-call-0d1cddfa.json';

const ON = { omahaPreflopCallWithActionBehind: true };
const CASES = [
  ['opener, hand 58751512 decision 10', OPENER as unknown as ComplaintFixture, 10],
  ['cold caller, hand 0d1cddfa decision 11', COLD as unknown as ComplaintFixture, 11],
] as const;

function actions(fx: ComplaintFixture, ord: number, opts?: Record<string, unknown>) {
  const [node] = replayHand(fx, { ords: [ord], opts });
  return node.profiles.map((p) => p.actions as Record<string, number>);
}

describe('the action-behind rule is an opt-in arm (PLO6-AUDIT-005)', () => {
  afterEach(() => HorseMind.reset());

  it.each(CASES)('%s: by default the recorded call is still made', (_label, fx, ord) => {
    expect(actions(fx, ord).some((a) => 'call' in a || 'all_in' in a)).toBe(true);
  });

  it.each(CASES)('%s: opted in, no profile calls at any seed', (_label, fx, ord) => {
    expect(actions(fx, ord, ON).every((a) => !('call' in a))).toBe(true);
  });

  it('the brain reads the option as `=== true`, so production never sets it by omission', () => {
    const src = readFileSync('src/engine/HorseLogic.ts', 'utf8');
    expect(src).toContain('opts.omahaPreflopCallWithActionBehind === true');
    expect(src).not.toMatch(/omahaPreflopCallWithActionBehind !== false/);
  });
});
