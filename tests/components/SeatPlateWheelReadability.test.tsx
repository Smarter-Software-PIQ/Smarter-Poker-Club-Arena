import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { WheelCabinet, WheelEntry } from '../../src/components/wheel/WheelCabinet';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (css: string, selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].trim() === selector)
    .map((match) => match[2]);
afterEach(cleanup);

describe('player plates stay readable across the complete responsive cascade', () => {
  const css = read('src/components/table/SeatSlot.css');
  it('names and chip counts never return to the 8-10px phone sizes', () => {
    for (const [selector, floor] of [
      ['.seat__name', 0.75],
      ['.seat__stack', 0.875],
    ] as const) {
      const matches = rules(css, selector);
      expect(matches.length).toBeGreaterThan(0);
      for (const body of matches) {
        const size = body.match(/font-size:\s*(?:clamp\()?([\d.]+)rem/);
        expect(size, selector).not.toBeNull();
        expect(Number(size![1]), selector).toBeGreaterThanOrEqual(floor);
      }
    }
    const page = read('src/pages/TablePage.css');
    expect(rules(page, '.seat__name')).toEqual([]);
    expect(rules(page, '.seat__stack')).toEqual([]);
  });
  it('each plate fills its seat so wider names do not silently shrink the box', () => {
    expect(rules(css, '.seat__info')[0]).toMatch(/width:\s*100%/);
    for (const body of rules(css, '.seat__info')) {
      const height = body.match(/min-height:\s*(?:clamp\()?([\d.]+)px/);
      expect(height).not.toBeNull();
      // Owner-requested proportional mobile boxes retain room for two readable lines.
      expect(Number(height![1])).toBeGreaterThanOrEqual(40);
    }
  });
});

describe('Diamond Spins data and actions own separate layout space', () => {
  it('preserves live balances, explicit entry and a single paid action', () => {
    let stake = 0;
    render(
      <WheelCabinet
        title="Diamond Spins"
        titleId="wheel-title"
        bays={[
          { label: 'Diamonds', value: '471K' },
          { label: 'Club Chips', value: '2.6K' },
        ]}
        entry={
          <WheelEntry
            value={100}
            availableDiamonds={10000}
            disabled={false}
            onChange={(value) => {
              stake = value;
            }}
          />
        }
        primary={{ label: 'Spin 100', disabled: true, onClick: () => {} }}
      />
    );
    const list = screen.getByText('471K').closest('dl')!;
    expect(list.textContent).toContain('471K');
    expect(list.parentElement).toBe(
      screen.getByRole('button', { name: 'Spin 100' }).parentElement?.parentElement
    );
    expect(screen.getByRole('button', { name: 'Spin 100' })).toBeDisabled();
    // jsdom does not implement showModal. Keyboard and modal activation run in Chromium.
    screen.getByRole('dialog', { hidden: true }).setAttribute('open', '');
    fireEvent.change(screen.getByLabelText('Diamonds To Spin'), { target: { value: '375' } });
    expect(stake).toBe(375);
    fireEvent.click(screen.getByRole('button', { name: 'Max' }));
    expect(stake).toBe(10000);
    expect(screen.getByLabelText('Diamonds To Spin')).toHaveAccessibleDescription(
      'Available: 10,000'
    );
    expect(
      screen.getByRole('heading', { name: 'Diamond Spins' }).querySelector('img')
    ).toHaveAttribute('src', expect.stringMatching(/diamond-spins-badge\.webp$/));
    expect(screen.queryByRole('button', { name: /Run Off|Auto Spin/i })).toBeNull();
  });
});
