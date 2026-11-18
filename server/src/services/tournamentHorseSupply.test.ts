import { describe, expect, it } from 'vitest';
import {
  SINGLE_EVENT_FLEET_SHARE,
  TOURNAMENT_GAMES_PER_HORSE,
  coverSupply,
  guaranteeSupplyFindings,
  type SupplyEvent,
  type SupplyHorse,
} from './tournamentHorseSupply.js';
import { CONCURRENT_GAME_LIMIT, HORSE_MAX_CASH_TABLES } from './HorseGameLoad.js';

/**
 * THE NIGHT OF 2026-11-13, REBUILT FROM WHAT PRODUCTION MEASURED AT 7:30 PM.
 * 1,000 horses. 136 on their rest day and about 354 off shift, holding nothing.
 * About 510 on shift: 153 already in the Nightly 20K, the other 357 at the game
 * limit, 165 of them holding cash seats. The event still needed 232 entries.
 * (Aggregates, not the per-horse rows: the load of each horse at that minute
 * was not recorded.)
 */
function november13(): SupplyHorse[] {
  const horse = (h: Partial<SupplyHorse>): SupplyHorse => ({
    load: 0,
    cashSeats: 0,
    inEvent: false,
    onShift: true,
    restDay: false,
    canPay: true,
    ...h,
  });
  return [
    ...Array.from({ length: 136 }, () => horse({ restDay: true, onShift: false })),
    ...Array.from({ length: 354 }, () => horse({ onShift: false })),
    ...Array.from({ length: 153 }, () => horse({ inEvent: true, load: 3 })),
    ...Array.from({ length: 165 }, () => horse({ load: 4, cashSeats: 3 })),
    ...Array.from({ length: 192 }, () => horse({ load: 4 })),
  ];
}
const MISSING = 232;

describe('replay of the Nightly 20K, 2026-11-13', () => {
  it('the pool the guard had that night could not cover it', () => {
    const fleet = november13();
    expect(fleet).toHaveLength(1000);
    expect(coverSupply(fleet, false)).toEqual({ free: 0, callable: 0 });
  });

  it('overlay cover finds more than the entries that were missing', () => {
    const supply = coverSupply(november13(), true);
    expect(supply.free).toBe(490);
    expect(supply.free).toBeGreaterThanOrEqual(MISSING);
    // And a further reserve that a cash call can free.
    expect(supply.callable).toBe(165);
  });

  it('a horse that cannot pay the entry is not counted as cover', () => {
    const fleet = november13().map((h, i) => (i < 400 ? { ...h, canPay: false } : h));
    expect(coverSupply(fleet, true).free).toBe(90);
  });
});

describe('the board is checked against the fleet', () => {
  const at = (h: number) => Date.parse('2026-11-14T00:00:00Z') + h * 3_600_000;
  const event = (e: Partial<SupplyEvent>): SupplyEvent => ({
    id: 'e',
    name: 'Event',
    startMs: at(1),
    closeMs: at(2.7),
    neededEntries: 100,
    guaranteed: true,
    ...e,
  });

  it('the fleet rules keep two games per horse for tournaments', () => {
    expect(CONCURRENT_GAME_LIMIT).toBe(4);
    expect(HORSE_MAX_CASH_TABLES).toBe(2);
    expect(TOURNAMENT_GAMES_PER_HORSE).toBe(2);
  });

  it('the 7 PM Midway hour as scheduled is within supply', () => {
    // Nightly 20K at 31.50, the Free Buy filled to 600, and the evening's other guarantees.
    const board = [
      event({ id: 'n20k', name: 'Nightly 20K', neededEntries: 635 }),
      event({ id: 'free', name: 'Free Buy', neededEntries: 600, guaranteed: false }),
      event({ id: 'a', neededEntries: 56, startMs: at(1.5), closeMs: at(2.7) }),
      event({ id: 'b', neededEntries: 70, startMs: at(2), closeMs: at(3.3) }),
      event({ id: 'c', neededEntries: 37, startMs: at(2), closeMs: at(3.2) }),
    ];
    expect(guaranteeSupplyFindings(board, 1000)).toEqual([]);
  });

  it('a guarantee needing more than the fleet can enter is a finding', () => {
    const findings = guaranteeSupplyFindings(
      [event({ id: 'big', name: 'Nightly 30K', neededEntries: 953 })],
      1000
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('big');
    expect(findings[0].detail.single_event_supply).toBe(1000 * SINGLE_EVENT_FLEET_SHARE);
  });

  it('events that overlap beyond the tournament games the fleet keeps are findings', () => {
    const board = [
      event({ id: 'x', neededEntries: 750 }),
      event({ id: 'y', neededEntries: 750 }),
      event({ id: 'free', neededEntries: 600, guaranteed: false }),
      event({ id: 'later', neededEntries: 300, startMs: at(6), closeMs: at(7) }),
    ];
    expect(guaranteeSupplyFindings(board, 1000).map((f) => f.id)).toEqual(['x', 'y']);
    // 2,100 entries against 2,000 games; a fleet of 1,100 keeps 2,200 and clears it.
    expect(guaranteeSupplyFindings(board, 1100).map((f) => f.id)).toEqual([]);
  });

  it('an unreadable clock is skipped, never guessed', () => {
    expect(
      guaranteeSupplyFindings([event({ id: 'nan', neededEntries: 5000, startMs: NaN })], 1000)
    ).toEqual([]);
  });
});
