/**
 * ═════════════════════════════════════════════════
 *  THE CLUB PROGRAMME MIRRORS THE HOUSE, AND THE THIRD SEAT WAITS FOR A HUMAN
 * ═════════════════════════════════════════════════
 *
 * Dan, 2026-09-03, eight rulings in one message. The ones that live in this
 * process are pinned here; the schedule mirror and the table closures are
 * migrations (20260903171313) and are verified against the database.
 *
 *   3. "ADD IN ALL THE SPINS (MIRROR MIDWAY UNION)" - a club board offers the
 *      same SPIN_CONFIGS the house does (its maxStake permitting), and it is
 *      never starved: the house used to spend the whole BURST first.
 *   4. "fleet should hold the seat for 90-350 seconds max before filling the
 *      3rd seat" - the human window is 90 to 350 seconds, in every place that
 *      hands one out.
 *   5. "ADD THE HIGHER STAKES FOR MIDWAY UNION, CAP IT AT 25-50."
 *   6. "SATELLITE SIT N GO'S ... A TICKET INTO BIGGER BUY IN MTT'S."
 *   7. "ALL MTT'S SHOULD BE ON A RECURRING WEEKLY CYCLE."
 *   2. "CLOSE ANY TABLES OVER 2/5" - the running ones drain through
 *      retire_when_empty rather than being cut off mid-hand.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SEAT_FIRST_HUMAN_WINDOW_MIN_MS,
  SEAT_FIRST_HUMAN_WINDOW_MAX_MS,
  boardBudgetShares,
  BOARD_BUDGET_FLOOR,
  satelliteHeadsUpBuyIn,
  satelliteHeadsUpName,
  pickSatelliteTargets,
  satelliteSourceIsSupported,
  satelliteTargetIsDeliverable,
  SATELLITE_HU_MIN_TICKET,
  SATELLITE_HU_TARGET_LEAD_MS,
  SATELLITE_HU_TARGET_HORIZON_MS,
  SATELLITE_HU_TARGETS_PER_OWNER,
  type SatelliteTargetRow,
} from './TournamentRecurringService.js';
import { freshHumanWindowMs } from './liveTournamentTableRecovery.js';
import {
  SPIN_LADDER,
  SNG_LADDER,
  SEAT_FIRST_OPENING_HORSES,
  SPIN_BOARD_OPEN_TARGET,
  SNG_BOARD_OPEN_TARGET,
} from '../config/seatFirstLadder.js';
import {
  RESTART_WEEKLY_MINUTES,
  RESTART_MAX_MINUTES,
  restartCloneStartMs,
  RESTART_MIN_LEAD_MS,
} from './ScheduledTournamentService.js';
import { isRetiringTable } from './HorseBehavior.js';
import { buyInFor, rakeRateFor } from '../config/buyIn.js';
import { HEADS_UP_SEATS } from '../config/headsUpSpec.js';

const RECURRING = readFileSync(
  join(process.cwd(), 'src/services/TournamentRecurringService.ts'),
  'utf8'
);
const SCHEDULED = readFileSync(
  join(process.cwd(), 'src/services/ScheduledTournamentService.ts'),
  'utf8'
);
const FLEET = readFileSync(join(process.cwd(), 'src/services/HorseFleetManager.ts'), 'utf8');
const ROTATOR = readFileSync(join(process.cwd(), 'src/services/HorseSessionRotator.ts'), 'utf8');

/**
 * ── THE WAIT IS NOW A LADDER, NOT A WINDOW (Dan 2026-11-08) ────────────────
 *
 * Dan: "SPINS AND SIT N GO'S WAIT FOR HUMANS TO JOIN, AFTER 1 HOURS TO 1:20
 * MINUTES WITH NO HUMANS A SECOND HORSE SITS FOR SPINS, AND THEN WITHIN THE
 * NEXT 30-60 MIN A 3RD HORSE WILL SIT TO PLAY ... FOR SIT N GOES, HORSE WAITS
 * UP TO 4 HOURS FOR A HUMAN TO JOIN."
 *
 * This replaced the 90-350 SECOND window, which was measured over the seven
 * days to 2026-11-07: 29,593 Spins and 26,405 Heads-Up games completed, SEVEN
 * of the 55,998 with a person in them.
 *
 * There were THREE surfaces; there are now TWO. `fn_repair_seat_first_games`
 * was dropped on 2026-09-08 (20260908043450_seat_first_inventory_is_created_atomically),
 * so the SQL window it carried has had no caller since - pinning its text kept
 * a retired rule looking live, which is exactly what CLAUDE.md 10.86 warns
 * about. The two surfaces that remain still move together or neither does.
 */
describe('4. the board waits out its ladder for a person', () => {
  it('the engine human window is Dan 3-7 minutes, not the retired 90-350 seconds', () => {
    expect(SEAT_FIRST_HUMAN_WINDOW_MIN_MS).toBe(180_000);
    expect(SEAT_FIRST_HUMAN_WINDOW_MAX_MS).toBe(420_000);
  });
  it('a Spin opens on a 60-80 minute rung and climbs a 30-60 minute one', () => {
    expect(SPIN_LADDER).toEqual([
      { minMs: 60 * 60_000, maxMs: 80 * 60_000 },
      { minMs: 30 * 60_000, maxMs: 60 * 60_000 },
    ]);
  });
  it('a Heads-Up waits three to four hours', () => {
    expect(SNG_LADDER).toEqual([{ minMs: 180 * 60_000, maxMs: 240 * 60_000 }]);
  });
  it('one horse opens a board, whatever its seat count', () => {
    expect(SEAT_FIRST_OPENING_HORSES).toBe(1);
  });
  it('the recovery sweep hands a repaired board its own ladder rung', () => {
    // Both surfaces derive from seatFirstLadder; neither retypes a number.
    const spin = freshHumanWindowMs(3);
    expect(spin).toBeGreaterThanOrEqual(60 * 60_000);
    expect(spin).toBeLessThanOrEqual(80 * 60_000);
    const headsUp = freshHumanWindowMs(2);
    expect(headsUp).toBeGreaterThanOrEqual(180 * 60_000);
    expect(headsUp).toBeLessThanOrEqual(240 * 60_000);
  });
});

describe('3. a club spin board is the house board, and cannot be starved', () => {
  it('every board gets a share of BURST before anyone spends', () => {
    expect(boardBudgetShares(1)).toBe(12);
    expect(boardBudgetShares(2)).toBe(6); // the house and Deep Stack Society
    expect(boardBudgetShares(3)).toBe(4);
    expect(boardBudgetShares(7)).toBe(BOARD_BUDGET_FLOOR);
    expect(boardBudgetShares(0)).toBe(12);
  });
  it('no board is permanently first in the queue for the shared budget', () => {
    /* 2026-11-08: the per-board share is gone, because the board is now
       ELEVEN Spins and SIX Heads-Up platform-wide (Dan's instruction) and a
       share each would be eleven each. One budget again - but the reason the
       shares existed is still real, so the boards are drawn in a fresh order
       every tick instead. Nobody goes first twice by construction. */
    expect(RECURRING).not.toMatch(/const budget = \{ left: BURST \};/);
    expect(RECURRING).toMatch(/private boardOpenOrder\(owners: BoardOwner\[\]\): BoardOwner\[\]/);
    expect(RECURRING).toMatch(/for \(const board of this\.boardOpenOrder\(owners\)\)/);
    // And the budget itself can never exceed what the platform has room for.
    expect(RECURRING).toMatch(
      /const budget = \{ left: Math\.min\(room, boardBudgetShares\(1\)\) \};/
    );
  });
  it('a failed open-board count opens nothing rather than guessing', () => {
    // CLAUDE.md 10.86: an unreadable answer is never coerced into good news.
    // Defaulting to "plenty of room" would re-open the whole 64-config
    // catalogue, which is the exact failure the target exists to prevent.
    expect(RECURRING).toMatch(/if \(room === null \|\| room <= 0\) return;/);
  });
  it('an owner board is the house SPIN_CONFIGS filtered only by its own stake cap', () => {
    expect(RECURRING).toMatch(/SPIN_CONFIGS\.filter\(\(c\) => c\.buyIn <= board\.maxStake\)/);
  });
  it('the open board is eleven Spins and six Heads-Up, platform-wide', () => {
    expect(SPIN_BOARD_OPEN_TARGET).toBe(11);
    expect(SNG_BOARD_OPEN_TARGET).toBe(6);
  });
  it('which price points are open is drawn fresh, so the ladder is not pinned', () => {
    // 64 Spin and 32 Heads-Up configs share 11 and 6 slots. Config order would
    // pin the cheapest eleven open for ever and strand the other fifty-three.
    expect(RECURRING).toMatch(/for \(let i = missing\.length - 1; i > 0; i--\)/);
  });
});

describe('5. the Midway ladder runs to 25/50 and no higher', () => {
  const block = /DEFAULT_TABLES: TableConfig\[\] = \[([\s\S]*?)\n\];/.exec(FLEET)?.[1] ?? '';
  const bigBlinds = [...block.matchAll(/bigBlind: ([0-9.]+),/g)].map((m) => Number(m[1]));
  it('has 5/10, 10/20 and 25/50 NLH plus PLO4 5/10', () => {
    expect(block).toMatch(/name: 'NLH 5\.00\/10\.00'/);
    expect(block).toMatch(/name: 'NLH 10\.00\/20\.00'/);
    expect(block).toMatch(/name: 'NLH 25\.00\/50\.00'/);
    expect(block).toMatch(/name: 'PLO4 5\.00\/10\.00'/);
  });
  it('caps at a 50 big blind', () => {
    expect(Math.max(...bigBlinds)).toBe(50);
  });
});

describe('6. satellite heads-ups pay a seat into a bigger event', () => {
  it('prices two entries to cover one ticket after the heads-up rake, with no overlay', () => {
    const rate = rakeRateFor({ tournamentType: 'SNG', maxPlayers: HEADS_UP_SEATS });
    for (const ticket of [20, 33, 44, 109, 200]) {
      const buyIn = satelliteHeadsUpBuyIn(ticket);
      expect(buyIn).toBeGreaterThan(0);
      expect(buyInFor(buyIn, rate).prize * HEADS_UP_SEATS).toBeGreaterThanOrEqual(ticket);
    }
    expect(satelliteHeadsUpBuyIn(0)).toBe(0);
    expect(satelliteHeadsUpBuyIn(1_000_000)).toBe(0);
  });
  it('names the feeder after its target', () => {
    expect(satelliteHeadsUpName('Sunday $200 Deep Stack')).toBe(
      'Sunday $200 Deep Stack Satellite Heads-Up'
    );
  });
  it('picks the dearest open events inside the window, one per name, never a seat-first game', () => {
    const now = Date.parse('2026-09-03T18:00:00Z');
    const at = (h: number) => new Date(now + h * 3_600_000).toISOString();
    // The flags are read from the row; a feeder never assumes them.
    const plain = {
      format_contract: 'mtt-v1',
      is_bounty: false,
      is_pko: false,
      is_mystery_bounty: false,
      is_premium_spin: false,
    };
    const rows: SatelliteTargetRow[] = [
      {
        ...plain,
        id: 'a',
        name: 'Sunday $200 Deep Stack',
        start_time: at(70),
        buy_in_amount: 180,
        buy_in_fee: 20,
        variant: 'freezeout',
        max_players: 1000,
      },
      {
        ...plain,
        id: 'b',
        name: 'Sunday $200 Deep Stack',
        start_time: at(238),
        buy_in_amount: 180,
        buy_in_fee: 20,
        variant: 'freezeout',
        max_players: 1000,
      },
      {
        ...plain,
        id: 'c',
        name: 'Saturday Night Big Stack',
        start_time: at(50),
        buy_in_amount: 40,
        buy_in_fee: 4,
        variant: 'freezeout',
        max_players: 500,
      },
      {
        ...plain,
        id: 'd',
        name: 'Friday Night Feature',
        start_time: at(30),
        buy_in_amount: 30,
        buy_in_fee: 3,
        variant: 'freezeout',
        max_players: 500,
      },
      {
        ...plain,
        id: 'e',
        name: 'Turbo Tuesday Graveyard',
        start_time: at(20),
        buy_in_amount: 3,
        buy_in_fee: 0.3,
        variant: 'freezeout',
        max_players: 500,
      },
      {
        ...plain,
        id: 'f',
        name: 'NLH Heads-Up 100',
        format_contract: 'sng-v1',
        start_time: at(1),
        buy_in_amount: 95,
        buy_in_fee: 5,
        variant: 'sng',
        max_players: 2,
      },
      {
        ...plain,
        id: 'g',
        name: 'Sunday Deep Stack Satellite $25',
        start_time: at(40),
        buy_in_amount: 22.5,
        buy_in_fee: 2.5,
        variant: 'satellite',
        max_players: 100,
      },
      {
        ...plain,
        id: 'h',
        name: 'Starting Any Minute',
        start_time: at(0.25),
        buy_in_amount: 90,
        buy_in_fee: 10,
        variant: 'freezeout',
        max_players: 500,
      },
      {
        ...plain,
        id: 'i',
        name: 'Next Month',
        start_time: at(24 * 9),
        buy_in_amount: 90,
        buy_in_fee: 10,
        variant: 'freezeout',
        max_players: 500,
      },
      {
        ...plain,
        id: 'j',
        name: 'Union PKO Afternoon (PLO4)',
        start_time: at(60),
        buy_in_amount: 18,
        buy_in_fee: 2,
        variant: 'progressive_bounty',
        max_players: 80,
      },
    ];
    const picked = pickSatelliteTargets(rows, now);
    expect(picked.map((r) => r.id)).toEqual(['a', 'c', 'd']);
    expect(picked.length).toBe(SATELLITE_HU_TARGETS_PER_OWNER);
    expect(SATELLITE_HU_MIN_TICKET).toBe(20);
    expect(SATELLITE_HU_TARGET_LEAD_MS).toBe(30 * 60_000);
    expect(SATELLITE_HU_TARGET_HORIZON_MS).toBe(7 * 24 * 3_600_000);
  });
  it('feeds every bounty, PKO and mystery event; never a Spin or an unknown row', () => {
    // 2026-09-11: the dearest weekly event was a PKO, so it got a feeder every
    // half hour and every finished feeder was refused at settlement
    // ("uses an unsupported bounty or Spin entry split"). 2026-10-16 (Dan:
    // "EVERY TOURNAMENT WITH A 25 BUY IN OR HIGHER SHOULD HAVE SATELLITES INTO
    // IT"): migration 20261017004440 seats a bounty target exactly like a paid
    // entry, so the PKO is now fed - and Spin and unknown flags still are not.
    const now = Date.parse('2026-09-11T03:00:00Z');
    const at = (h: number) => new Date(now + h * 3_600_000).toISOString();
    const plain = {
      format_contract: 'mtt-v1',
      is_bounty: false,
      is_pko: false,
      is_mystery_bounty: false,
      is_premium_spin: false,
      diamond_host: false,
    };
    const pko: SatelliteTargetRow = {
      format_contract: 'mtt-v1',
      id: '8171f9f6-1243-4d51-ac4b-9acabce110dc',
      name: 'Sunday Funday High Roller PKO',
      start_time: at(72),
      buy_in_amount: 67.5,
      buy_in_fee: 7.5,
      variant: 'progressive_bounty',
      max_players: 500,
      tournament_type: 'MTT',
      is_bounty: true,
      is_pko: true,
      is_mystery_bounty: false,
      is_premium_spin: false,
      diamond_host: false,
    };
    const main: SatelliteTargetRow = {
      ...plain,
      id: 'main',
      name: 'Sunday Funday Main Event',
      start_time: at(72),
      buy_in_amount: 45,
      buy_in_fee: 5,
      variant: 'freezeout',
      max_players: 500,
      tournament_type: 'MTT',
    };
    const delivered: SatelliteTargetRow[] = [
      pko,
      { ...main, id: 'flat', name: 'Flat Bounty', is_bounty: true, variant: 'bounty' },
      { ...main, id: 'mystery', name: 'Mystery', is_bounty: true, is_mystery_bounty: true },
      { ...main, id: 'bounty-variant', name: 'Bounty Variant', variant: 'bounty' },
    ];
    const refused: SatelliteTargetRow[] = [
      { ...main, id: 'premium', name: 'Premium Spin', is_premium_spin: true },
      { ...main, id: 'spin-type', name: 'Spin Type', tournament_type: 'SPIN' },
      { ...main, id: 'spin-variant', name: 'Spin Variant', variant: 'spin' },
      { ...main, id: 'unknown', name: 'Unknown Flags', is_pko: null },
      { ...main, id: 'unread', name: 'Unread Flags', is_bounty: undefined },
      // The Diamond seat transfer has no bounty part: a Diamond bounty target,
      // or one whose host was not read, opens no feeder.
      { ...pko, id: 'diamond-pko', name: 'Diamond PKO', diamond_host: true },
      { ...pko, id: 'unread-host-pko', name: 'Unread Host PKO', diamond_host: null },
      { ...pko, id: 'unset-host-pko', name: 'Unset Host PKO', diamond_host: undefined },
    ];
    for (const row of delivered) expect(satelliteTargetIsDeliverable(row)).toBe(true);
    for (const row of refused) expect(satelliteTargetIsDeliverable(row)).toBe(false);
    expect(satelliteTargetIsDeliverable(main)).toBe(true);
    // A plain target in the Diamond Arena is still fed.
    expect(satelliteTargetIsDeliverable({ ...main, diamond_host: true })).toBe(true);
    // The PKO is the dearest row, so it is the first event fed.
    expect(pickSatelliteTargets([...refused, ...delivered, main], now).map((r) => r.id)).toEqual([
      pko.id,
      'flat',
      'mystery',
    ]);
    expect(pickSatelliteTargets(refused, now)).toEqual([]);
  });
  it('a satellite is never itself a bounty or Spin event (the source rule)', () => {
    const satellite: SatelliteTargetRow = {
      format_contract: 'mtt-v1',
      id: 'sat',
      name: 'Sunday Funday High Roller PKO Satellite',
      start_time: null,
      buy_in_amount: 9,
      buy_in_fee: 1,
      variant: 'satellite',
      max_players: 100,
      tournament_type: 'SATELLITE',
      is_bounty: false,
      is_pko: false,
      is_mystery_bounty: false,
      is_premium_spin: false,
    };
    expect(satelliteSourceIsSupported(satellite)).toBe(true);
    expect(satelliteSourceIsSupported({ ...satellite, is_bounty: true })).toBe(false);
    expect(satelliteSourceIsSupported({ ...satellite, variant: 'progressive_bounty' })).toBe(false);
    expect(satelliteSourceIsSupported({ ...satellite, is_pko: null })).toBe(false);
    expect(SCHEDULED).toMatch(
      /if \(!satelliteSourceIsSupported\(old as unknown as SatelliteTargetRow\)\) return;/
    );
  });
  it("the database opens the same targets, with the authority's own predicate", () => {
    const guard = readFileSync(
      join(
        process.cwd(),
        '../supabase/migrations/20261017004440_satellites_seat_bounty_targets.sql'
      ),
      'utf8'
    );
    const body = guard.slice(
      guard.indexOf('CREATE OR REPLACE FUNCTION public.fn_satellite_target_is_deliverable(')
    );
    const deliverable = body.slice(0, body.indexOf('$function$;'));
    for (const flag of ['is_bounty', 'is_pko', 'is_mystery_bounty']) {
      expect(deliverable).toContain(`t.${flag} IS NOT NULL`);
    }
    expect(deliverable).toContain('t.is_premium_spin IS FALSE');
    expect(deliverable).toContain("lower(COALESCE(t.variant, '')) <> 'spin'");
    expect(deliverable).toContain("upper(COALESCE(t.tournament_type, '')) <> 'SPIN'");
    expect(deliverable).toContain('OR NOT public.fn_poker_diamond_tournament(t.id)');
    expect(deliverable).not.toContain('t.is_bounty IS FALSE');
  });
  it('reads the flags the predicate needs from the database', () => {
    const src = RECURRING.slice(RECURRING.indexOf('private async ensureSatelliteHeadsUps('));
    const read = src.slice(0, src.indexOf('.eq('));
    for (const column of [
      'tournament_type',
      'is_bounty',
      'is_pko',
      'is_mystery_bounty',
      'is_premium_spin',
    ]) {
      expect(read).toContain(column);
    }
  });
  it('the row is a heads-up SNG to every seat-first reader and a satellite to the finish', () => {
    const src = RECURRING.slice(RECURRING.indexOf('private async createSatelliteHeadsUp('));
    const insert = src.slice(0, src.indexOf('.select()'));
    expect(insert).toMatch(/variant: 'sng',/);
    expect(insert).toMatch(/tournament_type: 'SATELLITE',/);
    expect(insert).toMatch(/satellite_target_id: config\.targetId,/);
    expect(insert).toMatch(/satellite_seats: 1,/);
    expect(insert).toMatch(/max_players: config\.maxPlayers,/);
  });
  it('the feeders ride the heads-up tick for the house and every activated owner', () => {
    expect(RECURRING).toMatch(
      /await this\.ensureSatelliteHeadsUps\(this\.houseOwner, satelliteShare\);/
    );
    expect(RECURRING).toMatch(
      /for \(const owner of owners\) \{\s*await this\.ensureSatelliteHeadsUps\(owner, satelliteShare\);/
    );
  });
});

describe('7. an event may repeat every week, on the same weekday and time', () => {
  it('a week is the cap, and the checkbox value', () => {
    expect(RESTART_WEEKLY_MINUTES).toBe(10080);
    expect(RESTART_MAX_MINUTES).toBe(10080);
  });
  it('a weekly clone is anchored to the last start, not to when the hand ended', () => {
    const start = Date.parse('2026-09-06T17:00:00Z'); // Sunday 17:00
    const ended = start + 3 * 3_600_000; // ran three hours
    const next = restartCloneStartMs({
      restartMinutes: RESTART_WEEKLY_MINUTES,
      endedAtMs: ended,
      startTimeMs: start,
      nowMs: ended + 60_000,
      guaranteedPrize: 0,
    });
    expect(new Date(next).toISOString()).toBe('2026-09-13T17:00:00.000Z');
  });
  it('a clone made late steps forward to the next slot that is still ahead', () => {
    const start = Date.parse('2026-09-06T17:00:00Z');
    const next = restartCloneStartMs({
      restartMinutes: RESTART_WEEKLY_MINUTES,
      endedAtMs: start + 3_600_000,
      startTimeMs: start,
      nowMs: Date.parse('2026-09-20T12:00:00Z'),
      guaranteedPrize: 0,
    });
    expect(new Date(next).toISOString()).toBe('2026-09-20T17:00:00.000Z');
  });
  it('a sub-daily restart keeps the old rule: ended plus the interval, never inside the lead', () => {
    const ended = Date.parse('2026-09-06T17:40:00Z');
    const next = restartCloneStartMs({
      restartMinutes: 30,
      endedAtMs: ended,
      startTimeMs: ended - 40 * 60_000,
      nowMs: ended,
      guaranteedPrize: 0,
    });
    expect(next).toBe(ended + 30 * 60_000);
    const soon = restartCloneStartMs({
      restartMinutes: 5,
      endedAtMs: ended,
      startTimeMs: null,
      nowMs: ended + 10 * 60_000,
      guaranteedPrize: 0,
    });
    expect(soon).toBe(ended + 10 * 60_000 + RESTART_MIN_LEAD_MS);
  });
});

describe('2. a table over the cap drains through the engine, never a mid-hand cut', () => {
  it('only a literal true retires a table', () => {
    expect(isRetiringTable({ settings: { retire_when_empty: true } })).toBe(true);
    expect(isRetiringTable({ settings: { retire_when_empty: 'true' } })).toBe(false);
    expect(isRetiringTable({ settings: null })).toBe(false);
    expect(isRetiringTable(null)).toBe(false);
    expect(isRetiringTable({ settings: 'garbage' })).toBe(false);
  });
  it('the fleet reads settings and treats a retiring table as surplus', () => {
    // (Slice 2, 2026-09-05: the select also carries cluster_id and lifecycle,
    //  so the fleet can keep its hands off the controller's tables.)
    expect(FLEET).toMatch(
      /current_players, created_at, settings, cluster_id, lifecycle, role, main_index, last_human_seen_at, bomb_pot_enabled, big_blind_ante_enabled, nit_game, maintain_percent_min'/
    );
    expect(FLEET).toMatch(
      /if \(isRetiringTable\(t as \{ settings\?: unknown \}\)\) \{\s*surplusTableIds\.add\(t\.id\);/
    );
  });
  it('the rotator walks one horse out per cycle through the engine, outside the realism cap', () => {
    // 2026-09-05: role / main_index / lifecycle joined the select for the
    // horse seat-change pass (CLAUDE.md 10.5) - it has to know whether a
    // chair is on Main 1, which has no seat change, and whether the table is
    // closing. The columns this pin was written for (settings, for
    // isRetiringTable, and cluster_id, for the drain below) are still there.
    // 2026-09-05 (no lone horse): and created_at, for the opening-feeder grace.
    /* 2026-09-09: THE EMBED NAMES ITS PARENT NOW, and the pin moved with it
       (CLAUDE.md 10.6). `table_seats` gained two composite foreign keys to
       `tables` that afternoon, so the unqualified `tables!inner(...)` this
       used to pin was refused by PostgREST (PGRST201) and the rotator read
       nothing for three and a half hours. The COLUMNS this pin was written
       for are the point and every one of them is still asserted below; what
       changed is that the relationship is named, which is strictly stronger -
       the read can no longer be broken from a distance by a migration in
       another lane. */
    expect(ROTATOR).toMatch(
      /tables!table_seats_table_id_fkey!inner\(id, small_blind, big_blind, game_variant, tournament_id, is_spins, status, settings, cluster_id, role, main_index, lifecycle, last_human_seen_at, created_at, max_players, min_buy_in, max_buy_in, club_id, union_id, arena:clubs!fk_tables_club_id\(id, asset, is_platform, union_id\)\)/
    );
    // 2026-09-05: and the drain never touches a cluster table.
    expect(ROTATOR).toMatch(
      /if \(t\?\.cluster_id\) continue;\s*if \(!isRetiringTable\(t\)\) continue;/
    );
    const drain = ROTATOR.slice(
      ROTATOR.indexOf('A TABLE MARKED FOR RETIREMENT'),
      ROTATOR.indexOf('let departures = 0;')
    );
    expect(drain).toMatch(/engine\.leaveTable\(horseSeat\.user_id\)/);
    expect(drain).not.toMatch(/departures\+\+/);
  });
});
