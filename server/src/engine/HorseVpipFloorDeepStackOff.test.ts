/**
 * PLO6-AUDIT-004 through HorseLogic.decide: the VPIP floor does not set a deep
 * Omaha seat's preflop stack-off bar.
 *
 * Production hand 58751512 (PLO6 1/2 cash, a 50% VPIP floor table), decision
 * 13: the button, 390 big blinds deep with Td 5d Kc 4c Js Ac, faces 161 to
 * call into 520 behind a four-bet and shoves 780. The seat was in its third
 * hand at the table, so the floor multiplier was at its prior and had cut
 * every preflop bar, the jam bar included, to about 0.4 of its height. The
 * floor counts voluntary money in, which the call supplies.
 *
 * The fixture is the anonymised recorded hand (seats only). A recorded public
 * node does not carry the table's floor or the seat's judged VPIP, so the
 * fixture supplies the two values the live decision received (floor 50, two
 * hands judged at 50%). Replayed with opponent memory off for the live hybrid
 * profile and every base style over the fixed seeds.
 *
 * The rule is OPT-IN and off by default. The mechanism above is real, but the
 * expected-value check made after the rule first merged (#10628) does not show
 * the call beating the shove: it is better only against an aces-heavy four-bet
 * range with a caller, and worse against wider ranges or with any fold equity.
 * These cases pin that the default is the recorded behaviour and that the
 * opt-in arm does what it says, for whoever measures it next.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { replayHand, type ComplaintFixture } from './HorseComplaintReplay.js';
import FIXTURE from './fixtures/horse-plo6-floor-deep-stack-off-58751512.json';

const FX = FIXTURE as unknown as ComplaintFixture;
const ORD = 13;
const HERO_SEAT = 5;
const ON = { vpipFloorDeepStackOff: true };

/** Every profile's action counts at the node, as { profile: { action: seeds } }. */
function actionsAt(fixture: ComplaintFixture, opts?: Record<string, unknown>) {
  const [node] = replayHand(fixture, { ords: [ORD], opts });
  return Object.fromEntries(node.profiles.map((p) => [p.profile, p.actions]));
}

function variant(edit: (node: Record<string, unknown>) => void) {
  const copy = structuredClone(FX);
  const action = copy.actions.find((a) => a.ord === ORD)!;
  edit(action.publicNode as unknown as Record<string, unknown>);
  return copy;
}

const heroStack = (node: Record<string, unknown>, stack: number) => {
  (node.seats as number[][]).find((s) => s[0] === HERO_SEAT)![1] = stack;
};

const everyProfile = (actions: Record<string, Record<string, number>>, action: string) =>
  Object.values(actions).every((a) => Object.keys(a).length === 1 && a[action] > 0);

describe('a deep Omaha stack-off on a VPIP floor table through decide (PLO6-AUDIT-004)', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded node: 780 behind, 161 to call into 520, floor 50', () => {
    const node = FX.actions.find((a) => a.ord === ORD)!.publicNode!;
    expect(FX.variant).toBe('plo6');
    expect(FX.fmt).toBe('cash');
    expect(node.pot).toBe(520);
    expect(node.toCall).toBe(161);
    expect(node.bigBlind).toBe(2);
    expect(node.seats.find((s) => s[0] === HERO_SEAT)![1]).toBe(780);
    expect(node.vpipFloor).toBe(50);
    expect(node.ownVpip).toEqual({ hands: 2, vpip: 50 });
    expect(FX.actions.find((a) => a.ord === ORD)!.action).toBe('all_in');
  });

  it('default: the rule is off and the node replays the recorded shove for every profile', () => {
    expect(everyProfile(actionsAt(FX), 'all_in')).toBe(true);
  });

  it('opt-in: with the rule on every profile calls at every seed; none shoves', () => {
    expect(everyProfile(actionsAt(FX, ON), 'call')).toBe(true);
  });

  it('the brain reads the option as `=== true`, so production never sets it by omission', () => {
    const src = readFileSync('src/engine/HorseLogic.ts', 'utf8');
    expect(src).toContain('opts.vpipFloorDeepStackOff === true');
    expect(src).not.toMatch(/vpipFloorDeepStackOff !== false/);
  });

  it('a table with no floor is untouched: the same action with the rule on or off', () => {
    const unfloored = variant((node) => {
      delete node.vpipFloor;
      delete node.ownVpip;
    });
    expect(actionsAt(unfloored)).toEqual(actionsAt(unfloored, ON));
  });

  it('a seat already over its floor target is untouched', () => {
    const satisfied = variant((node) => {
      node.ownVpip = { hands: 10, vpip: 90 };
    });
    expect(actionsAt(satisfied)).toEqual(actionsAt(satisfied, ON));
  });

  it('120 big blinds or less is out of scope: the same action with the rule on or off', () => {
    // 190 behind at a big blind of 2 is 95bb.
    const shallow = variant((node) => heroStack(node, 190));
    expect(actionsAt(shallow)).toEqual(actionsAt(shallow, ON));
  });

  it('a call of more than 30% of the stack is a price decision and is left alone', () => {
    // 500 behind is still 250bb deep; 161 to call is 32% of it.
    const priced = variant((node) => heroStack(node, 500));
    expect(actionsAt(priced)).toEqual(actionsAt(priced, ON));
  });
});
