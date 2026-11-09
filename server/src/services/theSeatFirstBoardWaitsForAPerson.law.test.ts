/**
 * THE SEAT-FIRST BOARD WAITS FOR A PERSON (Dan, 2026-11-08, binding)
 *
 * Dan, verbatim: "WE SHOULD ONLY HAVE ONE HORSE SITTING AT HAND FULL OF
 * EVENTS, WE ARE AUTO RUNNING WAY TOO MANY ... SIT ONE HORSE AT LIKE 11
 * DIFFERENT SPINS AND LIKE 6 SIT N GO'S. SPINS AND SIT N GO'S WAIT FOR HUMANS
 * TO JOIN, AFTER 1 HOURS TO 1:20 MINUTES WITH NO HUMANS A SECOND HORSE SITS
 * FOR SPINS, AND THEN WITHIN THE NEXT 30-60 MIN A 3RD HORSE WILL SIT TO PLAY
 * ... FOR SIT N GOES, HORSE WAITS UP TO 4 HOURS FOR A HUMAN TO JOIN, ANYTIME
 * AFTER 3 HOURS AND 4 HOURS A HORSE CAN JOIN TO PLAY ... IF A HUMAN JOINS ANY
 * SIT N GO, IT STARTS. IF A HUMAN SITS AT AN EMPTY TABLE, OTHERS SHOULD JOIN
 * THE SIT N GO WITHIN 3-7 MIN."
 *
 * The measurement behind it, on production for the seven days to 2026-11-07:
 * 29,593 Spins and 26,405 Heads-Up games completed, ~11,539 a day over the
 * three clean days, and SEVEN of the 55,998 had a person in them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SEAT_FIRST_OPENING_HORSES,
  SPIN_LADDER,
  SNG_LADDER,
  SPIN_BOARD_OPEN_TARGET,
  SNG_BOARD_OPEN_TARGET,
  HUMAN_ARRIVAL_MIN_MS,
  HUMAN_ARRIVAL_MAX_MS,
  nextRungMs,
  openingRungMs,
  humanArrivalMs,
  ladderForSeats,
} from '../config/seatFirstLadder.js';

const RECURRING = readFileSync(
  join(process.cwd(), 'src/services/TournamentRecurringService.ts'),
  'utf8'
);
const GAME_SERVER = readFileSync(join(process.cwd(), 'src/GameServer.ts'), 'utf8');

/** A method's own body, bounded by the next method rather than by a count. */
function method(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, `${signature} must still exist`).toBeGreaterThan(-1);
  const next = src.indexOf('\n  private async ', start + signature.length);
  return src.slice(start, next > -1 ? next : src.length);
}

const MIN = 60_000;
/** Every rung is randomised, so a rule is checked over many draws, not one. */
const DRAWS = 400;
const lo = (span: number) => 0;
const hi = (span: number) => span;
const mid = (span: number) => Math.floor(span / 2);

describe('1. each board opens with exactly one horse', () => {
  it('one horse, whatever the seat count', () => {
    expect(SEAT_FIRST_OPENING_HORSES).toBe(1);
  });

  it('the opener is clamped to the seats, so a one-seat board is never oversold', () => {
    expect(RECURRING).toMatch(
      /return Math\.min\(Math\.max\(0, seats\), SEAT_FIRST_OPENING_HORSES\);/
    );
  });
});

describe('2. a Spin waits 60-80 minutes, then another 30-60', () => {
  it('the ladder is those two rungs in that order', () => {
    expect(SPIN_LADDER).toEqual([
      { minMs: 60 * MIN, maxMs: 80 * MIN },
      { minMs: 30 * MIN, maxMs: 60 * MIN },
    ]);
  });

  it('a Spin holding one horse waits 60-80 minutes for the second', () => {
    for (let i = 0; i < DRAWS; i++) {
      const wait = nextRungMs(3, 1, (span) => Math.floor(Math.random() * (span + 1)));
      expect(wait).not.toBeNull();
      expect(wait!).toBeGreaterThanOrEqual(60 * MIN);
      expect(wait!).toBeLessThanOrEqual(80 * MIN);
    }
    // The bounds are reachable, so neither end is decoration.
    expect(nextRungMs(3, 1, lo)).toBe(60 * MIN);
    expect(nextRungMs(3, 1, hi)).toBe(80 * MIN);
  });

  it('a Spin holding two horses waits 30-60 minutes for the third', () => {
    for (let i = 0; i < DRAWS; i++) {
      const wait = nextRungMs(3, 2, (span) => Math.floor(Math.random() * (span + 1)));
      expect(wait!).toBeGreaterThanOrEqual(30 * MIN);
      expect(wait!).toBeLessThanOrEqual(60 * MIN);
    }
    expect(nextRungMs(3, 2, lo)).toBe(30 * MIN);
    expect(nextRungMs(3, 2, hi)).toBe(60 * MIN);
  });

  it('the whole sequence is at least 90 minutes of open board before it deals', () => {
    // The floor of the two rungs together. Measured against the retired rule,
    // where the same board dealt about six minutes after it opened.
    const soonest = nextRungMs(3, 1, lo)! + nextRungMs(3, 2, lo)!;
    expect(soonest).toBe(90 * MIN);
    const latest = nextRungMs(3, 1, hi)! + nextRungMs(3, 2, hi)!;
    expect(latest).toBe(140 * MIN);
  });

  it('a full Spin has no next rung', () => {
    expect(nextRungMs(3, 3, mid)).toBeNull();
    expect(nextRungMs(3, 4, mid)).toBeNull();
  });
});

describe('3. a regular heads-up waits three to four hours', () => {
  it('one rung, 180-240 minutes', () => {
    expect(SNG_LADDER).toEqual([{ minMs: 180 * MIN, maxMs: 240 * MIN }]);
  });

  it('a heads-up holding one horse waits 3-4 hours for the second, and then deals', () => {
    for (let i = 0; i < DRAWS; i++) {
      const wait = nextRungMs(2, 1, (span) => Math.floor(Math.random() * (span + 1)));
      expect(wait!).toBeGreaterThanOrEqual(180 * MIN);
      expect(wait!).toBeLessThanOrEqual(240 * MIN);
    }
    expect(nextRungMs(2, 1, lo)).toBe(180 * MIN);
    expect(nextRungMs(2, 1, hi)).toBe(240 * MIN);
    // Two seats, so the second horse fills it; there is no third rung to wait.
    expect(nextRungMs(2, 2, mid)).toBeNull();
  });

  it('the opening wait is the first rung of the board s own ladder', () => {
    expect(openingRungMs(3, lo)).toBe(60 * MIN);
    expect(openingRungMs(2, lo)).toBe(180 * MIN);
    expect(ladderForSeats(3)).toBe(SPIN_LADDER);
    expect(ladderForSeats(2)).toBe(SNG_LADDER);
  });
});

describe('4. a person overtakes the ladder', () => {
  it('the rest of the field arrives 3-7 minutes after a person sits', () => {
    expect(HUMAN_ARRIVAL_MIN_MS).toBe(3 * MIN);
    expect(HUMAN_ARRIVAL_MAX_MS).toBe(7 * MIN);
    for (let i = 0; i < DRAWS; i++) {
      const wait = humanArrivalMs((span) => Math.floor(Math.random() * (span + 1)));
      expect(wait).toBeGreaterThanOrEqual(3 * MIN);
      expect(wait).toBeLessThanOrEqual(7 * MIN);
    }
  });

  it('a person s board asks for the FULL field; a horse-only board asks for one rung', () => {
    expect(GAME_SERVER).toContain('const target = hasHuman ? seats : Math.min(seats, paid + 1);');
  });

  it('the hold is counted from the person s seat, never from the board s own clock', () => {
    // The board clock is hours away now, so taking the later of the two would
    // strand the one person who actually sat down.
    expect(RECURRING).toContain('return Math.min(ceiling, partnerFloor + spread);');
    expect(RECURRING).not.toContain('Math.max(windowEnd, partnerFloor)');
  });

  it('a full board starts at once rather than waiting for the next poll', () => {
    expect(GAME_SERVER).toContain('this.startFilledSeatFirstBoard(tournamentId, seats);');
  });
});

describe('5. the open board is eleven Spins and six regular heads-up', () => {
  it('platform-wide, not per club and not per price point', () => {
    expect(SPIN_BOARD_OPEN_TARGET).toBe(11);
    expect(SNG_BOARD_OPEN_TARGET).toBe(6);
    // Counted over REGISTERING rows of that variant with no owner scope.
    const room = RECURRING.slice(
      RECURRING.indexOf('private async seatFirstBoardRoom('),
      RECURRING.indexOf('private async checkAndLaunchSNGs(')
    );
    expect(room).toMatch(/\.eq\('variant', variant\)/);
    expect(room).toMatch(/\.eq\('status', 'REGISTERING'\)/);
    expect(room).not.toMatch(/club_id|union_id/);
    expect(room).toMatch(/boardOpenTarget\(variant\) - count/);
  });

  it('a satellite feeder is not counted into the board it sits beside', () => {
    /* Measured on production 2026-11-08, before the ladder activated. A
       satellite feeder carries `variant: 'sng'` in both shapes it takes:
       `tournament_type: 'SATELLITE'` (createSatelliteHeadsUp) and
       `tournament_type: 'SNG'` with `satellite_target_id` set (the 6-max and
       9-max feeders, which are the ones that actually run). Counting by
       variant alone put 60 open feeders against a target of six beside 36
       real boards, which closes the regular heads-up board completely while
       the count reads as "full". Dan put the feeders outside the six, and the
       engine must call a feeder a feeder by the same test the daily report
       uses (fn_ca_seat_first_daily_starts). */
    const room = RECURRING.slice(
      RECURRING.indexOf('private async seatFirstBoardRoom('),
      RECURRING.indexOf('private async checkAndLaunchSNGs(')
    );
    expect(room).toMatch(
      /\.eq\('tournament_type', variant === 'spin' \? 'SPIN' : 'SNG'\)/
    );
    expect(room).toMatch(/\.is\('satellite_target_id', null\)/);
    expect(room).toMatch(/\.is\('satellite_target', null\)/);
  });

  it('a count it could not read opens nothing, rather than reading as room to spare', () => {
    // CLAUDE.md 10.86. Defaulting to "plenty of room" would re-open the whole
    // 64-config catalogue, which is the failure the target exists to prevent.
    expect(RECURRING).toMatch(/if \(room === null \|\| room <= 0\) return;/);
    const room = RECURRING.slice(RECURRING.indexOf('private async seatFirstBoardRoom('));
    expect(room.slice(0, room.indexOf('private async checkAndLaunchSNGs('))).toMatch(
      /return null;/
    );
  });

  it('never opens more in one tick than the platform has room for', () => {
    expect(RECURRING).toMatch(
      /const budget = \{ left: Math\.min\(room, boardBudgetShares\(1\)\) \};/
    );
  });
});

describe('6. concurrent launcher ticks cannot overrun the board or seat a horse twice', () => {
  it('one tick per variant at a time, and the flag is always released', () => {
    const tick = RECURRING.slice(
      RECURRING.indexOf('private async withBoardTick('),
      RECURRING.indexOf('private async seatFirstBoardRoom(')
    );
    expect(tick).toMatch(/if \(this\.boardTickInFlight\[variant\]\)[\s\S]*?return;/);
    expect(tick).toMatch(/this\.boardTickInFlight\[variant\] = true;/);
    // `finally`, not the end of `try`: every path inside returns early on a
    // read error, and a stuck flag would freeze the board permanently.
    expect(tick).toMatch(/finally \{[\s\S]*?this\.boardTickInFlight\[variant\] = false;/);
  });

  it('both board passes run inside that guard', () => {
    expect(RECURRING).toMatch(/await this\.withBoardTick\('sng',/);
    expect(RECURRING).toMatch(/await this\.withBoardTick\('spin',/);
  });

  it('one filler per board: a board another lane is filling is left to it', () => {
    expect(GAME_SERVER).toContain('if (this.tournamentTopUpsInFlight.has(tournamentId)) return;');
  });

  it('the budget is spent by one owner at a time, drawn in a fresh order each tick', () => {
    expect(RECURRING).toMatch(/private boardOpenOrder\(owners: BoardOwner\[\]\): BoardOwner\[\]/);
    expect(RECURRING).toMatch(/for \(const board of this\.boardOpenOrder\(owners\)\)/);
    expect(RECURRING).toMatch(/if \(budget\.left <= 0\) break;/);
  });
});

describe('7. an occupied board and an elapsed wait survive a restart', () => {
  it('the wait lives in start_time in the database, not in engine memory', () => {
    // An engine restart must not reset a board that has been waiting an hour,
    // and must not deal one early either. start_time is the only carrier.
    const advance = GAME_SERVER.slice(
      GAME_SERVER.indexOf('private async advanceSeatFirstRung('),
      GAME_SERVER.indexOf('/** Last "is a human seated here" answer')
    );
    expect(advance).toMatch(/\.from\('tournaments'\)/);
    expect(advance).toMatch(/\.update\(\{ start_time: new Date\(Date\.now\(\) \+ waitMs\)/);
    // Only a board still taking entries: one that started, finished or was
    // cancelled between the top-up and this write keeps its own clock.
    expect(advance).toMatch(/\.eq\('status', 'REGISTERING'\)/);
  });

  it('a failed rung write leaves the old window rather than dealing early', () => {
    const advance = GAME_SERVER.slice(
      GAME_SERVER.indexOf('private async advanceSeatFirstRung('),
      GAME_SERVER.indexOf('/** Last "is a human seated here" answer')
    );
    expect(advance).toMatch(/if \(error\) \{[\s\S]*?return;/);
  });

  it('rotating which price points are open never closes an occupied board', () => {
    // The rotation only chooses among configs that have NO open instance, so
    // a board someone is sitting at is not a candidate for anything.
    expect(RECURRING).toMatch(/const missing = configs\.filter\(\(c\) => !open\.has\(c\.name\)\);/);
    const shuffle = RECURRING.slice(
      RECURRING.indexOf('const missing = configs.filter('),
      RECURRING.indexOf('/* Cap the per-tick burst.')
    );
    expect(shuffle).toMatch(/for \(let i = missing\.length - 1; i > 0; i--\)/);
    expect(shuffle).not.toMatch(/delete|close|cancel/i);
  });
});

describe('8. satellite feeders are outside the six', () => {
  it('a satellite feeder does not spend the heads-up board budget', () => {
    // A satellite exists to feed one named target rather than to be a price
    // point on the open board; folding it into the six would quietly close
    // that target's cheapest way in.
    expect(RECURRING).toMatch(
      /const satelliteShare = Math\.min\(boardBudgetShares\(1\), SATELLITE_HU_TARGETS_PER_OWNER\);/
    );
  });

  it('and it is a SATELLITE row, so it is counted and reported on its own', () => {
    // Bounded by the method it is about, never by a byte count
    // (tests/unit/noFixedSizeSourceWindows.test.ts).
    const create = method(RECURRING, 'private async createSatelliteHeadsUp(');
    expect(create).toMatch(/tournament_type: 'SATELLITE'/);
  });
});
