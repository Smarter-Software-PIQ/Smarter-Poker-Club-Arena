/**
 * HU-HILO-001 (variants audit, 2026-11-13). The V40 Omaha pressure cap is a
 * ceiling for a weak HIGH hand facing a bet of 0.6 pot or more. It applied to
 * hi-lo unchanged (HorseLogic `useV40 && vi.isOmaha && made40.weak`), so a
 * hand holding the nut low with a weak high was capped to 0.28 and folded the
 * river to a pot bet heads-up, 20 seeds of 20, in cash and in a tournament,
 * although the low half alone returns 18 for a call of 12 (and the engine's
 * own pot share was 0.51 to 0.55 against a price of 0.33).
 *
 * Law: heads-up on the river in pot-limit Omaha hi-lo, a hand holding the nut
 * low does not fold to one pot-sized bet; a hand with no low and no pair
 * still does (the cap keeps its job for the high half).
 *
 * Pinned here: the nut low. The floor applies to every qualifying low at its
 * sampled share; non-nut lows are intended to follow the same arithmetic and
 * are not pinned by this law.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { cards, deal, decide, menuOf, type Fmt } from './HuVariantSpot.test-support.js';

function riverFacingPot(fmt: Fmt, hero: string, board: string, seed: number) {
  // seat 1 = button (the bettor, cards fixed only to fix the deck), seat 2 = big blind (the Horse)
  const t = deal({
    variant: 'plo8',
    fmt,
    stacks: [200, 200],
    prefix: [...cards('Qc 7c 6d 9s'), ...cards(hero), ...cards(board)],
  });
  const c = t.controller;
  const ok = (v: boolean) => expect(v).toBe(true);
  ok(c.performAction(1, 'raise', menuOf(t).maxRaiseTo ?? undefined, 'player'));
  ok(c.performAction(2, 'call', undefined, 'player'));
  for (let street = 0; street < 2; street++) {
    ok(c.performAction(2, 'check', undefined, 'player'));
    ok(c.performAction(1, 'check', undefined, 'player'));
  }
  ok(c.performAction(2, 'check', undefined, 'player'));
  ok(c.performAction(1, 'bet', menuOf(t).maxRaiseTo ?? undefined, 'player'));
  return decide(t, seed).d.action;
}
afterEach(() => HorseMind.reset());

describe('a nut low is not folded to one pot bet heads-up', () => {
  it.each([
    ['cash', 'Ac 4d Jh Th', 'Ks Kd 8h 3c 2s'],
    ['cash', 'Ac 4d Jh Th', 'Ks Qd 8h 3c 2s'],
    ['cash', 'Ac 2d Jh Th', 'Ks Qd 8h 5c 3s'],
    ['cash', 'Ac 2d Kh Th', 'Ks Qd 8h 5c 3s'],
    ['tournament', 'Ac 4d Jh Th', 'Ks Qd 8h 3c 2s'],
    ['tournament', 'Ac 2d Jh Th', 'Ks Qd 8h 5c 3s'],
  ] as [Fmt, string, string][])(
    '%s %s on %s continues',
    (fmt, hero, board) => {
      for (let s = 0; s < 12; s++)
        expect(riverFacingPot(fmt, hero, board, 300 + s * 13)).not.toBe('fold');
    },
    120_000
  );
  it('a hand with no low and no pair still folds', () => {
    for (let s = 0; s < 12; s++)
      expect(riverFacingPot('cash', 'Jc Td 9h 9d', 'Ks Qd 8h 5c 3s', 300 + s * 13)).toBe('fold');
  }, 120_000);
});
