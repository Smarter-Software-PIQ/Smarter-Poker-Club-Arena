/**
 * A STALE WELCOME FIXTURE WITH RECYCLED BOARDS RETIRES WITH ITS HISTORY
 * (2026-11-07). Club Create Certification run 42409273134 ended "11 of 11
 * stale account(s) unrecovered" on WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED:
 * three fixtures whose boards the 3 AM close had cancelled and re-made for six
 * nights. The deleting door can never retire them; the sweep now asks
 * fn_ca_retire_stale_welcome_fixture_with_history, and only for that refusal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STALE_WELCOME_HISTORY_DOOR,
  retireCertificationClubWithRetry,
  retiresThroughHistoryDoor,
} from '../../scripts/ci/production-e2e-account.mjs';

const configuration = {
  supabaseUrl: 'https://certification.supabase.invalid',
  serviceRoleKey: 'sb_secret_certification',
};
const clubId = '96bd011b-ab21-4a68-986e-77831a1d49cd';
const reason = 'stale-cert-recovery';
const boardLineage = () =>
  Object.assign(new Error('WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED'), { code: '55000' });
const retained = {
  success: true,
  club_id: clubId,
  disposition: 'retained_terminal_fixture_owner',
  tables_closed: 6,
  cancelled_generations_kept: 59,
};

describe('the stale welcome fixture history door', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is asked only for the board lineage refusal, by code and exact message', () => {
    expect(STALE_WELCOME_HISTORY_DOOR).toBe('fn_ca_retire_stale_welcome_fixture_with_history');
    expect(retiresThroughHistoryDoor(boardLineage(), null, clubId)).toBe(true);
    // REST carries the guard's text in the body.
    expect(
      retiresThroughHistoryDoor(
        Object.assign(new Error('Supabase service request ... (500)'), {
          code: '55000',
          body: { message: 'WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED' },
        }),
        null,
        clubId
      )
    ).toBe(true);
    for (const other of [
      Object.assign(new Error('WELCOME_CERTIFICATION_TOURNAMENT_LINEAGE_REFUSED'), {
        code: '55000',
      }),
      Object.assign(new Error('WELCOME_CERTIFICATION_FIXTURE_HAS_ACTIVITY'), { code: '55000' }),
      Object.assign(new Error('WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED'), { code: '23514' }),
      new Error('WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED'),
    ]) {
      expect(retiresThroughHistoryDoor(other, null, clubId)).toBe(false);
    }
  });

  it("leaves the run's own template on its terminal route", () => {
    const account = { templateFixtureRequest: { clubId, requestId: 'r-1' } };
    expect(retiresThroughHistoryDoor(boardLineage(), account, clubId)).toBe(false);
    expect(retiresThroughHistoryDoor(boardLineage(), account, 'another-club')).toBe(true);
  });

  it('retries a direct PostgreSQL board lineage refusal once through the history door and returns its receipt', async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('fn_ca_retire_welcome_certification_club')) throw boardLineage();
      if (sql.includes(STALE_WELCOME_HISTORY_DOOR)) return { rows: [{ result: retained }] };
      return { rows: [] };
    });
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      query,
      end: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      retireCertificationClubWithRetry({
        account: { id: 'stale-owner' },
        configuration,
        clubId,
        reason,
        environment: { DATABASE_URL: 'postgresql://certification.invalid/club_arena' },
        databaseClientFactory: vi.fn().mockResolvedValue(client),
        fetchImpl: vi.fn(),
        wait: vi.fn(),
      })
    ).resolves.toEqual(retained);
    const door = statements.findIndex((sql) => sql.includes(STALE_WELCOME_HISTORY_DOOR));
    expect(door).toBeGreaterThan(-1);
    expect(statements.filter((sql) => sql.includes(STALE_WELCOME_HISTORY_DOOR))).toHaveLength(1);
    // Its own transaction, as service_role, and without the retained-child maintenance gate.
    const begin = statements.lastIndexOf('BEGIN', door);
    const own = statements.slice(begin, door);
    expect(own).toContain("SET LOCAL request.jwt.claim.role = 'service_role'");
    expect(own).not.toContain("SET LOCAL app.club_retirement_maintenance = 'on'");
    expect(statements[door + 1]).toBe('COMMIT');
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('asks the history door over REST when no database credential is configured', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/rest/v1/rpc/fn_ca_retire_welcome_certification_club')) {
        return Response.json(
          { code: '55000', message: 'WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED' },
          { status: 500 }
        );
      }
      if (url.endsWith(`/rest/v1/rpc/${STALE_WELCOME_HISTORY_DOOR}`))
        return Response.json(retained);
      return new Response('unexpected request', { status: 500 });
    });
    await expect(
      retireCertificationClubWithRetry({
        account: { id: 'stale-owner' },
        configuration,
        clubId,
        reason,
        environment: {},
        fetchImpl,
        wait: vi.fn(),
      })
    ).resolves.toEqual(retained);
    expect(calls.filter((url) => url.endsWith(`/rpc/${STALE_WELCOME_HISTORY_DOOR}`))).toHaveLength(
      1
    );
  });

  it('keeps a history-door refusal as the answer (a fixture that ever had play stays refused)', async () => {
    const hasPlay = Object.assign(new Error('STALE_WELCOME_FIXTURE_HAS_PLAY'), { code: '55000' });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('fn_ca_retire_welcome_certification_club')) throw boardLineage();
      if (sql.includes(STALE_WELCOME_HISTORY_DOOR)) throw hasPlay;
      return { rows: [] };
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      retireCertificationClubWithRetry({
        account: { id: 'stale-owner' },
        configuration,
        clubId,
        reason,
        environment: { DATABASE_URL: 'postgresql://certification.invalid/club_arena' },
        databaseClientFactory: vi.fn().mockResolvedValue({
          connect: vi.fn().mockResolvedValue(undefined),
          query,
          end: vi.fn().mockResolvedValue(undefined),
        }),
        fetchImpl: vi.fn(async () => Response.json([])),
        wait: vi.fn(),
      })
    ).rejects.toBe(hasPlay);
  });
});
