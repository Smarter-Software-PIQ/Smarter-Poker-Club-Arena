import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  computeRaisePresets,
  default as ActionPanel,
} from '../../src/components/table/ActionPanel';
import {
  ACTION_CONTROLLER_COLORS,
  DEFAULT_ACTION_CONTROLLER,
  normalizeActionController,
  validBetPresets,
} from '../../src/lib/actionController';

const input = {
  isPreflop: true,
  bigBlind: 2,
  currentBet: 10,
  callAmount: 8,
  pot: 42,
  minRaise: 20,
  maxRaise: 500,
};
const panel = {
  ...input,
  canFold: true,
  canCheck: false,
  canCall: true,
  canRaise: true,
  canAllIn: true,
  isMyTurn: true,
};

describe('custom action-controller sizing', () => {
  it('applies all four custom preflop multipliers to the bet faced', () => {
    const values = computeRaisePresets({ ...input, preflopPresets: [2, 2.2, 5, 6] });
    expect(values.slice(0, 4).map((p) => [p.label, p.value])).toEqual([
      ['2X', 20],
      ['2.2X', 22],
      ['5X', 50],
      ['6X', 60],
    ]);
  });
  it('uses the big blind for an unopened preflop pot', () => {
    expect(
      computeRaisePresets({ ...input, currentBet: 0, minRaise: 4, preflopPresets: [2, 3, 4, 5] })[0]
        .value
    ).toBe(4);
  });
  it('uses the pot after the outstanding call, without double-counting invested chips', () => {
    const values = computeRaisePresets({
      ...input,
      isPreflop: false,
      postflopPresets: [25, 40, 60, 125],
    });
    expect(values.slice(0, 4).map((p) => [p.label, p.value])).toEqual([
      ['25%', 23],
      ['40%', 30],
      ['60%', 40],
      ['125%', 73],
    ]);
  });
  it('caps custom percentages at the PLO maximum and preserves whole Diamonds', () => {
    for (const p of computeRaisePresets({
      ...input,
      isPreflop: false,
      isPotLimit: true,
      maxRaise: 60,
      unit: 1,
      postflopPresets: [33.3, 75, 150, 1000],
    })) {
      expect(p.value).toBeGreaterThanOrEqual(20);
      expect(p.value).toBeLessThanOrEqual(60);
      expect(Number.isInteger(p.value)).toBe(true);
    }
  });
  it('100% and POT agree even between blind-sized slider steps', () => {
    const values = computeRaisePresets({
      ...input,
      isPreflop: false,
      currentBet: 0,
      callAmount: 0,
      pot: 7205,
      minRaise: 600,
      maxRaise: 64000,
      smallestChip: 300,
    });
    expect(values.find((p) => p.label === '100%')?.value).toBe(7205);
    expect(values.find((p) => p.label === 'POT')?.value).toBe(7205);
  });
  it.each([
    null,
    [],
    [2, 3, 4],
    [2, 3, 4, NaN],
    [2, 3, 4, Infinity],
    [0, 3, 4, 5],
    [2, 3, 4, 101],
    [2.001, 3, 4, 5],
    ['2', 3, 4, 5],
  ])('rejects malformed multiplier settings: %j', (value) => {
    expect(validBetPresets(value, 100)).toBe(false);
    expect(normalizeActionController({ preflop: value }).preflop).toEqual([2.5, 3, 3.5, 4]);
  });
  it('offers Arena Blue plus five casino palettes and reserves red for All In', () => {
    expect(ACTION_CONTROLLER_COLORS.map((color) => color.id)).toEqual([
      'blue',
      'green',
      'navy',
      'platinum',
      'gold',
      'teal',
    ]);
    expect(normalizeActionController({ color: 'unknown' }).color).toBe('blue');
  });
  it('removes Back and a preset only sizes, never submits', () => {
    const action = vi.fn();
    render(<ActionPanel {...panel} onAction={action} />);
    fireEvent.click(screen.getByLabelText('Open Raise Panel'));
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^3X -/ }));
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Raise 30' }));
    expect(action).toHaveBeenCalledExactlyOnceWith('raise', 30);
  });
  it('number keys use the configured preset and do not snap exact multipliers to the slider grid', () => {
    const action = vi.fn();
    const props = {
      ...panel,
      bigBlind: 10,
      smallBlind: 5,
      currentBet: 15,
      minRaise: 30,
      controllerSettings: { ...DEFAULT_ACTION_CONTROLLER, preflop: [2.5, 3, 4, 5] },
      onAction: action,
    };
    const { rerender } = render(<ActionPanel {...props} raiseIntent={{ nonce: 0, open: false }} />);
    rerender(<ActionPanel {...props} raiseIntent={{ nonce: 1, open: true, presetIndex: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Raise 37.5' }));
    expect(action).toHaveBeenCalledWith('raise', 37.5);
  });
});

it('uses the taller overlapping rail only for nine-max tables', () => {
  const { container, rerender } = render(
    <ActionPanel {...panel} maxPlayers={6} onAction={vi.fn()} />
  );
  expect(container.querySelector('.action-panel')?.getAttribute('data-table-capacity')).toBe('6');
  rerender(<ActionPanel {...panel} maxPlayers={9} onAction={vi.fn()} />);
  expect(container.querySelector('.action-panel')?.getAttribute('data-table-capacity')).toBe('9');
});

it('offers a direct All In button in a shove-or-fold tournament even when regular raises are available', () => {
  const action = vi.fn();
  render(<ActionPanel {...panel} shoveOrFold onAction={action} />);
  expect(screen.queryByLabelText('Open Raise Panel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'All In' }));
  expect(action).not.toHaveBeenCalled();
  // Dan 2026-11-19: all-in is two actions - tap, then confirm.
  fireEvent.click(screen.getByRole('button', { name: 'Confirm All In' }));
  expect(action).toHaveBeenCalledWith('allin', expect.any(Number));
});
