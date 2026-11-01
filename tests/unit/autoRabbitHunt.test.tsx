/**
 * AUTO RUN RABBIT HUNT (Dan 2026-11-01)
 *
 * "There should be two features inside the rabbit hunt functionality. Where
 * you can AUTO RUN RABBIT HUNT to always show the run out at the end of a
 * hand." This file drives the first one: a per-player switch
 * (user_table_settings.auto_rabbit_hunt) that makes the felt tile press
 * ITSELF the moment an offer lands.
 *
 * The press is the SAME single-flight, server-charged reveal a tap makes —
 * useRabbitHuntReveal, toasts and billing included — so there is no second
 * money path to drift. What is under test here is only the trigger: it fires
 * once per offer, it never fires for a guest (nobody to bill, and an
 * automatic "Please Log In" toast on every hand would be noise), and it
 * never fires with the switch off.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../src/hooks/useButtonImage', () => ({
  useButtonImage: () => '/rabbit.webp',
  useTimebankIcon: () => '/time-bank.webp',
}));

vi.mock('../../src/services/VIPService', () => ({
  FEATURE_PRICING: { rabbit_hunt: { cost: 5 } },
  vipService: {
    checkVIPStatus: vi.fn().mockResolvedValue({
      isVIP: false,
      monthlyLimits: { rabbitHunts: { used: 0, limit: 0 } },
    }),
  },
}));

const toast = { error: vi.fn(), info: vi.fn() };
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => toast }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import RabbitHunt from '../../src/components/table/RabbitHunt';
import {
  DEFAULT_USER_TABLE_SETTINGS,
  TABLE_SETTINGS_META,
} from '../../src/hooks/useUserTableSettings';
import { __resetRabbitEntitlementCache } from '../../src/components/table/rabbitEntitlement';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetRabbitEntitlementCache();
});

const tile = (over: Partial<React.ComponentProps<typeof RabbitHunt>> = {}) => (
  <RabbitHunt
    isAvailable={true}
    cardsAvailable={2}
    rabbitDiamondCost={5}
    userId="player-1"
    onReveal={vi.fn()}
    {...over}
  />
);

describe('the switch presses the same reveal a thumb presses', () => {
  it('fires once, with no tap, the moment the offer is up', async () => {
    const onReveal = vi
      .fn()
      .mockResolvedValue({ success: true, cards: [{ rank: 'A', suit: 's' }], diamondsSpent: 5 });
    render(tile({ autoRun: true, onReveal }));
    await waitFor(() => expect(onReveal).toHaveBeenCalledTimes(1));
  });

  it('a re-render while the first press settles does not press twice', async () => {
    let resolveReveal!: (v: unknown) => void;
    const pending = new Promise((r) => {
      resolveReveal = r;
    });
    const onReveal = vi.fn().mockReturnValue(pending);
    const { rerender } = render(tile({ autoRun: true, onReveal }));
    await waitFor(() => expect(onReveal).toHaveBeenCalledTimes(1));
    rerender(tile({ autoRun: true, onReveal, cardsAvailable: 2 }));
    rerender(tile({ autoRun: true, onReveal, rabbitDiamondCost: 5 }));
    expect(onReveal).toHaveBeenCalledTimes(1);
    resolveReveal({ success: true, cards: [{ rank: 'A', suit: 's' }], diamondsSpent: 5 });
    await waitFor(() => expect(onReveal).toHaveBeenCalledTimes(1));
  });

  it('never fires for a guest - there is nobody to bill', async () => {
    const onReveal = vi.fn();
    render(tile({ autoRun: true, userId: null, onReveal }));
    await new Promise((r) => setTimeout(r, 30));
    expect(onReveal).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('never fires with the switch off - the tap keeps working as before', async () => {
    const onReveal = vi.fn();
    render(tile({ onReveal }));
    await new Promise((r) => setTimeout(r, 30));
    expect(onReveal).not.toHaveBeenCalled();
  });
});

describe('the setting itself', () => {
  it('is OFF by default - a reveal can cost diamonds, so auto is opted into', () => {
    expect(DEFAULT_USER_TABLE_SETTINGS.auto_rabbit_hunt).toBe(false);
  });

  it('has a reachable switch in the settings list', () => {
    const row = TABLE_SETTINGS_META.find((m) => m.key === 'auto_rabbit_hunt');
    expect(row, 'no TABLE_SETTINGS_META row').toBeTruthy();
    expect(row!.label).toBe('Auto Run Rabbit Hunt');
    expect(row!.description.length).toBeGreaterThan(0);
  });

  it('TablePage wires the switch to the tile, and auto keeps the HUD slot live', () => {
    const page = read('src/pages/TablePage.tsx').replace(/\s+/g, '');
    expect(page).toContain('autoRun={v8Settings.auto_rabbit_hunt}');
    // Auto IS the player asking for the runout, so hiding the manual button
    // must not silence the automatic one.
    expect(page).toContain(
      'rabbitEnabled:v8Settings.rabbit_hunt_button||v8Settings.auto_rabbit_hunt'
    );
  });

  it('is relayed across devices like every other table setting', () => {
    expect(read('src/services/PostgresSyncHooks.ts')).toContain("'auto_rabbit_hunt'");
  });
});
