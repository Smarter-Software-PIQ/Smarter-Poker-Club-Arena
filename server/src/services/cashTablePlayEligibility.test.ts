import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDiamondCashSettingsOpen,
  assertDiamondTournamentSettingsOpen,
  DiamondCashPolicyClosedError,
  DiamondTournamentPolicyClosedError,
  forgetDiamondTournamentTablesSkipped,
  noteDiamondTournamentTableSkipped,
} from './cashTablePlayEligibility.js';

const TABLE = '42dbb91d-42b5-4b6d-af41-86b08203b9cd';
const ARENA = '002c2d27-9584-4e52-835a-bb2be148fc81';

describe('Diamond cash policy evidence', () => {
  it('classifies only an error-free explicit false bound to this arena as policy closed', () => {
    expect(() =>
      assertDiamondCashSettingsOpen(
        TABLE,
        ARENA,
        { club_id: ARENA, cash_games_enabled: true },
        null
      )
    ).not.toThrow();
    try {
      assertDiamondCashSettingsOpen(
        TABLE,
        ARENA,
        { club_id: ARENA, cash_games_enabled: false },
        null
      );
      throw new Error('missing refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(DiamondCashPolicyClosedError);
      expect(error).toMatchObject({
        code: 'diamond_cash_disabled',
        tableId: TABLE,
        arenaId: ARENA,
      });
    }
  });

  it.each(
    [
      null,
      undefined,
      [],
      [{ club_id: ARENA, cash_games_enabled: false }],
      { club_id: 'other-arena', cash_games_enabled: false },
      { club_id: ARENA },
      { club_id: ARENA, cash_games_enabled: null },
      { club_id: ARENA, cash_games_enabled: 'false' },
      { club_id: ARENA, cash_games_enabled: 0 },
    ].map((data) => ({ data }))
  )('keeps missing, malformed or incorrectly bound data actionable: %j', ({ data }) => {
    expect(() => assertDiamondCashSettingsOpen(TABLE, ARENA, data, null)).toThrow(
      /unavailable|malformed/
    );
    try {
      assertDiamondCashSettingsOpen(TABLE, ARENA, data, null);
    } catch (error) {
      expect(error).not.toBeInstanceOf(DiamondCashPolicyClosedError);
    }
  });

  it.each([false, true])('a read failure is unknown even when the body says %s', (enabled) => {
    const cause = new Error('supabase_timeout');
    try {
      assertDiamondCashSettingsOpen(
        TABLE,
        ARENA,
        { club_id: ARENA, cash_games_enabled: enabled },
        cause
      );
      throw new Error('missing failure');
    } catch (error) {
      expect(error).not.toBeInstanceOf(DiamondCashPolicyClosedError);
      expect(error).toMatchObject({
        message: 'Diamond cash settings read failed: supabase_timeout',
        cause,
      });
    }
  });

  it('does not classify a matching free-text message as an authoritative refusal', () => {
    expect(new Error('Diamond Cash Games Are Not Open')).not.toBeInstanceOf(
      DiamondCashPolicyClosedError
    );
  });

  it('requires an explicit successful read result rather than an absent error field', () => {
    expect(() =>
      assertDiamondCashSettingsOpen(
        TABLE,
        ARENA,
        { club_id: ARENA, cash_games_enabled: false },
        undefined
      )
    ).toThrow('Diamond cash settings read failed');
  });
});

describe('Diamond tournament policy evidence (Phase 8)', () => {
  it('opens only on an error-free explicit true bound to this arena', () => {
    expect(() =>
      assertDiamondTournamentSettingsOpen(
        TABLE,
        ARENA,
        { club_id: ARENA, tournaments_enabled: true },
        null
      )
    ).not.toThrow();
    expect(() =>
      assertDiamondTournamentSettingsOpen(
        TABLE,
        ARENA,
        { club_id: ARENA, tournaments_enabled: false },
        null
      )
    ).toThrow('Diamond Tournaments Are Not Open');
  });

  it('reads the tournament switch, never the cash one', () => {
    // cash open, tournaments closed: a tournament table is refused
    expect(() =>
      assertDiamondTournamentSettingsOpen(
        TABLE,
        ARENA,
        { club_id: ARENA, cash_games_enabled: true, tournaments_enabled: false },
        null
      )
    ).toThrow('Diamond Tournaments Are Not Open');
    // a row that carries only the cash switch is malformed for a tournament read
    expect(() =>
      assertDiamondTournamentSettingsOpen(
        TABLE,
        ARENA,
        { club_id: ARENA, cash_games_enabled: true },
        null
      )
    ).toThrow(/unavailable|malformed/);
  });

  it.each(
    [
      null,
      undefined,
      [],
      { club_id: 'other-arena', tournaments_enabled: false },
      { club_id: ARENA, tournaments_enabled: null },
      { club_id: ARENA, tournaments_enabled: 'false' },
      { club_id: ARENA, tournaments_enabled: 0 },
    ].map((data) => ({ data }))
  )('keeps missing, malformed or incorrectly bound data actionable: %j', ({ data }) => {
    expect(() => assertDiamondTournamentSettingsOpen(TABLE, ARENA, data, null)).toThrow(
      /unavailable|malformed/
    );
  });

  it.each([false, true])('a read failure is unknown even when the body says %s', (enabled) => {
    const cause = new Error('supabase_timeout');
    try {
      assertDiamondTournamentSettingsOpen(
        TABLE,
        ARENA,
        { club_id: ARENA, tournaments_enabled: enabled },
        cause
      );
      throw new Error('missing failure');
    } catch (error) {
      expect(error).toMatchObject({
        message: 'Diamond tournament settings read failed: supabase_timeout',
        cause,
      });
    }
  });
});

/**
 * DIAMOND ARENA IS CLOSED ON PURPOSE (owner, 2026-10-31). A closed tournament
 * switch is a typed decision the engine skips quietly: no admission retry
 * loop, no Tournament.table_admission_failing page, one info line per table.
 */
describe('a closed Diamond tournament arena is skipped quietly', () => {
  it('refuses with a typed closure that names the table and the arena', () => {
    try {
      assertDiamondTournamentSettingsOpen(
        TABLE,
        ARENA,
        { club_id: ARENA, tournaments_enabled: false },
        null
      );
      throw new Error('missing refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(DiamondTournamentPolicyClosedError);
      expect(error).toMatchObject({
        code: 'diamond_tournaments_disabled',
        tableId: TABLE,
        arenaId: ARENA,
      });
    }
  });

  it('a malformed or unreadable switch is never mistaken for the closure', () => {
    for (const [data, err] of [
      [{ club_id: ARENA, tournaments_enabled: null }, null],
      [{ club_id: ARENA, tournaments_enabled: false }, new Error('supabase_timeout')],
    ] as const) {
      try {
        assertDiamondTournamentSettingsOpen(TABLE, ARENA, data, err);
      } catch (error) {
        expect(error).not.toBeInstanceOf(DiamondTournamentPolicyClosedError);
      }
    }
  });

  it('logs once per table, at info, however often the table is asked', () => {
    forgetDiamondTournamentTablesSkipped();
    const lines: string[] = [];
    expect(noteDiamondTournamentTableSkipped('t1', 'tour', (l) => lines.push(l))).toBe(true);
    expect(noteDiamondTournamentTableSkipped('t1', 'tour', (l) => lines.push(l))).toBe(false);
    expect(noteDiamondTournamentTableSkipped('t2', null, (l) => lines.push(l))).toBe(true);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('tournaments_enabled=false');
  });

  it('the manager retires the table without a report, a refusal record or a retry', () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../tournament/TournamentManagerBase.ts'),
      'utf8'
    );
    const at = src.indexOf('if (tableId && engine.getStartupTournamentPolicyRefusal?.()) {');
    expect(at).toBeGreaterThan(-1);
    const branch = src.slice(at, src.indexOf('reportError(error, errorContext, metadata);', at));
    expect(branch).toContain('noteDiamondTournamentTableSkipped(tableId, this.tournamentId);');
    expect(branch).toContain('await this.retireClosedDiamondTournamentTable(tableId, engine);');
    expect(branch).not.toMatch(/scheduleManagedTableEngineRecovery|recoverManagedTableEngine|noteTableAdmissionRefusal/);
    const retire = src.slice(
      src.indexOf('private async retireClosedDiamondTournamentTable('),
      src.indexOf('private holdManagedTableUntilBookedStart(')
    );
    expect(retire).toContain('this.clearManagedTableEngineRecovery(tableId);');
    expect(retire).not.toMatch(/scheduleManagedTableEngineRecovery|pageTableAdmissionFailingIfDue/);
  });
});
