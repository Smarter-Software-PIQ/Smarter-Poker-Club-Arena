/**
 * Heads-up the button is the small blind: it posts the small blind, acts first
 * preflop and last postflop. The simulator must deal that, because the engine's
 * V31 key (gtoV31Position) labels the heads-up dealer SB; a simulator that put
 * the blinds the other way round never reached a single heads-up SB cell
 * (dataset 187815b1 paired_replay/cash: 10,000 hands, 0 candidate hits).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { playHand } from './HorseLeague.js';
import { HorseLogic } from '../engine/HorseLogic.js';
import { gtoV31Position } from '../engine/GtoDecisionContext.js';

interface Seen {
  seat: number;
  dealerSeat: number;
  stage: string;
  bet: number;
  currentBet: number;
  position: string | null;
}

afterEach(() => vi.restoreAllMocks());

describe('HorseLeague heads-up blinds', { timeout: 60_000 }, () => {
  it('the button posts the small blind, acts first preflop and last postflop', () => {
    const original = HorseLogic.decide.bind(HorseLogic);
    for (let h = 0; h < 40; h++) {
      const seen: Seen[] = [];
      vi.spyOn(HorseLogic, 'decide').mockImplementation(((
        p: never,
        gs: never,
        ...rest: never[]
      ) => {
        const player = p as { seat: number; bet: number };
        const state = gs as {
          dealerSeat: number;
          stage: string;
          currentBet: number;
          players: never[];
        };
        seen.push({
          seat: player.seat,
          dealerSeat: state.dealerSeat,
          stage: state.stage,
          bet: player.bet,
          currentBet: state.currentBet,
          position:
            gtoV31Position({
              seat: player.seat,
              dealerSeat: state.dealerSeat,
              players: state.players,
            })?.position ?? null,
        });
        return (original as (...args: never[]) => unknown)(p, gs, ...rest);
      }) as never);
      const dealer = (h % 2) + 1;
      const net = playHand(
        9100 + h * 7919,
        dealer,
        () => ({ mind: false, telemetry: false }),
        undefined,
        undefined,
        'nlh',
        2,
        80
      );
      vi.restoreAllMocks();
      expect(Math.abs(net[0] + net[1])).toBeLessThan(1e-6);

      const first = seen.find((s) => s.stage === 'preflop');
      expect(first, `hand ${h}`).toBeDefined();
      expect(first!.seat).toBe(dealer);
      expect(first!.bet).toBe(1); // the small blind (BB = 2)
      expect(first!.currentBet).toBe(2);
      expect(first!.position).toBe('SB');

      const flop = seen.filter((s) => s.stage === 'flop');
      if (flop.length > 0) {
        expect(flop[0].seat).not.toBe(dealer);
        expect(flop[0].position).toBe('BB');
      }
    }
  });
});
