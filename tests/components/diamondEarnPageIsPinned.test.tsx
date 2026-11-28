/**
 * THE EARN DIAMONDS PAGE IS PINNED BEFORE ITS FRAME MOVES
 * (#SmarterDesign batch D1, 2026-11-28)
 *
 * /clubs/:clubId/earn-diamonds is moving from three kinds of painted console
 * to the arena workspace. The condition on a page that pays diamonds: no
 * diamond amount, allowance, word, data hook, live region or control (with its
 * name and state) may change, and Refresh and Copy Invite Link keep their
 * behaviour. This renders the real page with a synthetic earning guide and
 * pins it (tests/helpers/reflowedSurfacePin.ts) in every state it shows: the
 * first read in flight, failed, ready with a referral link, paused with the
 * month used, a referral with no code yet, and the link copied.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reflowedSurfacePin } from '../helpers/reflowedSurfacePin';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  writeClipboard: vi.fn(),
}));

vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'viewer' } }),
}));
vi.mock('../../src/lib/share', () => ({ writeClipboard: mocks.writeClipboard }));
vi.mock('../../src/utils/errorReporter', () => ({
  reportError: () => undefined,
  reportWarning: () => undefined,
}));

import DiamondEarnPage from '../../src/pages/DiamondEarnPage';

const action = (key: string, diamonds: number, max: number, category: string) => ({
  key,
  diamonds,
  base_diamonds: diamonds,
  max_per_day: max,
  category,
});

const GUIDE = {
  ok: true,
  daily_cap: 150,
  daily_used: 35,
  daily_remaining: 115,
  monthly_remaining: 2900,
  frozen: false,
  referral_diamonds: 500,
  referral_code: 'KINGFISH42',
  actions: [
    action('social_post', 10, 3, 'social'),
    action('share_content', 5, 4, 'social'),
    action('strategy_comment', 8, 5, 'social'),
    action('reaction', 1, 20, 'social'),
    action('follow', 2, 10, 'social'),
    action('video_watch', 15, 2, 'video'),
    action('video_favorite', 3, 5, 'video'),
    action('training_level_complete', 25, 2, 'training'),
    action('gto_chart_study', 12, 3, 'training'),
    action('daily_trivia_challenge', 20, 1, 'training'),
  ],
};

function pinFile(name: string) {
  return `./__pins__/diamond-earn-${name}.pin.txt`;
}

function pin(container: HTMLElement): string {
  return `${JSON.stringify(reflowedSurfacePin(container), null, 2)}\n`;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/clubs/kings-club/earn-diamonds']}>
      <Routes>
        <Route path="/clubs/:clubId/earn-diamonds" element={<DiamondEarnPage />} />
      </Routes>
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
  mocks.rpc.mockReset().mockResolvedValue({ data: GUIDE, error: null });
  mocks.writeClipboard.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('the Earn Diamonds page prints the same diamonds, words and controls', () => {
  it('the first read in flight', async () => {
    mocks.rpc.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('loading'));
  });

  it('failed', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('down') });
    const { container } = mount();
    await screen.findByText('Your Earning Guide Could Not Be Loaded. Try Again.');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('failed'));
  });

  it('ready, with a referral link', async () => {
    const { container } = mount();
    await screen.findByText('Create A Post');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('ready'));
  });

  it('paused, with the month used and no referral offer', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ...GUIDE,
        frozen: true,
        monthly_remaining: 0,
        daily_used: 150,
        daily_remaining: 0,
        referral_diamonds: null,
        referral_code: null,
        actions: GUIDE.actions.slice(0, 2),
      },
      error: null,
    });
    const { container } = mount();
    await screen.findByText('Diamond Rewards Are Paused Right Now.');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('paused'));
  });

  it('a referral offer with no code yet', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...GUIDE, referral_code: null }, error: null });
    const { container } = mount();
    await screen.findByText('Refer A Friend');
    await settle();
    expect(
      (screen.getByRole('button', { name: 'Copy Invite Link' }) as HTMLButtonElement).disabled
    ).toBe(true);
    await expect(pin(container)).toMatchFileSnapshot(pinFile('no-code'));
  });

  it('the link copied', async () => {
    const { container } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy Invite Link' }));
    await screen.findByRole('button', { name: 'Link Copied' });
    expect(mocks.writeClipboard).toHaveBeenCalledWith('https://smarter.poker/?ref=KINGFISH42');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('copied'));
  });

  it('Refresh reads the guide again, and Open Activity opens the activity', async () => {
    mount();
    await screen.findByText('Create A Post');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Create A Post');
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenLastCalledWith('fn_diamond_spins_earn_guide');
    expect(screen.getAllByRole('button', { name: 'Open Activity' })).toHaveLength(10);
  });

  it('keeps the page title and its way back to Diamond Spins', async () => {
    const { container } = mount();
    await screen.findByText('Create A Post');
    expect(container.textContent).toContain('Earn Diamonds');
    expect(screen.getByRole('button', { name: '‹ Diamond Spins' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Diamond Spins' })).toBeTruthy();
  });
});
