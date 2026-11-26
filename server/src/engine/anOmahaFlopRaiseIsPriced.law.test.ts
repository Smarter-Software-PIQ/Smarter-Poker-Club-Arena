/**
 * LAW: A HEADS-UP FLOP RAISE IS PRICED ABOVE THE CALL AND THE FOLD, AT ITS BEST SIZE (PLO-OWNER lead-7 2026-11-26;
 * omahaFlopRaiseIsPriced, HorseOmahaFlopRaisePriced.ts).
 *  1. The bin equities are card-seeded (the same cards give the same numbers) and the bins' pool shares sum to one.
 *  2. A hand far ahead of the continuing range prices the pot raise above a small raise; a hand behind it prices the
 *     call or the fold above every raise.
 *  3. Only a raise is changed: a call, a fold or a check is returned as given (the same object), and off returns the
 *     raise as given. It never makes a raise.
 *  4. Out of its spot (multiway, the turn, PLO6, tournaments) it is silent; identity never enters.
 *  5. WHICH SIZE (2026-11-26, daily audit root cause D2): once the answer is a raise, two raise sizes are compared on
 *     the same footing, the same equity sample with no realization discount between them and no margin; the
 *     discount and the margin stay on the raise-or-call-or-fold question, and a size is taken only if it survives
 *     that question as the chain's own size did.
 */
import { describe, expect, it } from 'vitest';
import type { Card, HorseDecision } from '../types.js';
import {
  omahaFlopRaiseBinEquity,
  omahaFlopRaisePrice,
  omahaFlopRaisePricedRule,
  omahaFlopRaiseSpot,
} from './HorseOmahaFlopRaisePriced.js';
import { omahaMeasuredBettorRange } from './HorseOmahaMeasuredBettorRange.js';
import { FLOP_RAISE_FIXTURE } from './HorseOmahaFlopRaisePriced.test-support.js';

const cards = (s: string): Card[] =>
  (s.match(/../g) ?? []).map(
    (x) =>
      ({
        rank: x[0],
        suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[x[1] as 'c'],
      }) as Card
  );
const HIST = omahaMeasuredBettorRange('plo4', 'flop', 'agg', 0.75, 'hu', {
  record: null,
  readFactor: 1,
  minDefence: false,
})!.hist;
const SPOT = { pot: 76, toCall: 23, heroIn: 0, hisIn: 23 };

describe('LAW: a heads-up flop raise is priced above the call and the fold', () => {
  it('bin equities are card-seeded and the pool shares sum to one', () => {
    const a = omahaFlopRaiseBinEquity(cards('8h8d6c5c'), cards('8s7h2c'), [])!;
    const b = omahaFlopRaiseBinEquity(cards('8h8d6c5c'), cards('8s7h2c'), [])!;
    expect(a).toEqual(b);
    expect(a.mass.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
  });
  it('far ahead prices the pot raise above a small raise; behind prices the call or the fold above every raise', () => {
    const set = omahaFlopRaisePrice(
      HIST,
      omahaFlopRaiseBinEquity(cards('8h8d6c5c'), cards('8s7h2c'), [])!,
      SPOT,
      [46, 122],
      1000,
      0.9,
      0.04
    )!;
    const small = set.rows.find((r) => r.action === 'raise' && r.to === 46)!;
    const pot = set.rows.find((r) => r.action === 'raise' && r.to === 122)!;
    expect(pot.ev).toBeGreaterThan(small.ev);
    const weak = omahaFlopRaisePrice(
      HIST,
      omahaFlopRaiseBinEquity(cards('Ts9s8d7c'), cards('Js6h2d'), [])!,
      SPOT,
      [46, 122],
      1000,
      0.9,
      0.04
    )!;
    expect(weak.best.action).not.toBe('raise');
  });
  const nodes = FLOP_RAISE_FIXTURE.nodes;
  const n0 = nodes[0];
  const legal = (d: HorseDecision) => d;
  it('only a raise is changed; off and non-raises are the same object; it never makes a raise', () => {
    for (const d of [
      { action: 'call', amount: 5 },
      { action: 'fold', amount: 0 },
      { action: 'check', amount: 0 },
    ] as HorseDecision[])
      expect(
        omahaFlopRaisePricedRule(d, n0.player, n0.gs, true, 0.04, 0.9, legal, null).decision
      ).toBe(d);
    const raise = { action: 'raise', amount: (n0.gs.currentBet ?? 0) * 3 } as HorseDecision;
    expect(
      omahaFlopRaisePricedRule(raise, n0.player, n0.gs, false, 0.04, 0.9, legal, null).decision
    ).toBe(raise);
    for (const n of nodes) {
      const r = omahaFlopRaisePricedRule(
        { action: 'raise', amount: (n.gs.currentBet ?? 0) * 3 } as HorseDecision,
        n.player,
        n.gs,
        true,
        0.04,
        0.9,
        legal,
        null
      );
      expect(['raise', 'all_in', 'call', 'fold']).toContain(r.decision.action);
    }
  });
  it('which size: raise sizes are compared without the realization discount and without the margin', () => {
    const bins = omahaFlopRaiseBinEquity(cards('8h8d6c5c'), cards('8s7h2c'), [])!;
    const out = omahaFlopRaisePrice(HIST, bins, SPOT, [46, 84, 122], 1000, 0.75, 0.04)!;
    const full = omahaFlopRaisePrice(HIST, bins, SPOT, [46, 84, 122], 1000, 1, 0.04)!;
    for (const row of out.rows.filter((r) => r.action === 'raise')) {
      // the size footing is the price at realization one, whatever the street's realization
      const same = full.rows.find((r) => r.action === 'raise' && r.to === row.to)!;
      expect(row.evSize!).toBeCloseTo(same.ev, 9);
      expect(row.evSize!).toBeGreaterThanOrEqual(row.ev - 1e-9);
    }
    let insideMargin = 0;
    let raises = 0;
    for (const n of nodes) {
      for (const realization of [0.75, 0.85]) {
        const own = { action: 'raise', amount: n.gs.minRaiseTo ?? (n.gs.currentBet ?? 0) * 2 };
        const r = omahaFlopRaisePricedRule(
          own as HorseDecision,
          n.player,
          n.gs,
          true,
          0.04,
          realization,
          legal,
          null
        );
        const v = r.verdict;
        if (!v || r.changed === 'called' || r.changed === 'folded') continue;
        raises++;
        const rows = v.rows.filter((x) => x.action === 'raise');
        let other = v.rows[0];
        for (const x of v.rows) if (x.action !== 'raise' && x.ev > other.ev) other = x;
        const alive = rows.filter((x) => !(other.ev - x.ev > v.margin));
        const top = Math.max(...alive.map((x) => x.evSize!));
        const took = rows.find((x) => Math.abs(x.to - Number(r.decision.amount)) < 0.011);
        // the size taken is the survivor of highest same-footing price (the chain's own size when none survives)
        if (took && alive.length) expect(took.evSize!).toBeGreaterThanOrEqual(top - 1e-6);
        const mine = rows.find((x) => Math.abs(x.to - Number(own.amount)) < 0.011);
        if (r.changed === 'resized' && took && mine && !(took.ev - mine.ev > v.margin))
          insideMargin++;
      }
    }
    expect(raises).toBeGreaterThanOrEqual(20);
    // sizes the discounted gain could not move past the margin are moved now
    expect(insideMargin).toBeGreaterThanOrEqual(5);
  });
  it('is silent out of its spot and never keys on identity', () => {
    expect(omahaFlopRaiseSpot(n0.player, n0.gs)).not.toBeNull();
    expect(
      omahaFlopRaiseSpot(n0.player, { ...structuredClone(n0.gs), gameVariant: 'plo6' } as never)
    ).toBeNull();
    expect(
      omahaFlopRaiseSpot(n0.player, { ...structuredClone(n0.gs), gameMode: 'tournament' } as never)
    ).toBeNull();
    expect(
      omahaFlopRaiseSpot(n0.player, { ...structuredClone(n0.gs), stage: 'turn' } as never)
    ).toBeNull();
    const mw = structuredClone(n0.gs);
    mw.players = [
      ...mw.players,
      {
        ...structuredClone(mw.players.find((p) => p.seat !== n0.player.seat)!),
        seat: 9,
        user_id: 'x9',
        is_folded: false,
      },
    ];
    expect(omahaFlopRaiseSpot(n0.player, mw)).toBeNull();
    for (const n of nodes.slice(0, 15)) {
      const raise = { action: 'raise', amount: (n.gs.currentBet ?? 0) * 3 } as HorseDecision;
      const a = omahaFlopRaisePricedRule(raise, n.player, n.gs, true, 0.04, 0.9, legal, null);
      const gs = structuredClone(n.gs);
      for (const p of gs.players)
        if (p.seat !== n.player.seat) {
          p.user_id = 'someone-else';
          (p as unknown as Record<string, unknown>).is_horse = !(
            p as unknown as Record<string, unknown>
          ).is_horse;
          (p as unknown as Record<string, unknown>).username = 'other';
        }
      const b = omahaFlopRaisePricedRule(raise, n.player, gs, true, 0.04, 0.9, legal, null);
      expect([b.decision.action, b.decision.amount]).toEqual([
        a.decision.action,
        a.decision.amount,
      ]);
    }
  });
});
