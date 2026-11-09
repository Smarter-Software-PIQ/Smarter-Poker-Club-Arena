import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  heroCardHoldAllowed,
  heroCardsAlreadyDealtFor,
  heroIsBlindInLiveHand,
  previousHeroRow,
  LIGHTNING_HERO_CARD_RETRY_EVERY_MS,
  LIGHTNING_HERO_CARD_RETRY_MS,
} from '../src/lib/heroCardCustody';

/* Mongo, 2026-11-09, Lightning NLH hand 58167350: "Had a hand where I never saw
   my cards. Waited till the time bank showed up and never saw them."

   lightning_hand_player for that session: button (seat 6) in hand 58167227,
   which he won, then small blind (seat 1) in 58167350, folded by the clock 31
   seconds after it formed. The rules below are the three custody decisions
   that could each leave a dealt-in hero holding nothing. */

const HERO = 'd55730d2-da5a-45fc-8478-82e49f97cd7e';
const cards = [
  { rank: 'A', suit: 's' },
  { rank: 'K', suit: 's' },
];

describe('the hero is found by identity, not by seat', () => {
  // Hand 58167227: hero on seat 6 (index 5), holding the cards just delivered.
  const prev = [null, null, null, null, null, { id: HERO, isHero: true, holeCards: cards }];

  it('reproduces the defect: the old seat-index read finds nobody at the new seat', () => {
    // Hand 58167350 seats the hero on seat 1 (index 0).
    expect(prev[0]).toBeNull();
  });

  it('finds the hero row at its previous seat when the seat changed', () => {
    expect(previousHeroRow(prev, 0, HERO)?.holeCards).toBe(cards);
  });

  it('prefers the same index at a physical table', () => {
    const same = { id: HERO, isHero: true, holeCards: cards };
    expect(previousHeroRow([same, null], 0, HERO)).toBe(same);
  });

  it('never returns another player, and never guesses without an id', () => {
    const other = [{ id: 'someone-else', isHero: false, holeCards: cards }];
    expect(previousHeroRow(other, 0, HERO)).toBeNull();
    expect(previousHeroRow(prev, 0, '')).toBeNull();
    expect(previousHeroRow(prev, 0, undefined)).toBeNull();
    expect(previousHeroRow(null, 0, HERO)).toBeNull();
  });
});

describe('cards delivered for the incoming hand are held across its first snapshot', () => {
  it('keeps the existing rule: same hand or an unknown hand holds', () => {
    expect(heroCardHoldAllowed({ nextHand: 7, prevHand: 7, heldCardsHand: 0 })).toBe(true);
    expect(heroCardHoldAllowed({ nextHand: 0, prevHand: 7, heldCardsHand: 0 })).toBe(true);
    expect(heroCardHoldAllowed({ nextHand: 7, prevHand: 0, heldCardsHand: 0 })).toBe(true);
  });

  it('holds cards stamped with the incoming hand while the felt was a hand behind', () => {
    expect(
      heroCardHoldAllowed({ nextHand: 58167350, prevHand: 58167227, heldCardsHand: 58167350 })
    ).toBe(true);
  });

  it('still drops the previous hand at the boundary', () => {
    expect(
      heroCardHoldAllowed({ nextHand: 58167350, prevHand: 58167227, heldCardsHand: 58167227 })
    ).toBe(false);
    expect(heroCardHoldAllowed({ nextHand: 58167350, prevHand: 58167227, heldCardsHand: 0 })).toBe(
      false
    );
  });
});

describe('HAND_STARTED does not clear cards already delivered for that hand', () => {
  it('reproduces the defect: with the deal cue silent, only the cards stamp knows', () => {
    // A muted table never writes the cue hand. The old test read it alone.
    const dealCueHand = 58167227;
    expect(dealCueHand === 58167350).toBe(false);
    expect(
      heroCardsAlreadyDealtFor({ startedHand: 58167350, heldCardsHand: 58167350, dealCueHand })
    ).toBe(true);
  });

  it('accepts the deal cue as a witness as before', () => {
    expect(heroCardsAlreadyDealtFor({ startedHand: 9, heldCardsHand: 0, dealCueHand: 9 })).toBe(
      true
    );
  });

  it('clears a holding from any other hand, and when the hand is unknown', () => {
    expect(heroCardsAlreadyDealtFor({ startedHand: 9, heldCardsHand: 8, dealCueHand: 8 })).toBe(
      false
    );
    expect(heroCardsAlreadyDealtFor({ startedHand: 0, heldCardsHand: 0, dealCueHand: 0 })).toBe(
      false
    );
  });
});

describe('a blind hero in a live hand is the only one who asks again', () => {
  it('is blind when dealt in and holding nothing', () => {
    expect(
      heroIsBlindInLiveHand({
        hero: { id: HERO, isHero: true, status: 'active' },
        isHandInProgress: true,
      })
    ).toBe(true);
    expect(
      heroIsBlindInLiveHand({
        hero: { id: HERO, isHero: true, status: 'active', holeCards: [] },
        isHandInProgress: true,
      })
    ).toBe(true);
  });

  it('is not blind when holding cards, out of the hand, or between hands', () => {
    const base = { id: HERO, isHero: true };
    expect(
      heroIsBlindInLiveHand({ hero: { ...base, holeCards: cards }, isHandInProgress: true })
    ).toBe(false);
    for (const status of ['sitting_out', 'away', 'folded']) {
      expect(heroIsBlindInLiveHand({ hero: { ...base, status }, isHandInProgress: true })).toBe(
        false
      );
    }
    expect(heroIsBlindInLiveHand({ hero: base, isHandInProgress: false })).toBe(false);
    expect(heroIsBlindInLiveHand({ hero: null, isHandInProgress: true })).toBe(false);
  });

  it('asks well inside the action clock and keeps asking', () => {
    expect(LIGHTNING_HERO_CARD_RETRY_MS[0]).toBeGreaterThan(0);
    expect(Math.max(...LIGHTNING_HERO_CARD_RETRY_MS)).toBeLessThanOrEqual(2000);
    expect(LIGHTNING_HERO_CARD_RETRY_EVERY_MS).toBeLessThanOrEqual(5000);
  });
});

describe('TablePage keeps the hero cards by these rules and no others', () => {
  const page = readFileSync('src/pages/TablePage.tsx', 'utf8');
  const engineServer = readFileSync('server/src/index.ts', 'utf8');

  it('the snapshot hold never reads the hero by seat index again', () => {
    expect(page).not.toMatch(/const prevHero = prev\.players\[i\]/);
    expect(page).toMatch(/const prevHero = previousHeroRow\(prev\.players, i, sp\.id\)/);
    expect(page).toMatch(/const cardHoldSameHand = heroCardHoldAllowed\(\{/);
  });

  it('every accepted delivery stamps its hand before any sound decision', () => {
    const stamp = page.indexOf('heroCardsHandRef.current = dealtHandNumber;');
    const cue = page.indexOf('lightningHoldsHeroDealSound({');
    expect(stamp).toBeGreaterThan(0);
    expect(cue).toBeGreaterThan(stamp);
    // Exactly one writer: the guarded private-frame door.
    expect(page.split('heroCardsHandRef.current =').length - 1).toBe(1);
  });

  it('HAND_STARTED asks the cards stamp, not the deal cue alone', () => {
    expect(page).not.toMatch(
      /startedHandNumber > 0 && heroDealSoundHandRef\.current === startedHandNumber/
    );
    expect(page).toMatch(/const heroCardsAlreadyDealtForThisHand = heroCardsAlreadyDealtFor\(\{/);
  });

  it('a Lightning room owns a recovery, and it is the engine resync', () => {
    const at = page.indexOf("'TablePage.lightning_hole_cards_rerequested'");
    expect(at).toBeGreaterThan(0);
    const effect = page.slice(
      page.lastIndexOf('useEffect(() => {', at),
      page.indexOf('\n  }, [', at) + 120
    );
    expect(effect).toMatch(/!lightningRoomActive \|\| lightningObserver/);
    expect(effect).toMatch(/heroIsBlindInLiveHand\(\{/);
    expect(effect).toMatch(/requestEngineSnapshot\(\);/);
    expect(effect).toMatch(/heroCardFetchRef\.current = arm;/);
    expect(effect).toMatch(/lightningRoomActive, lightningObserver, requestEngineSnapshot\]/);
    // Never a wallet, seat or action call from a recovery.
    expect(effect).not.toMatch(/supabase\.|sendAction|submitAction|rpc\(/);
  });

  it('the engine answers that resync with the Lightning hero cards', () => {
    expect(engineServer).toMatch(
      /onResync: \(tableId, userId\) => \{[\s\S]{0,400}lightningRooms\.rePushHoleCards\(tableId, userId\)/
    );
  });
});
