/**
 * REWARDS DEFAULTS THE HERO TO THE TOP (Dan 2026-11-08).
 *
 *   "WHEN A PLAYER CHECKS 'REWARDS' IT SHOULD DEFAULT THE HERO TO THE TOP, LIKE
 *    IT DOES WHEN YOU CLICK 'RANKING'."
 *
 * His screenshot was a bounty-only PKO Free Buy whose "Bounty Winnings Outside
 * The Place Payouts" list started at 86th and never showed him. Rewards now
 * pins the same card Ranking pins, and the hero's row leads every per-player
 * list. Order only: no figure changes.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  TournamentEntry,
  TournamentTabProps,
} from '../../src/components/tournament/details/types';

vi.mock('../../src/lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'gt', 'order', 'limit']) chain[k] = () => chain;
  chain.abortSignal = async () => ({ data: [], error: null });
  return { supabase: { from: () => chain, rpc: vi.fn() } };
});
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/hooks/useTournamentPrizeFunding', () => ({
  useTournamentPrizeFunding: () => null,
}));
vi.mock('../../src/services/tournamentStandingsUpdates', () => ({
  subscribeTournamentStandings: () => () => {},
}));
vi.mock('../../src/components/tournament/details/useDownlineIds', () => ({
  useDownlineIds: () => ({ downlineIds: new Set(), carriesDownline: false, loading: false }),
}));

import RewardsTab from '../../src/components/tournament/details/RewardsTab';

afterEach(cleanup);

const e = (
  user: string,
  status: TournamentEntry['status'],
  extra: Partial<TournamentEntry> = {}
): TournamentEntry =>
  ({
    id: `id-${user}`,
    user_id: user,
    username: user,
    avatar_url: null,
    status,
    chips: 0,
    ...extra,
  }) as TournamentEntry;

/* A running bounty-only PKO: no places, every chip a knockout. */
function pko(entries: TournamentEntry[], hero: string): TournamentTabProps {
  return {
    tournament: {
      id: 'pko',
      name: 'Midday Free Buy',
      status: 'RUNNING',
      tournament_type: 'MTT',
      is_bounty: true,
      is_pko: true,
      prize_pool: 0,
      bounty_pool: 151,
      bounty_pool_paid: 20,
      payout_structure: '[]',
      arena: { id: 'club', asset: 'chips', is_platform: false, union_id: null },
    } as unknown as TournamentTabProps['tournament'],
    entries,
    tables: [],
    blindLevels: [],
    currentUserId: hero,
    isRegistered: true,
  };
}

const FIELD = [
  e('oldghost', 'playing', { chips: 54308, bounty_winnings: 3 }),
  e('hero', 'playing', { chips: 14300, bounty_winnings: 2 }),
  e('slyrat', 'playing', { chips: 23829 }),
  e('b04tnit', 'eliminated', { position: 86, bounty_winnings: 2 }),
  e('OldJett', 'eliminated', { position: 89, bounty_winnings: 1 }),
];

describe('Rewards pins the hero', () => {
  it('pins Your Current Position with the live chip rank Ranking prints', () => {
    const { container } = render(<RewardsTab {...pko(FIELD, 'hero')} />);
    const pin = container.querySelector('.rk-hero');
    expect(pin).toBeTruthy();
    expect(pin?.querySelector('.rk-hero__label')?.textContent).toBe('Your Current Position');
    // 54,308 then 23,829 then the hero's 14,300.
    expect(pin?.querySelector('.rk-hero__rank')?.textContent).toBe('3rd');
    expect(pin?.textContent).toContain('Bounties');
    // The pin comes before the prize headline.
    expect(container.querySelector('.rw')?.firstElementChild).toBe(pin);
  });

  it('says Your Result once the hero has a finishing position', () => {
    const done = [
      ...FIELD.filter((r) => r.user_id !== 'hero'),
      e('hero', 'eliminated', {
        position: 17,
        prize: 0,
        bounty_winnings: 2,
      }),
    ];
    const { container } = render(<RewardsTab {...pko(done, 'hero')} />);
    expect(container.querySelector('.rk-hero__label')?.textContent).toBe('Your Result');
    expect(container.querySelector('.rk-hero__rank')?.textContent).toBe('17th');
  });

  it('puts the hero first in Bounty Winnings Outside The Place Payouts, everyone else in order', () => {
    const late = [
      ...FIELD.filter((r) => r.user_id !== 'hero'),
      e('hero', 'eliminated', {
        position: 94,
        bounty_winnings: 3,
      }),
    ];
    const { container } = render(<RewardsTab {...pko(late, 'hero')} />);
    const names = [...container.querySelectorAll('.rw-list .rw-row .rw-who__name')].map(
      (n) => n.textContent
    );
    expect(names).toEqual(['hero', 'b04tnit', 'OldJett', 'oldghost']);
  });

  it('a viewer with no entry gets no pin', () => {
    const { container } = render(<RewardsTab {...pko(FIELD, 'spectator')} />);
    expect(container.querySelector('.rk-hero')).toBeNull();
  });
});
