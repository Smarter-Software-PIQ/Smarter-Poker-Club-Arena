import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const layout = vi.hoisted(() => ({
  prepare: vi.fn(() => false),
  space: vi.fn(() => false),
  awaitingMetadata: vi.fn(() => true),
  awaitingInitialLayout: vi.fn(() => false),
  lock: vi.fn(),
  ready: () => false,
  stop: vi.fn(),
}));
vi.mock('../../src/components/table/opponentAvatarLayout', () => ({
  createOpponentAvatarLayout: () => layout,
}));
import { useProtectedCardLayout } from '../../src/hooks/useProtectedCardLayout';

function Fixture({
  revision,
  handKey = 'hand-1',
  spectator = false,
}: {
  revision: string;
  handKey?: string;
  spectator?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useProtectedCardLayout(root, revision, handKey);
  return (
    <div className="table-page" data-hero={spectator ? 'false' : 'true'}>
      <div ref={root} />
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  layout.awaitingMetadata.mockReturnValue(true);
  layout.awaitingInitialLayout.mockReturnValue(false);
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

it('observers wait for portrait metadata before committing marker allocation', () => {
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
  vi.stubGlobal('innerWidth', 1024);
  vi.stubGlobal('innerHeight', 768);
  const view = render(<Fixture revision="preflop" spectator />);
  expect(layout.lock).not.toHaveBeenCalled();
  layout.awaitingMetadata.mockReturnValue(false);
  layout.awaitingInitialLayout.mockReturnValue(true);
  view.rerender(<Fixture revision="flop" spectator />);
  act(() => frames.shift()!(0));
  expect(layout.lock).not.toHaveBeenCalled();
  layout.awaitingInitialLayout.mockReturnValue(false);
  // A failed image releases metadata waiting through its own event, without
  // waiting for another action or changing the table's revision.
  act(() => view.container.querySelector('.table-page > div')!.dispatchEvent(new Event('error')));
  expect(frames).toHaveLength(1);
  act(() => frames.shift()!(0));
  expect(layout.lock).toHaveBeenCalledTimes(1);
});
