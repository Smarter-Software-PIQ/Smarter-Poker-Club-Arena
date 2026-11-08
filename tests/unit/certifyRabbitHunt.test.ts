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
} from '../../scripts/ci/certify-rabbit-hunt.mjs';

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
