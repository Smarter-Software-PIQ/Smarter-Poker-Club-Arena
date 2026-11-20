/**
 * LAW - Dan 2026-11-19:
 *   "you need to fix the all in button from auto going all in. either the
 *    slider goes all the way up and you click all in, or if the all in button
 *    is clicked, they need to confirm all in. either way, two actions for all
 *    in, never just one."
 *
 * This supersedes the 2026-08-19 "do NOT add a confirm-all-in button" rule
 * (this file used to be actionpanel-no-allin-confirm.test.tsx and pinned the
 * opposite). No single tap, click or key press may dispatch `allin`.
 *
 * Every way to shove is covered:
 *   - the main-row ALL IN button (hero cannot raise / shove-or-fold);
 *   - the bet-sizing panel's ALL IN preset (moves the slider to the top);
 *   - dragging the slider to the top, then confirming;
 *   - the fixed-limit wager that is hero's whole stack;
 *   - the A key (allInIntent);
 *   - the multi-table tile buttons (source-pinned below).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ActionPanel, { ALL_IN_ARM_MS } from '../src/components/table/ActionPanel';

const baseProps = {
  canFold: true,
  canCheck: false,
  canCall: true,
  canAllIn: true,
  currentBet: 10,
  callAmount: 10,
  minRaise: 20,
  maxRaise: 500,
  pot: 40,
  bigBlind: 2,
  isMyTurn: true,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('main-row ALL IN: tap, then confirm', () => {
  it('does not shove on the first tap, even with confirmAllIn false', () => {
    const onAction = vi.fn();
    render(
      <ActionPanel {...baseProps} canRaise={false} confirmAllIn={false} onAction={onAction} />
    );
    fireEvent.click(screen.getByLabelText('All In'));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Confirm All In')).toBeInTheDocument();
  });

  it('shoves on the confirming tap, with the real all-in amount', () => {
    // PLO shape: maxRaise is the pot cap (120), allInTo is the stack (500).
    const onAction = vi.fn();
    render(
      <ActionPanel
        {...baseProps}
        canRaise={false}
        maxRaise={120}
        allInTo={500}
        onAction={onAction}
      />
    );
    fireEvent.click(screen.getByLabelText('All In'));
    fireEvent.click(screen.getByLabelText('Confirm All In'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('allin', 500);
  });

  it('the arm lapses: a tap long after the first is a first tap again', () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    render(<ActionPanel {...baseProps} canRaise={false} onAction={onAction} />);
    fireEvent.click(screen.getByLabelText('All In'));
    act(() => {
      vi.advanceTimersByTime(ALL_IN_ARM_MS + 50);
    });
    fireEvent.click(screen.getByLabelText('All In'));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('the arm does not survive the end of the turn', () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <ActionPanel {...baseProps} canRaise={false} onAction={onAction} />
    );
    fireEvent.click(screen.getByLabelText('All In'));
    rerender(<ActionPanel {...baseProps} canRaise={false} isMyTurn={false} onAction={onAction} />);
    rerender(<ActionPanel {...baseProps} canRaise={false} isMyTurn onAction={onAction} />);
    fireEvent.click(screen.getByLabelText('All In'));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('shove-or-fold is two actions too', () => {
    const onAction = vi.fn();
    render(<ActionPanel {...baseProps} canRaise={false} shoveOrFold onAction={onAction} />);
    fireEvent.click(screen.getByLabelText('All In'));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Confirm All In'));
    expect(onAction).toHaveBeenCalledWith('allin', 500);
  });
});

describe('bet-sizing panel: ALL IN runs the slider up, confirm shoves', () => {
  it('the ALL IN preset never dispatches; it puts the amount at the top', () => {
    const onAction = vi.fn();
    render(<ActionPanel {...baseProps} canRaise onAction={onAction} />);
    fireEvent.click(screen.getByLabelText('Open Raise Panel'));
    fireEvent.click(screen.getByLabelText(/^Bet All In/));
    expect(onAction).not.toHaveBeenCalled();
    const confirm = screen.getByLabelText(/^All In For/);
    expect(confirm.textContent).toContain('500');
    fireEvent.click(confirm);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('allin', 500);
  });
});

describe('fixed limit: the all-in wager is two actions', () => {
  it('arms on the first tap and shoves on the second', () => {
    const onAction = vi.fn();
    render(
      <ActionPanel
        {...baseProps}
        canRaise
        isFixedLimit
        minRaise={60}
        maxRaise={60}
        allInTo={60}
        onAction={onAction}
      />
    );
    fireEvent.click(screen.getByLabelText('All In'));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Confirm All In'));
    expect(onAction).toHaveBeenCalledWith('allin', 60);
  });

  it('an ordinary fixed-limit raise is still one tap', () => {
    const onAction = vi.fn();
    render(
      <ActionPanel
        {...baseProps}
        canRaise
        isFixedLimit
        minRaise={20}
        maxRaise={20}
        allInTo={500}
        onAction={onAction}
      />
    );
    fireEvent.click(screen.getByLabelText('Open Raise Panel'));
    expect(onAction).toHaveBeenCalledWith('raise', 20);
  });
});

describe('the A key is two presses', () => {
  it('first press opens the slider at the top, second press shoves', () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <ActionPanel {...baseProps} canRaise allInIntent={0} onAction={onAction} />
    );
    rerender(<ActionPanel {...baseProps} canRaise allInIntent={1} onAction={onAction} />);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^All In For/).textContent).toContain('500');
    rerender(<ActionPanel {...baseProps} canRaise allInIntent={2} onAction={onAction} />);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('allin', 500);
  });

  it('with no slider, first press arms and second press shoves', () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <ActionPanel {...baseProps} canRaise={false} allInIntent={0} onAction={onAction} />
    );
    rerender(<ActionPanel {...baseProps} canRaise={false} allInIntent={1} onAction={onAction} />);
    expect(onAction).not.toHaveBeenCalled();
    rerender(<ActionPanel {...baseProps} canRaise={false} allInIntent={2} onAction={onAction} />);
    expect(onAction).toHaveBeenCalledWith('allin', 500);
  });

  it('does nothing on mount', () => {
    const onAction = vi.fn();
    render(<ActionPanel {...baseProps} canRaise={false} allInIntent={7} onAction={onAction} />);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Confirm All In')).toBeNull();
  });
});

describe('source guards: no one-tap shove can come back', () => {
  const panel = readFileSync(resolve(__dirname, '../src/components/table/ActionPanel.tsx'), 'utf8');
  const table = readFileSync(resolve(__dirname, '../src/pages/TablePage.tsx'), 'utf8');
  const multi = readFileSync(resolve(__dirname, '../src/pages/MultiTablePage.tsx'), 'utf8');

  it("ActionPanel dispatches 'allin' only from the armed path and the confirm button", () => {
    const calls = panel.match(/onAction\('allin'/g) ?? [];
    expect(calls.length, "a new onAction('allin') call site needs a two-action gate").toBe(2);
  });

  it('the A key does not call the shove path directly', () => {
    expect(table).not.toMatch(/onAllIn:\s*\(\)\s*=>\s*void handleActionPanelAction\('allin'\)/);
  });

  it('the multi-table tile ALL IN opens the slider instead of submitting', () => {
    expect(multi).not.toMatch(/handleTileAction\(table\.id,\s*'raise',\s*tileAllIn\)/);
    expect(multi).toMatch(/onClick=\{\(\) => openTileAt\(tileAllIn\)\}/);
  });
});
