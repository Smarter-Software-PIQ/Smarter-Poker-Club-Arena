import { expect, it, vi } from 'vitest';
import {
  GAME,
  HOUSE,
  reconcileProofWallet,
  recoveryClaimId,
  proofFetch,
} from '../scripts/ci/verify-plo-lightning-lifecycle.mjs';
const player = '11111111-1111-4111-8111-111111111111',
  cashier = '22222222-2222-4222-8222-222222222222',
  club = '33333333-3333-4333-8333-333333333333',
  session = '44444444-4444-4444-8444-444444444444';
const original = {
  accounts: { player, cashier },
  fundingClubId: club,
  cashSessionId: session,
  funding: { opId: 'fund' },
};
function fixture() {
  const state = {
    balance: 394,
    claimed: false,
    open: false,
    closed: true,
    exact: true,
    fundAmount: 400,
  };
  const report: any = {};
  const op = recoveryClaimId('42713823862', player);
  const claimReceipt = {
    id: 'claim',
    amount: 394,
    idempotency_key: `club_wallet_claim:${op}`,
    from_entity_id: player,
    to_entity_id: club,
  };
  const read = vi.fn(async (path: string) => {
    if (path.startsWith('cash_player_session?id='))
      return [
        {
          id: session,
          player_id: player,
          cluster_id: GAME,
          closed_at: state.closed ? '2026-11-09T22:43:54Z' : null,
          final_stack: 394,
          financial_capture_status: state.exact ? 'exact' : 'estimated',
        },
      ];
    if (path.startsWith('clubs?'))
      return [{ id: club, union_id: HOUSE, asset: 'chips', status: 'active' }];
    if (path.startsWith('union_clubs?')) return [{ club_id: club, union_id: HOUSE }];
    if (path.startsWith('chip_ledger?'))
      return path.includes('club_bank_send')
        ? [{ id: 'fund', amount: state.fundAmount, from_entity_id: club, to_entity_id: player }]
        : state.claimed
          ? [claimReceipt]
          : [];
    if (path.startsWith('club_members?'))
      return [
        {
          club_id: club,
          chip_balance: state.balance,
          promo_balance: 0,
          held_chips: 0,
          locked_chips: 0,
          credit_used: 0,
          credit_limit: 0,
        },
      ];
    return state.open ? [{ id: 'still-open' }] : [];
  });
  const sessionFor = vi.fn(async () => ({ userId: cashier, token: 'owned-cashier-session' }));
  const claim = vi.fn(async (_token: string, p: any) => {
    expect(p).toMatchObject({
      p_club_id: club,
      p_from_user_id: player,
      p_amount: 394,
      p_op_id: op,
    });
    expect(report.claimBack.pending).toBe(true);
    state.balance = 0;
    state.claimed = true;
    return { status: 200, body: { success: true } };
  });
  const dependencies = { read, sessionFor, claim, report, save: vi.fn() };
  return { state, dependencies };
}
it('resumes only the reconciled original wallet with one stable normal claim, then observes it without another transfer', async () => {
  const { state, dependencies: d } = fixture();
  await reconcileProofWallet(original, '42713823862', d);
  expect(state.balance).toBe(0);
  expect(d.claim).toHaveBeenCalledOnce();
  expect(d.report.claimBack.confirmed).toBe(true);
  await reconcileProofWallet(original, '42713823862', d);
  expect(d.claim).toHaveBeenCalledOnce();
  expect(d.sessionFor).toHaveBeenCalledOnce();
});
it.each(['closed', 'exact', 'open', 'fundAmount', 'balance'])(
  'refuses unresolved or mismatched original custody: %s',
  async (key) => {
    const { state, dependencies: d } = fixture();
    if (key === 'closed' || key === 'exact') state[key] = false;
    else if (key === 'open') state.open = true;
    else if (key === 'fundAmount') state.fundAmount = 399;
    else state.balance = 393;
    await expect(reconcileProofWallet(original, '42713823862', d)).rejects.toThrow();
    expect(d.claim).not.toHaveBeenCalled();
  }
);
it('retains the same operation key across an unknown response and observes its committed receipt before any replay', async () => {
  const { state, dependencies: d } = fixture();
  d.claim.mockImplementationOnce(async () => {
    state.balance = 0;
    state.claimed = true;
    throw new Error('response lost');
  });
  await expect(reconcileProofWallet(original, '42713823862', d)).rejects.toThrow('response lost');
  expect(d.report.claimBack.opId).toBe(recoveryClaimId('42713823862', player));
  await reconcileProofWallet(original, '42713823862', d);
  expect(d.claim).toHaveBeenCalledOnce();
  expect(d.report.claimBack.confirmed).toBe(true);
});
it('does not infer a returned wallet from zero alone when its original claim receipt is absent', async () => {
  const { state, dependencies: d } = fixture();
  state.balance = 0;
  await expect(reconcileProofWallet(original, '42713823862', d)).rejects.toThrow();
  expect(d.claim).not.toHaveBeenCalled();
});

it('normalizes only service calls from the maintained session client, preserving real user JWT requests', async () => {
  const serviceKey = 'sb_secret_current';
  const transport = vi.fn(async () => ({ status: 200 }));
  const send = proofFetch({ SUPABASE_SERVICE_ROLE_KEY: serviceKey }, transport);
  await send('https://fixture.invalid/auth/v1/admin/generate_link', {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
  });
  expect(transport.mock.calls[0][1].headers).toMatchObject({
    apikey: serviceKey,
    'x-smarter-data-actor': 'service',
  });
  expect(transport.mock.calls[0][1].headers.Authorization).toBeUndefined();
  const userHeaders = { apikey: 'publishable-fixture', Authorization: 'Bearer owned-user-jwt' };
  await send('https://fixture.invalid/rest/v1/rpc/fn_club_wallet_claim_back', {
    headers: userHeaders,
  });
  expect(transport.mock.calls[1][1].headers).toBe(userHeaders);
});
