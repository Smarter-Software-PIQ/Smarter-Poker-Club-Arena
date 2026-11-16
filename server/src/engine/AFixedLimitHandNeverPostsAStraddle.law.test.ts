/**
 * LAW: A FIXED-LIMIT HAND NEVER POSTS A STRADDLE (2026-11-15).
 *
 * The fixed-limit cap counts the big blind as wager 1 preflop and forced posts
 * are not in `actionHistory`, so a posted straddle raised `currentBet` without
 * counting as a wager. Run on the engine (A2-CONTRACT-EXECUTED section 9): a
 * straddle to 4 at a 1/2 limit table let the preflop go 4 -> 6 -> 8 -> 10
 * before it capped, five levels where the rules allow four. Production writes
 * straddle off for every limit table, but nothing in the engine refused one.
 *
 * The rule now: fixed limit has no straddle. The dealer does not collect one
 * for a fixed-limit hand (ServerTableEngineDealing, through
 * BettingStructure.structureAllowsStraddle), and HandController refuses to
 * post one it is handed, reporting the refusal. No-limit and pot-limit
 * straddles are unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('../services/errorReporter.js', () => ({ reportError }));

import { HandController } from './HandController.js';
import { structureAllowsStraddle, isFixedLimitCapped } from './BettingStructure.js';
import type { HandConfig, SeatPlayer } from '../types.js';

function mkPlayers(stacks: number[]): SeatPlayer[] {
  return stacks.map(
    (stack, i) =>
      ({
        seat: i + 1,
        user_id: `u${i + 1}`,
        username: `P${i + 1}`,
        stack,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      }) as SeatPlayer
  );
}

// Seats: 1 = button, 2 = SB, 3 = BB, 4 = UTG (the straddler).
function straddledHand(gameVariant: string) {
  const hc = new HandController(
    {
      tableId: 't-straddle',
      handNumber: 7,
      gameVariant,
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
      straddles: [{ seat: 4, amount: 4 }],
    } as HandConfig,
    mkPlayers([200, 200, 200, 200]),
    1
  );
  hc.start();
  const st = () => (hc as unknown as { state: any }).state;
  const seat = (n: number) => st().players.find((p: SeatPlayer) => p.seat === n);
  return { hc, st, seat };
}

beforeEach(() => reportError.mockClear());

describe('a fixed-limit hand never posts a straddle', () => {
  it('names fixed limit as the structure that refuses one', () => {
    expect(structureAllowsStraddle('flh')).toBe(false);
    expect(structureAllowsStraddle('flo8')).toBe(false);
    for (const v of ['nlh', 'plo4', 'plo5', 'pineapple', 'short_deck'])
      expect(structureAllowsStraddle(v)).toBe(true);
  });

  it.each(['flh', 'flo8'])(
    '%s: a straddle handed to the controller is refused before any chip moves',
    (variant) => {
      const h = straddledHand(variant);
      // Only the blinds are in: the would-be straddler still has every chip.
      expect(h.st().currentBet).toBe(2);
      expect(h.st().pot).toBe(3);
      expect(h.seat(4).stack).toBe(200);
      expect(h.seat(4).bet).toBe(0);
      expect(h.hc.getLastStraddleSeat()).toBeNull();
      // Action opens left of the big blind, as in any unstraddled hand.
      expect(h.st().currentPlayerSeat).toBe(4);
      expect(reportError).toHaveBeenCalledWith(
        expect.any(Error),
        'HandController.fixed_limit_straddle_refused'
      );
    }
  );

  it('the preflop caps after three raises over the blind: four levels, not five', () => {
    const h = straddledHand('flh');
    expect(h.hc.performAction(4, 'raise', 4)).toBe(true);
    expect(h.hc.performAction(1, 'raise', 6)).toBe(true);
    expect(h.hc.performAction(2, 'raise', 8)).toBe(true);
    expect(isFixedLimitCapped(h.st().actionHistory, 'preflop', 2)).toBe(true);
    // The fifth level the straddle used to allow is refused.
    expect(h.hc.performAction(3, 'raise', 10)).toBe(false);
    expect(h.hc.getAuthoritativeActionState('u3')!.legalActions).not.toContain('raise');
  });

  it.each(['nlh', 'plo4'])('%s: the straddle still posts exactly as before', (variant) => {
    const h = straddledHand(variant);
    expect(h.st().currentBet).toBe(4);
    expect(h.seat(4).stack).toBe(196);
    expect(h.seat(4).bet).toBe(4);
    expect(h.hc.getLastStraddleSeat()).toBe(4);
    // First to act is left of the straddler.
    expect(h.st().currentPlayerSeat).toBe(1);
    expect(reportError).not.toHaveBeenCalledWith(
      expect.anything(),
      'HandController.fixed_limit_straddle_refused'
    );
  });

  it('the dealer does not collect a straddle for a fixed-limit hand', () => {
    // The configuration side of the same rule: the straddle block in the deal
    // is gated on the dealt variant, so a fixed-limit hand of a mixed or
    // hand-edited straddle table never builds `config.straddles` at all.
    const here = dirname(fileURLToPath(import.meta.url));
    const dealing = readFileSync(join(here, 'ServerTableEngineDealing.ts'), 'utf8');
    expect(dealing).toMatch(
      /if \(this\.tableInfo\.straddle_enabled && structureAllowsStraddle\(this\.dealtGameVariant\(\)\)\) \{/
    );
  });
});
