import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Dan, 2026-11-26: "the first month should be $1 and then $20 a month after
   that, they can cancel anytime." The membership tab shows it; these pin the
   shared answer every OTHER upgrade prompt prints, and the prompts themselves.
   The rule that matters most: a price is printed only on the server's say-so,
   and "could not tell" prints nothing. */

const fetchStatus = vi.fn();
const native = vi.fn(() => false);

vi.mock('../../src/pages/marketplace/marketplaceShared', () => ({
  fetchVipIntroOfferStatus: (...args: unknown[]) => fetchStatus(...args),
}));
vi.mock('../../src/utils/hubMarketplace', () => ({
  usesInAppStorefront: () => native(),
}));

import { useUserStore } from '../../src/stores/useUserStore';
import {
  VIP_INTRO_PRICE_LINE,
  VIP_INTRO_UNKNOWN_RETRY_MS,
  VIP_INTRO_VERIFY_CONTACT_LINE,
  VIP_MEMBERSHIP_PURCHASE_PATH,
  VIP_REGULAR_PRICE_LINE,
  clearVipIntroEligibilityCache,
  peekVipIntroEligibility,
  readVipIntroEligibility,
  useVipIntroEligibility,
  vipUpgradePriceLine,
  vipUpgradeReasonLine,
  withVipUpgradePrice,
} from '../../src/hooks/useVipIntroEligibility';
import { formatPopupText } from '../../src/utils/popupStyle';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const signIn = (id: string | null) =>
  act(() => {
    useUserStore.setState({ user: id ? ({ id, username: 'p' } as never) : null });
  });
const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

beforeEach(() => {
  fetchStatus.mockReset();
  native.mockReset();
  native.mockReturnValue(false);
  signIn(null);
  clearVipIntroEligibilityCache();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the first-month price line', () => {
  it('words the amounts in USD with no currency symbol, Title Case, no em dash', () => {
    expect(VIP_INTRO_PRICE_LINE).toBe('First Month 1 USD, Then 20 USD Per Month. Cancel Anytime.');
    expect(VIP_REGULAR_PRICE_LINE).toBe('20 USD Per Month. Cancel Anytime.');
    for (const line of [
      VIP_INTRO_PRICE_LINE,
      VIP_REGULAR_PRICE_LINE,
      VIP_INTRO_VERIFY_CONTACT_LINE,
    ]) {
      expect(line).not.toContain('$');
      expect(line).not.toContain('—');
      expect(formatPopupText(line)).toBe(line);
    }
  });

  it('prints the 1 USD line only for eligible, 20 USD for ineligible, nothing for unknown', () => {
    expect(vipUpgradePriceLine(true, false)).toBe(VIP_INTRO_PRICE_LINE);
    expect(vipUpgradePriceLine(false, false)).toBe(VIP_REGULAR_PRICE_LINE);
    expect(vipUpgradePriceLine(null, false)).toBeNull();
  });

  it('prints no price at all inside the native app', () => {
    expect(vipUpgradePriceLine(true, true)).toBeNull();
    expect(vipUpgradePriceLine(false, true)).toBeNull();
    expect(vipUpgradeReasonLine({ eligible: false, reason: 'verify_contact' }, true)).toBeNull();
  });

  it('passes a server reason through, and an absent reason changes nothing', () => {
    expect(vipUpgradeReasonLine({ eligible: false, reason: 'verify_contact' }, false)).toBe(
      'Verify Your Email Or Phone To Unlock The 1 USD First Month'
    );
    expect(vipUpgradeReasonLine({ eligible: false, reason: null }, false)).toBeNull();
    expect(vipUpgradeReasonLine({ eligible: false, reason: 'something_else' }, false)).toBeNull();
    expect(vipUpgradeReasonLine({ eligible: true, reason: 'verify_contact' }, false)).toBeNull();
    expect(vipUpgradeReasonLine({ eligible: null, reason: 'verify_contact' }, false)).toBeNull();
  });

  it('leaves a sentence alone when there is no price to add', () => {
    expect(withVipUpgradePrice('Needs VIP.', null)).toBe('Needs VIP.');
    expect(withVipUpgradePrice('Needs VIP.', 'X')).toBe('Needs VIP. X');
  });

  it('sends the player to the membership tab with Monthly in view', () => {
    expect(VIP_MEMBERSHIP_PURCHASE_PATH).toBe('/marketplace?tab=membership&plan=vip-monthly');
  });
});

describe('useVipIntroEligibility', () => {
  it('eligible: shows the 1 USD first month', async () => {
    fetchStatus.mockResolvedValue({ eligible: true, reason: null });
    signIn(ALICE);
    const { result } = renderHook(() => useVipIntroEligibility());
    expect(result.current.priceLine).toBeNull();
    await waitFor(() => expect(result.current.eligible).toBe(true));
    expect(result.current.priceLine).toBe(VIP_INTRO_PRICE_LINE);
    expect(fetchStatus).toHaveBeenCalledWith(ALICE);
  });

  it('ineligible: shows the regular price and the reason the server gave', async () => {
    fetchStatus.mockResolvedValue({ eligible: false, reason: 'verify_contact' });
    signIn(ALICE);
    const { result } = renderHook(() => useVipIntroEligibility());
    await waitFor(() => expect(result.current.eligible).toBe(false));
    expect(result.current.priceLine).toBe(VIP_REGULAR_PRICE_LINE);
    expect(result.current.reason).toBe('verify_contact');
    expect(result.current.reasonLine).toBe(VIP_INTRO_VERIFY_CONTACT_LINE);
  });

  it('unknown: shows no price, whether the server could not say or the read threw', async () => {
    fetchStatus.mockResolvedValueOnce({ eligible: null, reason: null });
    signIn(ALICE);
    const first = renderHook(() => useVipIntroEligibility());
    await waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(first.result.current.eligible).toBeNull();
    expect(first.result.current.priceLine).toBeNull();

    clearVipIntroEligibilityCache();
    fetchStatus.mockRejectedValueOnce(new Error('offline'));
    await expect(readVipIntroEligibility(ALICE)).resolves.toEqual({ eligible: null, reason: null });
  });

  it('an unknown answer is not kept for the session: it is asked again after the wait', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    fetchStatus.mockResolvedValueOnce({ eligible: null, reason: null });
    fetchStatus.mockResolvedValueOnce({ eligible: true, reason: null });
    signIn(ALICE);
    await readVipIntroEligibility(ALICE);
    await readVipIntroEligibility(ALICE);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + VIP_INTRO_UNKNOWN_RETRY_MS + 1);
    await expect(readVipIntroEligibility(ALICE)).resolves.toEqual({ eligible: true, reason: null });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('native: never asks and never shows a price', async () => {
    native.mockReturnValue(true);
    fetchStatus.mockResolvedValue({ eligible: true, reason: null });
    signIn(ALICE);
    const { result } = renderHook(() => useVipIntroEligibility());
    await act(async () => {});
    expect(result.current.eligible).toBeNull();
    expect(result.current.priceLine).toBeNull();
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('signed out or disabled: never asks', async () => {
    fetchStatus.mockResolvedValue({ eligible: true, reason: null });
    const signedOut = renderHook(() => useVipIntroEligibility());
    await act(async () => {});
    expect(signedOut.result.current.priceLine).toBeNull();
    signedOut.unmount();
    signIn(ALICE);
    const disabled = renderHook(() => useVipIntroEligibility(false));
    await act(async () => {});
    expect(disabled.result.current.priceLine).toBeNull();
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('one request serves every surface: concurrent and later mounts share it', async () => {
    let release: (value: { eligible: boolean; reason: null }) => void = () => {};
    fetchStatus.mockReturnValue(
      new Promise((resolvePromise) => {
        release = resolvePromise;
      })
    );
    signIn(ALICE);
    const a = renderHook(() => useVipIntroEligibility());
    const b = renderHook(() => useVipIntroEligibility());
    const c = renderHook(() => useVipIntroEligibility());
    await waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
    await act(async () => release({ eligible: true, reason: null }));
    await waitFor(() => expect(c.result.current.eligible).toBe(true));
    expect(a.result.current.priceLine).toBe(VIP_INTRO_PRICE_LINE);
    expect(b.result.current.priceLine).toBe(VIP_INTRO_PRICE_LINE);

    const later = renderHook(() => useVipIntroEligibility());
    expect(later.result.current.priceLine).toBe(VIP_INTRO_PRICE_LINE);
    await act(async () => {});
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it('account change: the next account never sees the last one’s answer', async () => {
    fetchStatus.mockImplementation(async (id: string) => ({
      eligible: id === ALICE,
      reason: null,
    }));
    signIn(ALICE);
    const { result } = renderHook(() => useVipIntroEligibility());
    await waitFor(() => expect(result.current.priceLine).toBe(VIP_INTRO_PRICE_LINE));

    signIn(BOB);
    expect(result.current.priceLine).not.toBe(VIP_INTRO_PRICE_LINE);
    expect(peekVipIntroEligibility(ALICE)).toEqual({ eligible: null, reason: null });
    await waitFor(() => expect(result.current.priceLine).toBe(VIP_REGULAR_PRICE_LINE));
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('sign-out clears the cache, and an answer in flight across it is dropped', async () => {
    let release: (value: { eligible: boolean; reason: null }) => void = () => {};
    fetchStatus.mockReturnValueOnce(
      new Promise((resolvePromise) => {
        release = resolvePromise;
      })
    );
    signIn(ALICE);
    const pending = readVipIntroEligibility(ALICE);
    signIn(null);
    release({ eligible: true, reason: null });
    await expect(pending).resolves.toEqual({ eligible: null, reason: null });
    expect(peekVipIntroEligibility(ALICE)).toEqual({ eligible: null, reason: null });

    fetchStatus.mockResolvedValueOnce({ eligible: false, reason: null });
    signIn(ALICE);
    await expect(readVipIntroEligibility(ALICE)).resolves.toEqual({
      eligible: false,
      reason: null,
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });
});

describe('the surfaces that ask a non-member to go VIP', () => {
  const hook = read('src/hooks/useVipIntroEligibility.ts');

  it('the hook loads the storefront on demand and reads the reason-carrying status', () => {
    expect(hook).toContain("import('../pages/marketplace/marketplaceShared')");
    expect(hook).not.toMatch(/^import .*marketplaceShared/m);
    expect(hook).toContain('shared.fetchVipIntroOfferStatus(userId)');
    expect(hook).toContain('useUserStore.subscribe(');
  });

  it('the status read passes a server reason through and still fails closed', () => {
    const shared = read('src/pages/marketplace/marketplaceShared.ts');
    expect(shared).toContain('export async function fetchVipIntroOfferStatus(');
    expect(shared).toContain("typeof offer.eligible !== 'boolean' ||");
    expect(shared).toContain('offer.firstPeriodCents !== VIP_INTRO_OFFER.firstPeriodCents ||');
    expect(shared).toContain('return { eligible: offer.eligible, reason };');
    expect(shared).toContain('return (await fetchVipIntroOfferStatus(userId, signal)).eligible;');
  });

  it('the benefits sheet prints the price and links straight to the membership tab', () => {
    const modal = read('src/components/vip/VIPCardsModal.tsx');
    expect(modal).toContain('useVipIntroEligibility(isOpen && !isVIP)');
    expect(modal).toContain('`Or Join Club Arena For A Membership. ${vipIntro.priceLine}`');
    expect(modal).toContain('appNavigate(VIP_MEMBERSHIP_PURCHASE_PATH);');
    expect(modal).not.toContain('href="/hub/vip-membership"');
  });

  it('the VIP page prints the price only once it knows the account is not a member', () => {
    const page = read('src/pages/VIPPage.tsx');
    expect(page).toContain('useVipIntroEligibility(pageReady && !isVIP)');
    expect(page).toContain("{vipIntro.priceLine ? ` ${vipIntro.priceLine}` : ''}");
    expect(page).toContain('appNavigate(VIP_MEMBERSHIP_PURCHASE_PATH);');
    expect(page).toContain('Get VIP Membership');
  });

  it('the profile membership row prints the price and its button opens the purchase', () => {
    const profile = read('src/pages/ProfilePage.tsx');
    expect(profile).toContain("!!user && user.vipStatus === 'none'");
    expect(profile).toContain(
      "(vipIntro.priceLine ?? 'Membership Benefits Are Open On The VIP Page')"
    );
    expect(profile).toContain(
      "navigate(user.vipStatus === 'none' ? VIP_MEMBERSHIP_PURCHASE_PATH : '/vip')"
    );
  });

  it('the All In Squeeze upsell carries the price only when one is known', () => {
    const panel = read('src/components/table/TableSettingsPanel.tsx');
    expect(panel).toContain('useVipIntroEligibility(!isVIP && !vipLoading)');
    expect(panel).toContain('withVipUpgradePrice(ALL_IN_SQUEEZE_VIP_REQUIRED_MESSAGE, priceLine)');
    expect(panel).toContain('announceVipRequired(vipIntro.priceLine);');
  });

  it('the previous-hand Rabbit Hunt note, the premium locks and the unlock prompt carry it', () => {
    const hand = read('src/components/table/HandDetailModal.tsx');
    expect(hand).toContain('useVipIntroEligibility(vipNoteInsteadOfButton && !hidden)');
    expect(hand).toContain('VIP {vipIntro.priceLine}');
    const gallery = read('src/components/customization/AvatarGallery.tsx');
    expect(gallery).toContain('useVipIntroEligibility(!isVip)');
    expect(gallery.match(/withVipUpgradePrice\(/g)?.length).toBe(3);
    const studio = read('src/components/table/ThemeSettingsModal.tsx');
    expect(studio).toContain('useVipIntroEligibility(!isVip && pendingAssetPurchase !== null)');
    expect(studio).toContain('VIP Members Use Every Premium Design. VIP ${vipIntro.priceLine}');
  });

  it('the shell badge no longer sends a non-member to the Diamond tab', () => {
    const shell = read('src/components/Shell.tsx');
    expect(shell).toContain("navigate(isVIP ? '/vip' : VIP_MEMBERSHIP_PURCHASE_PATH);");
  });

  it('no surface outside the membership tab starts a checkout or prints a currency symbol', () => {
    for (const file of [
      'src/components/vip/VIPCardsModal.tsx',
      'src/pages/VIPPage.tsx',
      'src/components/table/TableSettingsPanel.tsx',
      'src/components/table/HandDetailModal.tsx',
      'src/components/Shell.tsx',
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/startCheckout|subscriptionCheckoutOfferConfirmation/);
      expect(source).not.toMatch(/\$\s?1\b|\$\s?20\b/);
    }
  });
});

describe('where the purchase address lands', () => {
  it('the web route opens the World Hub membership page on the Monthly plan', async () => {
    const actual = await vi.importActual<typeof import('../../src/utils/hubMarketplace')>(
      '../../src/utils/hubMarketplace'
    );
    expect(actual.hubMarketplaceDestination(VIP_MEMBERSHIP_PURCHASE_PATH.split('?')[1])).toBe(
      '/hub/vip-membership?plan=vip-monthly'
    );
  });
});
