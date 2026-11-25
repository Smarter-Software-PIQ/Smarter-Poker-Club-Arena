/**
 * A SWIPE NEVER ARMS CALL ANY (Dan 2026-11-24, CoachTim68).
 *
 * A finger that slid while pressing Fold used to arm Call Any (a rightward
 * drag with nothing selected landed on the right edge of the bar). Call Any is
 * uncapped, so that turned a fold into an all in. It now arms only from a tap.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PreActionBar from '../../src/components/table/PreActionBar';

function drag(el: Element, dx: number) {
  fireEvent.pointerDown(el, { clientX: 200, pointerType: 'touch' });
  fireEvent.pointerUp(el, { clientX: 200 + dx, pointerType: 'touch' });
}

function bar(props: { canCheck: boolean; currentBet: number; preAction?: any }) {
  const onPreActionChange = vi.fn();
  const view = render(
    <PreActionBar
      canCheck={props.canCheck}
      isMyTurn={false}
      preAction={props.preAction ?? null}
      onPreActionChange={onPreActionChange}
      currentBet={props.currentBet}
    />
  );
  const strip = view.container.querySelector('.pre-action-btn')!.parentElement!;
  return { onPreActionChange, strip };
}

describe('the pre-action bar swipe', () => {
  it.each([
    [true, 0],
    [false, 800],
    [false, 0],
  ])(
    'a rightward drag with nothing armed never arms Call Any (canCheck %s, bet %s)',
    (canCheck, currentBet) => {
      const { onPreActionChange, strip } = bar({ canCheck, currentBet });
      drag(strip, 120);
      expect(onPreActionChange).not.toHaveBeenCalledWith('callAny');
    }
  );

  it('a leftward drag from the last swipeable choice stops at the edge, not on Call Any', () => {
    const { onPreActionChange, strip } = bar({
      canCheck: false,
      currentBet: 800,
      preAction: 'call',
    });
    drag(strip, -120);
    expect(onPreActionChange).not.toHaveBeenCalled();
  });

  it('a swipe still steps between Fold and Call', () => {
    const { onPreActionChange, strip } = bar({
      canCheck: false,
      currentBet: 800,
      preAction: 'fold',
    });
    drag(strip, -120);
    expect(onPreActionChange).toHaveBeenCalledWith('call');
  });

  it('a swipe does not move an armed Call Any', () => {
    const { onPreActionChange, strip } = bar({
      canCheck: false,
      currentBet: 800,
      preAction: 'callAny',
    });
    drag(strip, 120);
    drag(strip, -120);
    expect(onPreActionChange).not.toHaveBeenCalled();
  });

  it('a tap on Call Any still arms it', () => {
    const { onPreActionChange } = bar({ canCheck: false, currentBet: 800 });
    fireEvent.click(screen.getByText('Call Any'));
    expect(onPreActionChange).toHaveBeenCalledWith('callAny');
  });
});
