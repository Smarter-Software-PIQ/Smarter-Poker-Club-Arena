import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { HandDetailModal } from '../../src/components/table/HandDetailModal';
import { usePreviousLightningDeal } from '../../src/lightning/usePreviousLightningDeal';
import type { LightningSnapshotFields } from '../../src/lightning/lightningHand';
import { buildReplay } from '../../src/utils/handReplay';

afterEach(cleanup);

function playing(
  hand_number: number,
  user_id = 'hero',
  is_folded = false
): LightningSnapshotFields {
  return { table_id: 'room', hand_number, stage: 'preflop', players: [{ user_id, is_folded }] };
}

function waiting(hand_number: number): LightningSnapshotFields {
  return { table_id: 'room', hand_number, stage: 'waiting', players: [] };
}

const initial = {
  room: 'room' as string | null,
  viewer: 'hero',
  snapshot: null as LightningSnapshotFields | null,
};
const useTrackedDeal = ({ room, viewer, snapshot }: typeof initial) =>
  usePreviousLightningDeal(room, viewer, snapshot);

it('promotes the last deal once across repeat, null, idle and direct hand transitions', () => {
  const { result, rerender } = renderHook(useTrackedDeal, { initialProps: initial });
  const send = (snapshot: LightningSnapshotFields | null) => rerender({ ...initial, snapshot });
  send(playing(41));
  send(playing(41));
  send(null);
  expect(result.current).toBeNull();
  send(playing(42));
  expect(result.current?.number).toBe(41);
  const previous = result.current;
  send(playing(42));
  send(playing(41, 'hero', true));
  send(waiting(41));
  send(null);
  expect(result.current).toBe(previous);
  send(waiting(42));
  expect(result.current?.number).toBe(42);
  const finished = result.current;
  send(waiting(42));
  send(playing(43));
  expect(result.current).toBe(finished);
});

it('records a confirmed hero fold and never adopts an opponent-only or invalid hand', () => {
  const { result, rerender } = renderHook(useTrackedDeal, { initialProps: initial });
  const send = (snapshot: LightningSnapshotFields) => rerender({ ...initial, snapshot });
  send(playing(1, 'opponent', true));
  send(playing(0, 'hero', true));
  expect(result.current).toBeNull();
  send(playing(41, 'hero', true));
  const folded = result.current;
  expect(folded?.number).toBe(41);
  send(playing(41, 'hero', true));
  send(playing(42, 'opponent'));
  expect(result.current).toBe(folded);
});

it.each([
  { room: 'next', viewer: 'hero' },
  { room: 'room', viewer: 'new-player' },
  { room: null, viewer: 'hero' },
])('isolates history on a change to room $room or viewer $viewer', (scope) => {
  const { result, rerender } = renderHook(useTrackedDeal, {
    initialProps: { ...initial, snapshot: playing(41, 'hero', true) },
  });
  expect(result.current?.number).toBe(41);
  rerender({ ...scope, snapshot: playing(41, 'hero', true) });
  expect(result.current).toBeNull();
  rerender(initial);
  expect(result.current).toBeNull();
});

it('retires the bare LightningPreviousHandReview and LightningPreviousHandResult aside permanently', () => {
  const cardSource = readFileSync(
    resolve(__dirname, '../../src/components/table/PreviousHandCard.tsx'),
    'utf8'
  );
  const cardCss = readFileSync(
    resolve(__dirname, '../../src/components/table/PreviousHandCard.css'),
    'utf8'
  );
  expect(cardSource).not.toContain('LightningPreviousHandReview');
  expect(cardSource).not.toContain('LightningPreviousHandResult');
  expect(cardCss).not.toContain('.lightning-previous-result');
});

it('TablePage opens the full HandDetailModal on Previous Hand tap in Lightning instead of the bare aside', () => {
  const tablePage = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
  const cardStart = tablePage.indexOf('<PreviousHandCard');
  const cardEnd = tablePage.indexOf('/>', cardStart);
  const cardBlock = tablePage.slice(cardStart, cardEnd);
  expect(cardBlock).toContain('setShowHandDetail(true)');
  expect(tablePage).not.toContain('<LightningPreviousHandReview');
  expect(tablePage).toContain('Boolean(lightningRoom && !lightningObserver)');
  expect(tablePage).toContain('rabbitTableId={lightningRoom ? null : (tableId ?? null)}');
  expect(tablePage).toContain(
    'tableNameFallback={lightningRoom ? tableState.tableName || null : null}'
  );
});

it('HandDetailModal shows pending Lightning deal status in empty and populated states and clears it once settled', () => {
  const settledHand = {
    id: 'hand-40',
    handNumber: 40,
    tableId: 'host-table-40',
    tableName: 'Lightning 1/2',
    gameType: 'nlh',
    smallBlind: 1,
    bigBlind: 2,
    timestamp: Date.parse('2026-11-19T12:00:00Z'),
    potTotal: 14,
    heroResult: 6,
    heroCards: ['As', 'Kh'],
    streets: [],
    winners: [{ playerId: 'hero', playerName: 'Hero', amount: 14 }],
    replay: buildReplay({
      handNumber: 40,
      playedAt: '2026-11-19T12:00:00Z',
      gameVariant: 'nlh',
      smallBlind: 1,
      bigBlind: 2,
      potSize: 14,
      rakeAmount: 0,
      bbjAmount: 0,
      buttonSeat: 1,
      board: ['Ac', '7d', '2s'],
      players: [
        { seat: 1, userId: 'hero', username: 'Hero', stack: 100 },
        { seat: 2, userId: 'villain', username: 'Villain', stack: 100 },
      ],
      actions: [
        { seat: 1, stage: 'preflop', action: 'raise', amount: 6, userId: 'hero' },
        { seat: 2, stage: 'preflop', action: 'call', amount: 6, userId: 'villain' },
      ],
      winners: [{ userId: 'hero', amount: 14, potIndex: 0 }],
      holeCards: { hero: ['As', 'Kh'] },
      showdown: [],
      pots: [{ index: 0, amount: 14 }],
    } as never),
  };

  // Empty state while the first fast-folded hand is still settling
  const view = render(
    <HandDetailModal
      isOpen
      onClose={() => {}}
      hands={[]}
      heroId="hero"
      loadState="ready"
      viewerSeated
      tableNameFallback="Lightning PLO5 1/2"
      pendingLightningDeal={{ handNumber: 41, status: 'pending' }}
    />
  );
  expect(screen.getByRole('dialog', { name: 'Hand Detail' })).toBeTruthy();
  expect(screen.getByText('Lightning PLO5 1/2')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('Hand #41');
  expect(screen.getByRole('status').textContent).toContain('Awaiting Final Result');

  // Populated state: older settled hand is readable while Hand #41 is still settling
  view.rerender(
    <HandDetailModal
      isOpen
      onClose={() => {}}
      hands={[settledHand as never]}
      heroId="hero"
      loadState="ready"
      viewerSeated
      tableNameFallback="Lightning PLO5 1/2"
      pendingLightningDeal={{ handNumber: 41, status: 'pending' }}
    />
  );
  expect(screen.getByText('Lightning PLO5 1/2')).toBeTruthy();
  expect(screen.getByText('#40')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('Hand #41');
  expect(screen.getByRole('status').textContent).toContain('Awaiting Final Result');

  // Once Hand #41 settles and lands in hands, the pending banner clears
  const settled41 = { ...settledHand, id: 'hand-41', handNumber: 41 };
  view.rerender(
    <HandDetailModal
      isOpen
      onClose={() => {}}
      hands={[settled41 as never, settledHand as never]}
      heroId="hero"
      loadState="ready"
      viewerSeated
      pendingLightningDeal={{ handNumber: 41, status: 'pending' }}
    />
  );
  expect(screen.queryByText('Awaiting Final Result')).toBeNull();
});
