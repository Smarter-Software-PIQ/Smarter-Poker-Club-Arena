import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const layout = vi.hoisted(() => ({
  prepare: vi.fn(() => false),
  space: vi.fn(() => false),
  awaitingMetadata: () => true,
  stop: vi.fn(),
}));
vi.mock('../../src/components/table/opponentAvatarLayout', () => ({
  createOpponentAvatarLayout: () => layout,
}));
import { useProtectedCardLayout } from '../../src/hooks/useProtectedCardLayout';

function Fixture({ revision, handKey = 'hand-1' }: { revision: string; handKey?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useProtectedCardLayout(root, revision, handKey);
  return (
    <div className="table-page" data-hero="true">
      <div ref={root} />
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('allocates once on mount and coalesces street revisions in the existing frame', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  const view = render(<Fixture revision="preflop" />);
  expect(layout.prepare).toHaveBeenCalledTimes(1);
  expect(frames).toHaveLength(0);
  view.rerender(<Fixture revision="flop" />);
  view.rerender(<Fixture revision="turn" />);
  expect(layout.prepare).toHaveBeenCalledTimes(1);
  expect(frames).toHaveLength(1);
  act(() => frames.shift()!(0));
  expect(layout.prepare).toHaveBeenCalledTimes(2);
  view.rerender(<Fixture revision="river" handKey="hand-2" />);
  expect(layout.prepare).toHaveBeenCalledTimes(3);
  expect(frames).toHaveLength(0);
});
