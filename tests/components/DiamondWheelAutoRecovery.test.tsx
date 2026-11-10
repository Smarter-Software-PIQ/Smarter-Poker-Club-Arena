vi.mock('../../src/hooks/useLiveBonusGuard', () => ({ useLiveBonusGuard: () => () => {} }));
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import receipts from '../fixtures/diamond-wheel-v2-receipts.json';
import {
  readWheelPending,
  saveWheelPending,
  type WheelPendingSpin,
} from '../../src/utils/wheelPendingSpin';
const backend = vi.hoisted(() => ({
  state: vi.fn(),
  commit: vi.fn(),
  spin: vi.fn(),
  runBegin: vi.fn(),
  runEnd: vi.fn(),
  navigate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  refresh: vi.fn(),
}));
vi.mock('../../src/services/DiamondWheelService', async (importOriginal) => ({
  // The page reads the service's named exports (the unverified-receipt error).
  ...(await importOriginal<typeof import('../../src/services/DiamondWheelService')>()),
  default: {
    getStateV2: backend.state,
    commit: backend.commit,
    spinV2: backend.spin,
    runBegin: backend.runBegin,
    runEnd: backend.runEnd,
    welcomeState: async () => ({ available: false, enabled: false }),
    dailyBonusState: async () => ({ available: false, ticket_count: 0 }),
    history: async () => [],
  },
}));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: { id: 'player' } }) }));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => backend.toast }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ clubId: 'club' }),
  useNavigate: () => backend.navigate,
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('../../src/utils/clubIdResolver', () => ({
  resolveClubUUID: async () => 'd1000000-0000-4000-8000-000000000003',
}));
vi.mock('../../src/hooks/useGameFloor', () => ({
  useGameFloor: () => ({ floor: null, refresh: backend.refresh }),
}));
vi.mock('../../src/components/games/FloorFeed', () => ({ default: () => null }));
vi.mock('../../src/components/games/DiamondSpinsTabs', () => ({ default: () => null }));
vi.mock('../../src/components/wheel/DiamondWheel', () => ({
  default: ({ onLanded, spinning, upgraded }: any) => (
    <button disabled={!spinning} onClick={onLanded}>
      {upgraded ? 'Land Upgrade Wheel' : 'Land Wheel'}
    </button>
  ),
}));
vi.mock('../../src/services/SoundService', () => ({
  soundService: { playWin: vi.fn(), playBigWin: vi.fn() },
}));
vi.mock('../../src/services/HapticService', () => ({ triggerHaptic: vi.fn() }));
import DiamondWheelPage from '../../src/pages/DiamondWheelPage';
import {
  WheelBatchService,
  type PaidWheelBatch,
  type PendingWheelBatch,
} from '../../src/services/WheelBatchService';
const sample = receipts.find((r) => r.kind === 'wheel' && r.value.outcome?.kind === 'chips')!.value;
const bonusSample = receipts.find(
  (r) =>
    r.kind === 'wheel' &&
    r.value.outcome?.kind === 'bonus' &&
    !r.value.welcome &&
    !r.value.daily_bonus
)!.value;
const RUN_ID = 'd1000000-0000-4000-8000-00000000run1'.replace('run1', '0a01');
const state = {
  ok: true,
  contract_version: 2,
  available: true,
  frozen: false,
  segments: sample.segments,
  pending_awards: [],
  auto_run: null,
  config: { spin_price_diamonds: 100, max_spins_per_player_per_day: 200 },
  player: {
    diamonds: 10000,
    spendable: 10000,
    is_member: true,
    spins_today: 0,
    seconds_until_next: 0,
  },
};
let ticket = 0;
const nextTicket = () => ({
  ok: true,
  commit_id: `d1000000-0000-4000-8000-${String(++ticket).padStart(12, '0')}`,
  server_seed_hash: 'a'.repeat(64),
});
/** The fixture receipt, sealed to this attempt's ticket and stake. */
const receiptFrom = (base: any, attempt: any) => {
  const fairness = {
    ...base.fairness,
    commit_id: attempt.commitId,
    server_seed_hash: attempt.commitHash,
    client_seed: attempt.clientSeed,
  };
  return {
    ...base,
    spin_id: `d1000000-0000-4000-8000-${String(1000 + ++spinSerial).padStart(12, '0')}`,
    entry_value_diamonds: attempt.entryDiamonds,
    player_cost_diamonds: attempt.entryDiamonds,
    fairness,
    ...(base.secondary
      ? {
          secondary: {
            ...base.secondary,
            fairness: {
              ...base.secondary.fairness,
              commit_id: attempt.commitId,
              server_seed_hash: attempt.commitHash,
              client_seed: attempt.clientSeed,
            },
          },
        }
      : {}),
    ...(base.bonus
      ? {
          bonus: {
            ...base.bonus,
            id: `d1000000-0000-4000-8000-${String(2000 + spinSerial).padStart(12, '0')}`,
            entry_diamonds: attempt.entryDiamonds,
            base_diamonds: attempt.entryDiamonds * base.bonus.boost_multiplier,
          },
        }
      : {}),
  };
};
let spinSerial = 0;
const receipt = (attempt: any) => receiptFrom(sample, attempt);
beforeEach(() => {
  ticket = 0;
  spinSerial = 0;
  backend.state.mockResolvedValue(state);
  backend.commit.mockImplementation(async () => nextTicket());
  backend.spin.mockImplementation(async (attempt) => receipt(attempt));
  backend.runBegin.mockImplementation(async (_club: string, spins: number) => ({
    ok: true,
    run_id: RUN_ID,
    spins,
    spins_done: 0,
  }));
  backend.runEnd.mockImplementation(async (run_id: string) => ({
    ok: true,
    run_id,
    spins_done: 0,
    pending_awards: [],
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
const ready = async () => {
  render(<DiamondWheelPage />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Spin 100', exact: true })).toBeEnabled()
  );
};
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
/** Every clock is fake from the first render: no countdown or retry is left
 * running on a real timer, and each wait below is measured, never slept. */
const readyOnFakeTimers = async () => {
  vi.useFakeTimers();
  render(<DiamondWheelPage />);
  await tick(0);
  expect(screen.getByRole('button', { name: 'Spin 100', exact: true })).toBeEnabled();
};
const saved = (): WheelPendingSpin => ({
  userId: 'player',
  clubId: sample.club_id!,
  mode: 'paid',
  commitId: 'd1000000-0000-4000-8000-00000000abcd',
  commitHash: 'b'.repeat(64),
  clientSeed: 'the-saved-seed',
  ticketId: null,
  contractVersion: 2,
  entryDiamonds: 100,
});
const land = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Land Wheel' }));
  });
};
/** A spin the player pressed lands on its reveal; its plate opens when the
 *  pop-open animation has played, which jsdom only ever reports on request. */
const landPressed = async () => {
  await land();
  await act(async () =>
    fireEvent.animationEnd(screen.getByRole('dialog').querySelector('[data-motion="keep"]')!)
  );
};
describe('single spins and player-owned recovery', () => {
  it('requires an explicit press for each debit, including after a delayed next ticket', async () => {
    await readyOnFakeTimers();
    let finish!: (v: unknown) => void;
    backend.commit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const spin = screen.getByRole('button', { name: 'Spin 100', exact: true });
    fireEvent.click(spin);
    fireEvent.click(spin);
    await tick(0);
    await landPressed();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await tick(5000);
    expect(backend.spin).toHaveBeenCalledTimes(1);
    await act(async () => finish(nextTicket()));
    await tick(120000);
    expect(backend.spin).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Spin 100', exact: true }));
    await tick(0);
    expect(backend.spin).toHaveBeenCalledTimes(2);
    expect(backend.spin.mock.calls[1][0].commitId).not.toBe(backend.spin.mock.calls[0][0].commitId);
    expect(backend.runBegin).not.toHaveBeenCalled();
  });
  it('omits the retired refresh action and reads current readiness on return without placing a spin', async () => {
    backend.state.mockResolvedValueOnce({
      ...state,
      available: false,
      reason: 'The Wheel Is Paused',
    });
    render(<DiamondWheelPage />);
    await screen.findByRole('button', { name: 'Prizes & More' });
    expect(screen.queryByRole('button', { name: 'Refresh Wheel' })).not.toBeInTheDocument();
    cleanup();
    render(<DiamondWheelPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Spin 100', exact: true })).toBeEnabled()
    );
    expect(backend.spin).not.toHaveBeenCalled();
    expect(backend.commit).toHaveBeenCalledTimes(1);
  });
  it('reopens at a smaller funded amount when the entry page had no ticket', async () => {
    backend.state.mockResolvedValueOnce({
      ...state,
      available: false,
      reason: 'The Host Must Fund Every Prize Before A Spin',
    });
    render(<DiamondWheelPage />);
    fireEvent.click(await screen.findByRole('button', { name: '25', exact: true }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Spin 25', exact: true })).toBeEnabled()
    );
    expect(backend.spin).not.toHaveBeenCalled();
    expect(backend.commit).toHaveBeenCalledTimes(1);
  });
  it('keeps a real maintenance pause and rereads thaw on return without placing a spin', async () => {
    backend.state.mockResolvedValue({ ...state, frozen: true });
    render(<DiamondWheelPage />);
    await screen.findByRole('button', { name: 'Prizes & More' });
    expect(screen.getByRole('button', { name: 'Spin 100', exact: true })).toBeDisabled();
    expect(screen.getByText('The Platform Is In Its Maintenance Break')).toBeInTheDocument();
    backend.state.mockResolvedValue(state);
    cleanup();
    render(<DiamondWheelPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Spin 100', exact: true })).toBeEnabled()
    );
    expect(backend.spin).not.toHaveBeenCalled();
  });
  it('an unknown spin is recovered by the page itself, with the original identity', async () => {
    // Review finding 9 (2026-09-21): this ran the 1s and 2s backoff on real
    // timers inside a 4s waitFor, under vitest's 5s test timeout. It now runs
    // on the fake clock from the first render and steps the schedule exactly.
    await readyOnFakeTimers();
    // Two dropped answers in a row: the page keeps resending the SAME saved
    // request (never a fresh wager) until the receipt lands. Nobody presses
    // anything - owner ruling 2026-09-21, no game may require a check.
    backend.spin
      .mockRejectedValueOnce(new Error('Connection Lost'))
      .mockRejectedValueOnce(new Error('Connection Lost Again'));
    fireEvent.click(screen.getByRole('button', { name: 'Spin 100', exact: true }));
    await tick(0);
    expect(backend.spin).toHaveBeenCalledTimes(1);
    expect(backend.toast.error).toHaveBeenCalledTimes(1);
    expect(readWheelPending('player', sample.club_id!)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover Spin' })).not.toBeInTheDocument();
    // Its answer was lost, so the saved spin now predates the next send.
    expect(screen.getByRole('button', { name: 'Recovering Spin' })).toBeInTheDocument();
    expect(screen.getByText('Recovering Your Previous Spin.')).toBeInTheDocument();
    // useAutoSettle's schedule: one second after the first loss...
    await tick(999);
    expect(backend.spin).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(backend.spin).toHaveBeenCalledTimes(2);
    // ...and two after the second.
    await tick(1999);
    expect(backend.spin).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(backend.spin).toHaveBeenCalledTimes(3);
    expect(backend.spin.mock.calls[1][0]).toEqual(backend.spin.mock.calls[0][0]);
    expect(backend.spin.mock.calls[2][0]).toEqual(backend.spin.mock.calls[0][0]);
    // One ticket for the whole episode: the saved spin never took a new one.
    expect(backend.commit).toHaveBeenCalledTimes(1);
    // The third answer is the receipt, so the wheel is spinning it.
    expect(screen.getByRole('button', { name: 'Land Wheel' })).toBeEnabled();
    // The loss was said once, not once per resend.
    expect(backend.toast.error).toHaveBeenCalledTimes(1);
  });
});

describe('the wheel says recovering only when it is one', () => {
  it('an ordinary spin in flight reads Spinning, never Recovering', async () => {
    await readyOnFakeTimers();
    let answer!: () => void;
    backend.spin.mockImplementationOnce(
      (attempt) =>
        new Promise((resolve) => {
          answer = () => resolve(receipt(attempt));
        })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Spin 100', exact: true }));
    await tick(0);
    expect(backend.spin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Spinning', exact: true })).toBeInTheDocument();
    expect(screen.queryAllByText(/Recover/)).toHaveLength(0);
    // A slow answer is not a lost one: nothing is resent while it is out.
    await tick(30_000);
    expect(backend.spin).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText(/Recover/)).toHaveLength(0);
    await act(async () => answer());
    expect(screen.getByRole('button', { name: 'Land Wheel' })).toBeEnabled();
    expect(screen.queryAllByText(/Recover/)).toHaveLength(0);
    await landPressed();
    // A pressed spin's chips prize waits for Continue; then the spin is done.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await tick(0);
    expect(screen.queryAllByText(/Recover/)).toHaveLength(0);
    expect(readWheelPending('player', sample.club_id!)).toBeNull();
  });

  it('a saved spin found when the wheel opens says it is being recovered', async () => {
    saveWheelPending(saved());
    backend.spin.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    render(<DiamondWheelPage />);
    // The wheel opens, then the saved spin goes at once, on the first turn.
    await tick(0);
    await tick(0);
    // Sent again at once, with its own sealed identity, and named for what it is.
    expect(backend.spin).toHaveBeenCalledTimes(1);
    expect(backend.spin.mock.calls[0][0]).toMatchObject({
      commitId: saved().commitId,
      clientSeed: 'the-saved-seed',
      entryDiamonds: 100,
    });
    expect(backend.commit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Recovering Spin' })).toBeInTheDocument();
    expect(screen.getByText('Recovering Your Previous Spin.')).toBeInTheDocument();
  });
});

describe('a failed read never leaves a spinner', () => {
  it('a spin amount whose quote fails is read again by the page itself', async () => {
    await readyOnFakeTimers();
    backend.state.mockRejectedValueOnce(new Error('Quote Lost'));
    fireEvent.click(screen.getByRole('button', { name: '500', exact: true }));
    await tick(0);
    // Review finding 5: this used to set a page error nothing retried. The
    // wheel stays on screen, keeps the chosen amount and says what it is doing.
    expect(screen.getByText('Preparing Your Next Spin')).toBeInTheDocument();
    expect(screen.queryByText('The Spin Amount Could Not Be Loaded')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spin 500', exact: true })).toBeDisabled();
    await tick(1000);
    expect(backend.state).toHaveBeenLastCalledWith('d1000000-0000-4000-8000-000000000003', 500);
    expect(screen.queryByText('Preparing Your Next Spin')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spin 500', exact: true })).toBeEnabled();
    expect(backend.spin).not.toHaveBeenCalled();
  });

  it('keeps reading until the quote comes back, on the same schedule', async () => {
    await readyOnFakeTimers();
    backend.state
      .mockRejectedValueOnce(new Error('Quote Lost'))
      .mockRejectedValueOnce(new Error('Quote Lost Again'));
    fireEvent.click(screen.getByRole('button', { name: '1,000', exact: true }));
    await tick(0);
    await tick(1000);
    expect(screen.getByText('Preparing Your Next Spin')).toBeInTheDocument();
    await tick(2000);
    expect(screen.getByRole('button', { name: 'Spin 1,000', exact: true })).toBeEnabled();
    expect(backend.spin).not.toHaveBeenCalled();
  });

  it('cannot resume an unfinished historical run into new debits', async () => {
    backend.state.mockResolvedValue({
      ...state,
      auto_run: { run_id: RUN_ID, spins: 10, spins_done: 4 },
    });
    vi.useFakeTimers();
    render(<DiamondWheelPage />);
    await tick(0);
    expect(screen.getByRole('button', { name: 'End Run' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Resume Run|Review Saved Run/i })).toBeNull();
    await tick(120000);
    expect(backend.spin).not.toHaveBeenCalled();
    expect(backend.runBegin).not.toHaveBeenCalled();
  });
  it('End Run closes the open run at the server and offers the games it left unplayed', async () => {
    const award = { ...bonusSample.bonus, id: 'd1000000-0000-4000-8000-000000009999' };
    backend.state.mockResolvedValue({
      ...state,
      auto_run: { run_id: RUN_ID, spins: 10, spins_done: 4 },
      pending_awards: [award],
    });
    backend.runEnd.mockResolvedValue({
      ok: true,
      run_id: RUN_ID,
      spins_done: 4,
      pending_awards: [award],
    });
    render(<DiamondWheelPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'End Run' }));
    await waitFor(() => expect(backend.runEnd).toHaveBeenCalledWith(RUN_ID));
    const summary = await screen.findByRole('dialog', { name: 'Run Complete' });
    expect(within(summary).getByText('1 Bonus Game To Play')).toBeInTheDocument();
    expect(backend.spin).not.toHaveBeenCalled();
    fireEvent.click(within(summary).getByRole('button', { name: 'Play Game' }));
    expect(backend.navigate).toHaveBeenCalledWith(`/clubs/club/plinko?wheelAward=${award.id}`);
  });
  it('a saved spin this build cannot read is discarded out loud instead of failing the page', async () => {
    localStorage.setItem(
      `diamond-wheel-pending:v1:player:${sample.club_id}`,
      '{"userId":"player"}'
    );
    await ready();
    expect(backend.toast.error).toHaveBeenCalledWith(
      'A Saved Spin Could Not Be Read. Your History Shows Every Spin.'
    );
    expect(localStorage.getItem(`diamond-wheel-pending:v1:player:${sample.club_id}`)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover Spin' })).toBeNull();
    expect(backend.spin).not.toHaveBeenCalled();
  });
  /* Owner ruling 2026-09-21, R8: no slide-in toast repeats a spin's result.
     The reveal and the control panel notice carry it; errors still toast. */
  it('a single spin shows its result in the reveal and the notice, with no slide-in toast', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Spin 100', exact: true }));
    await waitFor(() => expect(backend.spin).toHaveBeenCalledTimes(1));
    // The wheel turns once the receipt is in, not when the request leaves: a
    // click before that hits a disabled wheel and nothing reveals.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Land Wheel' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Land Wheel' }));
    const reveal = await screen.findByRole('dialog');
    fireEvent.animationEnd(reveal.querySelector('[data-motion="keep"]')!);
    fireEvent.click(within(reveal).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/^You Won \S+ Chips?$/)).toBeInTheDocument();
    expect(backend.toast.success).not.toHaveBeenCalled();
    expect(backend.toast.info).not.toHaveBeenCalled();
  });
});

function prepaidFixture(request: PendingWheelBatch, prizes = [bonusSample]): PaidWheelBatch {
  const receipts = Array.from({ length: request.spins }, (_, index) => ({
    ...receiptFrom(prizes[index] ?? sample, {
      commitId: `d1000000-0000-4000-8000-00000000030${index}`,
      commitHash: 'a'.repeat(64),
      clientSeed: `${request.seed}:${index + 1}`,
      entryDiamonds: request.entryDiamonds,
    }),
    contract_version: 4,
    auto_run: { run_id: RUN_ID, spins: request.spins, spins_done: index + 1 },
  }));
  return {
    request_id: request.requestId,
    run_id: RUN_ID,
    spins: request.spins,
    entry_diamonds: request.entryDiamonds,
    total_cost_diamonds: request.spins * request.entryDiamonds,
    client_seed: request.seed,
    receipts,
    tickets: receipts.map((r) => ({
      commit_id: r.fairness.commit_id,
      server_seed_hash: r.fairness.server_seed_hash,
    })),
  };
}
async function reviewHistoricalPaidRun(prizes = [bonusSample]) {
  const request: PendingWheelBatch = {
    userId: 'player',
    clubId: sample.club_id!,
    requestId: 'd1000000-0000-4000-8000-000000000abc',
    spins: 5,
    entryDiamonds: 100,
    seed: 'previously-committed',
    presented: 0,
  };
  const paid = prepaidFixture(request, prizes);
  const open = { run_id: paid.run_id, spins: paid.spins, spins_done: paid.spins };
  backend.state.mockResolvedValue({ ...state, contract_version: 4, auto_run: open });
  const read = vi.spyOn(WheelBatchService, 'read').mockResolvedValue(paid);
  vi.useFakeTimers();
  render(<DiamondWheelPage />);
  await tick(0);
  fireEvent.click(screen.getByRole('button', { name: 'Review Saved Run' }));
  await tick(0);
  await tick(0);
  expect(read).toHaveBeenCalledWith(RUN_ID, request.userId, request.clubId);
  return { read, paid };
}
describe('previously committed prepaid runs', () => {
  it('presents the remaining saved prizes after Not Now without placing a spin', async () => {
    await reviewHistoricalPaidRun();
    await land();
    const offer = screen.getByRole('dialog', { name: 'Bonus Game Won' });
    await tick(1200);
    expect(backend.spin).not.toHaveBeenCalled();
    fireEvent.click(within(offer).getByRole('button', { name: 'Not Now' }));
    await tick(1200);
    for (let index = 1; index < 5; index++) {
      await land();
      await tick(1200);
    }
    expect(backend.runBegin).not.toHaveBeenCalled();
    expect(backend.spin).not.toHaveBeenCalled();
    expect(backend.runEnd).toHaveBeenCalledWith(RUN_ID);
    expect(screen.getByRole('dialog', { name: 'Run Complete' })).toBeInTheDocument();
  });
  it('preserves queued games in order when several prepaid spins won a game', async () => {
    const { paid } = await reviewHistoricalPaidRun([bonusSample, sample, bonusSample]);
    const awards = [paid.receipts[0].bonus!, paid.receipts[2].bonus!];
    backend.runEnd.mockResolvedValue({
      ok: true,
      run_id: RUN_ID,
      spins_done: 5,
      pending_awards: awards,
    });
    for (const prize of paid.receipts) {
      await land();
      if (prize.bonus) {
        fireEvent.click(
          within(screen.getByRole('dialog', { name: 'Bonus Game Won' })).getByRole('button', {
            name: 'Not Now',
          })
        );
      }
      await tick(1200);
    }
    const summary = screen.getByRole('dialog', { name: 'Run Complete' });
    expect(
      within(summary).getByRole('list', { name: 'Bonus Games Won This Run' }).children
    ).toHaveLength(2);
    expect(
      within(summary).getByRole('list', { name: 'Prizes Won This Run' }).children
    ).toHaveLength(3);
    fireEvent.click(within(summary).getByRole('button', { name: 'Play Game' }));
    expect(backend.navigate).toHaveBeenCalledWith('/clubs/club/plinko?wheelAward=' + awards[0].id);
    expect(backend.spin).not.toHaveBeenCalled();
    expect(backend.runBegin).not.toHaveBeenCalled();
  });
  it('resumes the remaining receipt presentation after an explicitly chosen bonus game returns', async () => {
    const { read, paid } = await reviewHistoricalPaidRun();
    await land();
    backend.state.mockResolvedValue({
      ...state,
      contract_version: 4,
      auto_run: { run_id: RUN_ID, spins: 5, spins_done: 5 },
      pending_awards: [paid.receipts[0].bonus],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play Next Saved Game' }));
    await tick(0);
    expect(backend.navigate).toHaveBeenCalledTimes(1);
    cleanup();
    backend.state.mockResolvedValue({
      ...state,
      contract_version: 4,
      auto_run: { run_id: RUN_ID, spins: 5, spins_done: 5 },
      pending_awards: [],
    });
    render(<DiamondWheelPage />);
    await tick(0);
    await tick(1200);
    for (let index = 1; index < 5; index++) {
      await land();
      await tick(1200);
    }
    expect(read).toHaveBeenCalledWith(RUN_ID, 'player', sample.club_id!);
    expect(backend.runBegin).not.toHaveBeenCalled();
    expect(backend.spin).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Run Complete' })).toBeInTheDocument();
  });
});
