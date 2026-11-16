import { createContext } from 'react';
import type { ReplayFrame } from '../utils/replayFrames';

export type SharedBoardTiming = Partial<Record<'flop' | 'turn' | 'river', number>>;
type BoardObserver = (hand: string | number, count: number) => void;
export const SharedBoardObserver = createContext<BoardObserver | null>(null);

export function boardStreet(count: number) {
  return count === 3 ? 'flop' : count === 4 ? 'turn' : count === 5 ? 'river' : undefined;
}

export function readBoardTiming(input: unknown): SharedBoardTiming | undefined {
  if (!input || typeof input !== 'object') return;
  const times: SharedBoardTiming = {};
  let previous = -1;
  for (const street of ['flop', 'turn', 'river'] as const) {
    const at = (input as SharedBoardTiming)[street];
    if (at === undefined) continue;
    if (
      typeof at !== 'number' ||
      !Number.isSafeInteger(at) ||
      at < 0 ||
      at < previous ||
      at > 86400000
    )
      return;
    times[street] = at;
    previous = at;
  }
  return previous >= 0 ? times : undefined;
}

export function recordedFrameTime(
  frame: ReplayFrame | undefined | null,
  board?: SharedBoardTiming
) {
  if (!frame) return;
  if (frame.key === 'deal') return 0;
  if (frame.row) return frame.row.atMs;
  const street = boardStreet(frame.board.length);
  if (street && frame.key === 'street-' + street) return board?.[street];
}

/** Allocate untimed rows between the nearest observed frames. Preserve every measured deadline. */
export function recordedFrameOffsets(
  frames: ReplayFrame[],
  board: SharedBoardTiming | undefined,
  defaultMs: (frame: ReplayFrame) => number,
  endAtMs?: number
) {
  const offsets: number[] = frames.map(() => 0);
  // Engine action stamps can arrive after the following street was already painted.
  // The recorded board is the visual boundary. Fit untimed actions inside it.
  let nextBoard = Infinity;
  const deadlines = frames.map(() => Infinity);
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].key.startsWith('street-') && board) {
      const at = recordedFrameTime(frames[i], board);
      if (at !== undefined) nextBoard = at;
    }
    deadlines[i] = nextBoard;
  }
  let anchor = 0;
  let weight = 0;
  for (let i = 1; i < frames.length; i++) {
    weight += Math.max(1, defaultMs(frames[i - 1]));
    offsets[i] = offsets[anchor] + weight;
    const observed = frames[i].isShowdown ? endAtMs : recordedFrameTime(frames[i], board);
    if (observed === undefined || observed < offsets[anchor] || observed > deadlines[i]) continue;
    const start = offsets[anchor];
    for (let j = anchor + 1; j <= i; j++) {
      offsets[j] = start + ((offsets[j] - start) / weight) * (observed - start);
    }
    anchor = i;
    weight = 0;
  }
  return offsets;
}
