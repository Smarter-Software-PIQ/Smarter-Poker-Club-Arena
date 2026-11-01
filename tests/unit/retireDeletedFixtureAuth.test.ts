import { describe, expect, it } from 'vitest';
import {
  FIXTURES,
  retireDeletedFixtureAuth,
} from '../../scripts/ci/retire-deleted-fixture-auth.mjs';

const env = {
  SUPABASE_URL: 'https://kuklfnapbkmacvwxktbh.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-fixture',
};

type Row = { status: string; deleted: boolean; requests: { id: string; status: string }[] };

function fakeProduction(rows: Record<string, Row>) {
  const calls: { method: string; path: string; body?: string }[] = [];
  const json = (status: number, body: unknown) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      text: async () => JSON.stringify(body),
    }) as Response;
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const path = url.replace(env.SUPABASE_URL, '');
    const method = init.method || 'GET';
    calls.push({ method, path, body: init.body as string | undefined });
    const id = (path.match(/[0-9a-f-]{36}/) || [])[0] as string;
    if (path.startsWith('/rest/v1/profiles'))
      return json(200, rows[id] ? [{ id, status: rows[id].status }] : []);
    if (path.startsWith('/rest/v1/gdpr_deletion_requests'))
      return json(200, rows[id]?.requests ?? []);
    if (path === '/rest/v1/rpc/fn_mark_gdpr_completed') {
      const requestId = JSON.parse(String(init.body)).p_request_id;
      for (const row of Object.values(rows))
        for (const r of row.requests)
          if (r.id === requestId && r.status === 'anonymized') r.status = 'completed';
      return json(200, true);
    }
    if (path.startsWith('/auth/v1/admin/users/')) {
      if (!rows[id]) return json(404, {});
      if (method === 'DELETE') {
        expect(JSON.parse(String(init.body))).toEqual({ should_soft_delete: true });
        rows[id].deleted = true;
        return json(200, {});
      }
      return json(200, { id, deleted_at: rows[id].deleted ? '2026-11-01T06:00:00Z' : null });
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { calls, fetchImpl };
}

function erased(): Record<string, Row> {
  return Object.fromEntries(
    FIXTURES.map((id, i) => [
      id,
      {
        status: 'deleted',
        deleted: false,
        requests: [
          { id: `aaaaaaaa-0000-4000-8000-00000000000${i}`, status: 'anonymized' },
          { id: `bbbbbbbb-0000-4000-8000-00000000000${i}`, status: 'anonymized' },
        ],
      },
    ])
  );
}

describe('retire-deleted-fixture-auth', () => {
  it('acts on exactly the three named fixtures', () => {
    expect(FIXTURES).toEqual([
      'c81296d4-1b1f-4ec2-b9c4-fd795fbb63dd',
      '6fd4f8ef-5bd9-48b3-bfd8-0f32dd752dc4',
      '00000000-0000-0000-0000-000000000091',
    ]);
  });

  it('soft deletes each live Auth row and completes its erasure requests', async () => {
    const rows = erased();
    const { calls, fetchImpl } = fakeProduction(rows);
    const outcomes = await retireDeletedFixtureAuth({ env, fetchImpl, log: () => {} });
    expect(outcomes.map((o) => o.auth)).toEqual(['soft_deleted', 'soft_deleted', 'soft_deleted']);
    expect(outcomes.map((o) => o.requestsCompleted)).toEqual([2, 2, 2]);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(3);
    for (const row of Object.values(rows)) {
      expect(row.deleted).toBe(true);
      expect(row.requests.every((r) => r.status === 'completed')).toBe(true);
    }
    // Never a wallet, seat or chip path.
    expect(calls.some((c) => /wallet|seat|chip|ledger/.test(c.path))).toBe(false);
  });

  it('changes nothing on a second run', async () => {
    const rows = erased();
    const first = fakeProduction(rows);
    await retireDeletedFixtureAuth({ env, fetchImpl: first.fetchImpl, log: () => {} });
    const second = fakeProduction(rows);
    const outcomes = await retireDeletedFixtureAuth({
      env,
      fetchImpl: second.fetchImpl,
      log: () => {},
    });
    expect(outcomes.map((o) => o.requestsCompleted)).toEqual([0, 0, 0]);
    expect(second.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('refuses before any Auth write when the erasure is not proven', async () => {
    const rows = erased();
    rows[FIXTURES[0]].status = 'active';
    const { calls, fetchImpl } = fakeProduction(rows);
    await expect(retireDeletedFixtureAuth({ env, fetchImpl, log: () => {} })).rejects.toThrow(
      /refused/
    );
    expect(calls.some((c) => c.method !== 'GET')).toBe(false);

    const pending = erased();
    pending[FIXTURES[0]].requests[0].status = 'pending';
    const second = fakeProduction(pending);
    await expect(
      retireDeletedFixtureAuth({ env, fetchImpl: second.fetchImpl, log: () => {} })
    ).rejects.toThrow(/refused/);
    expect(second.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('refuses any project but the pinned production one', async () => {
    await expect(
      retireDeletedFixtureAuth({
        env: { ...env, SUPABASE_URL: 'https://example.supabase.co' },
        fetchImpl: async () => {
          throw new Error('no request may be sent');
        },
        log: () => {},
      })
    ).rejects.toThrow(/pinned production project/);
  });
});
