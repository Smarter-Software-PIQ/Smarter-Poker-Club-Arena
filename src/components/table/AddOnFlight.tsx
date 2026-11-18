import { useLayoutEffect, useRef } from 'react';
import { ADD_ON_BUBBLE_LIFETIME_MS } from './AddOnBubble';
import { restingAvatarTop, tableRenderScale } from './avatarCrownBounds';
import './AddOnFlight.css';

/** Plain ink travels from the actual bank to the visible avatar crown. */
export function AddOnFlight({ text, playerName }: { text: string; playerName?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const flight = ref.current;
    const wrapper = flight?.parentElement;
    if (!flight || !wrapper) return;
    const pane = wrapper.closest<HTMLElement>('.table-page');
    const measure = () => {
      const scale = tableRenderScale(wrapper);
      const box = wrapper.getBoundingClientRect();
      const bank =
        wrapper.querySelector<HTMLElement>('.seat__stack') ??
        wrapper.querySelector<HTMLElement>('.seat__info');
      const art = wrapper.querySelector<HTMLImageElement>('.seat__avatar-img');
      const bankBox = bank?.getBoundingClientRect() ?? box;
      const crown = art ? restingAvatarTop(art, scale) : box.top;
      const bounds = pane?.getBoundingClientRect();
      const left = Math.max(0, bounds?.left ?? 0) + 4;
      const right = Math.min(window.innerWidth, bounds?.right ?? window.innerWidth) - 4;
      flight.style.maxWidth = `${Math.max(0, right - left) / scale}px`;
      const half = (flight.offsetWidth * scale) / 2;
      const center = Math.max(
        left + half,
        Math.min(right - half, bankBox.left + bankBox.width / 2)
      );
      flight.style.left = `${(center - box.left) / scale}px`;
      flight.style.setProperty(
        '--add-on-start',
        `${(bankBox.top + bankBox.height / 2 - box.top) / scale - flight.offsetHeight / 2}px`
      );
      flight.style.setProperty(
        '--add-on-end',
        `${(Math.max((bounds?.top ?? 0) + 4, crown - 6 * scale - flight.offsetHeight * scale) - box.top) / scale}px`
      );
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(wrapper);
    if (pane) resized.observe(pane);
    const art = wrapper.querySelector<HTMLImageElement>('.seat__avatar-img');
    if (art) resized.observe(art);
    wrapper.addEventListener('load', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      resized.disconnect();
      wrapper.removeEventListener('load', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [text]);
  return (
    <div
      ref={ref}
      className="add-on-flight"
      style={{
        animationDuration: `calc(${ADD_ON_BUBBLE_LIFETIME_MS}ms * var(--animation-speed, 1))`,
      }}
      role="status"
      aria-live="polite"
      aria-label={playerName ? `${playerName}: ${text}` : text}
      data-motion="keep"
    >
      {text}
    </div>
  );
}
