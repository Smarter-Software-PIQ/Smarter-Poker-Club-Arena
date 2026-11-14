/**
 * THE CHARLES RULE COUNTDOWN RESUMES, AND SAYS SO WHILE IT IS PAUSED (owner
 * 2026-11-13: "IT NEEDS TO PICK BACK UP WHERE YOU LEFT OFF AT THE 7 HANDS,
 * NOT RESTART THE 10 BACK OVER").
 *
 * The database keeps required and played through the pause
 * (20261114050737). The client shows the paused count, asks nothing at the
 * leave doors while it is paused, and shows and announces the resumed number.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';

const rpc = vi.fn();
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import HitRunCountPill from '../src/components/table/HitRunCountPill';
import HeroVpipTracker from '../src/components/table/HeroVpipTracker';
import {
  HAND_COUNT_REFRESH_DELAY_MS,
  useCountdownResumed,
  useCountdownStarted,
  useHeroHandCount,
} from '../src/hooks/useHeroHandCount';
import {
  HIT_RUN_PAUSED_LABEL,
  countdownPausedText,
  countdownResumedText,
  fetchMyHandCount,
  fetchMyHandsOwed,
  pausedHands,
  pausedHandsLeftText,
  type HandCount,
} from '../src/lib/hitAndRun';

const flat = (p: string) => readFileSync(p, 'utf8').replace(/\s+/g, ' ');
const row = (over: Record<string, unknown>) => ({
  table_id: 't1',
  hands_remaining: 0,
  hands_required: 10,
  hands_played: 3,
  completed: false,
  blind_off: false,
  hands_reason: null,
  big_win_hands_remaining: 0,
  big_win_bb: null,
  ...over,
});
const status = (over: Record<string, unknown>) =>
  rpc.mockResolvedValue({ data: [row(over)], error: null });

beforeEach(() => rpc.mockReset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the paused count is read from the row, never from a constant', () => {
  it('is required minus played while nothing is owed and the count is not completed', () => {
    expect(pausedHands(row({}))).toBe(7);
    expect(pausedHands(row({ hands_required: 20, hands_played: 6 }))).toBe(14);
  });

  it('is nothing while hands are owed, once completed, or with no countdown', () => {
    expect(pausedHands(row({ hands_remaining: 7 }))).toBeNull();
    expect(pausedHands(row({ completed: true }))).toBeNull();
    expect(pausedHands(row({ hands_required: 0, hands_played: 0 }))).toBeNull();
    expect(pausedHands(row({ hands_played: 10 }))).toBeNull();
    expect(pausedHands(row({ big_win_hands_remaining: 4 }))).toBeNull();
    expect(pausedHands(row({ hands_required: null, hands_played: null }))).toBeNull();
    expect(pausedHands(null)).toBeNull();
  });

  it('the wording is Title Case with no em dash and no currency sign', () => {
    expect(HIT_RUN_PAUSED_LABEL).toBe('Countdown Paused');
    expect(countdownPausedText(7)).toBe('Countdown Paused - 7 Hands Left');
    expect(countdownPausedText(1)).toBe('Countdown Paused - 1 Hand Left');
    expect(pausedHandsLeftText(7)).toBe('Hands Left When You Are Back In Profit');
    expect(pausedHandsLeftText(1)).toBe('Hand Left When You Are Back In Profit');
    expect(countdownResumedText(7)).toBe(
      'You Are Back In Profit. 7 Hands Left Before You Can Leave'
    );
    for (const t of [countdownPausedText(7), pausedHandsLeftText(7), countdownResumedText(7)])
      expect(t).not.toMatch(/[–—$]/);
  });
});

describe('the status read', () => {
  it('reports a paused countdown and owes nothing, so no leave door asks', async () => {
    status({});
    expect(await fetchMyHandCount('t1')).toMatchObject({ owed: null, paused: 7, done: false });
    expect(await fetchMyHandsOwed('t1')).toBeNull();
  });

  it('after the return to profit owes the resumed number, not a fresh ten', async () => {
    status({ hands_remaining: 7, hands_reason: 'hit_run' });
    const count = await fetchMyHandCount('t1');
    expect(count).toMatchObject({ owed: 7, required: 10, reason: 'hit_run' });
    expect(count.paused ?? null).toBeNull();
    expect(await fetchMyHandsOwed('t1')).toBe(7);
  });

  it('a completed countdown is done and not paused', async () => {
    status({ completed: true, hands_played: 10 });
    expect(await fetchMyHandCount('t1')).toMatchObject({ owed: null, paused: null, done: true });
  });
});

describe('the felt shows the pause', () => {
  it('the Lightning pill shows the paused count, and the owed count wins over it', () => {
    const view = render(<HitRunCountPill hands={null} paused={7} />);
    const pill = screen.getByTestId('hit-run-paused-pill');
    expect(pill).toHaveTextContent('Countdown Paused');
    expect(pill).toHaveTextContent('7');
    expect(pill).toHaveTextContent('Hands Left When You Are Back In Profit');
    expect(pill).toHaveAttribute('aria-label', 'Countdown Paused - 7 Hands Left');
    view.rerender(<HitRunCountPill hands={7} paused={7} />);
    expect(screen.queryByTestId('hit-run-paused-pill')).not.toBeInTheDocument();
    expect(screen.getByTestId('hit-run-count-pill')).toHaveTextContent('7');
    view.rerender(<HitRunCountPill hands={null} paused={null} />);
    expect(view.container).toBeEmptyDOMElement();
  });

  it('the seat-side tracker shows the paused count beside the hero', async () => {
    rpc.mockResolvedValue({ data: { ok: true, seated: true, required: 0 }, error: null });
    const props = {
      tableId: 't1',
      heroSeated: true,
      isTournament: false,
      handNumber: 4,
      heroPos: { x: 50, y: 95 },
    };
    const view = render(<HeroVpipTracker {...props} handsOwed={null} handsPaused={7} />);
    const paused = screen.getByTestId('hero-hand-count-paused');
    expect(paused).toHaveTextContent('Countdown Paused');
    expect(paused).toHaveTextContent('7');
    expect(paused).toHaveAttribute('aria-label', 'Countdown Paused - 7 Hands Left');
    expect(screen.queryByTestId('hero-hand-count')).not.toBeInTheDocument();
    view.rerender(<HeroVpipTracker {...props} handsOwed={7} handsPaused={7} />);
    expect(screen.queryByTestId('hero-hand-count-paused')).not.toBeInTheDocument();
    expect(screen.getByTestId('hero-hand-count')).toHaveTextContent('7');
    await act(async () => {});
  });

  it('TablePage passes the pause to both, and announces the resume', () => {
    const page = flat('src/pages/TablePage.tsx');
    expect(page).toContain('handsPaused={heroHandCount.paused ?? null}');
    expect(page).toContain('paused={heroHandCount.paused ?? null}');
    expect(page).toContain(
      'useCountdownResumed(heroHandCount, (hands) => toast.info(countdownResumedText(hands)))'
    );
  });
});

describe('a classic table reads the pause the engine does not send', () => {
  type Engine = { owed: number | null; required: number | null; reason?: HandCount['reason'] };
  const mount = (engine: Engine, handNumber = 5) =>
    renderHook(
      (p: { engine: Engine; handNumber: number }) =>
        useHeroHandCount({
          enabled: true,
          tableId: 't1',
          lightningClusterId: null,
          handNumber: p.handNumber,
          engine: p.engine,
        }),
      { initialProps: { engine, handNumber } }
    );
  const settle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HAND_COUNT_REFRESH_DELAY_MS + 10);
    });
  };

  it('counts down from the engine, pauses from the database, resumes at the same number', async () => {
    vi.useFakeTimers();
    status({ hands_remaining: 7, hands_reason: 'hit_run' });
    const view = mount({ owed: 7, required: 10, reason: 'hit_run' });
    await settle();
    expect(rpc).not.toHaveBeenCalled();
    expect(view.result.current).toMatchObject({ owed: 7, required: 10, paused: null });

    // The player falls out of profit: the engine reports nothing owed.
    status({});
    view.rerender({ engine: { owed: null, required: null }, handNumber: 6 });
    expect(view.result.current).toMatchObject({ owed: null, paused: null });
    await settle();
    expect(rpc).toHaveBeenCalledWith('fn_my_hit_run_status', { p_table_id: 't1' });
    expect(view.result.current).toMatchObject({ owed: null, required: null, paused: 7 });

    // Hands out of profit never count: still 7, read again after each hand.
    view.rerender({ engine: { owed: null, required: null }, handNumber: 7 });
    await settle();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(view.result.current.paused).toBe(7);

    // Back in profit: the engine's count is shown, 7 of 10, and the pause ends.
    view.rerender({ engine: { owed: 7, required: 10, reason: 'hit_run' }, handNumber: 8 });
    expect(view.result.current).toMatchObject({ owed: 7, required: 10, paused: null });
  });

  it('reads once when the table opens and stops when nothing can be paused', async () => {
    vi.useFakeTimers();
    status({ hands_required: 0, hands_played: 0 });
    const view = mount({ owed: null, required: null });
    await settle();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(view.result.current.paused ?? null).toBeNull();
    view.rerender({ engine: { owed: null, required: null }, handNumber: 6 });
    view.rerender({ engine: { owed: null, required: null }, handNumber: 7 });
    await settle();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('a reload during a pause shows it, and a completed count ends the reads', async () => {
    vi.useFakeTimers();
    status({ hands_required: 20, hands_played: 16 });
    const view = mount({ owed: null, required: null });
    await settle();
    expect(view.result.current.paused).toBe(4);
    status({ completed: true, hands_required: 20, hands_played: 20 });
    view.rerender({ engine: { owed: null, required: null }, handNumber: 6 });
    await settle();
    expect(view.result.current.paused ?? null).toBeNull();
    view.rerender({ engine: { owed: null, required: null }, handNumber: 7 });
    await settle();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe('the resume is announced with the resumed number', () => {
  it('fires once when a paused count is owed again, and never as a fresh start', () => {
    const onResume = vi.fn();
    const onStart = vi.fn();
    const { rerender } = renderHook(
      ({ c, h }: { c: HandCount; h: number }) => {
        useCountdownResumed(c, onResume);
        useCountdownStarted(c, h, onStart);
      },
      { initialProps: { c: { owed: 8, required: 10, reason: 'hit_run' } as HandCount, h: 3 } }
    );
    rerender({ c: { owed: null, required: null, paused: 7 }, h: 4 });
    rerender({ c: { owed: null, required: null, paused: 7 }, h: 5 });
    expect(onResume).not.toHaveBeenCalled();
    rerender({ c: { owed: 7, required: 10, reason: 'hit_run', paused: null }, h: 6 });
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenLastCalledWith(7);
    expect(onStart).not.toHaveBeenCalled();
    rerender({ c: { owed: 6, required: 10, reason: 'hit_run', paused: null }, h: 7 });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('is silent for a count that was never paused and for a big-win count', () => {
    const onResume = vi.fn();
    const { rerender } = renderHook(({ c }: { c: HandCount }) => useCountdownResumed(c, onResume), {
      initialProps: { c: { owed: null, required: null } as HandCount },
    });
    rerender({ c: { owed: 10, required: 10, reason: 'hit_run' } });
    rerender({ c: { owed: null, required: null, paused: 7 } });
    rerender({ c: { owed: 10, required: 10, reason: 'big_win' } });
    expect(onResume).not.toHaveBeenCalled();
  });
});
