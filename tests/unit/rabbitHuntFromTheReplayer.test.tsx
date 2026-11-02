/**
 * RABBIT HUNT FROM THE HAND REPLAYER (P5 2026-09-05; widened 2026-11-01)
 *
 * The felt shows the offer for 2250-2650ms. The first cut of this surface
 * mirrored the engine's 90-second window, because that was all the engine
 * would sell. Dan 2026-11-01 widened the feature itself: "if you are looking
 * at a PREVIOUS HAND you can RABBIT HUNT, or run out the board's cards that
 * would have been there." The engine persists every captured runout to the
 * RLS-sealed rabbit_hunt_offers table and serves replayed hands from there,
 * so the replayer's bound is now that table's own 1-day retention.
 *
 * The rules stay where they were: the ENGINE decides whether a hand can be
 * bought (runout on record, table toggle, board length, dealt-in,
 * already-paid). The client decides only whether to OFFER the button, so the
 * replayer does not show a dead control on hands that are plainly past
 * selling.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { act, cleanup, render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

import {
  replayRabbitOffer,
  RABBIT_HUNT_REPLAY_RETENTION_MS,
} from '../../src/components/table/replayRabbitOffer';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');
const squash = (t: string) => t.replace(/\s+/g, '');

const board = (n: number) => Array.from({ length: n }, (_, i) => ({ rank: 'A', suit: 's', i }));

describe('which replayed hands are still worth offering', () => {
  const base = { handNumber: 41, timestamp: 1_000_000 };
  const now = base.timestamp + 5_000;

  it('a hand that ended early, inside the window, is offered', () => {
    const o = replayRabbitOffer({ ...base, boards: [board(3)] }, now);
    expect(o.show).toBe(true);
    expect(o.cardsUnseen, 'the turn and the river').toBe(2);
    expect(o.msLeft).toBe(RABBIT_HUNT_REPLAY_RETENTION_MS - 5_000);
  });

  it('a preflop fold has all five unseen', () => {
    expect(replayRabbitOffer({ ...base, boards: [] }, now)).toMatchObject({
      show: true,
      cardsUnseen: 5,
    });
    expect(replayRabbitOffer({ ...base, boards: [[]] }, now)).toMatchObject({
      show: true,
      cardsUnseen: 5,
    });
  });

  it('a board that ran out has nothing unseen behind it', () => {
    expect(replayRabbitOffer({ ...base, boards: [board(5)] }, now)).toMatchObject({
      show: false,
      cardsUnseen: 0,
    });
  });

  it('a re-run or a bomb pot is never offered - the engine does not sell them', () => {
    expect(replayRabbitOffer({ ...base, boards: [[], []] }, now).show).toBe(false);
    expect(replayRabbitOffer({ ...base, boards: [board(3), board(3)] }, now).show).toBe(false);
    expect(replayRabbitOffer({ ...base, boards: [board(4), board(4), board(4)] }, now).show).toBe(
      false
    );
  });

  it('past the retention it is not offered, and the button is not dangled', () => {
    const late = base.timestamp + RABBIT_HUNT_REPLAY_RETENTION_MS + 1;
    const o = replayRabbitOffer({ ...base, boards: [board(3)] }, late);
    expect(o.show).toBe(false);
    expect(o.msLeft).toBe(0);
  });

  it('the last second still counts', () => {
    const edge = base.timestamp + RABBIT_HUNT_REPLAY_RETENTION_MS - 1;
    expect(replayRabbitOffer({ ...base, boards: [board(4)] }, edge).show).toBe(true);
  });

  it('no hand at all is not an offer', () => {
    expect(replayRabbitOffer(null).show).toBe(false);
    expect(replayRabbitOffer(undefined).show).toBe(false);
  });
});

describe('the client copy of the retention matches the server', () => {
  it('is the one day the offers table is pruned at', () => {
    // The engine's bound is the rabbit_hunt_offers 1-day prune
    // (sp_prune_rabbit_hunt_offers, created in 20260823141355 and scheduled
    // alongside the 2026-11-01 widening). Pin the client constant to the
    // migration's own interval so the two cannot drift in silence.
    const migration = read(
      'supabase/migrations/20260823141355_rabbit_hunt_server_enforced_economy.sql'
    );
    expect(migration, 'the prune interval must still be findable').toMatch(/interval '1 day'/);
    expect(RABBIT_HUNT_REPLAY_RETENTION_MS).toBe(86_400_000);
  });

  it('the engine serves a replayed hand from the sealed offers table', () => {
    const engine = read('server/src/engine/ServerTableEngineSettlement.ts');
    // A hand the in-memory map no longer holds is read back from the
    // RLS-sealed rabbit_hunt_offers row the capture path wrote - that is
    // what makes a PREVIOUS hand purchasable at all (Dan 2026-11-01). The
    // 90-second age refusal is gone on purpose.
    expect(engine).toContain('loadPersistedRabbitOffer');
    expect(engine).toContain("from('rabbit_hunt_offers')");
    expect(engine).not.toContain("error: 'That Hand Is Too Old To Rabbit Hunt'");
  });

  it('the engine still refuses what the client declines to offer', () => {
    const engine = read('server/src/engine/ServerTableEngineSettlement.ts');
    // The client hiding a button is cosmetic; these are the real gates.
    expect(engine).toContain('The Board Already Ran Out');
    expect(engine).toContain('You Were Not Dealt Into That Hand');
    expect(engine, 'a second tap re-shows free, it does not re-bill').toContain(
      "source: 'already_revealed'"
    );
  });
});

describe('one purchase path, two surfaces', () => {
  it('the felt tile and the replayer both buy through useRabbitHuntReveal', () => {
    const tile = squash(read('src/components/table/RabbitHunt.tsx'));
    const modal = squash(read('src/components/table/HandDetailModal.tsx'));
    expect(tile).toContain(squash('useRabbitHuntReveal({'));
    expect(modal).toContain(squash('useRabbitHuntReveal({'));
    // and neither reimplements the charge
    expect(tile).not.toContain(squash('requestRabbitHunt('));
    expect(modal).not.toContain(squash('requestRabbitHunt('));
  });

  it('the hook is single-flight and says what it took', () => {
    const hook = read('src/components/table/useRabbitHuntReveal.ts');
    expect(hook, 'a same-frame double tap must not bill twice').toContain('inFlightRef.current');
    expect(hook).toContain('Diamonds Charged');
    expect(hook).toContain('Showing Your Rabbit Hunt Again, No Charge');
  });

  it('TablePage hands the replayer the same charging call, with an explicit hand', () => {
    const page = squash(read('src/pages/TablePage.tsx'));
    expect(page).toContain(squash('onRabbitHunt={handleRabbitReveal}'));
    expect(page).toContain(squash('const handleRabbitReveal = useCallback('));
    expect(page).toContain(squash('requestRabbitHunt(tableId, requestedHandNumber)'));
    expect(page, 'the hand being looked at, not the one the felt offered').toContain(
      squash('handNumber ?? rabbitHandNumberRef.current ?? liveHandNumberRef.current')
    );
  });
});

// ── the block itself ────────────────────────────────────────────────────────
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { useRabbitHuntReveal } from '../../src/components/table/useRabbitHuntReveal';

afterEach(cleanup);

function Harness({
  onReveal,
  userId = 'u1',
}: {
  onReveal: (n?: number) => Promise<never | any>;
  userId?: string;
}) {
  const { reveal, cards, hasRevealed, isRevealing } = useRabbitHuntReveal({
    onReveal,
    userId,
  });
  return (
    <div>
      <button onClick={() => void reveal(41)} disabled={isRevealing}>
        buy
      </button>
      <span data-testid="state">{hasRevealed ? `revealed:${cards.length}` : 'none'}</span>
    </div>
  );
}

describe('the purchase, driven', () => {
  it('buys once for the hand named, and shows the cards it bought', async () => {
    const onReveal = vi
      .fn()
      .mockResolvedValue({ success: true, cards: [{ rank: 'A', suit: 'c' }], diamondsSpent: 5 });
    const { getByText, getByTestId } = render(<Harness onReveal={onReveal} />);
    fireEvent.click(getByText('buy'));
    await waitFor(() => expect(getByTestId('state').textContent).toBe('revealed:1'));
    expect(onReveal).toHaveBeenCalledWith(41);
    // A second press after a reveal must not reach the paid endpoint again.
    fireEvent.click(getByText('buy'));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it('a refusal charges nothing and reveals nothing', async () => {
    const onReveal = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'That Hand Is Too Old To Rabbit Hunt' });
    const { getByText, getByTestId } = render(<Harness onReveal={onReveal} />);
    fireEvent.click(getByText('buy'));
    await waitFor(() => expect(onReveal).toHaveBeenCalledTimes(1));
    expect(getByTestId('state').textContent).toBe('none');
  });

  it('never paints an old account reveal into the replacement account', async () => {
    let resolveA!: (value: unknown) => void;
    let resolveB!: (value: unknown) => void;
    const requestA = new Promise((resolve) => {
      resolveA = resolve;
    });
    const requestB = new Promise((resolve) => {
      resolveB = resolve;
    });
    const onReveal = vi.fn().mockReturnValueOnce(requestA).mockReturnValueOnce(requestB);

    const { getByText, getByTestId, rerender } = render(
      <Harness onReveal={onReveal} userId="account-a" />
    );
    fireEvent.click(getByText('buy'));
    expect(onReveal).toHaveBeenCalledTimes(1);

    rerender(<Harness onReveal={onReveal} userId="account-b" />);
    await waitFor(() => expect(getByText('buy')).not.toBeDisabled());
    expect(getByTestId('state').textContent).toBe('none');
    fireEvent.click(getByText('buy'));
    expect(onReveal).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveA({ success: true, cards: [{ rank: 'A', suit: 's' }], diamondsSpent: 5 });
      await requestA;
    });
    expect(getByTestId('state').textContent).toBe('none');
    expect(getByText('buy')).toBeDisabled();

    await act(async () => {
      resolveB({ success: true, cards: [{ rank: 'K', suit: 'h' }], diamondsSpent: 5 });
      await requestB;
    });
    await waitFor(() => expect(getByTestId('state').textContent).toBe('revealed:1'));
  });
});
