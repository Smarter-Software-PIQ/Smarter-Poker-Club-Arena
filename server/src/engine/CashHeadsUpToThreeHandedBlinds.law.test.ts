/**
 * CASH, HEADS-UP BACK TO THREE-HANDED: NOBODY POSTS THE SMALL BLIND TWICE
 * RUNNING (2026-11-13, heads-up lane, HU-EXE-002).
 *
 * Heads-up the button is the small blind. When a third player was dealt in,
 * the cash rotation walked the button forward onto the previous big blind:
 * that player never posted the small blind that follows a big blind, and the
 * previous button posted the small blind twice running, half a big blind
 * moved from one incumbent to the other at every such transition. The
 * tournament rule (deadButton.ts) and the three-handed-to-heads-up rule
 * (headsUpButton.ts) already prevented exactly this; the cash
 * heads-up-to-three path did not. The button now stays for the entry hand
 * (ServerTableEngineBase.cashButtonStaysAfterHeadsUp).
 *
 * Driven through the real ServerTableEngine.dealHand and HandController.start,
 * with the cash wait-for-big-blind gate applied the way the dealing loop
 * applies it, over all 32 seat layouts of two incumbents and one newcomer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/supabase/client.js', () => ({ supabase: {}, maintenanceSupabase: {} }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
const { ServerTableEngine } = await import('./ServerTableEngine.js');

const engines: any[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.preciseTimer.dispose();
    e.engineTelemetry?.dispose?.();
  }
});

const row = (seat: number) => ({
  seat_number: seat,
  user_id: `u${seat}`,
  username: `P${seat}`,
  stack: 10_000,
  is_horse: false,
  occupancy_id: `occupancy-${seat}`,
  seat_id: `00000000-0000-4000-8000-0000000000${String(seat).padStart(2, '0')}`,
  seat_joined_at: '2026-11-13T00:00:00.000Z',
});

function cashTable() {
  const e = new ServerTableEngine('hu-exe-002') as any;
  engines.push(e);
  e.tableInfo = {
    id: 'hu-exe-002',
    game_variant: 'nlh',
    game_type: 'cash',
    tournament_id: null,
    small_blind: 50,
    big_blind: 100,
    ante: 0,
  };
  e.takePreparedHandNumber = () => 123;
  e.bombPotSchedPersistedJson = 'null';
  e.disconnectEngine.isSittingOut = () => false;
  e.waitingForBB = new Set();
  return e;
}

type Hand = { dealt: number[]; button: number; sb: number; bb: number };

async function hand(e: any): Promise<Hand> {
  // The dealing loop's gate: a waiting player is released when the big blind reaches their seat.
  if (e.waitingForBB.size > 0) {
    const bbSeat = e.getBBSeatIndex();
    for (const id of [...e.waitingForBB]) {
      const p = e.seatedPlayers.find((s: any) => s.user_id === id);
      if (p && p.seat_number === bbSeat) e.waitingForBB.delete(id);
    }
  }
  const players = e.seatedPlayers.filter((p: any) => !e.waitingForBB.has(p.user_id));
  const stop = new Error('controller built');
  e.fetchTimeBankExtras = () => {
    throw stop;
  };
  await expect(e.dealHand(players)).rejects.toBe(stop);
  const hc = e.handController;
  const posted: Array<{ seat: number; kind: string }> = [];
  hc.onEvent((ev: any) => {
    if (ev.type === 'FORCED_BETS_POSTED') posted.push(...ev.postings);
  });
  hc.start();
  expect(posted.filter((p) => p.kind === 'bb')).toHaveLength(1);
  expect(posted.filter((p) => p.kind === 'post')).toHaveLength(0);
  return {
    dealt: players.map((p: any) => p.seat_number),
    button: hc.getDealerSeat(),
    sb: posted.find((p) => p.kind === 'sb')!.seat,
    bb: posted.find((p) => p.kind === 'bb')!.seat,
  };
}

describe('HU-EXE-002: cash heads-up to three-handed, nobody skips or repeats a blind', () => {
  for (const pair of [
    [1, 2],
    [1, 4],
    [2, 5],
    [3, 6],
  ])
    for (const firstButton of pair)
      for (const arrival of [1, 2, 3, 4, 5, 6].filter((s) => !pair.includes(s)))
        it(`heads-up seats ${pair.join(' and ')}, button ${firstButton}, a new player sits at ${arrival}`, async () => {
          const e = cashTable();
          const other = pair.find((s) => s !== firstButton)!;
          // The heads-up hand before the first one dealt here: button and small blind `other`, big blind `firstButton`.
          e.lastButtonSeat = other;
          e.lastSmallBlindSeat = other;
          e.lastBigBlindSeat = firstButton;
          e.seatedPlayers = pair.map(row);
          e.dealtInUserIds = new Set(pair.map((s) => `u${s}`));
          const hands: Hand[] = [await hand(e)];
          expect([hands[0].button, hands[0].sb, hands[0].bb]).toEqual([
            firstButton,
            firstButton,
            other,
          ]);

          e.seatedPlayers = [...pair, arrival].sort((a, b) => a - b).map(row);
          e.waitingForBB.add(`u${arrival}`);
          for (let i = 0; i < 6; i++) hands.push(await hand(e));

          const entry = hands.findIndex((h) => h.dealt.includes(arrival));
          expect(entry, 'the new player is dealt in within two hands').toBeGreaterThan(0);
          expect(entry).toBeLessThanOrEqual(2);
          // Published cash rule: a new player enters in the big blind, never on the button.
          expect(hands[entry].bb).toBe(arrival);
          expect(hands[entry].button).not.toBe(arrival);

          for (let i = 1; i < hands.length; i++) {
            const prev = hands[i - 1];
            const now = hands[i];
            const label = `hand ${i + 1}: ${JSON.stringify(prev)} -> ${JSON.stringify(now)}`;
            // Nobody posts the big blind twice running.
            expect(now.bb, label).not.toBe(prev.bb);
            // The player who just posted the big blind posts the small blind next.
            expect(now.sb, label).toBe(prev.bb);
            // Heads-up, the button is the small blind.
            if (now.dealt.length === 2) expect(now.sb, label).toBe(now.button);
          }
        });
});
