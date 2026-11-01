import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ from: vi.fn(), members: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: io.from } }));
vi.mock('../../src/hooks', () => ({ useClubRole: () => ({ isAdmin: true }) }));
vi.mock('../../src/hooks/usePlayerPreference', () => ({
  usePlayerPreference: () => ['', vi.fn()],
}));
vi.mock('../../src/services/MembershipService', () => ({
  MembershipService: { getClubMembers: io.members },
}));
vi.mock('../../src/lib/authUtils', () => ({ readLocalSession: () => ({ userId: 'admin' }) }));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/console/SpadeConsole', () => ({
  SpadeConsole: ({ children, pill }: any) => (
    <section>
      {pill}
      {children}
    </section>
  ),
}));
import RegistrationApprovalsPanel from '../../src/components/tournament/RegistrationApprovalsPanel';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
};
it.each(['first-page', 'later-page', 'members', 'post-write'])(
  'finishes %s as unknown and allows explicit retry',
  async (mode) => {
    vi.useFakeTimers();
    let reads = 0,
      writes = 0,
      fail = true;
    const signals: AbortSignal[] = [];
    const members = [{ userId: 'player', displayName: 'Player' }];
    io.members.mockImplementation((_club, signal) => {
      if (signal) signals.push(signal);
      return mode === 'members' && fail ? new Promise(() => {}) : Promise.resolve(members);
    });
    io.from.mockImplementation(() => {
      const b: any = {
        select: () => b,
        eq: () => b,
        order: () => b,
        limit: () => b,
        gt: () => b,
        abortSignal: (signal: AbortSignal) => {
          signals.push(signal);
          return b;
        },
        insert: () => {
          writes++;
          return Promise.resolve({ error: null });
        },
        then: (yes: any, no: any) => {
          reads++;
          const hang =
            fail &&
            (mode === 'first-page' ||
              (mode === 'later-page' && reads === 2) ||
              (mode === 'post-write' && writes > 0));
          const data =
            mode === 'later-page' && reads === 1
              ? Array.from({ length: 1000 }, (_, i) => ({
                  user_id: `p${String(i).padStart(4, '0')}`,
                  created_at: '2026-10-31',
                }))
              : [];
          return (hang ? new Promise(() => {}) : Promise.resolve({ data, error: null })).then(
            yes,
            no
          );
        },
      };
      return b;
    });
    render(<RegistrationApprovalsPanel tournamentId="event" clubId="club" authorizedToRegister />);
    await flush();
    if (mode === 'post-write') {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      await flush();
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(screen.queryByText('Loading Members...')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Could Not Load Registration Approvals.');
    expect(screen.queryByText('1000 Approved')).toBeNull();
    expect(signals.some((signal) => signal.aborted)).toBe(true);
    expect(writes).toBe(mode === 'post-write' ? 1 : 0);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Approve' })).not.toBeDisabled();
    expect(writes).toBe(mode === 'post-write' ? 1 : 0);
  }
);
