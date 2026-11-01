import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import TournamentAnnouncementOverlay from '../../src/components/table/TournamentAnnouncementOverlay';
import ArenaGameCard from '../../src/components/lobby/game-cards/ArenaGameCard';
import type { ArenaGameCardData } from '../../src/components/lobby/game-cards/arenaGameCardTypes';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('each announcement owns its full display and fade', () => {
  it('does not restart the same event when callbacks or display data are recreated', () => {
    vi.useFakeTimers();
    const dismissed = vi.fn();
    const eventIdentity = {};
    const element = () => (
      <TournamentAnnouncementOverlay
        type="final_table"
        data={{ playersRemaining: 9 }}
        {...{ eventIdentity }}
        onDismiss={() => dismissed()}
      />
    );
    const view = render(element());
    for (let i = 0; i < 40; i++) {
      act(() => vi.advanceTimersByTime(100));
      view.rerender(element());
    }
    act(() => vi.advanceTimersByTime(500));
    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  it.each([3500, 4250])(
    'replaces the same type after %i ms without inheriting dismissal',
    (elapsed) => {
      vi.useFakeTimers();
      const dismissed = vi.fn();
      const first = { amount: 10 };
      const next = { amount: 20 };
      const view = render(
        <TournamentAnnouncementOverlay
          type="seven_deuce_bounty"
          data={first}
          {...{ eventIdentity: first }}
          onDismiss={dismissed}
        />
      );
      act(() => vi.advanceTimersByTime(elapsed));
      view.rerender(
        <TournamentAnnouncementOverlay
          type="seven_deuce_bounty"
          data={next}
          {...{ eventIdentity: next }}
          onDismiss={dismissed}
        />
      );
      expect(view.container.firstElementChild?.classList.contains('visible')).toBe(true);
      act(() => vi.advanceTimersByTime(3999));
      expect(dismissed).not.toHaveBeenCalled();
      expect(view.container.firstElementChild?.classList.contains('visible')).toBe(true);
      act(() => vi.advanceTimersByTime(1));
      expect(view.container.firstElementChild?.classList.contains('visible')).toBe(false);
      act(() => vi.advanceTimersByTime(500));
      expect(dismissed).toHaveBeenCalledTimes(1);
    }
  );
});

describe('desktop Spin promotion uses the displayed payout', () => {
  it.each(['Win Up To 25x', '3x'])('does not substitute 100x for %s', (maxPayout) => {
    const data: ArenaGameCardData = {
      id: 'spin',
      family: 'spins',
      title: 'Spin',
      gameType: 'Holdem',
      status: 'running',
      statusLabel: 'Running',
      rules: [],
      featured: true,
      maxPayout,
    };
    const view = render(
      <ArenaGameCard
        data={data}
        presentation="desktop"
        actions={{ primaryLabel: 'Watch', onPrimary: vi.fn() }}
      />
    );
    expect(view.container.querySelector('[data-zone="promotion"]')?.textContent).toBe(
      `${maxPayout.replace('Win Up To ', '')} Live`
    );
  });
});
