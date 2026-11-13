/**
 * A Horse decision's stored public node carries the VPIP floor inputs that
 * decision read (PLO6-AUDIT-012).
 *
 * Why: the floor, its window and the seat's own judged VPIP live on the table
 * engine, not the hand, so the node captured in HandController never had them.
 * Every preflop replay of a hand from a floored table then ran as if the table
 * had no floor: a 390bb PLO6 shove replayed as a fold, and a rule's reach was
 * measured as 13 decisions when it was 107. These cases pin the helper, the
 * single source both the decision and the record read, and the replay path.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  storedHorsePublicNode,
  unavailablePublicActionNode,
  withHorseVpipInputs,
  type HorsePublicActionNode,
} from './HorsePublicActionNode.js';

const captured = Object.freeze({
  version: 1,
  status: 'captured',
  variant: 'plo6',
  mode: 'cash',
  asset: 'chips',
  chipUnit: 0.01,
  street: 'preflop',
  dealerSeat: 1,
  actorSeat: 5,
  smallBlind: 1,
  bigBlind: 2,
  ante: 0,
  anteType: 'per_player',
  allInOrFold: false,
  bombPot: false,
  boardCount: 1,
  boards: [''],
  pot: 520,
  currentBet: 206,
  toCall: 161,
  structure: 'pot_limit',
  minRaiseTo: 367,
  maxRaiseTo: 825,
  fixedBetSize: null,
  wagersCapped: false,
  legalActions: ['fold', 'call', 'raise', 'all_in'],
  seats: [[5, 780, 45, 45, 0, 0, 0]],
}) as unknown as HorsePublicActionNode;

describe('withHorseVpipInputs', () => {
  it('a floored table: the floor, its window and the own judged figure are added', () => {
    const node = withHorseVpipInputs(captured, {
      vpipFloor: 50,
      vpipWindowHands: 30,
      ownVpip: { hands: 2, vpip: 50 },
    });
    expect(node).toMatchObject({
      vpipFloor: 50,
      vpipWindowHands: 30,
      ownVpip: { hands: 2, vpip: 50 },
    });
    expect(Object.isFrozen(node)).toBe(true);
  });

  it('every captured field is kept and the captured node itself is not touched', () => {
    const node = withHorseVpipInputs(captured, {
      vpipFloor: 50,
      vpipWindowHands: 10,
      ownVpip: undefined,
    }) as Record<string, unknown>;
    for (const [key, value] of Object.entries(captured)) expect(node[key]).toEqual(value);
    expect('vpipFloor' in captured).toBe(false);
    expect('ownVpip' in node).toBe(false);
  });

  it('a table with no floor records an explicit 0, so "no floor" is not "not recorded"', () => {
    const node = withHorseVpipInputs(captured, {
      vpipFloor: 0,
      vpipWindowHands: 10,
      ownVpip: undefined,
    }) as Record<string, unknown>;
    expect(node.vpipFloor).toBe(0);
    expect('vpipWindowHands' in node).toBe(false);
    expect('ownVpip' in node).toBe(false);
  });

  it('a seat with no judged sample yet keeps a null share', () => {
    const node = withHorseVpipInputs(captured, {
      vpipFloor: 50,
      vpipWindowHands: 10,
      ownVpip: { hands: 0, vpip: null },
    });
    expect(node).toMatchObject({ ownVpip: { hands: 0, vpip: null } });
  });

  it('unusable inputs add nothing and never throw: recording cannot break a hand', () => {
    expect(
      withHorseVpipInputs(captured, {
        vpipFloor: Number.NaN,
        vpipWindowHands: 10,
        ownVpip: undefined,
      })
    ).toBe(captured);
    const partial = withHorseVpipInputs(captured, {
      vpipFloor: 50,
      vpipWindowHands: Number.NaN,
      ownVpip: { hands: Number.NaN, vpip: 40 },
    }) as Record<string, unknown>;
    expect(partial.vpipFloor).toBe(50);
    expect('vpipWindowHands' in partial).toBe(false);
    expect('ownVpip' in partial).toBe(false);
  });

  it('an unavailable node is returned as it is', () => {
    const node = unavailablePublicActionNode('non_betting_action');
    expect(
      withHorseVpipInputs(node, { vpipFloor: 50, vpipWindowHands: 10, ownVpip: undefined })
    ).toBe(node);
  });
});

describe('storedHorsePublicNode', () => {
  const inputs = () => ({ vpipFloor: 50, vpipWindowHands: 10, ownVpip: { hands: 4, vpip: 25 } });

  it('a Horse decision gains the inputs; a human action is stored as captured', () => {
    expect(storedHorsePublicNode(captured, 'horse_policy', inputs)).toMatchObject({
      vpipFloor: 50,
      ownVpip: { hands: 4, vpip: 25 },
    });
    expect(storedHorsePublicNode(captured, 'player', inputs)).toBe(captured);
    expect(storedHorsePublicNode(captured, undefined, inputs)).toBe(captured);
  });

  it('a reader that throws stores the node as captured and does not throw', () => {
    const broken = () => {
      throw new Error('table engine has no floor reader');
    };
    expect(storedHorsePublicNode(captured, 'horse_policy', broken)).toBe(captured);
  });
});

describe('one source for the decision and the record', () => {
  const read = (file: string) => readFileSync(`src/engine/${file}`, 'utf8');

  it('the decision state takes its three floor inputs from horseVpipDecisionInputs', () => {
    const turns = read('ServerTableEngineTurns.ts');
    expect(turns).toContain('...this.horseVpipDecisionInputs(authoritativePlayer.user_id)');
    expect(turns).not.toMatch(/vpipFloor: this\.vpipFloor\(\)/);
  });

  it('the stored node of a Horse decision is written through the same helper', () => {
    const events = read('ServerTableEngineHandEvents.ts');
    expect(events).toContain('storedHorsePublicNode(event.publicNode, event.origin, () =>');
    expect(events).toContain('this.horseVpipDecisionInputs(actorId)');
  });

  it('a law fixture keeps the three fields and the replay hands them to the decision', () => {
    const replay = read('HorseComplaintReplay.ts');
    for (const field of ['vpipFloor', 'vpipWindowHands', 'ownVpip']) {
      expect(replay).toContain(`...(${field} !== undefined ? { ${field} } : {})`);
      expect(replay).toContain(`pn.${field} !== undefined ? { ${field}: pn.${field} }`);
    }
  });
});
