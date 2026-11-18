/**
 * Through the real hand-event handler: an accepted Horse decision is stored
 * with the VPIP floor inputs its table engine hands the decision; a human
 * action at the same table is stored exactly as captured (PLO6-AUDIT-012).
 */
import { describe, expect, it, vi } from 'vitest';
import { HandController } from './HandController.js';
import { ServerTableEngineHandEvents } from './ServerTableEngineHandEvents.js';
import type { ActionRecord, HandConfig, HandEvent, SeatPlayer } from '../types.js';

type ActionEvent = Extract<HandEvent, { type: 'PLAYER_ACTION' }>;

const players: SeatPlayer[] = [200, 200, 200, 200].map((stack, index) => ({
  seat: index + 1,
  user_id: `u${index + 1}`,
  username: `P${index + 1}`,
  stack,
  bet: 0,
  totalInvested: 0,
  cards: [],
  is_folded: false,
  is_all_in: false,
  is_sitting_out: false,
}));

const config = {
  tableId: 'stored-node-floor',
  handNumber: 1,
  gameVariant: 'plo6',
  smallBlind: 1,
  bigBlind: 2,
  rakeConfig: { percent: 5, cap: 100, noFlopNoDrop: true },
} as HandConfig;

async function playAndStore(reader?: (userId: string) => unknown) {
  const controller = new HandController(config, players, 1);
  const events: ActionEvent[] = [];
  controller.onEvent((event) => {
    if (event.type === 'PLAYER_ACTION') events.push(event);
  });
  controller.start();
  expect(controller.performAction(4, 'raise', 6, 'horse_policy')).toBe(true);
  expect(controller.performAction(1, 'call', 6, 'player')).toBe(true);
  const state = controller.getState();
  const owner = {
    tableId: 'stored-node-floor',
    handCount: 1,
    currentHandActions: [] as ActionRecord[],
    handController: { getState: () => state },
    markProgress: vi.fn(),
    broadcastCurrentState: vi.fn(),
    seatedPlayers: state.players.map((p) => ({ ...p, seat_number: p.seat })),
    preActionEngine: { onBetPlaced: vi.fn() },
    hub: { emitEvent: vi.fn() },
    ...(reader ? { horseVpipDecisionInputs: reader } : {}),
  };
  const handler = (
    ServerTableEngineHandEvents.prototype as unknown as {
      handleHandEvent(event: HandEvent, roster: unknown[]): Promise<void>;
    }
  ).handleHandEvent;
  for (const event of events) await handler.call(owner, event, []);
  return { stored: owner.currentHandActions, events };
}

describe('the stored node of a Horse decision carries the floor inputs', () => {
  it('floored table: the Horse action gains the floor and window for its own seat only', async () => {
    const asked: string[] = [];
    const { stored, events } = await playAndStore((userId) => {
      asked.push(userId);
      return { vpipFloor: 50, vpipWindowHands: 30, ownVpip: { hands: 7, vpip: 42.9 } };
    });
    expect(asked).toEqual(['u4']);
    expect(stored[0].origin).toBe('horse_policy');
    expect(stored[0].publicNode).toMatchObject({
      status: 'captured',
      vpipFloor: 50,
      vpipWindowHands: 30,
    });
    // The seat's judged VPIP is never written to a player-readable row.
    expect('ownVpip' in (stored[0].publicNode as object)).toBe(false);
    // Everything the controller captured is still there, unchanged.
    expect(stored[0].publicNode).toMatchObject({ ...events[0].publicNode });
    // The human action is stored as captured: no floor fields.
    expect(stored[1].origin).toBe('player');
    expect(stored[1].publicNode).toBe(events[1].publicNode);
  });

  it('unfloored table: an explicit 0 and nothing else', async () => {
    const { stored } = await playAndStore(() => ({
      vpipFloor: 0,
      vpipWindowHands: 10,
      ownVpip: undefined,
    }));
    const node = stored[0].publicNode as unknown as Record<string, unknown>;
    expect(node.vpipFloor).toBe(0);
    expect('vpipWindowHands' in node).toBe(false);
    expect('ownVpip' in node).toBe(false);
  });

  it('a floor reader that throws never breaks the hand: both actions are stored as captured', async () => {
    const { stored, events } = await playAndStore(() => {
      throw new Error('nit status unavailable');
    });
    expect(stored).toHaveLength(2);
    expect(stored.map((a) => a.publicNode)).toEqual(events.map((e) => e.publicNode));
  });

  it('no reader at all (an older engine object): stored as captured', async () => {
    const { stored, events } = await playAndStore();
    expect(stored.map((a) => a.publicNode)).toEqual(events.map((e) => e.publicNode));
  });
});
