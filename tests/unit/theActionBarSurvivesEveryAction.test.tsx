/**
 * Dan 2026-11-10: "the action bar on the bottom keeps glitching everytime a
 * player acts, it causes the action bar to fully reset, instead of changing
 * just the internal buttons."
 *
 * Every action moves currentPlayerSeat through N -> 0 -> M. The bridge that
 * keeps the pre-action bar up across the 0 was set by an effect, so the first
 * render showing the 0 had it off and the bar unmounted and remounted (its
 * 300ms entrance replayed) on every action. The harness below gates the real
 * PreActionBar exactly as TablePage does and feeds two opponent actions.
 */
import { act, cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { useEffect, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import PreActionBar from '../../src/components/table/PreActionBar';
import { useActorGapBridge } from '../../src/hooks/useActorGapBridge';
import { PRE_ACTION_GAP_BRIDGE_MS } from '../../src/lib/preActionPanelGate';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface Table {
  seat: number;
  owed: number;
}

/** The pre-change bridge, kept here only to prove the test sees the defect. */
function useEffectSetBridge(seat: number, inProgress: boolean): boolean {
  const [bridged, setBridged] = useState(false);
  useEffect(() => {
    if (seat > 0 || !inProgress) {
      setBridged(false);
      return;
    }
    setBridged(true);
    const t = window.setTimeout(() => setBridged(false), PRE_ACTION_GAP_BRIDGE_MS);
    return () => window.clearTimeout(t);
  }, [seat, inProgress]);
  return bridged;
}

function Harness({
  table,
  bridge,
}: {
  table: Table;
  bridge: (seat: number, inProgress: boolean) => boolean;
}) {
  const bridged = bridge(table.seat, true);
  const heroSeat = 1;
  const handStillTakingAction = table.seat > 0 || bridged;
  return handStillTakingAction && table.seat !== heroSeat ? (
    <PreActionBar
      canCheck={table.owed === 0}
      isMyTurn={false}
      preAction={null}
      onPreActionChange={() => {}}
      currentBet={table.owed}
    />
  ) : null;
}

function play(bridge: (seat: number, inProgress: boolean) => boolean) {
  const mounts: Element[] = [];
  const view = render(<Harness table={{ seat: 3, owed: 0 }} bridge={bridge} />);
  const record = () => {
    const bar = view.container.querySelector('.pre-action-bar');
    if (bar && !mounts.includes(bar)) mounts.push(bar);
    return bar;
  };
  record();
  // Seat 3 bets: the seat blanks, then the engine names seat 4.
  const steps: Table[] = [
    { seat: 0, owed: 2 },
    { seat: 4, owed: 2 },
    { seat: 0, owed: 6 },
    { seat: 5, owed: 6 },
  ];
  let everAbsent = false;
  for (const t of steps) {
    view.rerender(<Harness table={t} bridge={bridge} />);
    if (!record()) everAbsent = true;
  }
  return { mounts, everAbsent, container: view.container };
}

it('the bar keeps one DOM node through opponent actions; only its buttons change', () => {
  const { mounts, everAbsent, container } = play(useActorGapBridge);
  expect(everAbsent).toBe(false);
  expect(mounts).toHaveLength(1);
  // The buttons did change: Check is gone, the price shows.
  expect(container.textContent).toContain('Call 6');
  expect(container.textContent).not.toContain('Check');
});

it('the effect-set bridge it replaces did remount the bar (the defect)', () => {
  // act() flushes the effect before rerender returns, so the empty commit is
  // never seen here; the new DOM node it leaves behind is.
  const { mounts } = play(useEffectSetBridge);
  expect(mounts.length).toBeGreaterThan(1);
});

it('the bridge still expires, so a runout or a stall does not keep the bar up', () => {
  vi.useFakeTimers();
  const view = render(<Harness table={{ seat: 0, owed: 0 }} bridge={useActorGapBridge} />);
  expect(view.container.querySelector('.pre-action-bar')).not.toBeNull();
  act(() => {
    vi.advanceTimersByTime(PRE_ACTION_GAP_BRIDGE_MS + 1);
  });
  expect(view.container.querySelector('.pre-action-bar')).toBeNull();
  // The next actor reopens it, and the gap after that bridges again at once.
  view.rerender(<Harness table={{ seat: 4, owed: 0 }} bridge={useActorGapBridge} />);
  view.rerender(<Harness table={{ seat: 0, owed: 2 }} bridge={useActorGapBridge} />);
  expect(view.container.querySelector('.pre-action-bar')).not.toBeNull();
});

it('TablePage takes its bridge from the render-time hook', () => {
  const page = readFileSync('src/pages/TablePage.tsx', 'utf8');
  expect(page).toMatch(/const actorGapBridged = useActorGapBridge\(/);
  expect(page).not.toMatch(/setActorGapBridged/);
});
