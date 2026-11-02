import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useProtectedCardLayout } from '../../src/hooks/useProtectedCardLayout';

function Table({ hand, player }: { hand: string; player: string }) {
  const root = useRef<HTMLDivElement>(null);
  useProtectedCardLayout(root, hand, hand);
  return (
    <div className="table-page" data-hero="true">
      <div ref={root} className="table-scaler">
        <div className="seat seat--hero" data-player-id={player}>
          <div className="seat__avatar">
            <img
              className="seat__avatar-img"
              src="https://example.test/startup-portrait.png"
              alt=""
            />
          </div>
        </div>
      </div>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reinitializes a loaded avatar ring at a new hand without calling an uninitialized scheduler', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  const cancel = vi.fn((id: number) => frames.delete(id));
  vi.stubGlobal('cancelAnimationFrame', cancel);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(1);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
  } as unknown as CanvasRenderingContext2D);
  const view = render(<Table hand="hand-1" player="first" />);
  await act(async () => {
    await Promise.resolve();
  });
  // Real decoded metadata, retained by the hook, now drives prepare synchronously.
  expect(frames.size).toBe(1);
  expect(() => view.rerender(<Table hand="hand-2" player="replacement" />)).not.toThrow();
  expect(frames.size).toBe(1);
  const pending = [...frames.keys()][0];
  view.unmount();
  expect(cancel).toHaveBeenCalledWith(pending);
  expect(frames.size).toBe(0);
});
