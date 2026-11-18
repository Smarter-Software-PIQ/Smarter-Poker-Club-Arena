/**
 * WHERE A HORSE SITS (2026-11-07). Both horse seating paths took the lowest
 * open seat number, so tables filled 1, 2, 3, ... - a tell. HorseSeatChoice
 * picks among the open chairs like a person: spread out, rarely beside the
 * last arrival, a little toward the button. Deterministic per
 * (horse, table, moment). It never chooses a chair that is not open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  chooseHorseSeat,
  horseSeatPicker,
  seatChoiceMoment,
  seatDistance,
  seatWeight,
} from './HorseSeatChoice.js';
import { HorseFleetManager } from './HorseFleetManager.js';
import { supabase } from './supabase.js';
import { HORSE_UNION_CASH_PLAN as plan } from './HorseUnionCashPlan.js';

/* The call path is tested for the CHAIR; the work schedule and days off
   (owner 2026-11-12) are pinned on duty here and proven on their own in
   HorseWorkSchedule.law.test.ts. */
vi.mock('./HorseWorkSchedule.js', () => ({ offDutyReason: () => null, onDuty: () => true }));

const horses = Array.from({ length: 400 }, (_, i) => `horse-${i}`);

describe('the pure choice', () => {
  it('only ever answers an open chair, and null when none is open', () => {
    for (const h of horses.filter((_, i) => i % 4 === 0)) {
      const occupied = new Set([2, 5, 7]);
      const open = [1, 3, 4, 6, 8, 9];
      const seat = chooseHorseSeat({
        horseId: h,
        tableId: 't',
        moment: 1,
        maxSeats: 9,
        open,
        occupied,
      });
      expect(open).toContain(seat);
    }
    expect(
      chooseHorseSeat({
        horseId: 'h',
        tableId: 't',
        moment: 1,
        maxSeats: 9,
        open: [],
        occupied: new Set(),
      })
    ).toBeNull();
    // An "open" chair that is actually occupied is never handed out.
    expect(
      chooseHorseSeat({
        horseId: 'h',
        tableId: 't',
        moment: 1,
        maxSeats: 9,
        open: [4],
        occupied: new Set([4]),
      })
    ).toBeNull();
  });

  it('is deterministic per (horse, table, moment) and varies across them', () => {
    const args = {
      tableId: 't',
      maxSeats: 9,
      open: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      occupied: new Set<number>(),
    };
    const a = chooseHorseSeat({ ...args, horseId: 'h1', moment: 7 });
    expect(chooseHorseSeat({ ...args, horseId: 'h1', moment: 7 })).toBe(a);
    const firsts = new Set(horses.map((h) => chooseHorseSeat({ ...args, horseId: h, moment: 7 })));
    expect(firsts.size).toBe(9);
    const moments = new Set(
      Array.from({ length: 60 }, (_, m) => chooseHorseSeat({ ...args, horseId: 'h1', moment: m }))
    );
    expect(moments.size).toBeGreaterThan(3);
  });

  it('spreads out: a chair far from everyone outweighs one beside someone', () => {
    const ctx = { maxSeats: 9, occupied: new Set([1]) };
    expect(seatWeight(5, ctx)).toBeGreaterThan(seatWeight(2, ctx));
    expect(seatWeight(9, ctx)).toBe(seatWeight(2, ctx)); // 9 is beside 1 around the table
    expect(seatDistance(9, 1, 9)).toBe(1);
  });

  it('rarely, not never, sits right beside the last arrival', () => {
    const ctx = { maxSeats: 9, occupied: new Set([1, 4]), lastArrivalSeat: 4 };
    expect(seatWeight(5, ctx)).toBeLessThan(seatWeight(5, { ...ctx, lastArrivalSeat: null }));
    expect(seatWeight(5, ctx)).toBeGreaterThan(0);
  });

  it('leans toward the button and cutoff, away from the blinds about to come', () => {
    const ctx = { maxSeats: 9, occupied: new Set<number>(), buttonSeat: 4 };
    expect(seatWeight(4, ctx)).toBeGreaterThan(seatWeight(5, ctx)); // button vs SB
    expect(seatWeight(3, ctx)).toBeGreaterThan(seatWeight(6, ctx)); // cutoff vs BB
    expect(seatWeight(8, ctx)).toBe(seatWeight(8, { ...ctx, buttonSeat: null }));
  });

  it('an empty 9-max filled by six arrivals does not fill 1..6, and no two runs look alike', () => {
    const fills = new Set<string>();
    let lowestFirst = 0;
    for (let m = 0; m < 50; m++) {
      const picker = horseSeatPicker({ tableId: 'table-x', moment: m, maxSeats: 9, occupied: [] });
      const seats = horses.slice(0, 6).map((h) => picker.take(h)!);
      expect(new Set(seats).size).toBe(6);
      for (const s of seats) expect(s).toBeGreaterThanOrEqual(1);
      for (const s of seats) expect(s).toBeLessThanOrEqual(9);
      if (seats.join() === '1,2,3,4,5,6') lowestFirst++;
      fills.add(seats.join());
    }
    expect(lowestFirst).toBe(0);
    expect(fills.size).toBeGreaterThan(40);
  });

  it('two arrivals at an empty table usually sit apart (spread), sometimes beside', () => {
    let adjacent = 0;
    for (const h of horses.filter((_, i) => i % 2 === 0)) {
      const picker = horseSeatPicker({ tableId: 'spread', moment: 3, maxSeats: 9, occupied: [] });
      const a = picker.take(h)!;
      const b = picker.take(`${h}-second`)!;
      if (seatDistance(a, b, 9) === 1) adjacent++;
    }
    // A uniform pick would be beside 2/8 = 25% of the time.
    expect(adjacent).toBeLessThan(200 * 0.15);
  });

  it('the picker hands out each chair once and gets a released chair back', () => {
    const picker = horseSeatPicker({ tableId: 't', moment: 1, maxSeats: 3, occupied: [2] });
    const a = picker.take('a')!;
    const b = picker.take('b')!;
    expect(new Set([a, b, 2]).size).toBe(3);
    expect(picker.take('c')).toBeNull();
    picker.release(a);
    expect(picker.open()).toEqual([a]);
    expect(picker.take('c')).toBe(a);
  });

  it('the moment is the minute', () => {
    expect(seatChoiceMoment(120_000)).toBe(2);
    expect(seatChoiceMoment(179_999)).toBe(2);
  });
});

type OfferFleet = {
  claimOfferedSeats(...args: unknown[]): Promise<number>;
  resolveSeatClub(...args: unknown[]): string;
  computeHorseBuyIn(...args: unknown[]): number;
  sitsWithAutoTopUp(...args: unknown[]): Promise<boolean>;
  seatHorse(...args: unknown[]): Promise<boolean>;
};

describe('THE CALL PATH: a horse answering a seat offer sits where the choice says', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function claim(horseId: string, occupied: number[], buttonSeat: number | null) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 4, 5 + 6, 30)));
    const game = plan.games.find((row) => row.name === 'Classic NLH .10/.25')!;
    const table = {
      id: 'offer-table',
      club_id: plan.unionId,
      union_id: plan.unionId,
      cluster_id: game.id,
      role: 'main',
      main_index: 1,
      lifecycle: 'live',
      game_variant: game.variant,
      small_blind: game.smallBlind,
      big_blind: game.bigBlind,
      max_players: 9,
    };
    const offer = {
      id: 'offer',
      table_id: table.id,
      user_id: horseId,
      hold_expires_at: new Date(Date.now() + 60000).toISOString(),
    };
    const builder: Record<string, unknown> = {};
    for (const key of ['select', 'eq', 'order', 'limit', 'gt', 'update'])
      builder[key] = () => builder;
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [offer], error: null }).then(resolve);
    vi.spyOn(supabase, 'from').mockReturnValue(builder as never);
    const buttonLookup = vi.fn(() => buttonSeat);
    const fleet = new HorseFleetManager({ buttonSeatOf: buttonLookup }) as unknown as OfferFleet;
    vi.spyOn(fleet, 'resolveSeatClub').mockReturnValue(plan.unionId);
    vi.spyOn(fleet, 'computeHorseBuyIn').mockReturnValue(20);
    vi.spyOn(fleet, 'sitsWithAutoTopUp').mockResolvedValue(false);
    const seat = vi.spyOn(fleet, 'seatHorse').mockResolvedValue(true);
    const seats = occupied.map((n, i) => ({
      user_id: `seated-horse-${i}`,
      table_id: table.id,
      seat_number: n,
    }));
    const claimed = await fleet.claimOfferedSeats(
      [table],
      seats,
      new Map(),
      false,
      new Set([horseId, ...occupied.map((_, i) => `seated-horse-${i}`)]),
      {},
      new Set()
    );
    expect(claimed).toBe(1);
    expect(buttonLookup).toHaveBeenCalledWith(table.id);
    const chosen = seat.mock.calls[0][2] as number;
    const expected = horseSeatPicker({
      tableId: table.id,
      moment: seatChoiceMoment(),
      maxSeats: 9,
      occupied,
      buttonSeat,
    }).take(horseId);
    return { chosen, expected };
  }

  it('the seat handed to seatHorse is the choice, never an occupied chair', async () => {
    const results = new Set<number>();
    for (const h of horses.slice(0, 24)) {
      const { chosen, expected } = await claim(h, [1, 2], 5);
      expect(chosen).toBe(expected);
      expect([1, 2]).not.toContain(chosen);
      results.add(chosen);
      vi.restoreAllMocks();
    }
    // Lowest-open would have been 3 every time.
    expect(results.size).toBeGreaterThan(3);
  });
});

describe('THE WIRING (source contract): the seeding loop and GameServer', () => {
  const FLEET = readFileSync(new URL('./HorseFleetManager.ts', import.meta.url), 'utf8');
  const SERVER = readFileSync(new URL('../GameServer.ts', import.meta.url), 'utf8');

  it('the seeding loop gives each cleared horse a chair from the picker, not emptySeats[i]', () => {
    expect(FLEET).toContain('const seatPicker = horseSeatPicker({');
    expect(FLEET).toContain('const chair = seatPicker.take(String(horse.id));');
    expect(FLEET).toContain('cleared.push({ horse, seatNumber: chair, verdict });');
    expect(FLEET).not.toContain('seatNumber: emptySeats[i]');
    // The lone-seat second draw takes its chair from the same book.
    expect(FLEET).toContain('const chair = seatPicker.take(String(h.id));');
    expect(FLEET).not.toContain('chairs.shift()');
  });

  it('the offer path no longer scans for the lowest open number', () => {
    const claimSrc = FLEET.slice(FLEET.indexOf('private async claimOfferedSeats('));
    expect(claimSrc).toContain('}).take(String(offer.user_id)) ?? -1;');
    expect(claimSrc).not.toMatch(/for \(let s = 1; s <= maxSeats; s\+\+\)/);
  });

  it('GameServer hands the fleet the live button', () => {
    expect(SERVER).toContain(
      'buttonSeatOf: (tableId) => this.getTableEngine(tableId)?.getCurrentButtonSeat() ?? null'
    );
  });
});
