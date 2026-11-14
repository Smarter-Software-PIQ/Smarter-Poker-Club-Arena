/**
 * THE TOTAL PRIZE POOL IS EVERYTHING PUT IN, AND EVERY ROW SAYS WHO REBOUGHT
 * (Dan 2026-10-24).
 *
 *   "REWARDS PAGE SHOULD HAVE THE TOTAL PRIZE POOL INSIDE OF IT. THE TOTAL OF
 *    ALL THE BUY IN'S REBUYS AND ADD ON'S."
 *
 *   "INSIDE THE RANKING IT SHOULD TELL YOU HOW MANY TIMES THE REBOUGHT AND IF
 *    THEY ADDED ON AS WELL. THAT SHOULD BE IN THE RANKING AND INSIDE THE
 *    ENTRIES"
 *
 * Friday Fight Night PKO (827A1B52) as production recorded it: 276 entries,
 * 9 rebuys, 221 add-ons; buy-in 27 + 3 fee, rebuy 30, add-on 30 (no fee).
 * The server split that into prize_pool 10,050 and bounty_pool 4,275 and the
 * Rewards headline printed only the 10,050.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  TournamentEntry,
  TournamentTabProps,
} from '../../src/components/tournament/details/types';

const funding = vi.hoisted(() => ({
  current: { collected: 14325, overlay: 0 } as Record<string, number>,
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn((_name, args) => ({
      abortSignal: () =>
        Promise.resolve({
          data: { tournament_id: args.p_tournament_id, ...funding.current },
          error: null,
        }),
    })),
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/components/tournament/MysteryBountyPanel', () => ({ default: () => null }));

import RewardsTab from '../../src/components/tournament/details/RewardsTab';
import BuyInMarks from '../../src/components/tournament/details/BuyInMarks';

afterEach(() => {
  cleanup();
  funding.current = { collected: 14325, overlay: 0 };
});

const ROOT = join(__dirname, '..', '..');

/** 276 entries; the first 9 rebought once, the first 221 took the add-on. */
const ENTRIES: TournamentEntry[] = Array.from({ length: 276 }, (_, i) => ({
  id: `p${i}`,
  user_id: `u${i}`,
  username: `player${i}`,
  avatar_url: null,
  chips: i < 81 ? 200000 : 0,
  status: i < 81 ? 'playing' : 'eliminated',
  position: i < 81 ? undefined : 276 - (i - 81),
  rebuys: i < 9 ? 1 : 0,
  add_ons: i < 221 ? 1 : 0,
})) as TournamentEntry[];

function props(overrides: Record<string, unknown> = {}): TournamentTabProps {
  return {
    tournament: {
      id: '827a1b52-2814-4998-9b47-8c4afea22418',
      name: '3K GTD Friday Fight Night PKO',
      status: 'RUNNING',
      format_contract: 'mtt-v2',
      variant: 'progressive_bounty',
      tournament_type: 'MTT',
      is_bounty: true,
      is_pko: true,
      is_mystery_bounty: false,
      current_players: 81,
      prize_pool: 10050,
      prize_pool_finalized: true,
      guaranteed_prize: 3000,
      buy_in_amount: 27,
      buy_in_fee: 3,
      rebuy_cost: 30,
      addon_cost: 30,
      bounty_amount: 15,
      bounty_pool: 4275,
      bounty_pool_paid: 1863.73,
      payout_depth_percent: 12.5,
      payout_structure: JSON.stringify([
        { place: 1, percentage: 60 },
        { place: 2, percentage: 40 },
      ]),
      arena: { id: 'club', asset: 'chips', is_platform: false, union_id: null },
      ...overrides,
    } as unknown as TournamentTabProps['tournament'],
    entries: ENTRIES,
    tables: [],
    blindLevels: [],
    currentUserId: 'nobody',
    isRegistered: false,
  };
}

const poolTile = (c: HTMLElement) => c.querySelector('.rw-pool .tl-stat__value')?.textContent ?? '';

const mixRows = (c: HTMLElement) =>
  [...c.querySelectorAll('.rw-mix__row')].map((r) => [
    r.querySelector('.rw-mix__label')?.textContent ?? '',
    r.querySelector('.rw-mix__figure')?.textContent ?? '',
  ]);

describe('Rewards: the Total Prize Pool is every buy-in, rebuy and add-on', () => {
  it('prints places plus bounties, not the place half alone', () => {
    const { container } = render(<RewardsTab {...props()} />);
    expect(poolTile(container)).toBe('14,325');
    expect(poolTile(container)).not.toBe('10,050');
  });

  it('shows where it comes from, and the lines add up to the headline', async () => {
    const { container } = render(<RewardsTab {...props()} />);
    await waitFor(() =>
      expect(mixRows(container)).toEqual([
        ['276 Buy-Ins × 27', '7,452'],
        ['9 Rebuys × 27', '243'],
        ['221 Add-Ons × 30', '6,630'],
      ])
    );
    const split = container.querySelector('.rw-mix__split')?.textContent ?? '';
    expect(split).toContain('Place Prizes10,050');
    expect(split).toContain('Bounty Pool4,275');
  });

  it('a non-bounty event totals its prize pool and still breaks it down', () => {
    const { container } = render(
      <RewardsTab
        {...props({ is_bounty: false, is_pko: false, bounty_pool: 0, prize_pool: 14325 })}
      />
    );
    expect(poolTile(container)).toBe('14,325');
    expect(container.querySelector('.rw-mix__split')).toBeNull();
    expect(mixRows(container)).toHaveLength(3);
  });

  it('a funded overlay does not blank the lines: they are checked against net coverage', async () => {
    /* Nightly 20K, 2026-11-13: 195 buy-ins, 105 rebuys and 93 add-ons put in
       12,705 net; the house posted 7,295, so the finalized pool read 20,000. */
    funding.current = {
      collected: 20000,
      overlay: 0,
      net_coverage: 12705,
      house_required: 7295,
      house_posted: 7295,
      house_supplement_paid: 0,
    };
    const entries = Array.from({ length: 195 }, (_, i) => ({
      ...ENTRIES[i],
      rebuys: i < 105 ? 1 : 0,
      add_ons: i < 93 ? 1 : 0,
    })) as TournamentEntry[];
    const { container } = render(
      <RewardsTab
        {...props({
          is_bounty: false,
          is_pko: false,
          variant: 'freezeout',
          bounty_amount: 0,
          bounty_pool: 0,
          bounty_pool_paid: 0,
          prize_pool: 20000,
          guaranteed_prize: 20000,
          buy_in_amount: 31.5,
          buy_in_fee: 3.5,
          rebuy_cost: 35,
          addon_cost: 35,
        })}
        entries={entries}
      />
    );
    await waitFor(() =>
      expect(mixRows(container).slice(0, 3)).toEqual([
        ['195 Buy-Ins × 31.50', '6,142.50'],
        ['105 Rebuys × 31.50', '3,307.50'],
        ['93 Add-Ons × 35', '3,255'],
      ])
    );
  });

  it('withholds the amounts, never guesses them, when the lines do not reconcile', () => {
    /* e.g. free seats the costs cannot price: the counts stay, amounts dash. */
    const { container } = render(<RewardsTab {...props({ prize_pool: 9000 })} />);
    expect(poolTile(container)).toBe('13,275');
    expect(mixRows(container)).toEqual([
      ['276 Buy-Ins', '-'],
      ['9 Rebuys', '-'],
      ['221 Add-Ons', '-'],
    ]);
  });
});

describe('Ranking and Entries say how many times a player rebought and if they added on', () => {
  it('reads in words, never RB / AO', () => {
    const one = render(<BuyInMarks rebuys={1} addOn />);
    expect(one.container.textContent).toBe('1 RebuyAdd-On');
    cleanup();
    const three = render(<BuyInMarks rebuys={3} addOn={false} />);
    expect(three.container.textContent).toBe('3 Rebuys');
    cleanup();
    const none = render(<BuyInMarks rebuys={0} addOn={false} />);
    expect(none.container.textContent).toBe('');
  });

  it('both tabs draw the same marks off the entry row', () => {
    const ranking = readFileSync(
      join(ROOT, 'src/components/tournament/details/RankingTab.tsx'),
      'utf8'
    );
    const entries = readFileSync(
      join(ROOT, 'src/components/tournament/details/EntriesTab.tsx'),
      'utf8'
    );
    expect(ranking).toMatch(
      /<BuyInMarks rebuys=\{entry\.rebuys\} addOn=\{\(entry\.add_ons \?\? 0\) > 0\} \/>/
    );
    expect(entries).toMatch(/<BuyInMarks\b/);
    expect(entries).not.toMatch(/`RB \$\{/);
    expect(entries).not.toMatch(/>\s*AO\s*</);
  });
});
