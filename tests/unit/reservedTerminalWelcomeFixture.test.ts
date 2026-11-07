import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi } from 'vitest';
import {
  retireTerminalWelcomeFixture,
  terminalWelcomeFixtureSQL,
  terminalStaffSQL,
  preparedTerminalStaffClubs,
} from '../../scripts/ci/reserved-terminal-welcome-fixture.mjs';
import {
  cleanupProductionE2EAccount,
  main,
  retireCertificationClubWithRetry,
} from '../../scripts/ci/production-e2e-account.mjs';
const id = '00000000-0000-4000-8000-000000000099';
const clubId = '00000000-0000-4000-8000-000000000098';
const account = {
  id,
  email: 'ca-customization-cert-postdeploy-terminal@example.invalid',
  templateFixtureRequest: { clubId, requestId: '00000000-0000-4000-8000-000000000097' },
};
function clientFor({
  safe = true,
  persisted = true,
  success = true,
  alreadyRetired = false,
  staffSafe = true,
  staffRemains = false,
  chipsReturned = 0 as number | null,
} = {}) {
  let retired = alreadyRetired;
  let staff = alreadyRetired ? [] : [...preparedTerminalStaffClubs];
  const query = vi.fn(async (sql: string, values?: any[]) => {
    if (sql === terminalStaffSQL)
      return { rows: [{ safe_staff_retirement: staffSafe, prepared_club_ids: [...staff] }] };
    if (sql.includes('fn_member_leave_to_treasury')) {
      staff = staff.filter((scope) => scope !== values?.[0]);
      return { rows: [{ result: { success: true, chips_returned: chipsReturned } }] };
    }
    if (sql.includes('fn_can_create_games')) return { rows: [{ can_create_games: false }] };
    if (sql.includes('fn_club_is_staff'))
      return { rows: [{ has_live_staff: staffRemains || staff.length > 0 }] };
    if (sql.startsWith('SELECT lifecycle_status'))
      return { rows: [{ lifecycle_status: retired ? 'retired' : 'active' }] };
    if (sql.includes('fn_ca_retire_welcome_certification_club'))
      throw Object.assign(new Error('WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED'), {
        code: '55000',
      });
    if (sql === terminalWelcomeFixtureSQL)
      return {
        rows: [
          {
            id: clubId,
            name: 'Crest Cert Terminal',
            owner_id: id,
            lifecycle_status: retired && persisted ? 'retired' : 'active',
            safe_terminal_template: safe,
          },
        ],
      };
    if (sql.includes('fn_retire_settled_club(')) {
      retired = true;
      return {
        rows: [
          {
            result: alreadyRetired
              ? { success, already_retired: true }
              : { success, records_retained: success },
          },
        ],
      };
    }
    return { rows: [] };
  });
  return { query, connect: vi.fn(), end: vi.fn() };
}
describe('reserved cancelled welcome fixture retirement', () => {
  it('runs the maintained retire-create-clubs CLI then re-proves retained state in cleanup', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'terminal-cli-'));
    const path = join(folder, 'account.json');
    writeFileSync(path, JSON.stringify(account));
    const client = clientFor();
    let reads = 0;
    const fetchImpl = vi.fn(async (input: string) => {
      if (/\/rpc\/fn_(club_is_staff|can_create_games)/.test(String(input)))
        return Response.json(false);
      if (String(input).includes('/rest/v1/club_members?'))
        return Response.json([{ club_id: clubId, user_id: id, role: 'owner', status: 'active' }]);
      if (String(input).includes('/rest/v1/clubs?'))
        return Response.json([
          {
            id: clubId,
            owner_id: id,
            name: 'Crest Cert Terminal',
            lifecycle_status: reads++ ? 'retired' : 'active',
          },
        ]);
      throw new Error(`Unexpected request ${input}`);
    });
    const options = {
      environment: {
        SUPABASE_URL: 'https://example.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
        DATABASE_URL: 'synthetic',
        E2E_TEST_ACCOUNT_FILE: path,
      },
      fetchImpl,
      databaseClientFactory: async () => client,
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(main('retire-create-clubs', options)).resolves.toBe(0);
      expect(
        log.mock.calls.some(
          ([line]) =>
            String(line).includes('"auth_deleted":false') &&
            String(line).includes('retained_terminal_fixture_owner')
        )
      ).toBe(true);
      const proofs = client.query.mock.calls.filter(
        ([sql]) => sql === terminalWelcomeFixtureSQL
      ).length;
      await expect(cleanupProductionE2EAccount(options)).resolves.toBe(true);
      expect(
        client.query.mock.calls.filter(([sql]) => sql === terminalWelcomeFixtureSQL)
      ).toHaveLength(proofs + 2);
      expect(
        client.query.mock.calls.filter(([sql]) =>
          sql.includes('fn_ca_retire_welcome_certification_club')
        )
      ).toHaveLength(1);
      expect(JSON.parse(readFileSync(`${path}.retained-terminal.json`, 'utf8'))).toMatchObject({
        auth_deleted: false,
        club_ids: [clubId],
      });
      expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/auth/'))).toBe(false);
    } finally {
      log.mockRestore();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('recovers an already retired exact fixture without repeating the destructive door', async () => {
    const client = clientFor({ alreadyRetired: true });
    await expect(
      retireCertificationClubWithRetry({
        account,
        clubId,
        reason: 'retry',
        environment: { DATABASE_URL: 'synthetic' },
        databaseClientFactory: async () => client,
        configuration: {},
      })
    ).resolves.toMatchObject({ disposition: 'retained_terminal_fixture_owner' });
    expect(
      client.query.mock.calls.some(([sql]) =>
        sql.includes('fn_ca_retire_welcome_certification_club')
      )
    ).toBe(false);
    expect(
      client.query.mock.calls.filter(([sql]) => sql.includes('fn_retire_settled_club('))
    ).toHaveLength(1);
  });
  it('refuses staff custody or retained live authority without accepting a retained owner', async () => {
    for (const options of [
      { staffSafe: false },
      { staffRemains: true },
      { chipsReturned: null },
      { chipsReturned: 1 },
    ]) {
      const client = clientFor(options);
      await expect(
        retireTerminalWelcomeFixture({ client, clubId, account, reason: 'test' })
      ).rejects.toThrow(/Custody|Live Staff|Departure/);
      expect(client.query.mock.calls.some(([sql]) => sql.includes('fn_retire_settled_club('))).toBe(
        false
      );
    }
  });
  it('preacquires hierarchy lanes before membership locks and leaves only three prepared grants', async () => {
    const client = clientFor();
    await retireTerminalWelcomeFixture({ client, clubId, account, reason: 'test' });
    const calls = client.query.mock.calls;
    const membership = calls.findIndex(
      ([sql]) => sql.includes('FROM public.club_members') && sql.includes('FOR UPDATE')
    );
    const hierarchy = calls
      .map(([sql], index) => (sql.includes('cashier-hierarchy:') ? index : -1))
      .filter((i) => i >= 0);
    expect(hierarchy).toHaveLength(4);
    expect(Math.max(...hierarchy)).toBeLessThan(membership);
    expect(
      calls
        .filter(([sql]) => sql.includes('fn_member_leave_to_treasury'))
        .map(([, args]) => args?.[0])
        .sort()
    ).toEqual([...preparedTerminalStaffClubs].sort());
    expect(
      calls
        .filter(([sql]) => sql.includes('ANY($1') && sql.includes('public.clubs'))
        .every(([sql]) => sql.includes('KEY SHARE'))
    ).toBe(true);
  });
  it('refuses absent durable own creation identity before SQL', async () => {
    const client = clientFor();
    await expect(
      retireTerminalWelcomeFixture({
        client,
        clubId,
        account: { ...account, templateFixtureRequest: {} },
        reason: 'test',
      })
    ).rejects.toThrow('Exact Owned');
    expect(client.query).not.toHaveBeenCalled();
  });
  it.each([false])('does not invoke retirement when terminal lineage is refused', async (safe) => {
    const client = clientFor({ safe });
    await expect(
      retireTerminalWelcomeFixture({ client, clubId, account, reason: 'test' })
    ).rejects.toThrow('Lineage Refused');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('fn_retire_settled_club('))).toBe(
      false
    );
  });
  it('requires successful canonical retirement and terminal readback', async () => {
    for (const options of [{ success: false }, { persisted: false }]) {
      await expect(
        retireTerminalWelcomeFixture({
          client: clientFor(options),
          clubId,
          account,
          reason: 'test',
        })
      ).rejects.toThrow('Refused');
    }
  });
  it('refuses fresh live-authority readback before writing a terminal cleanup receipt', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'terminal-authority-'));
    const path = join(folder, 'account.json');
    const client = clientFor();
    let reads = 0;
    const fetchImpl = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('/rpc/fn_club_is_staff')) return Response.json(true);
      if (url.includes('/rpc/fn_can_create_games')) return Response.json(false);
      if (url.includes('/rest/v1/club_members?'))
        return Response.json([{ club_id: clubId, user_id: id, role: 'owner', status: 'active' }]);
      if (url.includes('/rest/v1/clubs?'))
        return Response.json([
          {
            id: clubId,
            owner_id: id,
            name: 'Crest Cert Terminal',
            lifecycle_status: reads++ ? 'retired' : 'active',
          },
        ]);
      throw new Error(`Unexpected request ${url}`);
    });
    try {
      await expect(
        cleanupProductionE2EAccount({
          record: account,
          databaseClientFactory: async () => client,
          environment: {
            SUPABASE_URL: 'https://example.invalid',
            SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
            DATABASE_URL: 'synthetic',
            E2E_TEST_ACCOUNT_FILE: path,
          },
          fetchImpl,
        })
      ).rejects.toThrow('Live Authority Readback Refused');
      expect(existsSync(`${path}.retained-terminal.json`)).toBe(false);
      expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/auth/'))).toBe(false);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it('records retained owner explicitly through actual cleanup consumer, without Auth deletion', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'terminal-owner-'));
    const path = join(folder, 'account.json');
    const client = clientFor();
    let reads = 0;
    const fetchImpl = vi.fn(async (input: string) => {
      if (/\/rpc\/fn_(club_is_staff|can_create_games)/.test(String(input)))
        return Response.json(false);
      if (String(input).includes('/rest/v1/club_members?'))
        return Response.json([{ club_id: clubId, user_id: id, role: 'owner', status: 'active' }]);
      if (String(input).includes('/rest/v1/clubs?'))
        return Response.json([
          {
            id: clubId,
            owner_id: id,
            name: 'Crest Cert Terminal',
            lifecycle_status: reads++ ? 'retired' : 'active',
          },
        ]);
      throw new Error(`Unexpected request ${input}`);
    });
    try {
      await expect(
        cleanupProductionE2EAccount({
          record: account,
          databaseClientFactory: async () => client,
          environment: {
            SUPABASE_URL: 'https://example.invalid',
            SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
            DATABASE_URL: 'synthetic',
            E2E_TEST_ACCOUNT_FILE: path,
          },
          fetchImpl,
        })
      ).resolves.toBe(true);
      const receipt = JSON.parse(readFileSync(`${path}.retained-terminal.json`, 'utf8'));
      expect(receipt).toMatchObject({
        disposition: 'retained_terminal_fixture_owner',
        user_id: id,
        auth_deleted: false,
        club_ids: [clubId],
      });
      expect(client.query.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(1);
      expect(client.query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
      expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/auth/'))).toBe(false);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
