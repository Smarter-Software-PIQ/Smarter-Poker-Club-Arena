import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), error: vi.fn(), resolve: vi.fn() }));
vi.mock('../../src/services/TournamentService', async (original) => {
  const actual = await original<typeof import('../../src/services/TournamentService')>();
  return {
    ...actual,
    tournamentService: {
      resumePendingTournamentCreation: vi.fn().mockResolvedValue(null),
      createTournament: mocks.create,
      buildRpcConfig: actual.tournamentService.buildRpcConfig.bind(actual.tournamentService),
    },
  };
});
vi.mock('../../src/utils/clubIdResolver', () => ({ resolveClubUUID: mocks.resolve }));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: mocks.error }),
}));
import CreateTournamentModal from '../../src/components/club/CreateTournamentModal';
import { supabase } from '../../src/lib/supabase';
const A = 'd6000000-0000-4000-8000-000000000001';
const B = 'd6000000-0000-4000-8000-000000000002';
const target = {
  id: 'd6000000-0000-4000-8000-000000000009',
  name: 'Current Main',
  status: 'REGISTERING',
  tournament_type: 'MTT',
  variant: 'freezeout',
  is_bounty: false,
  is_pko: false,
  is_mystery_bounty: false,
  is_premium_spin: false,
};
const view = (clubId = A) => (
  <CreateTournamentModal
    clubId={clubId}
    initialFormat="satellite"
    onClose={vi.fn()}
    onSuccess={vi.fn()}
  />
);
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function query(answer: Promise<any>, filterStatus = false) {
  let statuses: string[] = [];
  const q = {
    signal: undefined as AbortSignal | undefined,
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn((_column, values) => {
      statuses = values;
      return q;
    }),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    abortSignal: vi.fn((signal: AbortSignal) => {
      q.signal = signal;
      return q;
    }),
    then: (yes: any, no: any) =>
      answer
        .then((result) =>
          filterStatus
            ? { ...result, data: result.data.filter((row: any) => statuses.includes(row.status)) }
            : result
        )
        .then(yes, no),
  };
  return q;
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockImplementation(async (id) => id);
  mocks.create.mockResolvedValue({ id: 'created' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('satellite targets belong to a finite current-club read', () => {
  it('offers the maintained uppercase registering and announced statuses', async () => {
    const q = query(
      Promise.resolve({
        data: [target, { ...target, id: 'announced', name: 'Next Main', status: 'ANNOUNCED' }],
        error: null,
      }),
      true
    );
    vi.spyOn(supabase, 'from').mockReturnValue(q as never);
    render(view());
    await flush();
    expect(screen.getByRole('option', { name: 'Current Main' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Next Main' })).toBeTruthy();
  });
  it('submits a selected current-club target and excludes satellite and Spin targets', async () => {
    const rows = [
      target,
      { ...target, id: 'satellite', name: 'Satellite Feed', tournament_type: 'SATELLITE' },
      { ...target, id: 'spin', name: 'Spin Feed', tournament_type: 'SPIN' },
    ];
    vi.spyOn(supabase, 'from').mockReturnValue(
      query(Promise.resolve({ data: rows, error: null })) as never
    );
    const mounted = render(view());
    await flush();
    expect(screen.queryByRole('option', { name: 'Satellite Feed' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Spin Feed' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Awards Seats Into'), { target: { value: target.id } });
    fireEvent.change(screen.getByPlaceholderText('E.G. Saturday Night Turbo'), {
      target: { value: 'Current Club Satellite' },
    });
    fireEvent.submit(mounted.container.querySelector('form')!);
    await flush();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0][1].satelliteTarget.tournamentId).toBe(target.id);
  });
  it('retires the old club selection and refuses it while the new club read is pending', async () => {
    const pending = deferred();
    vi.spyOn(supabase, 'from')
      .mockReturnValueOnce(query(Promise.resolve({ data: [target], error: null })) as never)
      .mockReturnValue(query(pending.promise) as never);
    const mounted = render(view());
    await flush();
    fireEvent.change(screen.getByLabelText('Awards Seats Into'), { target: { value: target.id } });
    mounted.rerender(view(B));
    await flush();
    expect(screen.queryByRole('option', { name: 'Current Main' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('E.G. Saturday Night Turbo'), {
      target: { value: 'Current Club Satellite' },
    });
    fireEvent.submit(mounted.container.querySelector('form')!);
    await flush();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('expires and aborts an unanswered target query without inventing an empty club', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const q = query(pending.promise);
    vi.spyOn(supabase, 'from').mockReturnValue(q as never);
    render(view());
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12001);
    });
    expect(screen.getByText(/Target Tournaments Could Not Be Loaded/)).toBeTruthy();
    expect(q.signal?.aborted).toBe(true);
    pending.resolve({ data: [target], error: null });
    await flush();
    expect(screen.queryByRole('option', { name: 'Current Main' })).toBeNull();
  });
  it('expires an unanswered club resolver before issuing a target query', async () => {
    vi.useFakeTimers();
    mocks.resolve.mockReturnValue(new Promise(() => {}));
    const from = vi.spyOn(supabase, 'from');
    render(view());
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12001);
    });
    expect(screen.getByText(/Target Tournaments Could Not Be Loaded/)).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
  });
  it('aborts the retired query and ignores its late result', async () => {
    const pending = deferred();
    const old = query(pending.promise);
    vi.spyOn(supabase, 'from')
      .mockReturnValueOnce(old as never)
      .mockReturnValue(query(Promise.resolve({ data: [], error: null })) as never);
    const mounted = render(view());
    await flush();
    mounted.rerender(view(B));
    await flush();
    expect(old.signal?.aborted).toBe(true);
    pending.resolve({ data: [target], error: null });
    await flush();
    expect(screen.queryByRole('option', { name: 'Current Main' })).toBeNull();
  });
});
