/**
 * THE OWNER SHEET OWNS THE MIDWAY ROWS IT LISTS (2026-11-18, lag incident).
 *
 * The fixed board sync (ScheduledTournamentService.syncFixedBoard) runs every
 * ten minutes and must reach an empty plan. Against production it never did:
 * the trigger a01_tournament_schedule_board_is_hard_coded rewrites every write
 * to a Midway Union schedule from the owner weekly sheet, so the 22 PATCHes
 * the plan asked for each returned 204 and changed nothing, and the next sync
 * asked for the same 22 again. Each one is a tournament_schedules row update
 * with eight row triggers, on a table the settlement lanes queue behind.
 *
 * The fixture is the production table as read on 2026-11-18 with the same
 * filter the sync uses (config->>fixedBoard IS NOT NULL), all 58 rows, minus
 * the two bulky config keys the plan never reads (blindStructure,
 * midwayWeeklyTerms).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIXED_BOARD,
  FIXED_BOARD_CLUBS,
  OWNER_SHEET_CLUB_ID,
  OWNER_SHEET_RETIRED_SCHEDULE_IDS,
  fixedBoardRowFor,
  isDatabaseOwnedBoardRow,
  isOwnerSheetRow,
  planFixedBoardSync,
  type ExistingFixedBoardRow,
} from './fixedBoard.js';

const here = dirname(fileURLToPath(import.meta.url));
const production = JSON.parse(
  readFileSync(join(here, 'fixtures', 'productionFixedBoardRows.2026-11-18.json'), 'utf8')
) as ExistingFixedBoardRow[];

const MIDWAY = FIXED_BOARD_CLUBS.find((c) => c.clubId === OWNER_SHEET_CLUB_ID)!;
const ARENA = FIXED_BOARD_CLUBS.find((c) => c.clubId !== OWNER_SHEET_CLUB_ID)!;
const midwayRows = production.filter((r) => r.club_id === MIDWAY.clubId);

describe('the production fixture is the table the sync reads', () => {
  it('holds 58 fixed-board rows: 29 Midway (22 on, 7 off) and 29 arena', () => {
    expect(production).toHaveLength(58);
    expect(midwayRows).toHaveLength(29);
    expect(midwayRows.filter((r) => r.active)).toHaveLength(22);
    expect(production.filter((r) => r.club_id === ARENA.clubId)).toHaveLength(29);
  });

  it('every active Midway row is a sheet row, and none carries the time-change keys', () => {
    const active = midwayRows.filter((r) => r.active);
    expect(active.every(isOwnerSheetRow)).toBe(true);
    for (const r of active) {
      expect(r.config).not.toHaveProperty('previousStartTimes');
      expect(r.config).not.toHaveProperty('retiredStartTimes');
      expect(r.config).not.toHaveProperty('startTimesEffectiveFrom');
    }
  });

  it('21 of those rows differ from what this file would write, which is what never converged', () => {
    const drifting = midwayRows.filter((r) => {
      const event = FIXED_BOARD.find((e) => e.name === r.config?.fixedBoard);
      if (!event || !r.active) return false;
      const want = fixedBoardRowFor(MIDWAY, event).config;
      return (
        want.startTimesEffectiveFrom !== r.config?.startTimesEffectiveFrom ||
        JSON.stringify(want.previousStartTimes) !== JSON.stringify(r.config?.previousStartTimes)
      );
    });
    expect(drifting).toHaveLength(21);
  });
});

describe('the plan converges against production', () => {
  it('asks for nothing at all on the Midway Union', () => {
    expect(planFixedBoardSync(production, [MIDWAY])).toEqual({
      inserts: [],
      updates: [],
      deactivate: [],
    });
  });

  it('asks for nothing on a Midway row when every club is planned', () => {
    const plan = planFixedBoardSync(production);
    const midwayIds = new Set(midwayRows.map((r) => r.id));
    expect(plan.inserts.filter((r) => r.club_id === MIDWAY.clubId)).toEqual([]);
    expect(plan.updates.filter((u) => midwayIds.has(u.id))).toEqual([]);
    expect(plan.deactivate.filter((id) => midwayIds.has(id))).toEqual([]);
  });

  it('is stable: planning twice gives the same empty Midway plan', () => {
    const first = planFixedBoardSync(production, [MIDWAY]);
    const second = planFixedBoardSync(production, [MIDWAY]);
    expect(second).toEqual(first);
  });
});

describe('a row the database decides alone is never written', () => {
  const sheetRow = midwayRows.find((r) => isOwnerSheetRow(r))!;
  const event = FIXED_BOARD.find((e) => e.name === sheetRow.config?.fixedBoard)!;

  it.each([
    ['other times', { start_times_utc: ['03:33'] }],
    ['other days', { days_of_week: [2] }],
    ['another zone', { time_zone: 'UTC' }],
    ['switched off', { active: false }],
  ])('a sheet row with %s is still left to the sheet', (_label, change) => {
    const row = { ...sheetRow, ...change } as ExistingFixedBoardRow;
    expect(planFixedBoardSync([row], [MIDWAY], [event])).toEqual({
      inserts: [],
      updates: [],
      deactivate: [],
    });
  });

  it('a sheet row for an event this file no longer lists is not switched off from here', () => {
    const row = {
      ...sheetRow,
      config: { ...sheetRow.config, fixedBoard: 'An Event Only The Sheet Lists' },
    } as ExistingFixedBoardRow;
    expect(planFixedBoardSync([row], [MIDWAY]).deactivate).toEqual([]);
  });

  it('the sheet row is the event row even beside an older active copy, which is retired', () => {
    const copy = {
      ...sheetRow,
      id: 'older-copy',
      config: { type: 'fixed_board', fixedBoard: event.name, horsesToRegister: event.horses },
    } as ExistingFixedBoardRow;
    const plan = planFixedBoardSync([copy, sheetRow], [MIDWAY], [event]);
    expect(plan).toEqual({ inserts: [], updates: [], deactivate: ['older-copy'] });
  });

  it('the row the sheet retired stays off without a write', () => {
    for (const id of OWNER_SHEET_RETIRED_SCHEDULE_IDS) {
      const row = midwayRows.find((r) => r.id === id)!;
      expect(row, id).toBeTruthy();
      expect(row.active).toBe(false);
      expect(isDatabaseOwnedBoardRow(row)).toBe(true);
    }
  });
});

describe('everything else is still the engine board', () => {
  it('a Midway row the sheet does not list is still rewritten to this file', () => {
    const event = FIXED_BOARD.find((e) => e.name === 'Morning Free Buy (NLH)')!;
    const want = fixedBoardRowFor(MIDWAY, event);
    const stale = { ...want, id: 'not-on-the-sheet', start_times_utc: ['09:15'] };
    expect(isOwnerSheetRow(stale)).toBe(false);
    expect(planFixedBoardSync([stale], [MIDWAY], [event]).updates).toEqual([
      { id: 'not-on-the-sheet', row: want },
    ]);
  });

  it('the sheet marker means nothing on another club', () => {
    const event = FIXED_BOARD[0];
    const want = fixedBoardRowFor(ARENA, event);
    const row = {
      ...want,
      id: 'arena-row',
      start_times_utc: ['09:15'],
      config: { ...want.config, midwayWeeklyRevision: 'owner-sheet-2026-11-07-v1' },
    };
    expect(isOwnerSheetRow(row)).toBe(false);
    expect(planFixedBoardSync([row], [ARENA], [event]).updates.map((u) => u.id)).toEqual([
      'arena-row',
    ]);
  });
});

describe('the engine and the trigger agree on who owns what', () => {
  const migrationsDir = join(here, '..', '..', '..', 'supabase', 'migrations');
  const DEFINES = 'CREATE OR REPLACE FUNCTION public.fn_tournament_schedule_board_is_hard_coded()';
  const latest = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(join(migrationsDir, f), 'utf8').includes(DEFINES))
    .pop();
  const sql = latest ? readFileSync(join(migrationsDir, latest), 'utf8') : '';
  const body = sql.slice(sql.indexOf(DEFINES)).split('$function$')[1] ?? '';

  it('the newest definition of the trigger still rewrites Midway rows from the sheet', () => {
    expect(latest, 'no migration defines the trigger').toBeTruthy();
    expect(body).toContain(`NEW.club_id='${OWNER_SHEET_CLUB_ID}'::uuid`);
    expect(body).toContain('public.fn_ca_midway_weekly_catalog()');
    expect(body).toContain('NEW:=jsonb_populate_record(NEW,owned)');
  });

  it('the ids it pins off are exactly the ids this file leaves off', () => {
    const list = /NEW\.id IN \(([^)]*)\)/.exec(body)?.[1] ?? '';
    const pinned = [...list.matchAll(/'([0-9a-f-]{36})'::uuid/g)].map((m) => m[1]);
    expect(pinned.sort()).toEqual([...OWNER_SHEET_RETIRED_SCHEDULE_IDS].sort());
  });

  it('every sheet event carries the marker the engine reads', () => {
    const CATALOG = 'CREATE OR REPLACE FUNCTION public.fn_ca_midway_weekly_catalog()';
    const file = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => readFileSync(join(migrationsDir, f), 'utf8').includes(CATALOG))
      .pop();
    expect(file, 'no migration defines the catalog').toBeTruthy();
    const text = readFileSync(join(migrationsDir, file!), 'utf8');
    const doc = JSON.parse(text.slice(text.indexOf(CATALOG)).split('$catalog$')[1]) as {
      events: { id: string; config: Record<string, unknown> }[];
    };
    expect(doc.events.length).toBeGreaterThan(100);
    for (const e of doc.events) {
      expect(typeof e.config.midwayWeeklyRevision, e.id).toBe('string');
    }
    const sheetIds = new Set(doc.events.map((e) => e.id));
    for (const r of midwayRows.filter((x) => isOwnerSheetRow(x))) {
      expect(sheetIds.has(r.id), r.id).toBe(true);
    }
  });
});
