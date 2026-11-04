import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type NoteRead = {
  data: {
    id: string;
    notes: string;
    tags: string[];
    color_label: string;
  } | null;
  error: { message: string } | null;
};

const mocks = vi.hoisted(() => ({
  currentUser: { id: 'account-a' } as { id: string } | null,
  noteReads: new Map<string, Promise<NoteRead>>(),
  checkVIPStatus: vi.fn(),
  purchaseFeature: vi.fn(),
  showDiamondTopUp: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  save: vi.fn().mockResolvedValue({ error: null }),
  remove: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: mocks.currentUser }),
}));

vi.mock('../../src/services/VIPService', () => ({
  FEATURE_PRICING: { tag_pack: { cost: 1 } },
  vipService: {
    checkVIPStatus: mocks.checkVIPStatus,
    purchaseFeature: mocks.purchaseFeature,
  },
}));

vi.mock('../../src/services/PlayerNotesService', () => ({
  NOTE_COLORS: [{ name: 'None', value: 'none', hex: 'transparent' }],
  PLAYER_TAGS: ['Aggressive'],
  LABEL_TO_HEX: { none: '#6b7280' },
  playerNotesService: {
    clearCache: vi.fn(),
    notifyChanged: vi.fn(),
    deleteNote: (...args: unknown[]) => mocks.remove(...args),
  },
}));

vi.mock('../../src/hooks/useStaggerAnimation', () => ({
  useStaggerAnimation: () => ({ style: () => ({}) }),
}));

vi.mock('../../src/components/common/DiamondTopUpToast', () => ({
  showDiamondTopUp: mocks.showDiamondTopUp,
}));

vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => mocks.toast,
}));

vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let requestedUserId = '';
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: string) => {
        if (column === 'user_id') requestedUserId = value;
        return builder;
      };
      builder.maybeSingle = () => {
        if (table !== 'player_notes') return Promise.resolve({ data: null, error: null });
        return mocks.noteReads.get(requestedUserId) ?? Promise.resolve({ data: null, error: null });
      };
      builder.order = () => Promise.resolve({ data: [], error: null });
      builder.in = () => Promise.resolve({ data: [], error: null });
      builder.upsert = (...args: unknown[]) => mocks.save(...args);
      builder.delete = () => builder;
      return builder;
    },
  },
}));

import PlayerNotesPanel from '../../src/components/gameplay/PlayerNotesPanel';

function view() {
  return (
    <MemoryRouter>
      <PlayerNotesPanel targetUserId="opponent" targetName="Opponent" />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  mocks.currentUser = { id: 'account-a' };
  mocks.noteReads.clear();
  vi.clearAllMocks();
});

describe('Player Notes Account Isolation', () => {
  it('ignores late account A note data after account B becomes active', async () => {
    const accountANote = deferred<NoteRead>();
    const accountBNote = deferred<NoteRead>();
    mocks.noteReads.set('account-a', accountANote.promise);
    mocks.noteReads.set('account-b', accountBNote.promise);

    const rendered = render(view());
    mocks.currentUser = { id: 'account-b' };
    rendered.rerender(view());

    await act(async () => {
      accountBNote.resolve({ data: null, error: null });
      await accountBNote.promise;
    });

    await act(async () => {
      accountANote.resolve({
        data: {
          id: 'note-a',
          notes: 'Account A Secret',
          tags: ['Aggressive'],
          color_label: 'none',
        },
        error: null,
      });
      await accountANote.promise;
    });

    expect(screen.getByPlaceholderText('Add Notes About This Player...')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Aggressive' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('tags are free: a tap selects the tag with no status check and no purchase', async () => {
    /* TAGS ARE FREE (Dan 2026-11-04). The tag pack purchase and the VIP status
       read are gone from this panel; a tag toggles on and off like a switch. */
    mocks.noteReads.set('account-a', Promise.resolve({ data: null, error: null }));
    render(view());
    const tag = await screen.findByRole('button', { name: 'Aggressive' });
    await waitFor(() => expect(tag).toBeEnabled());
    fireEvent.click(tag);
    expect(tag).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tag);
    expect(tag).toHaveAttribute('aria-pressed', 'false');
    expect(mocks.checkVIPStatus).not.toHaveBeenCalled();
    expect(mocks.purchaseFeature).not.toHaveBeenCalled();
    expect(mocks.showDiamondTopUp).not.toHaveBeenCalled();
  });

  it('fails closed instead of overwriting a note after its read fails', async () => {
    mocks.noteReads.set(
      'account-a',
      Promise.resolve({ data: null, error: { message: 'notes database unavailable' } })
    );
    mocks.checkVIPStatus.mockResolvedValue({ isVIP: false });

    render(view());

    expect(await screen.findByText('Player Note Could Not Be Loaded.')).toBe(
      screen.getByRole('alert')
    );
    expect(screen.getByPlaceholderText('Add Notes About This Player...')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Aggressive' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save Note' })).toBeDisabled();
    expect(mocks.purchaseFeature).not.toHaveBeenCalled();
  });
});

it('saves edited and cleared notes, blocks repeat saves and retains a failed draft', async () => {
  mocks.checkVIPStatus.mockResolvedValue({ isVIP: true });
  mocks.noteReads.set(
    'account-a',
    Promise.resolve({
      data: { id: 'note', notes: 'Previous Read', tags: [], color_label: 'none' },
      error: null,
    })
  );
  const saved = deferred<{ error: null }>();
  mocks.save.mockReturnValueOnce(saved.promise);
  const rendered = render(view());
  const input = await screen.findByDisplayValue('Previous Read');
  fireEvent.change(input, { target: { value: 'New Read' } });
  const save = screen.getByRole('button', { name: 'Save Note' });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][0]).toMatchObject({
    user_id: 'account-a',
    target_user_id: 'opponent',
    notes: 'New Read',
  });
  await act(async () => saved.resolve({ error: null }));
  mocks.save.mockRejectedValueOnce(new Error('offline'));
  fireEvent.change(input, { target: { value: 'Keep My Draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Note' }));
  await waitFor(() =>
    expect(mocks.toast.error).toHaveBeenCalledWith('Failed To Save Note. Your Draft Is Still Here.')
  );
  expect(input).toHaveValue('Keep My Draft');
  expect(input).not.toBeDisabled();
  /* A BLANK SAVE IS A CLEAR (2026-11-04): no text, no tags and no colour
     removes the row instead of writing an empty note that would still count
     as a note (in the library, and as a post-it on the seat). */
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Note' }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
  expect(mocks.remove).toHaveBeenCalledWith('account-a', 'opponent');
  expect(mocks.save).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Note Cleared'));
  rendered.unmount();
});

it('a blank save on a player with no note writes nothing, clears nothing and closes', async () => {
  mocks.noteReads.set('account-a', Promise.resolve({ data: null, error: null }));
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <PlayerNotesPanel targetUserId="opponent" targetName="Opponent" onClose={onClose} />
    </MemoryRouter>
  );
  const save = await screen.findByRole('button', { name: 'Save Note' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.toast.success).not.toHaveBeenCalled();
});

it('retries an unread note before permitting an edit', async () => {
  mocks.checkVIPStatus.mockResolvedValue({ isVIP: false });
  mocks.noteReads.set('account-a', Promise.reject(new Error('offline')));
  render(view());
  const retry = await screen.findByRole('button', { name: 'Retry' });
  expect(screen.getByRole('button', { name: 'Save Note' })).toBeDisabled();
  mocks.noteReads.set(
    'account-a',
    Promise.resolve({
      data: { id: 'note', notes: 'Recovered Read', tags: [], color_label: 'none' },
      error: null,
    })
  );
  fireEvent.click(retry);
  expect(await screen.findByDisplayValue('Recovered Read')).not.toBeDisabled();
});
