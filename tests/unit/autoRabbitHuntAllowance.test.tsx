/**
 * AUTO RUN SAYS WHAT IT SPENDS (2026-11-02): the setting names the order it
 * draws on, and a VIP sees their live allowance under it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

const fetchPreview = vi.fn();
vi.mock('@/services/rabbitHuntPricing', async (orig) => ({
  ...(await orig<typeof import('@/services/rabbitHuntPricing')>()),
  fetchRabbitHuntChargePreview: (...a: unknown[]) => fetchPreview(...a),
}));
const vip = { isVIP: true, isLoading: false };
vi.mock('@/hooks/useVIP', () => ({ useVIPStatus: () => vip }));

import { TableSettingsPanel } from '@/components/table/TableSettingsPanel';
import { DEFAULT_USER_TABLE_SETTINGS, TABLE_SETTINGS_META } from '@/hooks/useUserTableSettings';

afterEach(() => {
  cleanup();
  fetchPreview.mockReset();
});

describe('Auto Run Rabbit Hunt explains its cost', () => {
  it('the description names the order it draws on', () => {
    const meta = TABLE_SETTINGS_META.find((m) => m.key === 'auto_rabbit_hunt');
    expect(meta?.description).toMatch(
      /Unlimited With Lifetime VIP, 100 A Month With VIP, Then Credits, Then Diamonds/
    );
  });
  it('a VIP sees the live allowance under the setting', async () => {
    vip.isVIP = true;
    fetchPreview.mockResolvedValue({ source: 'vip_allowance', vipRemaining: 42, creditsLeft: 2 });
    const ui = render(
      <TableSettingsPanel
        settings={DEFAULT_USER_TABLE_SETTINGS}
        loading={false}
        onToggle={() => {}}
        mode="inline"
      />
    );
    expect((await ui.findByTestId('auto-rabbit-allowance')).textContent).toBe(
      '42 VIP Rabbit Hunts Left This Month · 2 Credits'
    );
  });
  it('a non-VIP is not asked about an allowance', () => {
    vip.isVIP = false;
    const ui = render(
      <TableSettingsPanel
        settings={DEFAULT_USER_TABLE_SETTINGS}
        loading={false}
        onToggle={() => {}}
        mode="inline"
      />
    );
    expect(ui.queryByTestId('auto-rabbit-allowance')).toBeNull();
    expect(fetchPreview).not.toHaveBeenCalled();
  });
});
