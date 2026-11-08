import { describe, it, expect } from 'vitest';
// @ts-expect-error untyped CI module
import {
  engineGate,
  verdict,
  fixtureBrowserId,
  RABBIT_HUNT_REQUIRED_COMMITS,
  PREVIEW_TO_CHARGE,
  sameCards,
  ownerRetainedAsRecord,
  settleRabbitHuntClub,
  settleStrandedRabbitHuntClub,
  RABBIT_HUNT_GAME_NAME,
  RABBIT_HUNT_CLUB_NAME_PREFIX,
  LEAVE_SETTLES_WITHIN_MS,
} from '../../scripts/ci/certify-rabbit-hunt.mjs';
import { readFileSync } from 'node:fs';
import { sliceCall } from '../helpers/sourceWindow';

const SHA = 'a'.repeat(40);
const carries = async () => true;

describe('the daily rabbit hunt certification gate', () => {
  it('requires both #9233 and #9314', () => {
    expect(RABBIT_HUNT_REQUIRED_COMMITS.map((c: { pr: number }) => c.pr)).toEqual([9233, 9314]);
  });

  it('runs only when the serving engine carries both commits and is idle', async () => {
    const g = await engineGate({
      health: { releaseSha: SHA, maintenance: { phase: 'idle' } },
      isAncestor: carries,
    });
    expect(g).toMatchObject({ carries: true, outcome: 'run', releaseSha: SHA });
  });

  it('an engine without the feature is UNKNOWN, names what it lacks and creates nothing', async () => {
    const g = await engineGate({
      health: { releaseSha: SHA },
      isAncestor: async (a: string) => !a.startsWith('518d46c5'),
    });
    expect(g.carries).toBe(false);
    expect(g.outcome).toBe('unknown');
    expect(g.reason).toMatch(/does not carry the feature yet .*#9314/);
    expect(g.reason).not.toMatch(/#9233/);
  });

  it('an unreadable ancestry or identity is UNKNOWN, never a pass', async () => {
    expect(
      (await engineGate({ health: { releaseSha: SHA }, isAncestor: async () => null })).outcome
    ).toBe('unknown');
    expect(
      (
        await engineGate({
          health: { releaseSha: SHA },
          isAncestor: async () => {
            throw new Error('x');
          },
        })
      ).outcome
    ).toBe('unknown');
    expect((await engineGate({ health: {}, isAncestor: carries })).outcome).toBe('unknown');
  });

  it('an engine whose health does not answer is UNKNOWN, not a crash', async () => {
    const g = await engineGate({ health: null, isAncestor: carries });
    expect(g).toMatchObject({ carries: false, outcome: 'unknown' });
    expect(g.reason).toMatch(/did not answer/);
  });

  it('an engine in maintenance is UNKNOWN until the thaw', async () => {
    const g = await engineGate({
      health: { releaseSha: SHA, maintenance: { phase: 'freezing' } },
      isAncestor: carries,
    });
    expect(g.outcome).toBe('unknown');
    expect(g.reason).toMatch(/maintenance/);
  });
});

describe('the verdict', () => {
  const gate = { carries: true, reason: 'ok', releaseSha: SHA };
  it('UNKNOWN when gated, whatever else happened', () => {
    expect(
      verdict({ gate: { carries: false, reason: 'lacks' }, steps: [], cleanup: [] }).conclusion
    ).toBe('unknown');
  });
  it('PASS only when every case passed and every cleanup step finished', () => {
    expect(
      verdict({ gate, steps: [{ name: 'a', ok: true }], cleanup: [{ step: 'c', ok: true }] })
        .conclusion
    ).toBe('pass');
  });
  it('FAIL on any failed case, an error, an incomplete cleanup or no case at all', () => {
    expect(verdict({ gate, steps: [{ name: 'a', ok: false }], cleanup: [] })).toMatchObject({
      conclusion: 'fail',
      reason: 'a',
    });
    expect(
      verdict({ gate, steps: [{ name: 'a', ok: true }], error: 'boom', cleanup: [] }).conclusion
    ).toBe('fail');
    expect(
      verdict({ gate, steps: [{ name: 'a', ok: true }], cleanup: [{ step: 'retire', ok: false }] })
        .reason
    ).toMatch(/cleanup: retire/);
    expect(verdict({ gate, steps: [], cleanup: [] }).reason).toMatch(/no case ran/);
  });
  it('FAIL on a cleanup step that never reported a result: residue is never a pass (2026-11-07, #9830)', () => {
    expect(
      verdict({
        gate,
        steps: [{ name: 'a', ok: true }],
        cleanup: [{ step: 'retire the vip account', ok: undefined }],
      })
    ).toMatchObject({ conclusion: 'fail', reason: 'cleanup: retire the vip account' });
    expect(
      verdict({
        gate,
        steps: [{ name: 'a', ok: true }],
        cleanup: [
          { step: 'retire the vip account', ok: true },
          {
            step: 'retire the owner account',
            ok: true,
            detail: 'kept as the owner of record of retired club x',
          },
        ],
      }).conclusion
    ).toBe('pass');
  });
});

describe('the owner of a retired Cert RH club is its owner of record (2026-11-07, #9830)', () => {
  const ownerId = '0f1f28e9-0000-4000-8000-000000000001';
  const clubId = '110fc34f-0000-4000-8000-000000000002';
  const refusal = new Error(
    'Guarded test-account sweep refused ' +
      ownerId +
      ': Supabase service request POST /rest/v1/rpc/cleanup_reserved_certification_account failed (500): {"code":"55000","message":"CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY"}'
  );
  const retired = { id: clubId, owner_id: ownerId, lifecycle_status: 'retired' };
  it('is exactly the custody refusal on an owned club that reads retired', () => {
    expect(ownerRetainedAsRecord({ error: refusal, club: retired, ownerId, clubId })).toBe(true);
  });
  it('is nothing else: another refusal, an active club, another owner, an unreadable club, no club', () => {
    expect(
      ownerRetainedAsRecord({
        error: new Error('canceling statement due to statement timeout'),
        club: retired,
        ownerId,
        clubId,
      })
    ).toBe(false);
    expect(
      ownerRetainedAsRecord({
        error: refusal,
        club: { ...retired, lifecycle_status: 'active' },
        ownerId,
        clubId,
      })
    ).toBe(false);
    expect(
      ownerRetainedAsRecord({
        error: refusal,
        club: { ...retired, owner_id: 'someone-else' },
        ownerId,
        clubId,
      })
    ).toBe(false);
    expect(ownerRetainedAsRecord({ error: refusal, club: undefined, ownerId, clubId })).toBe(false);
    expect(
      ownerRetainedAsRecord({ error: refusal, club: retired, ownerId, clubId: undefined })
    ).toBe(false);
  });
});

describe('device continuity', () => {
  it('matches the #9303 token derivation: stable per account and origin, a v4-shaped UUID', () => {
    const a = fixtureBrowserId('11111111-1111-4111-8111-111111111111');
    expect(a).toBe(fixtureBrowserId('11111111-1111-4111-8111-111111111111'));
    expect(a).not.toBe(fixtureBrowserId('22222222-2222-4222-8222-222222222222'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('certification compares what it sold and what it charged', () => {
  it('maps each preview answer to the engine charge source', () => {
    expect(PREVIEW_TO_CHARGE).toEqual({
      lifetime_vip: 'lifetime_vip',
      credit: 'purchased',
      vip_allowance: 'vip_monthly',
      diamonds: 'diamonds',
    });
  });

  it('compares kept and sold cards by rank, suit and order only', () => {
    const sold = [
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
    ];
    expect(
      sameCards(
        [
          { rank: 'A', suit: 'spades', extra: 1 },
          { rank: 'K', suit: 'hearts' },
        ],
        sold
      )
    ).toBe(true);
    expect(sameCards([sold[1], sold[0]], sold)).toBe(false);
    expect(sameCards([sold[0]], sold)).toBe(false);
    expect(sameCards([], [])).toBe(false);
    expect(sameCards(null, sold)).toBe(false);
  });
});

/* 2026-11-08: run 42411184920 certified every case and then died in cleanup,
   "refused while seated". The hit-and-run club setting (20261107040516) held
   the winning player's seat for hands a two-seat table could never deal, the
   run ignored the leave's answer, and the cleanup found a live seat. The club
   (8f508869) sat active with 99,684 chips and two funded members, and the
   stale sweep refused it as "only its own run's cleanup settles it". The
   cleanup is now one function, settleRabbitHuntClub, that the run and the
   stale sweep (through settleStrandedRabbitHuntClub) share; the run switches
   hit-and-run off for its club and waits for the seats to actually leave. */
describe('the rabbit-hunt club is settled by one cleanup the run and the stale sweep share (2026-11-08)', () => {
  const CLUB = '8f508869-0000-4000-8000-000000000001';
  const OWNER = '1eb1fe67-0000-4000-8000-000000000002';
  const VIP = '2bf8c974-0000-4000-8000-000000000003';
  const PLAIN = '0dce3416-0000-4000-8000-000000000004';
  const TABLE = '7de26617-0000-4000-8000-000000000005';
  const reservedEmail = (n: string) =>
    `ca-customization-cert-postdeploy-1794083358063-${n}@example.invalid`;

  function world(opts: { seated?: unknown[]; grants?: unknown[]; retire?: boolean } = {}) {
    const calls: string[] = [];
    let retired = false;
    const c = {
      svc: async (path: string) => {
        calls.push(`svc ${path.split('?')[0]}`);
        if (path.startsWith('table_seats?')) return opts.seated ?? [];
        if (path.startsWith('ca_certification_vip_grants?'))
          return opts.grants ?? [{ op_id: `rh-cert-vip-${VIP}`, user_id: VIP }];
        if (path.startsWith('club_members?'))
          return [
            { user_id: VIP, chip_balance: '8.05' },
            { user_id: PLAIN, chip_balance: '7.95' },
            { user_id: OWNER, chip_balance: '0.00' },
          ].filter((m) => !path.includes(`user_id=neq.${m.user_id}`));
        throw new Error(`unexpected read ${path}`);
      },
      svcRpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push(`svcRpc ${fn} ${args.p_user_id}`);
        return { ok: true };
      },
      sessionFor: async (email: string) => {
        calls.push(`session ${email}`);
        return { token: 'owner-token', userId: OWNER };
      },
      rpc: async (token: string, fn: string, args: Record<string, unknown>) => {
        expect(token).toBe('owner-token');
        calls.push(
          `rpc ${fn} ${args.p_from_user_id ?? args.p_game_id ?? args.p_scope_id ?? args.p_club_id}`
        );
        if (fn === 'fn_club_wallet_claim_back') return { status: 200, body: { success: true } };
        if (fn === 'fn_list_managed_games')
          return { status: 200, body: { items: [{ id: TABLE, contract: { version: 3 } }] } };
        if (fn === 'fn_execute_managed_game_command') {
          expect(args.p_expected_version).toBe(3);
          return { status: 200, body: { ok: true } };
        }
        if (fn === 'fn_retire_settled_club') {
          retired = opts.retire !== false;
          return {
            status: 200,
            body: retired ? { success: true } : { success: false, error: 'x' },
          };
        }
        throw new Error(`unexpected rpc ${fn}`);
      },
    };
    const notes: Array<{ name: string; ok: boolean }> = [];
    const note = (name: string, ok: boolean) => notes.push({ name, ok });
    return {
      c,
      calls,
      notes,
      note,
      get retired() {
        return retired;
      },
    };
  }

  it('ends the VIP, returns every balance to the bank, closes the run tables, retires the club, in that order, and touches no account', async () => {
    const w = world();
    const out = await settleRabbitHuntClub({
      c: w.c,
      clubId: CLUB,
      clubName: 'Cert RH 83360371',
      ownerEmail: reservedEmail('owner'),
      memberIds: [OWNER, VIP, PLAIN],
      tableIds: [TABLE],
      note: w.note,
      sleep: async () => undefined,
    });
    expect(out).toEqual({ settled: true, seated: [] });
    expect(w.calls).toEqual([
      'svc table_seats',
      'svc ca_certification_vip_grants',
      `svcRpc fn_ca_certification_vip_end ${VIP}`,
      `session ${reservedEmail('owner')}`,
      'svc club_members',
      `rpc fn_club_wallet_claim_back ${VIP}`,
      `rpc fn_club_wallet_claim_back ${PLAIN}`,
      `rpc fn_list_managed_games ${CLUB}`,
      `rpc fn_execute_managed_game_command ${TABLE}`,
      `rpc fn_retire_settled_club ${CLUB}`,
    ]);
    expect(w.notes.every((n) => n.ok)).toBe(true);
    expect(w.notes.map((n) => n.name)).toContain('retire the certification club');
    expect(w.calls.some((call) => call.includes('cleanup_reserved_certification_account'))).toBe(
      false
    );
  });

  it("a live seat refuses the whole settlement before any door: the seat is the engine's", async () => {
    const w = world({ seated: [{ table_id: TABLE }] });
    const out = await settleRabbitHuntClub({
      c: w.c,
      clubId: CLUB,
      clubName: 'Cert RH 83360371',
      ownerEmail: reservedEmail('owner'),
      memberIds: [OWNER, VIP, PLAIN],
      tableIds: [TABLE],
      note: w.note,
      sleep: async () => undefined,
    });
    expect(out).toEqual({ settled: false, seated: [{ table_id: TABLE }] });
    expect(w.calls).toEqual(['svc table_seats']);
    expect(w.notes).toEqual([{ name: 'refused while seated', ok: false }]);
  });

  it('a retire the door refuses is reported as not settled, never as done', async () => {
    const w = world({ retire: false, grants: [] });
    const out = await settleRabbitHuntClub({
      c: w.c,
      clubId: CLUB,
      clubName: 'Cert RH 83360371',
      ownerEmail: reservedEmail('owner'),
      memberIds: [OWNER, VIP, PLAIN],
      tableIds: [],
      note: w.note,
      sleep: async () => undefined,
    });
    expect(out.settled).toBe(false);
    expect(w.notes.at(-1)).toEqual({ name: 'retire the certification club', ok: false });
    expect(w.calls.some((call) => call.startsWith('rpc fn_list_managed_games'))).toBe(false);
  });

  describe('a stranded club is settled only from a record that proves what it is', () => {
    const env = {
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      VITE_SUPABASE_ANON_KEY: 'anon',
    };
    const isReserved = (email: string) => email.startsWith('ca-customization-cert-postdeploy-');
    function fetchFor(state: {
      club?: Record<string, unknown> | null;
      members?: Array<{ user_id: string; role: string }>;
      emails?: Record<string, string>;
    }) {
      const urls: string[] = [];
      const fetchImpl = async (input: string | URL, init?: RequestInit) => {
        const url = decodeURIComponent(String(input));
        urls.push(`${init?.method || 'GET'} ${url.replace(env.SUPABASE_URL, '')}`);
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          });
        if (url.includes('/rest/v1/clubs?')) return json(state.club === null ? [] : [state.club]);
        if (url.includes('/rest/v1/club_members?')) return json(state.members ?? []);
        const user = url.match(/\/auth\/v1\/admin\/users\/([^?]+)/);
        if (user) {
          const email = state.emails?.[user[1]];
          return email ? json({ id: user[1], email }) : json({}, 404);
        }
        return new Response(`unexpected ${url}`, { status: 500 });
      };
      return { fetchImpl, urls };
    }
    const club = {
      id: CLUB,
      name: 'Cert RH 83360371',
      owner_id: OWNER,
      lifecycle_status: 'active',
    };

    it('refuses a club that is not an active Cert RH club owned by the identity, reading nothing else', async () => {
      for (const bad of [
        null,
        { ...club, lifecycle_status: 'retired' },
        { ...club, owner_id: VIP },
        { ...club, name: 'Crest Cert Template 1234' },
      ]) {
        const f = fetchFor({ club: bad });
        await expect(
          settleStrandedRabbitHuntClub({
            environment: env,
            fetchImpl: f.fetchImpl as typeof fetch,
            clubId: CLUB,
            ownerId: OWNER,
            isReserved,
          })
        ).rejects.toThrow(
          `Refusing to settle club ${CLUB}: not an active rabbit-hunt certification club`
        );
        expect(f.urls).toHaveLength(1);
      }
    });

    it('refuses when any member is outside the reserved namespace: a person in the club ends it', async () => {
      const f = fetchFor({
        club,
        members: [
          { user_id: OWNER, role: 'owner' },
          { user_id: VIP, role: 'player' },
        ],
        emails: { [OWNER]: reservedEmail('owner'), [VIP]: 'dan@example.com' },
      });
      await expect(
        settleStrandedRabbitHuntClub({
          environment: env,
          fetchImpl: f.fetchImpl as typeof fetch,
          clubId: CLUB,
          ownerId: OWNER,
          isReserved,
        })
      ).rejects.toThrow(`member ${VIP} is not a reserved certification identity`);
      expect(f.urls.some((u) => u.includes('/rest/v1/tables?'))).toBe(false);
      expect(f.urls.some((u) => u.includes('/rpc/'))).toBe(false);
    });

    it('requires its credentials and the reserved predicate, by name', async () => {
      await expect(
        settleStrandedRabbitHuntClub({
          environment: { SUPABASE_URL: env.SUPABASE_URL },
          clubId: CLUB,
          ownerId: OWNER,
          isReserved,
        })
      ).rejects.toThrow('VITE_SUPABASE_ANON_KEY are required');
      await expect(
        settleStrandedRabbitHuntClub({ environment: env, clubId: CLUB, ownerId: OWNER })
      ).rejects.toThrow('requires the reserved-namespace predicate');
    });
  });

  it('the run switches hit-and-run off for its club as the owner, before anyone sits, and waits for the seats to leave', () => {
    const source = readFileSync('scripts/ci/certify-rabbit-hunt.mjs', 'utf8');
    const hitRun = source.indexOf("'fn_set_club_hit_run'");
    const sit = source.indexOf("'atomic_table_buyin'");
    expect(hitRun).toBeGreaterThan(0);
    expect(hitRun).toBeLessThan(sit);
    const call = sliceCall(source.slice(source.lastIndexOf('await rpc(', hitRun)), 'rpc(');
    expect(call).toContain("'fn_set_club_hit_run'");
    expect(call).toContain('p_enabled: false');
    expect(source).toContain('both certification players left their seats');
    expect(LEAVE_SETTLES_WITHIN_MS).toBeGreaterThanOrEqual(30_000);
    // The run's finally and the stale sweep share one settlement.
    expect(source.match(/settleRabbitHuntClub\(/g)?.length).toBe(3);
    expect(RABBIT_HUNT_GAME_NAME).toBe('Cert RH');
    expect(RABBIT_HUNT_CLUB_NAME_PREFIX).toBe('Cert RH ');
  });
});
