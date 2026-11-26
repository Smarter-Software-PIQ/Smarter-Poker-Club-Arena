/**
 * LAW: A RIVER FULL HOUSE ON A TRIPS BOARD THAT QUADS OR A STRAIGHT FLUSH CAN BEAT MAY CALL, NEVER RAISE
 * (PLO-OWNER lead-7 2026-11-26; omahaRiverTripsBoardBoatIsNotNutClass, HorseOmahaTripsBoardBoat.ts).
 * HorseOmahaTripsBoardBoat.realHands.fixture.json: 71 real Horse river raises with a full house, Nov 12-26 (public
 * snapshot and the raising Horse's own cards only): 34 on trips boards a holding beats, 37 on paired boards.
 *  1. On every beatable trips-board raise the option turns the raise into the call; off, the raise is the same object.
 *  2. On every paired-board raise (the test keeps them: +8,376 bb over 253 raises) nothing changes.
 *  3. Only a raise facing a wager is touched; another street, a call, a bet or a fold is the same object.
 *  4. Identity never enters (another user id, name or person flag decides the same).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  omahaTripsBoard,
  omahaTripsBoardBoatBeatable,
  omahaTripsBoardBoatRule,
} from './HorseOmahaTripsBoardBoat.js';

interface Node {
  hand: string;
  recorded: { action: string; amount: number };
  trips: boolean;
  beatable: boolean;
  result: string | null;
  player: SeatPlayer;
  gs: HorseGameStateV2;
}
const FIX = JSON.parse(
  readFileSync(
    new URL('./HorseOmahaTripsBoardBoat.realHands.fixture.json', import.meta.url),
    'utf8'
  )
) as { nodes: Node[] };
const legal = (d: HorseDecision) => d;
const c = (s: string): Card[] =>
  (s.match(/../g) ?? []).map(
    (x) =>
      ({
        rank: x[0],
        suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[x[1] as 'c'],
      }) as Card
  );

describe('LAW: a river full house on a beatable trips board may call, never raise', () => {
  const nodes = FIX.nodes;
  it('the fixture holds beatable trips-board raises and paired-board raises', () => {
    expect(nodes.filter((n) => n.beatable).length).toBeGreaterThanOrEqual(30);
    expect(nodes.filter((n) => !n.trips).length).toBeGreaterThanOrEqual(30);
    expect(omahaTripsBoard(c('8s8d8h3c2d'))).toBe(true);
    expect(omahaTripsBoard(c('8s8dTh3c2d'))).toBe(false);
  });
  it('turns every beatable trips-board raise into the call, and leaves every paired-board raise', () => {
    for (const n of nodes) {
      const d = { action: n.recorded.action, amount: n.recorded.amount } as HorseDecision;
      const on = omahaTripsBoardBoatRule(d, n.player, n.gs, true, legal);
      const off = omahaTripsBoardBoatRule(d, n.player, n.gs, false, legal);
      expect(off).toBe(d);
      expect(omahaTripsBoardBoatBeatable(n.player, n.gs)).toBe(n.beatable);
      if (n.beatable) expect(['call', 'all_in'].includes(on.action) && on !== d, n.hand).toBe(true);
      else expect(on, n.hand).toBe(d);
    }
  });
  it('touches only a raise facing a wager on the river', () => {
    const n = nodes.find((x) => x.beatable)!;
    for (const d of [
      { action: 'call', amount: 5 },
      { action: 'fold', amount: 0 },
    ] as HorseDecision[])
      expect(omahaTripsBoardBoatRule(d, n.player, n.gs, true, legal)).toBe(d);
    const turn = {
      ...structuredClone(n.gs),
      stage: 'turn',
      communityCards: n.gs.communityCards!.slice(0, 4),
    };
    const r = { action: 'raise', amount: n.recorded.amount } as HorseDecision;
    expect(omahaTripsBoardBoatRule(r, n.player, turn as never, true, legal)).toBe(r);
  });
  it('never keys on identity', () => {
    for (const n of nodes.filter((x) => x.beatable).slice(0, 10)) {
      const gs = structuredClone(n.gs);
      for (const p of gs.players)
        if (p.seat !== n.player.seat) {
          p.user_id = 'someone-else';
          (p as unknown as Record<string, unknown>).is_horse = !(
            p as unknown as Record<string, unknown>
          ).is_horse;
        }
      expect(omahaTripsBoardBoatBeatable(n.player, gs)).toBe(true);
    }
  });
});
