import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HeadsUpWaitingModal } from '../../src/components/table/HeadsUpWaitingModal';
import * as shareModule from '../../src/lib/share';

describe('HeadsUpWaitingModal behavior', () => {
  beforeEach(() => {
    // jsdom does not implement showModal/close natively on HTMLDialogElement.
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close() {
      const wasOpen = this.hasAttribute('open');
      this.removeAttribute('open');
      if (wasOpen) {
        this.dispatchEvent(new Event('close'));
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('transitions from choice to invite on Specific Player and preserves the invite step across re-renders', () => {
    const onChooseSpecific = vi.fn();
    const onChooseAnyone = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <HeadsUpWaitingModal
        isOpen={true}
        initialStep="choice"
        tableName="NLH 1/2 Heads Up"
        inviteUrl="https://smarter.poker/hub/club-arena/table/tbl-1"
        onChooseSpecific={onChooseSpecific}
        onChooseAnyone={onChooseAnyone}
        onClose={onClose}
      />
    );

    expect(screen.getByText('Waiting For Opponent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Specific Player' }));

    expect(onChooseSpecific).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Invite Player')).toBeInTheDocument();
    expect(
      screen.getByText('https://smarter.poker/hub/club-arena/table/tbl-1')
    ).toBeInTheDocument();

    // Parent re-renders while still open with initialStep='choice' (e.g. table state tick)
    // must NOT bounce the player back to the choice step.
    rerender(
      <HeadsUpWaitingModal
        isOpen={true}
        initialStep="choice"
        tableName="NLH 1/2 Heads Up"
        inviteUrl="https://smarter.poker/hub/club-arena/table/tbl-1"
        onChooseSpecific={onChooseSpecific}
        onChooseAnyone={onChooseAnyone}
        onClose={onClose}
      />
    );
    expect(screen.getByText('Invite Player')).toBeInTheDocument();
  });

  it('surfaces ShareLinkFallback when shareLink returns failed and notifies when copied', async () => {
    const onNotify = vi.fn();
    const shareSpy = vi.spyOn(shareModule, 'shareLink').mockResolvedValueOnce('failed');

    render(
      <HeadsUpWaitingModal
        isOpen={true}
        initialStep="invite"
        tableName=""
        inviteUrl="https://smarter.poker/hub/club-arena/table/tbl-2"
        onChooseSpecific={vi.fn()}
        onChooseAnyone={vi.fn()}
        onClose={vi.fn()}
        onNotify={onNotify}
      />
    );

    const primaryBtn = screen.getByRole('button', { name: /Copy Link|Share/i });
    fireEvent.click(primaryBtn);

    await waitFor(() => {
      expect(shareSpy).toHaveBeenCalledWith({
        source: 'HeadsUpWaitingModal.share',
        title: 'Heads Up Sit N Go',
        text: 'Join Me In Heads Up Sit N Go On Smarter.Poker',
        url: 'https://smarter.poker/hub/club-arena/table/tbl-2',
      });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Copy Is Blocked Here. The Game Invite Link Is Selected, Copy It By Hand.'
    );
    expect(onNotify).not.toHaveBeenCalled();

    shareSpy.mockResolvedValueOnce('copied');
    fireEvent.click(primaryBtn);

    await waitFor(() => {
      expect(onNotify).toHaveBeenCalledWith('success', 'Game Invite Link Copied');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes the native dialog when isOpen flips false (e.g. tab switch in MultiTablePage)', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <HeadsUpWaitingModal
        isOpen={true}
        initialStep="invite"
        tableName="NLH Heads Up"
        inviteUrl="https://smarter.poker/hub/club-arena/table/tbl-3"
        onChooseSpecific={vi.fn()}
        onChooseAnyone={vi.fn()}
        onClose={onClose}
      />
    );

    const dialog = container.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);

    rerender(
      <HeadsUpWaitingModal
        isOpen={false}
        initialStep="invite"
        tableName="NLH Heads Up"
        inviteUrl="https://smarter.poker/hub/club-arena/table/tbl-3"
        onChooseSpecific={vi.fn()}
        onChooseAnyone={vi.fn()}
        onClose={onClose}
      />
    );

    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('waits for async Specific Player persistence, stays on choice with inline error on failure, and shows tokenized URL on success', async () => {
    const onChooseSpecific = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onClose = vi.fn();

    const { rerender } = render(
      <HeadsUpWaitingModal
        isOpen={true}
        initialStep="choice"
        tableName="NLH Heads Up"
        inviteUrl="https://smarter.poker/hub/club-arena/table/tbl-4"
        errorMessage="Could Not Update Waiting Mode, Please Try Again"
        onChooseSpecific={onChooseSpecific}
        onChooseAnyone={vi.fn()}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could Not Update Waiting Mode, Please Try Again'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Specific Player' }));
    await waitFor(() => expect(onChooseSpecific).toHaveBeenCalledTimes(1));
    // Must NOT advance to invite step when RPC persistence returns false.
    expect(screen.getByText('Waiting For Opponent')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Specific Player' }));
    await waitFor(() => expect(screen.getByText('Invite Player')).toBeInTheDocument());

    rerender(
      <HeadsUpWaitingModal
        isOpen={true}
        initialStep="invite"
        tableName="NLH Heads Up"
        inviteUrl="https://smarter.poker/hub/club-arena/table/tbl-4?invite=a1b2c3d4e5f60718293a4b5c6d7e8f90"
        onChooseSpecific={onChooseSpecific}
        onChooseAnyone={vi.fn()}
        onClose={onClose}
      />
    );
    expect(
      screen.getByText(
        'https://smarter.poker/hub/club-arena/table/tbl-4?invite=a1b2c3d4e5f60718293a4b5c6d7e8f90'
      )
    ).toBeInTheDocument();
  });

  it('does not close on Play Anyone when async persistence fails, and closes when it succeeds', async () => {
    const onChooseAnyone = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onClose = vi.fn();

    render(
      <HeadsUpWaitingModal
        isOpen={true}
        initialStep="choice"
        tableName="NLH Heads Up"
        inviteUrl="https://smarter.poker/hub/club-arena/table/tbl-5"
        onChooseSpecific={vi.fn()}
        onChooseAnyone={onChooseAnyone}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play Anyone' }));
    await waitFor(() => expect(onChooseAnyone).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Play Anyone' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
