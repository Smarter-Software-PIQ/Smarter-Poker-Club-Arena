/**
 * TablePage.EngineHeroSeatNotRendered (2026-10-31): "engine seats hero at N
 * but client renders no seat (maxPlayers=M, rows=R)". The felt now sizes its
 * ring from the engine's table size (seatRingSize) and can draw 2..10 seats,
 * so EVERY valid hero seat at EVERY table size renders - whatever stale
 * `maxPlayers` the client is holding when the snapshot lands.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SUPPORTED_SEATS,
  SEAT_POSITIONS_10MAX,
  rotateSeatsForHero,
  seatLayoutFor,
  seatRingSize,
} from '../../src/lib/tableSeatGeometry';
import { reconcileHeroSeatFromEngine } from '../../src/lib/heroSeatReconcile';
import { mapEngineSnapshot } from '../../src/utils/mapEngineSnapshot';

const HERO = 'hero-user';
const SIZES = [2, 3, 4, 5, 6, 7, 8, 9, 10];
/** What the client may be holding when the first snapshot lands. */
const STALE_CLIENT_MAX = [0, 2, 6, 9, 10];

function snapshot(maxSeats: number, heroSeat: number) {
  return {
    max_seats: maxSeats,
    stage: 'preflop',
    pot: 0,
    community_cards: [],
    action_history: [],
    current_player: null,
    players: [
      { seat: heroSeat, user_id: HERO, username: 'Hero', stack: 100, cards: [] },
      ...(heroSeat === 1 ? [] : [{ seat: 1, user_id: 'v1', username: 'V', stack: 100, cards: [] }]),
    ],
  };
}

describe('every hero seat at every table size renders (2..10 x 1..N)', () => {
  it('the client can draw ten seats', () => {
    expect(MAX_SUPPORTED_SEATS).toBe(10);
  });

  for (const maxPlayers of SIZES) {
    for (let seat = 1; seat <= maxPlayers; seat++) {
      for (const clientMax of STALE_CLIENT_MAX) {
        it(`${maxPlayers}-max, hero in seat ${seat}, client held maxPlayers=${clientMax}`, () => {
          // 1. The snapshot mapper keeps the hero's row at its seat.
          const mapped = mapEngineSnapshot(snapshot(maxPlayers, seat) as never, HERO, clientMax);
          expect(mapped.maxSeats).toBe(maxPlayers);
          let players = mapped.players as ({ id?: string } | null)[];
          expect(players[seat - 1]?.id).toBe(HERO);

          // 2. The engine-seat heal accepts every valid seat (it used to refuse 10).
          let state = { players, maxPlayers: clientMax, heroSeat: 0 };
          const patch = reconcileHeroSeatFromEngine(state, seat, HERO);
          if (patch) {
            state = {
              players: (patch.players as typeof players) ?? state.players,
              maxPlayers: patch.maxPlayers ?? state.maxPlayers,
              heroSeat: patch.heroSeat ?? state.heroSeat,
            };
            players = state.players;
          }
          // TablePage's row invariant (heroSeat follows the hero's row) for
          // the case the heal leaves alone because the row is already there.
          if (state.heroSeat <= 0) {
            const idx = players.findIndex((p) => p?.id === HERO);
            if (idx >= 0) state = { ...state, heroSeat: idx + 1 };
          }
          expect(state.heroSeat).toBe(seat);

          // 3. The felt's ring has a position for the hero's seat, at the
          //    bottom-centre hero slot, even before maxPlayers is corrected.
          for (const heldMax of [clientMax, state.maxPlayers, mapped.maxSeats]) {
            const size = seatRingSize({ maxPlayers: heldMax, heroSeat: seat, rows: players });
            const ring = seatLayoutFor(size);
            expect(ring.length).toBeGreaterThanOrEqual(seat);
            const rotated = rotateSeatsForHero(ring, seat);
            expect(rotated[seat - 1]).toBeDefined();
            expect(rotated[seat - 1].pos).toEqual({ x: 50, y: 100 });
            // Every occupied row has a drawable position too.
            players.forEach((row, idx) => {
              if (row) expect(rotated[idx]?.pos).toBeDefined();
            });
          }
        });
      }
    }
  }
});

describe('the 10-max ring', () => {
  it('has ten distinct on-felt positions, hero at the bottom centre, mirrored left/right', () => {
    expect(SEAT_POSITIONS_10MAX).toHaveLength(10);
    expect(SEAT_POSITIONS_10MAX[0]).toEqual({ x: 50, y: 100 });
    const keys = new Set(SEAT_POSITIONS_10MAX.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(10);
    for (const p of SEAT_POSITIONS_10MAX) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
      // Symmetric: every seat has a mirror image across x = 50.
      expect(keys.has(`${100 - p.x},${p.y}`)).toBe(true);
    }
  });

  it('reuses only positions an existing measured ring already uses', () => {
    const measured = new Set<string>();
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9])
      for (const p of seatLayoutFor(n)) measured.add(`${p.x},${p.y}`);
    for (const p of SEAT_POSITIONS_10MAX) expect(measured.has(`${p.x},${p.y}`)).toBe(true);
  });

  it('a corrupt size or seat cannot index past the rings', () => {
    for (const bad of [Number.NaN, -3, 0, 1e9, 10.7])
      expect(seatLayoutFor(seatRingSize({ maxPlayers: bad, heroSeat: bad }))).toBeDefined();
    expect(seatRingSize({ maxPlayers: 6, heroSeat: 1e9 })).toBe(MAX_SUPPORTED_SEATS);
    expect(
      seatRingSize({ maxPlayers: 6, rows: [null, null, null, null, null, null, null, {}] })
    ).toBe(8);
  });
});
