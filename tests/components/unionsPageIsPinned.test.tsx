/**
 * THE UNIONS DIRECTORY IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign batch U1, 2026-11-28)
 *
 * The Unions directory moves from its own gradient dress to the arena
 * workspace. The condition: no printed figure, word, data hook, named region or
 * control state may change. This renders the real page with synthetic reads
 * and pins all five (tests/helpers/surfacePin.ts) in every state the page
 * shows: loaded (one union with an online answer, one whose read failed), empty
 * with and without the creation allowlist, a failed read and the first load.
 * The page head is left out of the reading: it is the one part the pass
 * replaces. The snapshots were recorded against the old page on main 65a64d1f6
 * and are unchanged by the pass.
 */
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const fixture = vi.hoisted(() => ({
  canCreateUnion: true,
  getUnions: vi.fn(),
  getOnlineCount: vi.fn(),
}));

vi.mock('../../src/services/UnionService', () => ({
  unionService: { getUnions: fixture.getUnions, getOnlineCount: fixture.getOnlineCount },
}));
vi.mock('../../src/hooks/useCanCreateUnion', () => ({
  useCanCreateUnion: () => ({ canCreateUnion: fixture.canCreateUnion }),
}));
vi.mock('../../src/hooks/useVisibilityRefresh', () => ({ useVisibilityRefresh: () => {} }));
vi.mock('../../src/components/union/CreateUnionModal', () => ({ default: () => null }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../src/core/MasterBus', () => ({
  masterBus: { subscribeDebounced: () => () => {}, emit: vi.fn() },
}));
const toast = vi.hoisted(() => ({
  success: () => {},
  error: () => {},
  info: () => {},
  warning: () => {},
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => toast,
  useOptionalToast: () => null,
}));

import UnionsPage from '../../src/pages/UnionsPage';

function union(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    slug: id,
    name: 'Midway Union',
    description: 'Every Midway Club Under One Network.',
    ownerId: 'owner-a',
    isPublic: true,
    memberCount: 1284,
    clubCount: 12,
    totalRake: 0,
    level: 7,
    playerLevel: 7,
    hierarchyLevel: 3,
    totalPlayers: 1284,
    hierarchyUnits: 3,
    hierarchyUnitsRoundedUp: 3,
    playerThresholdCurrent: 1000,
    playerThresholdNext: 1500,
    hierarchyThresholdCurrent: 3,
    hierarchyThresholdNext: 4,
    settings: { revenueSharePercent: 10, sharedPlayerPool: true, crossClubTournaments: true },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const UNIONS = [
  union('midway-union', { avatarUrl: 'https://example.test/u.png' }),
  union('river-union', {
    name: 'River Union',
    description: undefined,
    memberCount: 46,
    totalPlayers: 46,
    clubCount: 2,
    level: 1,
    playerLevel: 1,
    hierarchyLevel: 1,
  }),
];

function mount() {
  return render(
    <MemoryRouter>
      <UnionsPage />
    </MemoryRouter>
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

/** The words inside each card: a card is one link, so surfacePin reads it
 *  only by its accessible name. */
function linkWords(root: HTMLElement): string[] {
  return [...root.querySelectorAll('a[href]')].map((a) => {
    const words: string[] = [];
    const walker = a.ownerDocument.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const piece = (walker.currentNode.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (piece) words.push(piece);
    }
    return words.join(' | ');
  });
}

function pin(container: HTMLElement) {
  const root = container.firstElementChild as HTMLElement;
  return { ...surfacePin(root), links: linkWords(root) };
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.canCreateUnion = true;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
  fixture.getUnions.mockResolvedValue(UNIONS);
  fixture.getOnlineCount.mockImplementation(async (id: string) => {
    if (id === 'river-union') throw new Error('read failed');
    return 87;
  });
});

afterEach(() => {
  cleanup();
});

describe('the Unions directory prints the same figures, words and controls', () => {
  it('loaded', async () => {
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "a||Open Midway Union Union|",
          "a||Open River Union Union|",
          "button|button|Create Union|",
          "button|button|Start A Union|",
        ],
        "links": [
          "Midway Union | Every Midway Club Under One Network. | 12 | Clubs | Lv. | 34 | Major Operator | 1,284 | Members | 87 | Online | 42 | % Complete | Next: Lv. | 35 | Open Union | ›",
          "R | River Union | A Connected Club Network With Shared Games And Events. | 2 | Clubs | Lv. | 10 | Small Club | 46 | Members | Unavailable | Online | 20 | % Complete | Next: Lv. | 11 | Open Union | ›",
        ],
        "money": {
          "figures": [
            "12",
            "34",
            "1,284",
            "87",
            "42",
            "35",
            "2",
            "10",
            "46",
            "20",
            "11",
          ],
          "hooks": [
            "data-discover=true",
            "data-discover=true",
          ],
        },
        "regions": [
          "a||Open Midway Union Union",
          "div||Midway Union Network Statistics",
          "div|progressbar|Midway Union Level Progress",
          "a||Open River Union Union",
          "div||River Union Network Statistics",
          "div|progressbar|River Union Level Progress",
        ],
        "text": "Create Your Own Union | Bring Together Multiple Clubs Under One Network For Shared Player Pools And Coordinated Events.",
      }
    `);
  });

  it('empty, for the allowlisted account', async () => {
    fixture.getUnions.mockResolvedValue([]);
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Create Union|",
          "button|button|Create Union|",
          "button|button|Start A Union|",
        ],
        "links": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "section|status|",
        ],
        "text": "UNION | No Networks Yet | Build The First Union | Connect Clubs Under One Network To Coordinate Games, Liquidity And Events. | Create Your Own Union | Bring Together Multiple Clubs Under One Network For Shared Player Pools And Coordinated Events.",
      }
    `);
  });

  it('empty, for everybody else', async () => {
    fixture.canCreateUnion = false;
    fixture.getUnions.mockResolvedValue([]);
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [],
        "links": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "section|status|",
        ],
        "text": "UNION | No Networks Yet | Build The First Union | Connect Clubs Under One Network To Coordinate Games, Liquidity And Events.",
      }
    `);
  });

  it('failed', async () => {
    fixture.getUnions.mockRejectedValue(new Error('offline'));
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Create Union|",
          "button|button|Start A Union|",
          "button|button|Try Again|",
        ],
        "links": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "section|alert|",
        ],
        "text": "FAULT | Recovery Required | This Surface Could Not Load | Club Arena Could Not Load Union Networks Right Now. | Create Your Own Union | Bring Together Multiple Clubs Under One Network For Shared Player Pools And Coordinated Events.",
      }
    `);
  });

  it('first load', async () => {
    fixture.getUnions.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    await flush();
    expect(pin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "button|button|Create Union|",
          "button|button|Start A Union|",
        ],
        "links": [],
        "money": {
          "figures": [],
          "hooks": [],
        },
        "regions": [
          "div|status|",
        ],
        "text": "Opening Union Networks | Create Your Own Union | Bring Together Multiple Clubs Under One Network For Shared Player Pools And Coordinated Events.",
      }
    `);
  });
});
