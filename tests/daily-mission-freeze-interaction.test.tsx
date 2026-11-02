import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DailyChallengesPage from '../src/pages/DailyChallengesPage';
import type { DailyChallengeDashboard } from '../src/services/DailyChallengeService';

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
  buyFreeze: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('../src/lib/supabase', () => ({
  getAuthUser: vi.fn().mockResolvedValue({ data: { user: { id: 'freeze-player' } }, error: null }),
}));
vi.mock('../src/services/DailyChallengeService', () => ({
  DAILY_MISSION_REROLL_COST: 100,
  dailyChallengeService: {
    getDashboard: mocks.dashboard,
    getDashboardRevision: vi.fn().mockResolvedValue(1),
    buyStreakFreeze: mocks.buyFreeze,
  },
}));
vi.mock('../src/components/common/Toast', () => ({ useToast: () => mocks }));
vi.mock('../src/hooks/useMasterBusBroadcastChannel', () => ({
  useMasterBusBroadcastChannel: vi.fn(),
}));
vi.mock('../src/core/MasterBus', () => ({
  masterBus: { emit: vi.fn(), on: vi.fn(() => () => undefined) },
}));
vi.mock('../src/lib/analytics', () => ({ capture: vi.fn() }));
vi.mock('../src/services/HapticService', () => ({ triggerHaptic: vi.fn() }));
vi.mock('../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../src/utils/ChunkPreloader', () => ({ prefetchIntent: vi.fn() }));
vi.mock('../src/services/DailyMissionTelemetryService', () => ({
  recordDailyMissionOperation: vi.fn(),
  dailyMissionReasonCode: () => 'test_error',
}));
vi.mock('../src/services/DailyMissionNotificationService', () => ({
  getDailyMissionAlertPreference: vi.fn().mockResolvedValue(false),
  setDailyMissionAlertPreference: vi.fn(),
}));
vi.mock('../src/lib/pushClient', () => ({
  enablePush: vi.fn(),
  hasLocalSubscription: vi.fn().mockResolvedValue(false),
  isIos: () => false,
  isIosStandalonePwa: () => false,
  isWebPushSupported: () => false,
  notificationPermission: () => 'default',
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function dashboard(revision = 1): DailyChallengeDashboard {
  return {
    missions: [],
    periodKeys: { daily: new Date().toISOString().slice(0, 10), weekly: 'week', monthly: 'month' },
    stats: {
      totalCompleted: 0,
      totalClaimed: 0,
      currentStreak: 1,
      totalDiamondsEarned: 0,
      milestoneStart: 0,
      nextMilestone: 7,
      milestoneReward: 100,
      milestoneProgressPercent: 14,
      daysToMilestone: 6,
    },
    streak: {
      streak: 1,
      freezesAvailable: revision - 1,
      usedFreeze: false,
      frozenDate: null,
      lastFrozenDate: null,
      honoredFrozenDates: 0,
      consumedFreeze: false,
      consumedFrozenDate: null,
      nextFreezeIn: null,
    },
    diamondBalance: revision === 1 ? 10000 : 5000,
    vault: { count: 0, diamonds: 0, items: [], pageSize: 100, hasMore: false },
    revision,
    syncedAt: new Date().toISOString(),
  };
}

async function openPurchase() {
  const shell = document.createElement('div');
  shell.id = 'root';
  document.body.appendChild(shell);
  render(
    <MemoryRouter>
      <DailyChallengesPage />
    </MemoryRouter>,
    { container: shell }
  );
  const launcher = await waitFor(() => {
    const button = document.getElementById('buy-streak-freeze') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(false);
    return button!;
  });
  fireEvent.click(launcher);
  const dialog = screen.getByRole('dialog', { name: 'Secure A Streak Freeze?' });
  return {
    shell,
    launcher,
    dialog,
    confirm: within(dialog).getByRole('button', { name: 'Buy Streak Freeze' }),
  };
}

describe('Daily Missions freeze purchase interaction ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dashboard.mockResolvedValue(dashboard());
  });
  afterEach(() => {
    cleanup();
    document.getElementById('root')?.remove();
  });

  it('holds the dialog and shell protection through purchase and ledger reconciliation', async () => {
    const purchase = deferred<{ success: boolean }>();
    const refresh = deferred<DailyChallengeDashboard>();
    mocks.buyFreeze.mockReturnValue(purchase.promise);
    const { shell, confirm, dialog } = await openPurchase();
    mocks.dashboard.mockReturnValue(refresh.promise);

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mocks.buyFreeze).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Secure A Streak Freeze?' })).not.toBeNull();
    expect(shell.hasAttribute('inert')).toBe(true);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    const keepDiamonds = within(dialog).getByRole('button', { name: 'Keep My Diamonds' });
    expect((keepDiamonds as HTMLButtonElement).disabled).toBe(true);
    expect(keepDiamonds.querySelector('[data-state]')).toHaveAttribute('data-state', 'disabled');

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeNull();

    await act(async () => purchase.resolve({ success: true }));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(shell.hasAttribute('inert')).toBe(true);
    await act(async () => refresh.resolve(dashboard(2)));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.getElementById('daily-missions')).not.toBeNull();
    expect(shell.hasAttribute('inert')).toBe(false);
    expect(mocks.buyFreeze).toHaveBeenCalledTimes(1);
  });

  it('cycles Daily -> Weekly -> Monthly subpages, opens and cancels inline reroll confirmation, and verifies #SmarterCasinoRealism attributes', async () => {
    const reroll = vi.fn().mockResolvedValue({
      success: true,
      alreadyRerolled: false,
      diamondsSpent: 100,
      challengeId: 'hp_25',
      diamondBalance: 9900,
    });
    const { dailyChallengeService } = await import('../src/services/DailyChallengeService');
    (dailyChallengeService as unknown as { rerollChallenge: typeof reroll }).rerollChallenge =
      reroll;
    mocks.dashboard.mockResolvedValue({
      ...dashboard(1),
      missions: [
        {
          id: 'daily-1',
          challenge_id: 'hp_10',
          assigned_date: new Date().toISOString().slice(0, 10),
          progress: 2,
          completed: false,
          claimed: false,
          completed_at: null,
          tier: 'daily',
          challenge: {
            id: 'hp_10',
            name: 'Daily Grinder',
            description: 'Play 10 Hands Today',
            type: 'hands_played',
            requirement: 10,
            diamondReward: 15,
            chipReward: 0,
            tier: 'daily',
          },
        },
        {
          id: 'weekly-1',
          challenge_id: 'wk_50',
          assigned_date: 'week',
          progress: 50,
          completed: true,
          claimed: false,
          completed_at: new Date().toISOString(),
          tier: 'weekly',
          challenge: {
            id: 'wk_50',
            name: 'Weekly Marathon',
            description: 'Play 50 Hands This Week',
            type: 'hands_played',
            requirement: 50,
            diamondReward: 120,
            chipReward: 0,
            tier: 'weekly',
          },
        },
        {
          id: 'monthly-1',
          challenge_id: 'mo_200',
          assigned_date: 'month',
          progress: 200,
          completed: true,
          claimed: true,
          completed_at: new Date().toISOString(),
          tier: 'monthly',
          challenge: {
            id: 'mo_200',
            name: 'Monthly Legend',
            description: 'Play 200 Hands This Month',
            type: 'hands_played',
            requirement: 200,
            diamondReward: 500,
            chipReward: 0,
            tier: 'monthly',
          },
        },
      ],
    });

    const shell = document.createElement('div');
    shell.id = 'root';
    document.body.appendChild(shell);
    render(
      <MemoryRouter initialEntries={['/challenges/daily']}>
        <Routes>
          <Route path="/challenges/:cycle?" element={<DailyChallengesPage />} />
        </Routes>
      </MemoryRouter>,
      { container: shell }
    );

    const rootSurface = await waitFor(() => {
      const node = document.getElementById('daily-missions');
      expect(node).not.toBeNull();
      expect(node!.getAttribute('aria-busy')).toBe('false');
      return node!;
    });
    expect(rootSurface.getAttribute('data-casino-realism')).toBe('smarter-casino-realism');
    expect(rootSurface.getAttribute('data-mission-cycle')).toBe('daily');

    // Verify Daily mission card and inline reroll confirmation pop-up
    const dailyCard = document.getElementById('mission-card-daily-1');
    expect(dailyCard).not.toBeNull();
    expect(dailyCard!.getAttribute('data-casino-realism')).toBe('smarter-casino-realism');
    const rerollBtn = within(dailyCard!).getByRole('button', {
      name: /Reroll.*Diamond.*For Daily Grinder/i,
    });
    fireEvent.click(rerollBtn);
    const confirmGroup = await screen.findByRole('group', {
      name: /Confirm Reroll For Daily Grinder/i,
    });
    expect(confirmGroup).not.toBeNull();
    fireEvent.click(within(confirmGroup).getByRole('button', { name: 'Keep It' }));
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: /Confirm Reroll For Daily Grinder/i })).toBeNull()
    );

    // Switch to Weekly subpage and verify cycle state + claimable card
    fireEvent.click(screen.getByRole('tab', { name: /^Weekly/i }));
    await waitFor(() => expect(rootSurface.getAttribute('data-mission-cycle')).toBe('weekly'));
    const weeklyCard = document.getElementById('mission-card-weekly-1');
    expect(weeklyCard).not.toBeNull();
    expect(weeklyCard!.getAttribute('data-casino-realism')).toBe('smarter-casino-realism');
    expect(weeklyCard!.getAttribute('data-mission-state')).toBe('complete');

    // Switch to Monthly subpage and verify cycle state + claimed card
    fireEvent.click(screen.getByRole('tab', { name: /^Monthly/i }));
    await waitFor(() => expect(rootSurface.getAttribute('data-mission-cycle')).toBe('monthly'));
    const monthlyCard = document.getElementById('mission-card-monthly-1');
    expect(monthlyCard).not.toBeNull();
    expect(monthlyCard!.getAttribute('data-casino-realism')).toBe('smarter-casino-realism');
    expect(monthlyCard!.getAttribute('data-mission-state')).toBe('claimed');
  });

  it.each(['rejection', 'network error'])(
    'releases protection after a %s without losing the page',
    async (outcome) => {
      const purchase = deferred<{ success: boolean }>();
      mocks.buyFreeze.mockReturnValue(purchase.promise);
      const { shell, confirm } = await openPurchase();
      fireEvent.click(confirm);
      expect(screen.queryByRole('dialog')).not.toBeNull();
      await act(async () => {
        if (outcome === 'network error') purchase.reject(new Error('unavailable'));
        else purchase.resolve({ success: false });
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(shell.hasAttribute('inert')).toBe(false);
      expect(document.getElementById('daily-missions')).not.toBeNull();
      expect(mocks.error).toHaveBeenCalled();
      expect(mocks.buyFreeze).toHaveBeenCalledTimes(1);
    }
  );

  it('still permits cancellation before a purchase starts', async () => {
    const { shell } = await openPurchase();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(shell.hasAttribute('inert')).toBe(false);
    expect(mocks.buyFreeze).not.toHaveBeenCalled();
  });
});
