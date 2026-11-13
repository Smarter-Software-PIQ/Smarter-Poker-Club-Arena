/**
 * Cross-variant reach of the PLO6-AUDIT-005 rule (an Omaha preflop call of 40%
 * of the stack with chips and action behind is not priced as a final all-in).
 * The rule has no variant term beyond "Omaha", so each affected game gets one
 * decision-level case at the real node of production hand 58751512 (decision
 * 10), replayed as that game with the recorded seat's first four or five
 * cards. The rule is OPT-IN and off by default (the value check does not
 * support it), so these cases pin two things: the default is the behaviour
 * production had, and the opt-in arm reaches exactly these games. They are a
 * record of the arm's reach for whoever measures it, not an endorsement of
 * that reach: no PLO4, PLO5, PLO8 or tournament evidence exists for the rule.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { replayHand, type ComplaintFixture } from './HorseComplaintReplay.js';
import FIXTURE from './fixtures/horse-plo6-action-behind-opener-58751512.json';

const FX = FIXTURE as unknown as ComplaintFixture;
const ON = { omahaPreflopCallWithActionBehind: true };

function as(variant: string, cards: number, tournament = false): ComplaintFixture {
  const fx = structuredClone(FX) as ComplaintFixture & { fmt: string };
  (fx as { variant: string }).variant = variant;
  fx.hole = { '2': FX.hole['2'].slice(0, cards) } as typeof FX.hole;
  for (const a of fx.actions) {
    const node = a.publicNode as unknown as Record<string, unknown> | undefined;
    if (!node) continue;
    node.variant = variant;
    if (tournament) node.mode = 'tournament';
  }
  if (tournament) fx.fmt = 'tour';
  return fx;
}

function actions(fx: ComplaintFixture, opts?: Record<string, unknown>) {
  const [node] = replayHand(fx, { ords: [10], opts });
  return node.profiles.map((p) => p.actions as Record<string, number>);
}

describe('the action-behind rule in every Omaha game it reaches (PLO6-AUDIT-005)', () => {
  afterEach(() => HorseMind.reset());

  it.each([
    ['plo4', 4],
    ['plo5', 5],
    ['plo8', 4],
  ] as const)(
    '%s cash: the default puts the chips in; opted in, the rule folds',
    (variant, cards) => {
      const fx = as(variant, cards);
      expect(actions(fx).every((a) => !('fold' in a))).toBe(true);
      expect(actions(fx, ON).every((a) => Object.keys(a).join() === 'fold')).toBe(true);
    }
  );

  it('plo6 tournament: opted in, the rule reaches tournaments and never takes the call', () => {
    const fx = as('plo6', 6, true);
    const on = actions(fx, ON);
    expect(on).not.toEqual(actions(fx));
    expect(on.every((a) => !('call' in a))).toBe(true);
  });
});
