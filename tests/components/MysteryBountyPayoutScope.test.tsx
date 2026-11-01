import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MysteryBountyPanel from '../../src/components/tournament/MysteryBountyPanel';
import type { UseMysteryBountyResult } from '../../src/hooks/useMysteryBounty';

const transport = vi.hoisted(() => ({ responses: [] as Promise<any>[], reads: [] as any[] }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (relation: string) => {
      const read: any = { relation, filters: {} };
      transport.reads.push(read);
      const builder: any = {
        select: () => builder,
        eq: (key: string, value: string) => {
          read.filters[key] = value;
          return builder;
        },
        abortSignal: (signal: AbortSignal) => {
          read.signal = signal;
          return builder;
        },
        maybeSingle: () => transport.responses.shift()!,
      };
      return builder;
    },
  },
}));
vi.mock('../../src/hooks/usePlayerPreference', () => ({
  usePlayerPreference: () => [false, vi.fn()],
}));
vi.mock('../../src/hooks/useMysteryBountyProjection', () => ({
  useMysteryBountyProjection: () => null,
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
const data: UseMysteryBountyResult = {
  inventory: null,
  awards: [],
  awardsTotal: 0,
  isLoading: false,
  pendingReveals: 0,
  refresh: vi.fn(),
  leaderboard: [
    { userId: 'bob', username: 'Bob', bountiesWon: 1, earningsCents: 500000 },
    { userId: 'ann', username: 'Ann', bountiesWon: 1, earningsCents: 75000 },
  ],
};
const row = (prize: number, position = 1) => ({
  data: { prize, position, status: 'eliminated' },
  error: null,
});
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function panel(event = 'event-a', completed = true) {
  return (
    <MysteryBountyPanel
      tournamentId={event}
      isMysteryBounty
      data={data}
      isCompleted={completed}
      unitCents={1}
    />
  );
}
function select(name: string) {
  fireEvent.click(
    within(screen.getByText('Mystery Bounty Leaderboard').closest('section')!).getByRole('button', {
      name: new RegExp(name),
    })
  );
}
function figure(name: string) {
  return screen.getByText(name).parentElement!;
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}
beforeEach(() => {
  transport.responses = [];
  transport.reads = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('selected mystery bounty payout belongs to its exact read scope', () => {
  it('never paints one player prize or rank under another while the next read waits', async () => {
    transport.responses.push(Promise.resolve(row(100)), new Promise(() => {}));
    render(panel());
    select('Bob');
    await flush();
    expect(figure('Tournament Prize')).toHaveTextContent('100');
    select('Ann');
    await flush();
    expect(figure('Tournament Prize')).toHaveTextContent('Loading');
    expect(figure('Final Position')).toHaveTextContent('Loading');
    expect(figure('Total Payout')).toHaveTextContent('Loading');
    expect(transport.reads[1].filters).toEqual({ tournament_id: 'event-a', user_id: 'ann' });
  });
  it('invalidates the old event immediately and ignores its delayed response', async () => {
    const old = deferred();
    transport.responses.push(old.promise, Promise.resolve(row(200, 2)));
    const view = render(panel());
    select('Bob');
    await flush();
    view.rerender(panel('event-b'));
    await flush();
    expect(figure('Tournament Prize')).toHaveTextContent('200');
    await act(async () => {
      old.resolve(row(900));
    });
    expect(figure('Tournament Prize')).toHaveTextContent('200');
    expect(figure('Final Position')).toHaveTextContent('#2');
    expect(transport.reads[0].signal?.aborted).toBe(true);
  });
  it('does not retain a loaded old event while the next event read hangs', async () => {
    transport.responses.push(Promise.resolve(row(100)), new Promise(() => {}));
    const view = render(panel());
    select('Bob');
    await flush();
    view.rerender(panel('event-b'));
    await flush();
    expect(figure('Tournament Prize')).toHaveTextContent('Loading');
    expect(figure('Total Payout')).toHaveTextContent('Loading');
  });
  it('ends a hung read as unread, aborts transport and ignores a late success without retry', async () => {
    vi.useFakeTimers();
    const late = deferred();
    transport.responses.push(late.promise);
    render(panel());
    select('Bob');
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_001);
    });
    expect(figure('Tournament Prize')).toHaveTextContent('Could Not Be Read');
    expect(figure('Total Payout')).toHaveTextContent('Could Not Be Read');
    expect(transport.reads[0].signal?.aborted).toBe(true);
    await act(async () => {
      late.resolve(row(900));
    });
    expect(figure('Tournament Prize')).toHaveTextContent('Could Not Be Read');
    expect(transport.reads).toHaveLength(1);
  });
  it('keeps a missing row distinct from a failed read and an actual zero prize', async () => {
    transport.responses.push(
      Promise.resolve({ data: null, error: null }),
      Promise.resolve({ data: null, error: { message: 'Unavailable' } }),
      Promise.resolve(row(0))
    );
    render(panel());
    select('Bob');
    await flush();
    expect(figure('Tournament Prize')).toHaveTextContent('Not Available');
    expect(figure('Total Payout')).toHaveTextContent('Not Available');
    select('Ann');
    await flush();
    expect(figure('Tournament Prize')).toHaveTextContent('Could Not Be Read');
    select('Bob');
    await flush();
    expect(figure('Tournament Prize')).toHaveTextContent('0');
    expect(figure('Total Payout')).toHaveTextContent('5,000');
  });
  it('refreshes the selected payout when the event becomes completed', async () => {
    transport.responses.push(Promise.resolve(row(0)), Promise.resolve(row(250)));
    const view = render(panel('event-a', false));
    select('Bob');
    await flush();
    view.rerender(panel('event-a', true));
    await flush();
    expect(figure('Tournament Prize')).toHaveTextContent('250');
    expect(figure('Total Payout')).toHaveTextContent('5,250');
    expect(transport.reads).toHaveLength(2);
  });
});
