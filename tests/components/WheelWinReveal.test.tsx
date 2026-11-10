import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WheelWinReveal } from '../../src/components/wheel/WheelWinReveal';
import { soundService } from '../../src/services/SoundService';
import { triggerHaptic } from '../../src/services/HapticService';

vi.mock('../../src/services/SoundService', () => ({
  soundService: { playWin: vi.fn(), playBigWin: vi.fn() },
}));
vi.mock('../../src/services/HapticService', () => ({ triggerHaptic: vi.fn() }));
afterEach(() => vi.clearAllMocks());

vi.mock('../../src/components/common/Modal', () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../src/components/console/SpadeConsole', () => ({
  SpadeConsole: ({ children, eyebrow }: { children: React.ReactNode; eyebrow?: string }) => (
    <div>
      <p data-eyebrow>{eyebrow}</p>
      {children}
    </div>
  ),
}));
vi.mock('../../src/utils/animationSpeed', () => ({ getAnimationSpeed: () => 1 }));

describe('the winning sector opens the awarded experience', () => {
  it('pauses the reveal while the player is in another tab', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('visible');
    const { container, unmount } = render(
      <WheelWinReveal
        prize={{ kind: 'bonus', game: 'crash' }}
        title="Diamond Crash"
        detail="Your Bonus"
        onOpen={vi.fn()}
      />
    );
    const opening = container.querySelector('[data-motion="keep"]') as HTMLElement;
    expect(opening.style.animationPlayState).toBe('running');
    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(opening.style.animationPlayState).toBe('paused');
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(opening.style.animationPlayState).toBe('running');
    unmount();
    visibility.mockRestore();
  });
  it('opens the earned game once after the burst without another tap', () => {
    vi.useFakeTimers();
    const opened = vi.fn();
    render(
      <WheelWinReveal
        prize={{ kind: 'bonus', game: 'mines' }}
        title="Diamond Mines"
        detail="Your bonus"
        onOpen={opened}
      />
    );
    const play = screen.getByRole('button', { name: 'Play Game' });
    expect(play).toBeEnabled();
    act(() => vi.advanceTimersByTime(999));
    expect(opened).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    fireEvent.click(play);
    expect(opened).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it.each([{ reserved: true }, { holdOpen: true }])(
    'preserves outstanding choices and reserved prizes',
    (props) => {
      vi.useFakeTimers();
      const opened = vi.fn();
      render(
        <WheelWinReveal
          {...props}
          prize={{ kind: 'chips' }}
          title="Claim"
          detail="Reserved"
          onOpen={opened}
        />
      );
      act(() => vi.advanceTimersByTime(6000));
      expect(opened).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button'));
      expect(opened).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    }
  );
  it('labels an upgrade Open Upgrade Wheel and waits for that tap as well', () => {
    const opened = vi.fn();
    const { container } = render(
      <WheelWinReveal
        prize={{ kind: 'upgrade' }}
        title="Bonus Upgrade"
        detail="Your Upgrade"
        onOpen={opened}
      />
    );
    fireEvent.animationEnd(container.querySelector('[data-motion="keep"]')!);
    expect(opened).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open Upgrade Wheel' }));
    expect(opened).toHaveBeenCalledTimes(1);
  });
  it('auto-continues ordinary prizes after three seconds and reveals earned games earlier', () => {
    vi.useFakeTimers();
    const chips = vi.fn();
    const game = vi.fn();
    render(
      <WheelWinReveal
        prize={{ kind: 'chips' }}
        title="12 Chips"
        detail="Returning"
        onOpen={chips}
      />
    );
    render(
      <WheelWinReveal
        prize={{ kind: 'bonus', game: 'plinko' }}
        title="Diamond Plinko"
        detail="Your Bonus"
        onOpen={game}
      />
    );
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(game).toHaveBeenCalledTimes(1);
    expect(chips).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(chips).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it('keeps an instant prize open for the player to read before continuing', () => {
    const opened = vi.fn();
    const { container } = render(
      <WheelWinReveal
        prize={{ kind: 'chips' }}
        title="3 Chips"
        detail="Paid To Your Account"
        onOpen={opened}
      />
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    fireEvent.animationEnd(container.querySelector('[data-motion="keep"]')!);
    expect(opened).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

/**
 * A RECEIPT SAYS WHAT IT IS (2026-09-22). Every chips receipt was headed "You
 * Won", including the one a Donkey Cross hit or a Crash crash pays out of the
 * guaranteed minimum. The wheel's own prizes are always won and keep it.
 */
describe('a receipt that is not a win says so', () => {
  const eyebrow = () => document.querySelector('[data-eyebrow]')?.textContent;
  it('heads the receipt with what the round was, when it was not a win', () => {
    render(
      <WheelWinReveal
        prize={{ kind: 'chips' }}
        title="0.10 Chips"
        detail="Hit At Street 3."
        eyebrow="Guarantee Paid"
        onOpen={vi.fn()}
      />
    );
    expect(eyebrow()).toBe('Guarantee Paid');
  });
  it('keeps You Won, and the wheel upgrade, when nothing overrides it', () => {
    const { unmount } = render(
      <WheelWinReveal
        prize={{ kind: 'chips' }}
        title="3 Chips"
        detail="Paid To Your Account"
        onOpen={vi.fn()}
      />
    );
    expect(eyebrow()).toBe('You Won');
    unmount();
    render(
      <WheelWinReveal
        prize={{ kind: 'upgrade' }}
        title="Super Spin"
        detail="Your Next Spin Is Doubled"
        onOpen={vi.fn()}
      />
    );
    expect(eyebrow()).toBe('Wheel Upgrade');
  });
});

/**
 * A RECEIPT NEVER CELEBRATES A LOSS (2026-09-22). This modal played a major
 * arpeggio and a 'success' haptic on mount for every chips receipt, which
 * includes a Donkey Cross hit, a Diamond Mines mine and a Crash crash - each
 * of which pays only the guaranteed minimum. The page that knows what the
 * round was says so.
 */
describe('a receipt that is not a win makes no sound', () => {
  it('plays nothing and buzzes nothing when the page asks for silence', () => {
    render(
      <WheelWinReveal
        prize={{ kind: 'chips' }}
        title="0.10 Chips"
        detail="Hit At Street 3."
        silent
        onOpen={vi.fn()}
      />
    );
    expect(soundService.playWin).not.toHaveBeenCalled();
    expect(soundService.playBigWin).not.toHaveBeenCalled();
    expect(triggerHaptic).not.toHaveBeenCalled();
  });
  it('still sings a win that nobody silenced', () => {
    render(
      <WheelWinReveal
        prize={{ kind: 'chips' }}
        title="3 Chips"
        detail="Paid To Your Account"
        onOpen={vi.fn()}
      />
    );
    expect(soundService.playWin).toHaveBeenCalledTimes(1);
    expect(vi.mocked(triggerHaptic).mock.calls).toEqual([['success']]);
  });
});
