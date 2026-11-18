import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  LightningPreviousHandReview,
  LightningPreviousHandResult,
} from '../../src/components/table/PreviousHandCard';
import { usePreviousLightningDeal } from '../../src/lightning/usePreviousLightningDeal';
import { handHistoryService } from '../../src/services/HandHistoryService';
import type { LightningSnapshotFields } from '../../src/lightning/lightningHand';

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

it('renders only the requested hand, distinguishes pending and failed reads, and closes', () => {
  const close = vi.fn();
  const hand = {
    handNumber: 41,
    streets: [{ name: 'flop' as const, cards: ['Ac', 'Kh', '2s'], actions: [], pot: 12 }],
    potTotal: 26,
    heroResult: 13,
  };
  const props = { handNumber: 42, hand, historyFailed: false, onClose: close };
  const view = render(<LightningPreviousHandResult {...props} />);
  expect(screen.getByText('Hand #42')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Awaiting Final Result');
  view.rerender(<LightningPreviousHandResult {...props} historyFailed />);
  expect(screen.getByRole('status').textContent).toBe('Hand History Unavailable');
  view.rerender(<LightningPreviousHandResult {...props} handNumber={41} />);
  expect(screen.getByText('Ac Kh 2s')).toBeTruthy();
  expect(screen.getByText('Pot 26 · Your Result +13')).toBeTruthy();
  view.rerender(
    <LightningPreviousHandResult
      {...props}
      handNumber={41}
      hand={{ ...hand, streets: [], heroResult: -3 }}
    />
  );
  expect(screen.getByText('No Board Dealt')).toBeTruthy();
  expect(screen.getByText('Pot 26 · Your Result -3')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close Previous Hand' }));
  expect(close).toHaveBeenCalledOnce();
});

it('reruns the selected deal read on reconnect and ignores a late response from the disconnected read', async () => {
  let finishOld!: (result: { state: 'pending' }) => void;
  const reader = vi
    .spyOn(handHistoryService, 'getPreviousLightningHand')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    )
    .mockResolvedValueOnce({ state: 'unavailable' });
  const deal = { id: 'hand-41', number: 41, scope: 'scope' };
  const props = { deal, viewer: 'hero', room: 'room', onClose: vi.fn() };
  try {
    const view = render(<LightningPreviousHandReview {...props} connected />);
    view.rerender(<LightningPreviousHandReview {...props} connected={false} />);
    expect(reader).toHaveBeenCalledTimes(1);
    view.rerender(<LightningPreviousHandReview {...props} connected />);
    await screen.findByText('Hand Settled · History Unavailable');
    finishOld({ state: 'pending' });
    await Promise.resolve();
    expect(screen.getByRole('status').textContent).toBe('Hand Settled · History Unavailable');
    expect(reader.mock.calls).toEqual([
      ['hero', 'room', deal, undefined],
      ['hero', 'room', deal, undefined],
    ]);
  } finally {
    reader.mockRestore();
  }
});
