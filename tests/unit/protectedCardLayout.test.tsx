import { paintedAvatarTop } from '../../src/components/table/avatarCrownBounds';
import { useRef } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProtectedCardLayout } from '../../src/hooks/useProtectedCardLayout';
import { installCssTranslateShim } from './support/cssTranslateShim';
function Fixture({
  revealed,
  revision = 'same-hand',
  potTop = 260,
  boardTop = 310,
  count = 6,
  seats = 9,
  width = 393,
  avatarSource = '',
  topCap = false,
  podClass,
}: {
  revealed: boolean;
  revision?: string;
  potTop?: number;
  boardTop?: number;
  count?: number;
  seats?: number;
  width?: number;
  avatarSource?: string;
  topCap?: boolean;
  podClass?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useProtectedCardLayout(ref, revision);
  return (
    <div className="table-page" data-seats={seats} data-box={`0,0,${width},852`}>
      <div className="bbj-mini-plate" data-box="130,20,140,14" />
      <div className="table-scaler" data-box="0,0,393,600" ref={ref}>
        <div className="community-area" data-box={`60,${boardTop},280,90`} />
        <div className="pot-display" data-box={`160,${potTop},80,30`} />
        <div className="seat__info" data-box="10,410,100,40" />
        <div className={podClass ?? `seat-wrapper--top${topCap ? ' seat-wrapper--cap' : ''}`}>
          <img
            className="seat__avatar-img"
            src={avatarSource || undefined}
            data-box="180,100,50,50"
            alt=""
          />
          {revealed && topCap && (
            <div className="seat__cards--revealed">
              {Array.from({ length: count }, (_, i) => (
                <div key={i} className="seat__card" data-box={`${80 + i * 10},0,20,35`} />
              ))}
            </div>
          )}
        </div>
        {revealed && !topCap && (
          <div className="seat__cards--revealed">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="seat__card" data-box={`${80 + i * 10},330,20,35`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
let restoreTranslate: () => void = () => {};
beforeEach(() => {
  restoreTranslate = installCssTranslateShim();
});
afterEach(() => {
  restoreTranslate();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function stubGeometry() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(393);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const [left = 0, top = 0, width = 0, height = 0] = (this.dataset.box ?? '')
      .split(',')
      .map(Number);
    const row = this.closest<HTMLElement>('.seat__cards--revealed');
    const pod = this.closest<HTMLElement>('.seat-wrapper--top');
    const [rx = 0, ry = 0] = (row?.style.translate || '0px 0px').split(' ').map(parseFloat);
    const [px = 0, py = 0] = (pod?.style.translate || '0px 0px').split(' ').map(parseFloat);
    const dx = rx + px,
      dy = ry + py;
    return {
      left: left + dx,
      top: top + dy,
      width,
      height,
      right: left + dx + width,
      bottom: top + dy + height,
      x: left + dx,
      y: top + dy,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

const settle = async (row: HTMLElement) => {
  await act(async () => {
    row.dispatchEvent(new Event('animationend', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
};

it('a child reveal after the parent commit is positioned clear of the real board and pot nodes', async () => {
  stubGeometry();
  const h = render(<Fixture revealed={false} />);
  const head = h.container.querySelector('.seat__avatar-img')!.getBoundingClientRect();
  const mini = h.container.querySelector('.bbj-mini-plate')!.getBoundingClientRect();
  // Dan 2026-10-22: "pull the table down so the top player isn't scrunched up" -
  // the top pod keeps 8px of air below the jackpot plate, not 4px.
  expect(head.top).toBe(mini.bottom + 8);
  await act(async () => h.rerender(<Fixture revealed />));
  const row = h.container.querySelector<HTMLElement>('.seat__cards--revealed')!;
  await waitFor(() => expect(row.style.translate).not.toBe(''));
  const settled = row.style.translate;
  // Runout/pot updates and animation completion must not re-place this hand.
  await act(async () =>
    h.rerender(<Fixture revealed revision="turn" potTop={200} boardTop={500} />)
  );
  await act(async () => {
    row.dispatchEvent(new Event('animationend', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(row.style.translate).toBe(settled);
  const card = row.querySelector('.seat__card')!.getBoundingClientRect();
  for (const element of h.container.querySelectorAll('.community-area,.pot-display,.seat__info')) {
    const box = element.getBoundingClientRect();
    expect(
      card.left < box.right &&
        card.right > box.left &&
        card.top < box.bottom &&
        card.bottom > box.top
    ).toBe(false);
  }
});

// Dan 2026-10-23: shown cards never move once they are on the table, in every
// game, not only PLO5/PLO6.
it.each([2, 4])(
  'a shown %i-card hand keeps its slot through the runout and effects',
  async (count) => {
    stubGeometry();
    // Shown on a clear felt, then the runout lands board cards over that spot.
    const h = render(<Fixture revealed count={count} boardTop={500} />);
    const row = h.container.querySelector<HTMLElement>('.seat__cards--revealed')!;
    await waitFor(() => expect(row.style.translate).not.toBe(''));
    const settled = row.style.translate;
    const step = row.style.getPropertyValue('--vh-step-f');
    const width = row.style.getPropertyValue('--vh-card-w');
    await act(async () =>
      h.rerender(<Fixture revealed count={count} revision="river" potTop={200} boardTop={310} />)
    );
    await settle(row);
    expect(row.style.translate).toBe(settled);
    expect(row.style.getPropertyValue('--vh-step-f')).toBe(step);
    expect(row.style.getPropertyValue('--vh-card-w')).toBe(width);
  }
);

it('a phone toolbar changing the viewport height alone does not move a shown hand', async () => {
  stubGeometry();
  const height = window.innerHeight;
  const h = render(<Fixture revealed boardTop={500} />);
  const row = h.container.querySelector<HTMLElement>('.seat__cards--revealed')!;
  await waitFor(() => expect(row.style.translate).not.toBe(''));
  const settled = row.style.translate;
  try {
    // Safari hides its toolbar on scroll; the felt itself keeps its size.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height + 84 });
    await act(async () => h.rerender(<Fixture revealed boardTop={310} potTop={200} />));
    await settle(row);
    expect(row.style.translate).toBe(settled);
  } finally {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  }
});

it('a new hand at the same seat is placed afresh', async () => {
  stubGeometry();
  const h = render(<Fixture revealed count={4} />);
  const row = h.container.querySelector<HTMLElement>('.seat__cards--revealed')!;
  await waitFor(() => expect(row.style.translate).not.toBe(''));
  await act(async () => h.rerender(<Fixture revealed={false} count={4} revision="next-hand" />));
  await act(async () =>
    h.rerender(<Fixture revealed count={4} revision="next-hand" boardTop={500} />)
  );
  const next = h.container.querySelector<HTMLElement>('.seat__cards--revealed')!;
  await settle(next);
  // The new hand is laid out against the new board, not pinned to the old slot.
  const card = next.querySelector('.seat__card')!.getBoundingClientRect();
  const board = h.container.querySelector('.community-area')!.getBoundingClientRect();
  expect(
    card.left < board.right &&
      card.right > board.left &&
      card.top < board.bottom &&
      card.bottom > board.top
  ).toBe(false);
});

// Top chairs reserve their mobile shown-card lane before reveal; revealing
// cards cannot reanchor the character. Desktop retains its original crown crop.
it.each([481, 606, 1024])(
  'six-max top chair retains its initial crown through reveal at width %i',
  async (width) => {
    stubGeometry();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    const h = render(
      <Fixture
        revealed={false}
        seats={6}
        width={width}
        avatarSource="/avatars/table/vip_wolf@2x.webp"
      />
    );
    const head = h.container.querySelector<HTMLImageElement>('.seat__avatar-img')!;
    const initialCrown = paintedAvatarTop(head);
    if (width <= 768) {
      const mini = h.container.querySelector('.bbj-mini-plate')!.getBoundingClientRect();
      expect(head.getBoundingClientRect().top).toBeCloseTo(mini.bottom + 9);
    } else {
      expect(initialCrown).toBeCloseTo(-2);
      expect(head.getBoundingClientRect().top).toBeLessThan(-2);
    }
    const pod = h.container.querySelector<HTMLElement>('.seat-wrapper--top')!;
    expect(pod.style.getPropertyValue('--sp-top-seat-shift')).toBe(
      pod.style.translate.split(' ')[1]
    );
    await act(async () =>
      h.rerender(
        <Fixture
          revealed
          seats={6}
          width={width}
          avatarSource="/avatars/table/vip_wolf@2x.webp"
          revision="flop"
        />
      )
    );
    expect(
      paintedAvatarTop(h.container.querySelector<HTMLImageElement>('.seat__avatar-img')!)
    ).toBeCloseTo(initialCrown);
  }
);

it.each([320, 375, 393, 430, 480])(
  'retains the safe legacy phone lane at %i CSS pixels',
  (width) => {
    stubGeometry();
    const h = render(
      <Fixture
        revealed={false}
        seats={6}
        width={width}
        avatarSource="/avatars/table/vip_wolf@2x.webp"
      />
    );
    expect(h.container.querySelector('.seat__avatar-img')!.getBoundingClientRect().top).toBe(42);
  }
);

it('mobile top-cap cards stay below the visible page edge', async () => {
  stubGeometry();
  vi.stubGlobal('innerWidth', 393);
  const h = render(<Fixture revealed topCap />);
  const row = h.container.querySelector<HTMLElement>('.seat__cards--revealed')!;
  await settle(row);
  const page = h.container.querySelector('.table-page')!.getBoundingClientRect();
  const card = row.querySelector('.seat__card')!.getBoundingClientRect();
  expect(card.top).toBeGreaterThanOrEqual(page.top + 8);
});

it('does not throw when an occupied opponent seat temporarily has zero measured parts during a render', () => {
  stubGeometry();
  const ref = { current: null as HTMLDivElement | null };
  function LiveTableScene({ handKey }: { handKey: string }) {
    useProtectedCardLayout(ref, 'rev-1', handKey);
    return (
      <div className="table-page" data-seats={9} data-box="0,0,393,852">
        <div
          className="table-scaler"
          data-box="0,0,393,600"
          ref={(el) => {
            ref.current = el;
          }}
        >
          <div className="community-area" data-box="60,220,280,90" />
          <div className="seat-wrapper seat-wrapper--left" data-box="5,100,66,110">
            <div className="seat seat--compact" data-box="5,100,66,110">
              <div className="seat__avatar" data-box="5,100,62,85">
                <img
                  className="seat__avatar-img"
                  src="/avatars/vip/dragon.png"
                  data-box="5,100,62,85"
                  alt=""
                />
              </div>
              <div className="seat__info" data-box="2,175,66,35" />
            </div>
          </div>
          <div className="seat-wrapper seat-wrapper--left" data-box="5,160,66,110">
            <div className="seat seat--compact" data-box="5,160,0,0">
              <div className="seat__avatar" data-box="5,160,0,0" />
              <div className="seat__info" data-box="2,235,0,0" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  expect(() => render(<LiveTableScene handKey="table-8:53819612" />)).not.toThrow();
});

it('advancing revision across preflop/flop/turn/river actions does not tear down settled top-pod or revealed-row styles', async () => {
  stubGeometry();
  vi.stubGlobal('innerWidth', 393);
  const h = render(<Fixture revealed revision="preflop-action-1" />);
  const row = h.container.querySelector<HTMLElement>('.seat__cards--revealed')!;
  const pod = h.container.querySelector<HTMLElement>('.seat-wrapper--top')!;
  await waitFor(() => expect(row.style.translate).not.toBe(''));
  const settledRowTranslate = row.style.translate;
  const settledPodTranslate = pod.style.translate;
  expect(settledPodTranslate).not.toBe('');

  const removeSpy = vi.spyOn(CSSStyleDeclaration.prototype, 'removeProperty');
  for (const rev of ['preflop-action-2', 'flop-deal', 'turn-bet', 'river-call']) {
    await act(async () => h.rerender(<Fixture revealed revision={rev} />));
    expect(row.style.translate).toBe(settledRowTranslate);
    expect(pod.style.translate).toBe(settledPodTranslate);
  }
  const removedProps = removeSpy.mock.calls.map(([prop]) => prop);
  expect(removedProps).not.toContain('--sp-top-seat-shift');
});

it('a seat that leaves the top lane drops its shift (Dan 2026-11-02, jam_degen on the felt)', async () => {
  /* A tournament table renders one snapshot as a cash table on reconnect, so
     its top seats carry seat-wrapper--top and are shifted. When isTournament
     arrives they are cap-only, outside the nine-seat lane. The shift must go
     with the lane, or that player sits on the felt for the rest of the session. */
  stubGeometry();
  const h = render(<Fixture revealed={false} podClass="seat-wrapper--top seat-wrapper--cap" />);
  const pod = () => h.container.querySelector<HTMLElement>('.seat-wrapper--cap')!;
  await waitFor(() => expect(pod().style.getPropertyValue('--sp-top-seat-shift')).not.toBe(''));
  expect(pod().style.translate).not.toBe('');
  await act(async () =>
    h.rerender(<Fixture revealed={false} revision="tournament" podClass="seat-wrapper--cap" />)
  );
  await waitFor(() => expect(pod().style.getPropertyValue('--sp-top-seat-shift')).toBe(''));
  expect(pod().style.translate).toBe('');
});

// Dan 2026-11-05, live FLH 0.50/1 on a phone: "MAMAPRIYA IS TOO LOW". Both
// top chairs share one rail line. Library art carries transparent canvas above
// the head (free_penguin 31%, vip_wolf 4%), and the table normalizes figure
// size, so the two image boxes differ while the painted figures match. The
// lane is measured from the painted crown, so the two plates sit level; the
// old image-box anchor parked the penguin's plate ~51px below the wolf's.
it('two top chairs on one rail line sit level whatever character each wears', () => {
  stubGeometry();
  function TwoTopChairs() {
    const ref = useRef<HTMLDivElement>(null);
    useProtectedCardLayout(ref, 'level');
    return (
      <div className="table-page" data-seats={9} data-box="0,0,393,852">
        <div className="bbj-mini-plate" data-box="130,20,140,14" />
        <div className="table-scaler" data-box="0,0,393,600" ref={ref}>
          <div className="community-area" data-box="60,420,280,90" />
          <div className="seat-wrapper--top" data-chair="penguin">
            <img
              className="seat__avatar-img"
              src="/avatars/table/free_penguin@2x.webp"
              data-box="0,100,174,174"
              alt=""
            />
            <div className="seat__info" data-box="40,270,96,37" />
          </div>
          <div className="seat-wrapper--top" data-chair="wolf">
            <img
              className="seat__avatar-img"
              src="/avatars/table/vip_wolf@2x.webp"
              data-box="200,100,123,123"
              alt=""
            />
            <div className="seat__info" data-box="214,219,96,37" />
          </div>
        </div>
      </div>
    );
  }
  const h = render(<TwoTopChairs />);
  const plate = (chair: string) =>
    h.container
      .querySelector(`[data-chair="${chair}"] .seat__info`)!
      .getBoundingClientRect().top;
  expect(Math.abs(plate('penguin') - plate('wolf'))).toBeLessThanOrEqual(2);
  // The wolf keeps its existing placement; the penguin rises to it, and its
  // painted head still keeps at least 8px of air below the jackpot plate.
  const mini = h.container.querySelector('.bbj-mini-plate')!.getBoundingClientRect();
  const wolf = h.container.querySelector('[data-chair="wolf"] .seat__avatar-img')!;
  expect(wolf.getBoundingClientRect().top).toBeCloseTo(mini.bottom + 8);
  const penguin = h.container.querySelector<HTMLImageElement>(
    '[data-chair="penguin"] .seat__avatar-img'
  )!;
  expect(paintedAvatarTop(penguin)).toBeGreaterThanOrEqual(mini.bottom + 8 - 0.01);
});
