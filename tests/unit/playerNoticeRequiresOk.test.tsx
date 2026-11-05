import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rpc = vi.fn();
vi.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import {
  PlayerNoticeModal,
  usePendingPlayerNotice,
} from '../../src/components/notices/PlayerNoticeModal';

const NOTICE = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'tournament-arena-relaunch-2026-11-05',
  title: 'Tournament Arena Update Complete',
  body: 'Thank You For Your Patience While We Updated The Poker Tournament Arena. It Took A Little Longer Than Expected To Fully Finish The Update, So We Have Credited Your Account With 25 Chips For The Delay! Good Luck Out There!',
  ok_label: 'OK',
};

function Host({ userId }: { userId: string | null }) {
  const { notice, acknowledge } = usePendingPlayerNotice(userId, false);
  return <PlayerNoticeModal notice={notice} onAcknowledge={acknowledge} />;
}

describe('a player notice closes only through OK', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('shows the pending notice, has no other way out, and records the OK', async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === 'fn_ca_pending_player_notice') return { data: NOTICE, error: null };
      if (name === 'fn_ca_ack_player_notice') return { data: true, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });
    render(<Host userId="u-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('player-notice-body')).toHaveTextContent(NOTICE.body)
    );

    // Escape does nothing; the overlay is not a button.
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('player-notice-overlay'));
    expect(screen.getByTestId('player-notice-body')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();

    fireEvent.click(screen.getByTestId('player-notice-ok'));
    await waitFor(() => expect(screen.queryByTestId('player-notice-body')).toBeNull());
    expect(rpc).toHaveBeenCalledWith('fn_ca_ack_player_notice', { p_notice_id: NOTICE.id });
  });

  it('renders nothing when there is no pending notice or no signed-in player', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { rerender } = render(<Host userId="u-2" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('fn_ca_pending_player_notice'));
    expect(screen.queryByTestId('player-notice-body')).toBeNull();
    rpc.mockClear();
    rerender(<Host userId={null} />);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is wired into the app shell behind the welcome and profile gates, and the migration carries the relaunch copy', () => {
    const layout = readFileSync(
      resolve(__dirname, '../../src/components/layouts/AppLayout.tsx'),
      'utf8'
    );
    expect(layout).toContain("lazyWithRetry(() => import('../notices/PlayerNoticeModal'))");
    expect(layout).toMatch(
      /noticeSuspended = !isReady \|\| !profileReady \|\| showWelcome \|\| showProfileModal/
    );
    expect(layout).toContain('<PlayerNoticeGate userId={user.id} />');
    const migration = readFileSync(
      resolve(
        __dirname,
        '../../supabase/migrations/20261105033238_tournament_relaunch_notice_and_announcement_receipts.sql'
      ),
      'utf8'
    );
    expect(migration).toContain(NOTICE.body);
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_pending_player_notice() TO authenticated'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_ack_player_notice(uuid) TO authenticated'
    );
    expect(migration).not.toMatch(/[—–]/);
  });
});
