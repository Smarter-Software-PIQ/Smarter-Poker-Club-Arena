/**
 * A SEAT NEVER SAYS ZERO FOR A BALANCE IT DOES NOT KNOW (Dan 2026-11-18).
 *
 * "WHEN A PLAYER JOINS A TABLE IN BETWEEN THE BLINDS OR ANY OTHER REASON,
 * THEIR STACK SHOULD SHOW, IT SHOULD NEVER SAY ZERO."
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { standInStack } from '@/lib/standInStack';

const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('the stand-in for a seated player who is not in the hand', () => {
  it('shows the confirmed seat balance, including a confirmed zero', () => {
    expect(standInStack({ rowStack: 3632, paidBuyIn: 0 })).toEqual({
      stack: 3632,
      stackPending: false,
    });
    expect(standInStack({ rowStack: 0, paidBuyIn: 200 })).toEqual({
      stack: 0,
      stackPending: false,
    });
  });

  it('shows the buy-in this device just had confirmed until the row is read', () => {
    expect(standInStack({ rowStack: null, paidBuyIn: 200 })).toEqual({
      stack: 200,
      stackPending: false,
    });
  });

  it('never prints 0 for a balance nobody has confirmed: it is pending', () => {
    // Waiting for the big blind before the first seat read, a buy-in recovered
    // from its receipt, a tournament seat, a player first seen through presence.
    for (const unknown of [
      { rowStack: null, paidBuyIn: 0 },
      { rowStack: null },
      { rowStack: undefined, paidBuyIn: null },
      { rowStack: Number.NaN, paidBuyIn: 0 },
      { rowStack: -5, paidBuyIn: 0 },
    ]) {
      expect(standInStack(unknown)).toEqual({ stack: 0, stackPending: true });
    }
  });

  it('a Lightning seat between hands keeps its own answer', () => {
    expect(standInStack({ lightningStack: 950, rowStack: null })).toEqual({
      stack: 950,
      stackPending: false,
    });
    expect(standInStack({ lightningStack: null, rowStack: 400 })).toEqual({
      stack: 0,
      stackPending: true,
    });
  });

  it('every stand-in on the table page goes through it', () => {
    const page = src('src/pages/TablePage.tsx');
    expect(page).toContain("import { standInStack } from '../lib/standInStack';");
    // The hero's chair while they wait to be dealt in.
    expect(page).toContain('rowStack: heroRowStack,');
    expect(page).not.toContain('heroRowStack ?? pendingSeatStackRef.current ?? 0');
    // A player first seen through presence.
    expect(page).not.toContain('stack: existing?.stack ?? 0,');
    // ...and never inherits the previous occupant's chips.
    expect(page).toContain('...standInStack({ rowStack: null }),');
    expect(page).not.toContain('existing?.stack');
  });

  it('the seat draws its loading mark, not a number, while the balance is pending', () => {
    const seat = src('src/components/table/SeatSlot.tsx');
    expect(seat).toMatch(/player\.stackPending\s*\?\s*'\.\.\.'/);
  });
});
