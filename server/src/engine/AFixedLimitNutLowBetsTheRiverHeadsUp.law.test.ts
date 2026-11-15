/**
 * SPEC-FL-02 (Fixed-Limit lane, 2026-11-14). Heads-up on an unbet flo8 river
 * the nut low with nothing for high was checked 61.6 percent of 1,188 live
 * spots. The hand is decided by the baseline river-bluff range
 * (HorseRiverBluffRange `freeroll`), which bets it at RIVER_BLUFF_HILO_FREEROLL
 * = 0.55 and otherwise checks. A bet cannot lose the low half, wins the high
 * half whenever a better high folds, and costs half a bet when the low is
 * tied.
 *
 * Law (option fixedLimitHiLoNutLowRiverBet, opt-in, default off): with the
 * option on, fixed-limit hi-lo cash, heads-up, river unbet or checked to
 * hero, the nut low with no high always bets, in or out of position. The one
 * refusal is a station read with the bare nut low. A second nut low is not
 * the freeroll and is unchanged. With the option off the hand still mixes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { hiLoNutLowRiverBets, nutLowBlockersHeld } from './HorseFixedLimitWagerRead.js';
import { cards } from './HuVariantSpot.test-support.js';
import {
  HU_BIG_BLIND_FIRST,
  HU_CHECKED_TO_BUTTON,
  tally,
} from './FixedLimitWagerRead.test-support.js';

const ON = { mind: true, fixedLimitHiLoNutLowRiverBet: true } as const;
const OFF = { mind: true } as const;
afterEach(() => HorseMind.reset());

const BOARD = 'Ks Qd 8h 5c 3s';
const button = (hero: string) => `${hero} Kc 7d 9c 7s ${BOARD}`;
const bigBlind = (hero: string) => `Kc 7d 9c 7s ${hero} ${BOARD}`;

describe('fixed-limit hi-lo heads-up: the nut low bets the river (option on)', () => {
  it('checked to the button: always bets; off it mixes', () => {
    expect(tally('flo8', 2, button('Ac 2d Jh Th'), HU_CHECKED_TO_BUTTON, ON, 20)).toEqual({
      bet: 20,
    });
    const off = tally('flo8', 2, button('Ac 2d Jh Th'), HU_CHECKED_TO_BUTTON, OFF, 20);
    expect(off.check ?? 0).toBeGreaterThanOrEqual(4);
    expect(off.bet ?? 0).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('first to act in the big blind: always bets; off it mixes', () => {
    expect(tally('flo8', 2, bigBlind('Ac 2d Jh Td'), HU_BIG_BLIND_FIRST, ON, 20)).toEqual({
      bet: 20,
    });
    const off = tally('flo8', 2, bigBlind('Ac 2d Jh Td'), HU_BIG_BLIND_FIRST, OFF, 20);
    expect(off.check ?? 0).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('a second nut low is not the freeroll: the option changes nothing', () => {
    const on = tally('flo8', 2, button('Ac 4d Jh Th'), HU_CHECKED_TO_BUTTON, ON, 20);
    const off = tally('flo8', 2, button('Ac 4d Jh Th'), HU_CHECKED_TO_BUTTON, OFF, 20);
    expect(on).toEqual(off);
  }, 120_000);

  it('the refusal: a station read with the bare nut low keeps the baseline frequency', () => {
    const base = {
      isFixedLimit: true,
      isHiLo: true,
      headsUp: true,
      freeroll: true,
      opponentCanRespond: true,
    };
    const bare = nutLowBlockersHeld(cards('Ac 2d Jh Th'), cards(BOARD));
    const blocked = nutLowBlockersHeld(cards('Ac 2d As Th'), cards(BOARD));
    expect([bare, blocked]).toEqual([2, 3]);
    expect(hiLoNutLowRiverBets({ ...base, opponentNeverFolds: true, nutLowBlockers: bare })).toBe(
      false
    );
    expect(
      hiLoNutLowRiverBets({ ...base, opponentNeverFolds: true, nutLowBlockers: blocked })
    ).toBe(true);
    expect(hiLoNutLowRiverBets({ ...base, opponentNeverFolds: false, nutLowBlockers: bare })).toBe(
      true
    );
    for (const off of [
      { isFixedLimit: false },
      { isHiLo: false },
      { headsUp: false },
      { freeroll: false },
    ])
      expect(
        hiLoNutLowRiverBets({ ...base, ...off, opponentNeverFolds: false, nutLowBlockers: 4 })
      ).toBe(false);
  });
});
