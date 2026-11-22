/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UNIT TESTS - OnlineFriendInvitePicker
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnlineFriendInvitePicker } from '../../src/components/table/OnlineFriendInvitePicker';
import type {
  InvitableContact,
  SendTableInviteResult,
} from '../../src/services/TableInviteService';

const mockFetchInvitableContacts = vi.fn();
const mockSendInAppTableInvite = vi.fn();
const mockGetCooldownRemaining = vi.fn(() => 0);
const mockPresenceMap = new Map<string, boolean>();

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({
    user: { id: 'hero-1', alias: 'KingFish', username: 'kingfish' },
  }),
}));

vi.mock('../../src/hooks/useProfilePresence', () => ({
  useProfilePresence: () => mockPresenceMap,
}));

vi.mock('../../src/services/TableInviteService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/TableInviteService')>();
  return {
    ...actual,
    fetchInvitableContacts: (...args: unknown[]) => mockFetchInvitableContacts(...args),
    sendInAppTableInvite: (...args: unknown[]) => mockSendInAppTableInvite(...args),
    getTableInviteCooldownRemainingMs: (...args: unknown[]) => mockGetCooldownRemaining(...args),
  };
});

const CONTACTS: InvitableContact[] = [
  {
    userId: 'u-offline-friend',
    displayName: 'Aaron Offline',
    username: 'aaron_off',
    source: 'friend',
    level: 4,
  },
  {
    userId: 'u-online-clubmate',
    displayName: 'Zara Clubmate',
    username: 'zara_club',
    source: 'clubmate',
    level: 7,
  },
  {
    userId: 'u-online-friend',
    displayName: 'Mike Online',
    username: 'mike_on',
    source: 'friend',
    level: 10,
  },
];

describe('OnlineFriendInvitePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPresenceMap.clear();
    mockPresenceMap.set('u-offline-friend', false);
    mockPresenceMap.set('u-online-clubmate', true);
    mockPresenceMap.set('u-online-friend', true);
    mockFetchInvitableContacts.mockResolvedValue(CONTACTS);
    mockGetCooldownRemaining.mockReturnValue(0);
  });

  it('sorts online contacts first (friends before clubmates) and renders zero em-dashes', async () => {
    const { container } = render(
      <OnlineFriendInvitePicker
        mode="inline"
        kind="cash"
        tableId="tbl-1"
        clubId="club-1"
        tableName="Diamond 1/2"
      />
    );

    const rows = await screen.findAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-user-id'))).toEqual([
      'u-online-friend',
      'u-online-clubmate',
      'u-offline-friend',
    ]);
    expect(screen.getByText('2 Online')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\u2014/);
  });

  it('filters by search query and Online Only toggle', async () => {
    render(
      <OnlineFriendInvitePicker mode="inline" kind="cash" tableId="tbl-1" tableName="Diamond 1/2" />
    );

    await screen.findAllByRole('listitem');

    // Toggle Online Only -> hides offline friend
    fireEvent.click(screen.getByRole('button', { name: 'Online Only' }));
    let rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-user-id'))).toEqual([
      'u-online-friend',
      'u-online-clubmate',
    ]);

    // Search filters further
    const searchInput = screen.getByRole('searchbox', { name: 'Search Friends Or Clubmates' });
    fireEvent.change(searchInput, { target: { value: 'zara' } });
    rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-user-id'))).toEqual(['u-online-clubmate']);
  });

  it('transitions Invite -> Sending... -> Invited on confirmed send and calls onInviteSent', async () => {
    let resolveInvite!: (v: SendTableInviteResult) => void;
    mockSendInAppTableInvite.mockImplementation(
      () =>
        new Promise<SendTableInviteResult>((resolve) => {
          resolveInvite = resolve;
        })
    );
    const onInviteSent = vi.fn();

    render(
      <OnlineFriendInvitePicker
        mode="inline"
        kind="cash"
        tableId="tbl-9"
        tableName="High Roller 5/10"
        onInviteSent={onInviteSent}
      />
    );

    await screen.findAllByRole('listitem');
    const inviteBtn = screen.getByRole('button', { name: 'Invite Mike Online' });
    fireEvent.click(inviteBtn);

    expect(inviteBtn.getAttribute('aria-busy')).toBe('true');
    expect(inviteBtn.textContent).toContain('Sending...');

    resolveInvite({ ok: true, actionUrl: '/table/tbl-9', cooldownMs: 60_000 });

    await waitFor(() => {
      const invitedBtn = screen.getByRole('button', { name: 'Mike Online Invited' });
      expect((invitedBtn as HTMLButtonElement).disabled).toBe(true);
      expect(invitedBtn.textContent).toBe('Invited');
    });

    expect(onInviteSent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-online-friend', displayName: 'Mike Online' }),
      '/table/tbl-9'
    );
  });

  it('displays an honest error alert on insert failure and keeps Invite retryable', async () => {
    mockSendInAppTableInvite.mockResolvedValue({
      ok: false,
      reason: 'insert_failed',
      message: 'Could Not Send Invite Right Now. Please Try Again.',
    });

    render(
      <OnlineFriendInvitePicker
        mode="inline"
        kind="cash"
        tableId="tbl-9"
        tableName="High Roller 5/10"
      />
    );

    await screen.findAllByRole('listitem');
    const inviteBtn = screen.getByRole('button', { name: 'Invite Mike Online' });
    fireEvent.click(inviteBtn);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could Not Send Invite Right Now. Please Try Again.');
    expect((inviteBtn as HTMLButtonElement).disabled).toBe(false);
    expect(inviteBtn.textContent).toBe('Invite');
  });

  it('renders Share Link Instead action in modal mode when onShareLink is provided', async () => {
    const onShareLink = vi.fn();
    const onClose = vi.fn();

    render(
      <OnlineFriendInvitePicker
        mode="modal"
        isOpen={true}
        onClose={onClose}
        onShareLink={onShareLink}
        kind="lightning"
        clusterId="cl-5"
        tableName="Lightning NLH"
      />
    );

    await screen.findAllByRole('listitem');
    const shareBtn = screen.getByRole('button', { name: 'Share Link Instead' });
    fireEvent.click(shareBtn);
    expect(onShareLink).toHaveBeenCalledTimes(1);
  });
});
