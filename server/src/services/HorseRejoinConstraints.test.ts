/**
 * A BARRED HORSE IS NOT A BUYER (2026-09-05).
 *
 * The door rules the fleet reads before it tries a seat: the VPIP bar
 * (fn_cash_rejoin_floor raises VPIP_BARRED) and the rejoin floor
 * (BUYIN_BELOW_FLOOR). Measured before the fleet read them: 341 of 349
 * buy-in refusals in one hour were VPIP_BARRED, from 35 horses holding 57
 * active bars, every one counted as a buyer first.
 */
import { describe, it, expect } from 'vitest';
import {
  applyRejoinFloor,
  buildRejoinConstraints,
  rejoinPlayerKey,
  rejoinTableKey,
} from './HorseRejoinConstraints.js';

const NOW = Date.parse('2026-09-05T08:00:00Z');
const later = (mins: number) => new Date(NOW + mins * 60_000).toISOString();

const MADNESS = 'cluster:050f0735-1eac-45b3-90f8-3e50ab72dc04';
const LIGHTNING = 'cluster:f67a1436-e842-4b49-8644-3e184bd77ba6';

const row = (over: Partial<Parameters<typeof buildRejoinConstraints>[0][number]> = {}) => ({
  player_id: 'horse-1',
  game_scope: MADNESS,
  required_stack: '0.01',
  barred_until: null,
  expires_at: later(60),
  ...over,
});

describe('the key is the game, exactly as fn_cash_game_scope_of_table writes it', () => {
  it('a must-move / Lightning table keys on its cash game', () => {
    expect(rejoinTableKey({ id: 't-1', cluster_id: '050f0735-1eac-45b3-90f8-3e50ab72dc04' })).toBe(
      MADNESS
    );
  });

  it('every table of one cash game shares one key (feeder, main 2, ...)', () => {
    const feeder = rejoinTableKey({ id: 'feeder', cluster_id: 'g' });
    const main2 = rejoinTableKey({ id: 'main-2', cluster_id: 'g' });
    expect(feeder).toBe(main2);
  });

  it('a standalone table keys on its own scope, then its own id', () => {
    expect(rejoinTableKey({ id: 'x', seat_game_scope: 'table:x' })).toBe('table:x');
    expect(rejoinTableKey({ id: 'x' })).toBe('table:x');
  });
});

describe('ONE GAME, NOT ONE STAKES LEVEL (Dan, 2026-11-18)', () => {
  it('a Madness floor does not follow the player into Lightning at the same stakes', () => {
    // WooWoo: left PLO5 1/2 Madness Feeder with 3,762.18, sat in PLO5 1/2
    // Lightning Games Feeder (max 400) and was forced to bring the 3,762.18.
    const c = buildRejoinConstraints(
      [row({ player_id: 'woowoo', game_scope: MADNESS, required_stack: '3762.18' })],
      NOW
    );
    expect(c.rejoinFloor.get(rejoinPlayerKey('woowoo', MADNESS))).toBe(3762.18);
    expect(c.rejoinFloor.get(rejoinPlayerKey('woowoo', LIGHTNING))).toBeUndefined();
    expect(
      applyRejoinFloor(400, c.rejoinFloor.get(rejoinPlayerKey('woowoo', LIGHTNING)), 400)
    ).toBe(400);
  });

  it('a VPIP bar in one game does not bar the same stakes in another game', () => {
    const c = buildRejoinConstraints([row({ barred_until: later(90) })], NOW);
    expect(c.barred.has(rejoinPlayerKey('horse-1', MADNESS))).toBe(true);
    expect(c.barred.has(rejoinPlayerKey('horse-1', LIGHTNING))).toBe(false);
  });

  it('a row with no game matches nothing, as game_scope = NULL matches nothing in SQL', () => {
    const c = buildRejoinConstraints(
      [row({ game_scope: null, barred_until: later(90), required_stack: '500' })],
      NOW
    );
    expect(c.barred.size).toBe(0);
    expect(c.rejoinFloor.size).toBe(0);
  });
});

describe('buildRejoinConstraints', () => {
  it('a bar still in force bars exactly that horse in exactly that game', () => {
    const c = buildRejoinConstraints([row({ barred_until: later(90) })], NOW);
    expect(c.barred.has(rejoinPlayerKey('horse-1', MADNESS))).toBe(true);
    // a different horse in the same game is unaffected
    expect(c.barred.has(rejoinPlayerKey('horse-2', MADNESS))).toBe(false);
  });

  it('a bar that has lifted does not bar, even while the floor row is still alive', () => {
    const c = buildRejoinConstraints(
      [row({ barred_until: later(-1), required_stack: '250', expires_at: later(60) })],
      NOW
    );
    expect(c.barred.size).toBe(0);
    expect(c.rejoinFloor.get(rejoinPlayerKey('horse-1', MADNESS))).toBe(250);
  });

  it('an expired row is ignored entirely', () => {
    const c = buildRejoinConstraints(
      [row({ barred_until: later(90), required_stack: '250', expires_at: later(-1) })],
      NOW
    );
    expect(c.barred.size).toBe(0);
    expect(c.rejoinFloor.size).toBe(0);
  });

  it('two floors for one game keep the higher', () => {
    const c = buildRejoinConstraints(
      [row({ required_stack: '120' }), row({ required_stack: '300' }), row({ required_stack: 80 })],
      NOW
    );
    expect(c.rejoinFloor.get(rejoinPlayerKey('horse-1', MADNESS))).toBe(300);
  });

  it('a bar-only row (the one-cent floor) bars but does not meaningfully raise a buy-in', () => {
    const c = buildRejoinConstraints([row({ barred_until: later(30) })], NOW);
    const key = rejoinPlayerKey('horse-1', MADNESS);
    expect(c.barred.has(key)).toBe(true);
    expect(applyRejoinFloor(100, c.rejoinFloor.get(key), 200)).toBe(100);
  });
});

describe('applyRejoinFloor - what the buy-in modal shows a human', () => {
  it('raises a buy-in below the floor to the floor', () => {
    expect(applyRejoinFloor(100, 180, 200)).toBe(180);
  });
  it('leaves a buy-in already at or above the floor alone', () => {
    expect(applyRejoinFloor(190, 180, 200)).toBe(190);
    expect(applyRejoinFloor(180, 180, 200)).toBe(180);
  });
  it('clamps at the table max, exactly as fn_cash_effective_buyin does', () => {
    expect(applyRejoinFloor(100, 450, 200)).toBe(450);
  });
  it('no floor, no change', () => {
    expect(applyRejoinFloor(100, undefined, 200)).toBe(100);
    expect(applyRejoinFloor(100, Number.NaN, 200)).toBe(100);
  });
  it('never lowers a buy-in', () => {
    expect(applyRejoinFloor(250, 100, 200)).toBe(250);
  });
});
