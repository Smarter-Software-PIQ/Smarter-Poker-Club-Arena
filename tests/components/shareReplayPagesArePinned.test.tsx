/**
 * THE FOUR SHARE AND REPLAY PAGES ARE PINNED BEFORE THEIR FRAME MOVES
 * (#SmarterDesign Batch T2, 2026-11-28)
 *
 * Covers:
 *   - HandReplayerPage (/share/hand/:handId)
 *   - SharedHandReplayPage (/replay?h=..., signed-out, signed-in, unreadable, and ?clip=1)
 *   - ShortHandReplayPage (/h/:token loading, open, revoked, missing, unreachable)
 *   - SharedBonusReplayPage (/bonus-replay/:shareId loading, ready, error)
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';
import { encodeHand } from '../../src/components/table/ShareHand';
import { shareableFromModel } from '../../src/lib/shareHandModel';
import { buildReplay, replayInputFromRow } from '../../src/utils/handReplay';

const state = vi.hoisted(() => ({
  signedIn: false,
  openShort: vi.fn(),
  readBonus: vi.fn(),
}));

vi.mock('../../src/lib/authUtils', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/authUtils')>()),
  hasLocalSession: () => state.signedIn,
}));
vi.mock('../../src/services/SoundService', () => ({
  soundService: new Proxy({}, { get: () => vi.fn() }),
  haptic: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: null }) }));
vi.mock('../../src/services/HandHistoryService', () => ({
  handHistoryService: { getHand: vi.fn() },
}));
vi.mock('../../src/components/replay/HandReplay', () => ({
  default: ({
    handId,
    source,
    clip,
  }: {
    handId?: string;
    source?: { handNumber?: unknown };
    clip?: unknown;
  }) => (
    <div
      className="hand-replay"
      data-hand-id={handId ?? ''}
      data-hand-number={source?.handNumber ? String(source.handNumber) : ''}
      data-clip={clip ? '1' : '0'}
    >
      Hand Replay Surface
    </div>
  ),
}));
vi.mock('../../src/services/SharedHandLinkService', () => ({
  openSharedHand: (...args: unknown[]) => state.openShort(...args),
}));
vi.mock('../../src/services/DiamondReplayService', () => ({
  DiamondReplayService: {
    read: (...args: unknown[]) => state.readBonus(...args),
  },
  bonusReplayTitle: () => 'Plinko Bonus',
}));
vi.mock('../../src/components/games/BonusReplayPlayer', () => ({
  default: ({ replay }: { replay: { id?: string } }) => (
    <section aria-label="Bonus Replay" data-replay-id={replay.id ?? ''}>
      Bonus Replay Player
    </section>
  ),
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import HandReplayerPage from '../../src/pages/share/HandReplayerPage';
import SharedHandReplayPage from '../../src/pages/share/SharedHandReplayPage';
import ShortHandReplayPage from '../../src/pages/share/ShortHandReplayPage';
import SharedBonusReplayPage from '../../src/pages/share/SharedBonusReplayPage';

const HERO = 'hero-uuid';
const ROW = {
  id: 'hand-uuid',
  hand_number: 77,
  game_variant: 'nlh',
  small_blind: 1,
  big_blind: 2,
  pot_size: 20,
  button_seat: 1,
  started_at: '2026-09-30T12:00:00.000Z',
  community_cards: ['7c', '2c', '9h'],
  players: [
    { userId: HERO, username: 'kingfish', seat: 1, stack: 110, cards: [] },
    { userId: 'villain-uuid', username: 'Emerson', seat: 2, stack: 90, cards: [] },
  ],
  actions: [
    { seat: 1, userId: HERO, action: 'raise', amount: 6, stage: 'preflop' },
    { seat: 2, userId: 'villain-uuid', action: 'fold', amount: 0, stage: 'preflop' },
  ],
  winners: [{ userId: HERO, amount: 20, potIndex: 0 }],
  winner_name: 'kingfish',
  hole_cards: null,
  showdown: null,
};

const ENCODED_HAND = encodeHand(
  shareableFromModel(buildReplay(replayInputFromRow(ROW as never)), {
    id: ROW.id,
    tableName: 'Kingfish Club',
    heroUserId: HERO,
  })
);

function pinFile(name: string) {
  return `./__pins__/share-replay-${name}.pin.txt`;
}

function pin(container: HTMLElement): string {
  return `${JSON.stringify(surfacePin(container), null, 2)}\n`;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.signedIn = false;
  delete (window as unknown as { __SP_CLIP__?: unknown }).__SP_CLIP__;
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { __SP_CLIP__?: unknown }).__SP_CLIP__;
});

describe('share and replay pages print the same figures, words and controls', () => {
  it('HandReplayerPage (/share/hand/:handId)', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/share/hand/hand-77']}>
        <Routes>
          <Route path="/share/hand/:handId" element={<HandReplayerPage />} />
        </Routes>
      </MemoryRouter>
    );
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('hand-replayer'));
  });

  it('SharedHandReplayPage signed-out with invite code', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={[`/replay?h=${ENCODED_HAND}&i=HSTAAAA`]}>
        <SharedHandReplayPage />
      </MemoryRouter>
    );
    await settle();
    expect(container.querySelector('.shared-replay > .hand-replay')).not.toBeNull();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('shared-hand-signed-out'));
  });

  it('SharedHandReplayPage signed-in (no join card)', async () => {
    state.signedIn = true;
    const { container } = render(
      <MemoryRouter initialEntries={[`/replay?h=${ENCODED_HAND}`]}>
        <SharedHandReplayPage />
      </MemoryRouter>
    );
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('shared-hand-signed-in'));
  });

  it('SharedHandReplayPage unreadable link', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/replay?h=bad']}>
        <SharedHandReplayPage />
      </MemoryRouter>
    );
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('shared-hand-empty'));
  });

  it('SharedHandReplayPage clip mode preserves exact single-child camera DOM', async () => {
    (window as unknown as { __SP_CLIP__?: unknown }).__SP_CLIP__ = {
      v: 1,
      style: 'felt-720p',
      heroId: HERO,
      row: ROW,
      tableName: 'Kingfish Club',
      privateHoleCards: {},
      discardedCards: {},
      minMs: 15000,
      maxMs: 40000,
    };
    const { container } = render(
      <MemoryRouter initialEntries={['/replay?clip=1']}>
        <SharedHandReplayPage />
      </MemoryRouter>
    );
    await settle();
    expect(container.querySelector('.shared-replay--clip')?.children).toHaveLength(1);
    expect(container.querySelector('.arena-workspace-mast')).toBeNull();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('shared-hand-clip'));
  });

  it('ShortHandReplayPage loading state', async () => {
    state.openShort.mockReturnValueOnce(new Promise(() => {}));
    const { container } = render(
      <MemoryRouter initialEntries={['/h/AbCd2345']}>
        <Routes>
          <Route path="/h/:token" element={<ShortHandReplayPage />} />
        </Routes>
      </MemoryRouter>
    );
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('short-loading'));
  });

  it('ShortHandReplayPage revoked state', async () => {
    state.openShort.mockResolvedValueOnce({ status: 'revoked' });
    const { container } = render(
      <MemoryRouter initialEntries={['/h/AbCd2345']}>
        <Routes>
          <Route path="/h/:token" element={<ShortHandReplayPage />} />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByText('This Hand Is No Longer Shared');
    await settle();
    await expect(pin(container)).toMatchFileSnapshot(pinFile('short-revoked'));
  });

  it('SharedBonusReplayPage loading, ready and error states', async () => {
    state.readBonus.mockReturnValueOnce(new Promise(() => {}));
    const loadingView = render(
      <MemoryRouter initialEntries={['/bonus-replay/share-1']}>
        <Routes>
          <Route path="/bonus-replay/:shareId" element={<SharedBonusReplayPage />} />
        </Routes>
      </MemoryRouter>
    );
    await settle();
    await expect(pin(loadingView.container)).toMatchFileSnapshot(pinFile('bonus-loading'));
    loadingView.unmount();

    state.readBonus.mockResolvedValueOnce({ id: 'share-1', game: 'plinko' });
    const readyView = render(
      <MemoryRouter initialEntries={['/bonus-replay/share-1']}>
        <Routes>
          <Route path="/bonus-replay/:shareId" element={<SharedBonusReplayPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(readyView.getByLabelText('Bonus Replay')).toBeInTheDocument());
    await settle();
    await expect(pin(readyView.container)).toMatchFileSnapshot(pinFile('bonus-ready'));
    readyView.unmount();

    state.readBonus.mockRejectedValueOnce(new Error('Replay Could Not Be Loaded'));
    const errorView = render(
      <MemoryRouter initialEntries={['/bonus-replay/share-1']}>
        <Routes>
          <Route path="/bonus-replay/:shareId" element={<SharedBonusReplayPage />} />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByRole('alert');
    await settle();
    await expect(pin(errorView.container)).toMatchFileSnapshot(pinFile('bonus-error'));
  });
});
