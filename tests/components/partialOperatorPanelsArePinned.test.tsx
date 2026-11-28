/**
 * THE LAST PAINTED PANELS ON THREE CONVERTED PAGES ARE PINNED BEFORE THEY
 * MOVE (2026-11-28)
 *
 * Club Settings, Player Offers and the Agent Dashboard already wear the arena
 * workspace; each still hosts one panel on the painted console: the jackpot
 * Announcements (BBJThresholdPanel), the promotion standings (LeaderboardCard)
 * and the agent Performance Score (AgentScoreCard). Moving them to the chrome
 * case must not move a figure, a word, a data hook, a named region or a
 * control's state. Recorded against main f6ba3b40c before the change
 * (tests/helpers/surfacePin.ts).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const CLUB = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, { rows?: unknown[]; single?: unknown }>,
  getLeaderboard: vi.fn(),
  auth: { user: { id: 'me' }, isHydrating: false },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'order', 'limit'])
        query[method] = () => query;
      query.maybeSingle = async () => ({ data: mocks.tables[table]?.single ?? null, error: null });
      query.then = (done: (value: unknown) => unknown, fail: (error: unknown) => unknown) =>
        Promise.resolve({ data: mocks.tables[table]?.rows ?? [], error: null }).then(done, fail);
      return query;
    },
  },
}));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => mocks.toast }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/lib/bbjPoolFeed', () => ({
  watchBbjPool: (_club: string, listener: (snap: { mainBalance: number }) => void) => {
    listener({ mainBalance: 15342.07 });
    return () => {};
  },
}));
vi.mock('../../src/services/PromotionService', () => ({
  promotionService: { getLeaderboard: (...args: unknown[]) => mocks.getLeaderboard(...args) },
}));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => mocks.auth }));
vi.mock('../../src/hooks/useMasterBusSubscription', () => ({ useMasterBusSubscription: vi.fn() }));

import BBJThresholdPanel from '../../src/components/bbj/BBJThresholdPanel';
import LeaderboardCard from '../../src/components/leaderboard/LeaderboardCard';
import AgentScoreCard from '../../src/components/agent/AgentScoreCard';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tables = {};
});
afterEach(cleanup);

describe('the jackpot announcements keep every figure, word, region and control', () => {
  beforeEach(() => {
    mocks.tables.bbj_notify_thresholds = {
      rows: [
        { id: 't1', amount: '10000.00', label: 'weekend push', enabled: true },
        { id: 't2', amount: '25000.50', label: null, enabled: false },
      ],
    };
  });
  it('an operator who can edit', async () => {
    const { container } = render(<BBJThresholdPanel clubId={CLUB} canEdit />);
    await screen.findByText('Weekend Push');
    expect(surfacePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Add Announcement|",
          "button|button|Clear|disabled",
          "button|button|Remove|",
          "button|button|Remove|",
          "button|button|Turn Off|",
          "button|button|Turn On|",
          "input|number||value=",
          "input|text||value=",
        ],
        "money": {
          "figures": [
            "15,342.07",
            "15,342.07",
            "10,000.00",
            "25,000.50",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Bad Beat Jackpot | Announcements | 15,342.07 | Tell Your Members When The Jackpot Passes An Amount You Choose. Each Amount Is Announced Once, And It Arms Again The Next Time The Jackpot Is Hit. | The Jackpot Is Currently | 15,342.07 | Chips | . | 10,000.00 | Weekend Push | On | 25,000.50 | Off | Announce At (Chips) | Note (Optional)",
      }
    `);
  });
  it('a member who can only read', async () => {
    const { container } = render(<BBJThresholdPanel clubId={CLUB} canEdit={false} />);
    await screen.findByText('Weekend Push');
    expect(surfacePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [
            "15,342.07",
            "15,342.07",
            "10,000.00",
            "25,000.50",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Bad Beat Jackpot | Announcements | 15,342.07 | Tell Your Members When The Jackpot Passes An Amount You Choose. Each Amount Is Announced Once, And It Arms Again The Next Time The Jackpot Is Hit. | The Jackpot Is Currently | 15,342.07 | Chips | . | 10,000.00 | Weekend Push | On | 25,000.50 | Off",
      }
    `);
  });
  it('no announcements set', async () => {
    mocks.tables.bbj_notify_thresholds = { rows: [] };
    const { container } = render(<BBJThresholdPanel clubId={CLUB} canEdit />);
    await screen.findByText(/No Announcements Set/);
    expect(surfacePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Add Announcement|",
          "button|button|Clear|disabled",
          "input|number||value=",
          "input|text||value=",
        ],
        "money": {
          "figures": [
            "15,342.07",
            "15,342.07",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Bad Beat Jackpot | Announcements | 15,342.07 | Tell Your Members When The Jackpot Passes An Amount You Choose. Each Amount Is Announced Once, And It Arms Again The Next Time The Jackpot Is Hit. | The Jackpot Is Currently | 15,342.07 | Chips | . | No Announcements Set. Your Members Are Not Told When The Jackpot Grows. | Announce At (Chips) | Note (Optional)",
      }
    `);
  });
});

describe('the promotion standings keep every figure, word, region and control', () => {
  const entry = (userId: string, rank: number, score: number, prize: number | null) => ({
    userId,
    rank,
    username: userId,
    displayName: userId === 'me' ? 'Kingfish' : `Player ${rank}`,
    score,
    prize,
  });
  it('on the offer row glass, with the viewer pinned below the board', async () => {
    mocks.getLeaderboard.mockImplementation((_id: string, limit: number) =>
      Promise.resolve(
        limit === 1000
          ? [entry('a', 1, 19255.12, 250), entry('me', 15, 812, null)]
          : [entry('a', 1, 19255.12, 250), entry('b', 2, 9000, 100), entry('c', 4, 50.5, 0)]
      )
    );
    const { container } = render(
      <LeaderboardCard promotionId="p1" title="Weekly Rankings" limit={5} variant="glass" />
    );
    await screen.findByText('Your Position');
    expect(surfacePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [
            "1st",
            "Player 1",
            "19,255.12",
            "250",
            "2nd",
            "Player 2",
            "9,000",
            "100",
            "#4",
            "Player 4",
            "50.50",
            "#15",
            "812",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "1st | P | Player 1 | 19,255.12 | Prize | 250 | 2nd | P | Player 2 | 9,000 | Prize | 100 | #4 | P | Player 4 | 50.50 | Your Position | #15 | K | Kingfish | (You) | 812",
      }
    `);
  });
  it('on its own case', async () => {
    mocks.getLeaderboard.mockResolvedValue([entry('me', 1, 19255.12, 250)]);
    const { container } = render(<LeaderboardCard promotionId="p1" title="Weekly Rankings" />);
    await screen.findByText('19,255.12');
    expect(surfacePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [
            "1st",
            "19,255.12",
            "250",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Promotion Rankings | Weekly Rankings | Standings | 1st | K | Kingfish | (You) | 19,255.12 | Prize | 250",
      }
    `);
  });
  it('a failed read', async () => {
    mocks.getLeaderboard.mockRejectedValue(new Error('Offline'));
    const { container } = render(<LeaderboardCard promotionId="p1" variant="glass" />);
    await screen.findByRole('alert');
    expect(surfacePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Retry Rankings|",
        ],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "div|alert|",
        ],
        "text": "Rankings Could Not Be Updated.",
      }
    `);
  });
  it('no entries yet', async () => {
    mocks.getLeaderboard.mockResolvedValue([]);
    const { container } = render(<LeaderboardCard promotionId="p1" variant="glass" />);
    await screen.findByText('No Entries Yet');
    expect(surfacePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "No Entries Yet",
      }
    `);
  });
});

describe('the agent performance score keeps every figure, word, region and control', () => {
  it('a scored agent', async () => {
    mocks.tables = {
      agents: { single: { id: 'agent-1' } },
      chip_transactions: {
        rows: [
          { id: 'x1', amount: 100.5, clawed_back: false, to_user_id: 'p1' },
          { id: 'x2', amount: 2500, clawed_back: true, to_user_id: 'p2' },
          { id: 'x3', amount: 40, clawed_back: false, to_user_id: 'p3' },
        ],
      },
      player_stats: { rows: [{ user_id: 'p1' }, { user_id: 'p3' }] },
    };
    const { container } = render(<AgentScoreCard userId="me" clubId={CLUB} />);
    await screen.findByText('Overall Score');
    expect(surfacePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [
            "Agent / Last 30 Days",
            "35",
            "3 Txns",
            "6",
            "2/3 Active",
            "67",
            "33.3% Rate",
            "0",
            "2 Active Players",
            "67",
            "880.17",
            "33.3",
            "67",
          ],
          "hooks": [],
        },
        "regions": [
          "section||Score Breakdown",
          "section||Headline Figures",
        ],
        "text": "Agent / Last 30 Days | Performance Score | Grade F | Overall Score | 35 | Distribution Volume | 3 Txns | 6 | Player Retention | 2/3 Active | 67 | Clawback Health | 33.3% Rate | 0 | Network Activity | 2 Active Players | 67 | Avg Distribution | 880.17 | Clawback Rate | 33.3 | % | Retention | 67 | %",
      }
    `);
  });
  it('no performance data', async () => {
    const { container } = render(<AgentScoreCard userId="me" clubId={CLUB} />);
    await screen.findByText('No Performance Data Available Yet');
    expect(surfacePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [],
        "text": "Agent | Performance Score | No Data | No Performance Data Available Yet",
      }
    `);
  });
  it('scoring', () => {
    const { container } = render(<AgentScoreCard userId="me" clubId={CLUB} />);
    expect(surfacePin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "money": {
          "figures": [
            "Scoring The Last 30 Days...",
          ],
          "hooks": [],
        },
        "regions": [],
        "text": "Agent | Performance Score | Scoring | Scoring The Last 30 Days...",
      }
    `);
  });
});
