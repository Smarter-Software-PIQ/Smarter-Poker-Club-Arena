import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi } from 'vitest';
import {
  retireTerminalWelcomeFixture,
  terminalWelcomeFixtureSQL,
} from '../../scripts/ci/reserved-terminal-welcome-fixture.mjs';
import {
  cleanupProductionE2EAccount,
  retireCertificationClubWithRetry,
} from '../../scripts/ci/production-e2e-account.mjs';
const id = '00000000-0000-4000-8000-000000000099';
const clubId = '00000000-0000-4000-8000-000000000098';
const account = {
  id,
  email: 'ca-customization-cert-postdeploy-terminal@example.invalid',
  templateFixtureRequest: { clubId, requestId: '00000000-0000-4000-8000-000000000097' },
};
function clientFor({ safe = true, persisted = true, success = true, alreadyRetired = false } = {}) {
  let retired = alreadyRetired;
  const query = vi.fn(async (sql: string) => {
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
  it('records retained owner explicitly through actual cleanup consumer, without Auth deletion', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'terminal-owner-'));
    const path = join(folder, 'account.json');
    const client = clientFor();
    let reads = 0;
    const fetchImpl = vi.fn(async (input: string) => {
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
