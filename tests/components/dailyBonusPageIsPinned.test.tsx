/**
 * THE DAILY BONUS PAGE IS PINNED BEFORE ITS FRAME MOVES
 * (#SmarterDesign player pages batch P6, 2026-11-28)
 *
 * /bonuses is moving from the Rewards Circuit header's painted console to the
 * arena workspace. The condition on a page that pays rewards: no reward
 * figure, word, data hook, named region or control may change, and the claim
 * key keeps its behaviour. This renders the real page and the real sheet with
 * a synthetic status read and pins the sheet (tests/helpers/surfacePin.ts) in
 * every state it shows: the first read in flight, failed, not available on
 * this account, claimable, a claim in flight, and already claimed. The head
 * around the sheet is the one part the pass replaces, so the pin reads the
 * sheet itself; the head's words are held by the last case.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  claimAll: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../src/stores/useUserStore', () => ({
  useUserStore: (select: (state: unknown) => unknown) => select({ user: { id: 'viewer' } }),
}));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => mocks.toast }));
vi.mock('../../src/services/HapticService', () => ({ triggerHaptic: () => true }));
vi.mock('../../src/utils/playPremiumSfx', () => ({ playPremiumSfx: () => undefined }));
vi.mock('../../src/utils/errorReporter', () => ({
  reportError: () => undefined,
  reportWarning: () => undefined,
}));
vi.mock('../../src/components/table/ThrowableImage', () => ({
  ThrowableImage: ({ throwableId }: { throwableId: string }) => (
    <img alt="" data-id={throwableId} />
  ),
}));
vi.mock('../../src/services/DailyBonusService', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/DailyBonusService')>(
    '../../src/services/DailyBonusService'
  );
  return {
    ...actual,
    dailyBonusService: {
      getStatus: mocks.getStatus,
      claim: vi.fn(),
      claimAll: mocks.claimAll,
      markShown: vi.fn(async () => undefined),
      requestIdFor: () => 'req',
    },
  };
});

import DailyBonusPage from '../../src/pages/DailyBonusPage';

const tile = (over: Record<string, unknown>) => ({
  slot: 1,
  kind: 'diamonds',
  label: 'Diamonds',
  vip_only: false,
  quantity: 0,
  base_diamonds: 5,
  diamonds: 5,
  claimed: false,
  claimed_at: null,
  granted: null,
  locked: false,
  capped: false,
  ...over,
});

const TILES = [
  tile({ slot: 1 }),
  tile({
    slot: 2,
    kind: 'rabbit_hunts',
    label: 'Rabbit Hunt',
    quantity: 1,
    base_diamonds: 0,
    diamonds: 0,
  }),
  tile({ slot: 3, kind: 'mystery', label: 'Mystery Tile', base_diamonds: 0, diamonds: 0 }),
  tile({ slot: 4, capped: true, base_diamonds: 25, diamonds: 25 }),
  tile({
    slot: 5,
    label: 'VIP Bonus',
    vip_only: true,
    base_diamonds: 10,
    diamonds: 10,
    locked: true,
  }),
];

const STATUS = {
  eligible: true,
  today: '2026-09-08',
  reset_at: '2026-09-09T05:00:00+00:00',
  seconds_to_reset: 5025,
  streak: 12,
  cycle_day: 5,
  streak_day: null,
  multiplier: 1.5,
  is_vip: false,
  claimed_today: false,
  shown_today: true,
  unclaimed: 4,
  tiles: TILES,
  week: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    streak: day + 7,
    diamonds: day * 7,
    extras: null,
    chest: day === 7,
    has_spin: day === 3,
    state: day < 5 ? 'done' : day === 5 ? 'today' : 'upcoming',
  })),
  tomorrow: [
    { kind: 'diamonds', label: 'Diamonds', vip_only: false, quantity: 0, diamonds: 10 },
    { kind: 'time_bank', label: 'Time Bank', vip_only: false, quantity: 2, diamonds: 0 },
  ],
  caps: {
    daily_cap: 110,
    daily_used: 35,
    daily_remaining: 75,
    monthly_cap: 3300,
    monthly_used: 400,
    monthly_remaining: 2900,
    bonus_monthly_cap: 3750,
    bonus_monthly_used: 0,
    bonus_monthly_remaining: 3750,
    frozen: false,
  },
  cents_per_diamond: 1,
  shield: { held: 2, expires_at: '2026-09-20T05:00:00+00:00' },
  boost: { active: false },
  streak_protected: true,
  bonus_spins_held: 1,
};

const CLAIMED = {
  ...STATUS,
  claimed_today: true,
  unclaimed: 0,
  tiles: TILES.map((t) =>
    t.locked
      ? t
      : {
          ...t,
          claimed: true,
          claimed_at: '2026-09-08T12:00:00+00:00',
          granted:
            t.kind === 'diamonds'
              ? { kind: 'diamonds', diamonds: t.diamonds, quantity: 0, balance_after: 505 }
              : t.kind === 'mystery'
                ? { kind: 'diamonds', diamonds: 15, quantity: 0, lucky: 3, balance_after: 520 }
                : { kind: t.kind, diamonds: 0, quantity: t.quantity },
        }
  ),
};

function pinFile(name: string) {
  return `./__pins__/daily-bonus-${name}.pin.txt`;
}

function pin(container: HTMLElement): string {
  const sheet = container.querySelector('.dbs') as HTMLElement;
  return `${JSON.stringify(surfacePin(sheet), null, 2)}\n`;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/bonuses']}>
      <DailyBonusPage />
    </MemoryRouter>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStatus.mockReset().mockResolvedValue(STATUS);
  mocks.claimAll.mockReset().mockReturnValue(new Promise(() => {}));
});

afterEach(cleanup);

describe('the Daily Bonus page prints the same rewards, words and controls', () => {
  it('the first read in flight', async () => {
    mocks.getStatus.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('loading'));
  });

  it('failed', async () => {
    mocks.getStatus.mockRejectedValue(new Error('Could Not Load Your Daily Bonus'));
    const { container } = mount();
    await screen.findByRole('button', { name: 'Try Again' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('failed'));
  });

  it('not available on this account', async () => {
    mocks.getStatus.mockResolvedValue({ ...STATUS, eligible: false, tiles: [] });
    const { container } = mount();
    await screen.findByText('The Daily Bonus Is Not Available On This Account.');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('unavailable'));
  });

  it('claimable', async () => {
    const { container } = mount();
    await screen.findByRole('button', { name: 'Claim All' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('claimable'));
  });

  it('one reward left to claim', async () => {
    mocks.getStatus.mockResolvedValue({
      ...CLAIMED,
      claimed_today: false,
      unclaimed: 1,
      tiles: CLAIMED.tiles.map((t) =>
        t.slot === 4 ? { ...t, claimed: false, claimed_at: null, granted: null } : t
      ),
    });
    const { container } = mount();
    await screen.findByRole('button', { name: 'Claim Reward' });
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('one-left'));
  });

  it('a claim in flight', async () => {
    const { container } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Claim All' }));
    await screen.findByRole('button', { name: 'Claiming' });
    expect(mocks.claimAll).toHaveBeenCalledTimes(1);
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('claiming'));
  });

  it('already claimed today', async () => {
    mocks.getStatus.mockResolvedValue(CLAIMED);
    const { container } = mount();
    await screen.findByText('Streak Locked In For Today.');
    expect(screen.queryByRole('button', { name: /^Claim/ })).toBeNull();
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('claimed'));
  });

  it('keeps the page title and the account-keyed sheet', async () => {
    const { container } = mount();
    await screen.findByRole('button', { name: 'Claim All' });
    expect(container.textContent).toContain('Daily Bonus');
    expect(container.querySelectorAll('.dbs')).toHaveLength(1);
    expect(container.querySelector('.daily-bonus-page')).not.toBeNull();
  });
});
