/**
 * THE VIP PAGE IS PINNED BEFORE ITS FRAME MOVES
 * (#SmarterDesign player pages batch P6, 2026-11-28)
 *
 * /vip is moving from the Rewards Circuit page bar and the painted shark
 * panels to the arena workspace. The condition on a page that prints a
 * diamond balance and sells features: no figure, word, data hook, named
 * region or control may change, and the Buy keys keep their behaviour. This
 * renders the real page, the real membership plate, the real perks grid and
 * the real Diamond Activity with synthetic reads and pins every one
 * (tests/helpers/surfacePin.ts) in each state the page shows: the first read
 * in flight, a non-member with features to buy, a purchase in flight, a VIP,
 * a Lifetime VIP, an empty activity list, and a balance and activity that
 * could not be read. The page head's title and "?" are the one part the pass
 * replaces; surfacePin leaves them out and reads everything else.
 */
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const LIMITS = {
  rabbitHunts: { used: 12, limit: 100 },
  timeBankSeconds: { used: 40, limit: 120 },
  emojis: { used: 300, limit: 1200 },
  tags: { used: 7, limit: 1000 },
  throwables: { used: 499, limit: 500 },
};

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  status: vi.fn(),
  purchase: vi.fn(),
  profile: vi.fn(),
  ledger: vi.fn(),
}));

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'viewer' } }),
}));
vi.mock('../../src/hooks/usePlayerPreference', () => ({
  usePlayerPreference: <T,>(_key: string, initial: T) => useState<T>(initial),
}));
vi.mock('../../src/hooks/useVipIntroEligibility', () => ({
  VIP_MEMBERSHIP_PURCHASE_PATH: '/marketplace?item=vip',
  vipMembershipPurchaseHref: () => '/hub/club-arena/marketplace?item=vip',
  useVipIntroEligibility: (enabled: boolean) =>
    enabled
      ? { priceLine: 'Your First Month Is 4.99', reasonLine: null }
      : { priceLine: null, reasonLine: null },
}));
vi.mock('../../src/services/VIPService', () => ({
  VIP_MONTHLY_ALLOWANCES: {
    rabbitHunts: 100,
    timeBankSeconds: 120,
    emojis: 1200,
    tags: 1000,
    throwables: 500,
  },
  FEATURE_PRICING: {
    rabbit_hunt: { cost: 5, usageType: 'per_use', description: 'Reveal undealt cards' },
    show_stack_bb: { cost: 5, usageType: 'per_session', description: 'Show stacks in big blinds' },
    offline_protection: { cost: 250, usageType: 'per_session', description: 'Stay seated' },
    theme_unlock: { cost: 50, usageType: 'one_time', description: 'Unlock a theme' },
    club_creation: { cost: 0, usageType: 'one_time', description: 'Create a club' },
  },
  vipService: { checkVIPStatus: mocks.status, purchaseFeature: mocks.purchase },
  normalizeVIPPurchaseError: () => 'Purchase Failed',
}));
vi.mock('../../src/lib/supabase', () => {
  const from = () => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.order = () => builder;
    builder.limit = () => mocks.ledger();
    return builder;
  };
  const profile = () => {
    const builder: Record<string, unknown> = {};
    builder.eq = () => builder;
    builder.select = () => builder;
    builder.maybeSingle = () => mocks.profile();
    return builder;
  };
  return { supabase: { from, rpc: () => profile() } };
});
vi.mock('../../src/utils/errorReporter', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { emit: vi.fn(), subscribeDebounced: vi.fn(() => () => {}) },
}));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => mocks.toast }));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: vi.fn() }));
vi.mock('../../src/components/common/PageSkeleton', () => ({
  default: () => <div role="status" aria-label="Loading content" />,
}));
vi.mock('../../src/components/vip/VIPCardsModal', () => ({ VIPCardsModal: () => null }));
vi.mock('../../src/components/vip/DiamondTopUpModal', () => ({ DiamondTopUpModal: () => null }));
vi.mock('../../src/components/wallet/DiamondWalletModal', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../src/components/wallet/DiamondWalletModal'
  );
  return { ...actual, default: () => null };
});

import VIPPage from '../../src/pages/VIPPage';

const NONE = { isVIP: false, status: 'none', expiresAt: null, monthlyLimits: LIMITS };
const VIP = {
  isVIP: true,
  status: 'vip',
  expiresAt: new Date('2026-12-20T12:00:00Z'),
  monthlyLimits: LIMITS,
};
const LIFETIME = { isVIP: true, status: 'lifetime', expiresAt: null, monthlyLimits: LIMITS };

const LEDGER = [
  {
    id: 'tx-1',
    type: null,
    transaction_type: 'daily_bonus',
    amount: 25,
    player_line: 'Daily Bonus Day 12',
    balance_after: 1275,
    created_at: '2026-11-20T15:00:00Z',
  },
  {
    id: 'tx-2',
    type: 'rabbit_hunt',
    transaction_type: null,
    amount: -5,
    player_line: null,
    balance_after: 1250,
    created_at: '2026-11-19T15:00:00Z',
  },
  {
    id: 'tx-3',
    type: null,
    transaction_type: 'purchase',
    amount: 1000,
    player_line: 'Diamond Package',
    balance_after: null,
    created_at: '2026-10-02T15:00:00Z',
  },
];

function pinFile(name: string) {
  return `./__pins__/vip-${name}.pin.txt`;
}

function pin(container: HTMLElement): string {
  return `${JSON.stringify(surfacePin(container), null, 2)}\n`;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

/** The membership plate and Diamond Activity enter 200 ms after the read. */
async function entered() {
  await screen.findByText('Diamond Activity', {}, { timeout: 2000 });
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockReset().mockResolvedValue(NONE);
  mocks.purchase.mockReset().mockReturnValue(new Promise(() => {}));
  mocks.profile.mockReset().mockResolvedValue({ data: { diamonds: 1275 }, error: null });
  mocks.ledger.mockReset().mockResolvedValue({ data: LEDGER, error: null });
});

afterEach(cleanup);

describe('the VIP page prints the same figures, words and controls', () => {
  it('the first read in flight', async () => {
    mocks.status.mockReturnValue(new Promise(() => {}));
    const { container } = render(<VIPPage />);
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('loading'));
  });

  it('a non-member with features to buy', async () => {
    const { container } = render(<VIPPage />);
    await entered();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('non-member'));
  });

  it('a purchase in flight', async () => {
    const { container } = render(<VIPPage />);
    await entered();
    fireEvent.click(screen.getAllByRole('button', { name: 'Buy' })[0]);
    await screen.findByRole('button', { name: 'Processing' });
    expect(mocks.purchase).toHaveBeenCalledTimes(1);
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('purchasing'));
  });

  it('a VIP', async () => {
    mocks.status.mockResolvedValue(VIP);
    const { container } = render(<VIPPage />);
    await entered();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('member'));
  });

  it('a Lifetime VIP', async () => {
    mocks.status.mockResolvedValue(LIFETIME);
    const { container } = render(<VIPPage />);
    await entered();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('lifetime'));
  });

  it('no diamond activity yet', async () => {
    mocks.ledger.mockResolvedValue({ data: [], error: null });
    mocks.profile.mockResolvedValue({ data: { diamonds: 0 }, error: null });
    const { container } = render(<VIPPage />);
    await entered();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('empty'));
  });

  it('a balance and activity that could not be read', async () => {
    mocks.profile.mockResolvedValue({ data: null, error: { message: 'denied' } });
    mocks.ledger.mockResolvedValue({ data: null, error: { message: 'denied' } });
    const { container } = render(<VIPPage />);
    await entered();
    await screen.findByRole('button', { name: 'Retry Diamond Activity' });
    await expect(pin(container)).toMatchFileSnapshot(pinFile('failed'));
  });
});
