/**
 * LAW: THE HEADS-UP RIVER OPENING BET IS PRICED ON HIS RANGE, WITH EXACT CARD REMOVAL, AND A BLUFF NEEDS BOTH THE
 * PRICE AND THE BLOCKERS (PLO-OWNER lead-7 lane plo-postflop, 2026-11-26; HorseOmahaRiverOpeningBet.ts).
 *  1. Card removal is exact: the bins' masses sum to one with and without the Horse's cards, and a nut-flush blocker
 *     empties the nut-flush bins of his range.
 *  2. With no record (equilibrium fold B / (P + B)) a hand with no showdown value and no blocker gain never bluffs.
 *  3. A bluff stands only where the Horse's cards raise his fold share (math AND blockers); a value bet only in position.
 *  4. Off, or out of its spot, the rule returns the same decision object; it changes only a check into a bet.
 *  5. Identity never enters: the same public record under another user id, name or person/Horse flag decides the same.
 */
import { describe, expect, it } from 'vitest';
import type { HorseDecision } from '../types.js';
import {
  OMAHA_RIVER_OPENING_BIN_EDGES,
  omahaRiverOpeningBetRule,
  omahaRiverOpeningBins,
  omahaRiverOpeningFoldMultiplier,
  omahaRiverOpeningPrice,
  omahaRiverOpeningSpot,
} from './HorseOmahaRiverOpeningBet.js';
import { RIVER_OPENING_FIXTURE, cards } from './HorseOmahaRiverOpeningBet.test-support.js';
import tables from './HorseOmahaRiverOpeningRangeTables.json' with { type: 'json' };

const T = tables as unknown as { cells: Record<string, { hist: number[] }> };
const CHECK = T.cells['plo4|checkfirst|bet']!.hist;
const IPSTART = T.cells['plo4|ipstart|bet']!.hist;
const SIZES = [33, 50, 75, 100];
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('LAW: the heads-up river opening bet is priced on his range', () => {
  it('card removal is exact and a nut-flush blocker empties his nut-flush bins', () => {
    const board = cards('Ts8s6s4c2h');
    const b = omahaRiverOpeningBins(cards('AsKd7h2c'), board, [])!;
    expect(b.mass0.length).toBe(OMAHA_RIVER_OPENING_BIN_EDGES.length - 1);
    expect(sum(b.mass0)).toBeCloseTo(1, 9);
    expect(sum(b.mass)).toBeCloseTo(1, 9);
    // the ace of spades leaves him no ace-high flush: the strongest bins lose their mass
    const top = (x: number[]) => x[0] + x[1];
    expect(top(b.mass)).toBeLessThan(top(b.mass0) * 0.75);
    const n = omahaRiverOpeningBins(cards('Jc9h5d3d'), board, [])!;
    expect(top(n.mass)).toBeGreaterThan(top(b.mass));
  });

  it('with no record, air with no blocker gain never bluffs; a strong hand in position is a value bet', () => {
    const none = omahaRiverOpeningFoldMultiplier(null);
    expect(none).toEqual({ m: 1, n: 0 });
    const board = cards('KsQd7h4c2s');
    for (const hole of ['JcTc9h8h', 'Jd9d8c3h', '6c5c3d3h']) {
      const v = omahaRiverOpeningPrice(
        IPSTART,
        omahaRiverOpeningBins(cards(hole), board, [])!,
        100,
        SIZES,
        0.04,
        none,
        'oop'
      )!;
      if (v.kind === 'bluff') expect(v.blocker).toBe(true);
      for (const r of v.rows)
        expect(r.ev - v.evCheck).toBeLessThanOrEqual(
          r.margin + 1e-9 + Math.max(0, (r.fold - r.fold0) * (100 + r.amount))
        );
    }
    const set = omahaRiverOpeningPrice(
      CHECK,
      omahaRiverOpeningBins(cards('KhKc5d3d'), board, [])!,
      100,
      SIZES,
      0.04,
      none,
      'ip'
    )!;
    expect(set.kind).toBe('value');
    expect(set.best!.eqCall).toBeGreaterThan(0.5);
  });

  it('his record moves the fold rate from equilibrium and dominates as it grows', () => {
    const few = omahaRiverOpeningFoldMultiplier({ foldBig: { folds: 9, opps: 10 } });
    const many = omahaRiverOpeningFoldMultiplier({ foldBig: { folds: 900, opps: 1000 } });
    expect(few.m).toBeGreaterThan(1);
    expect(many.m).toBeGreaterThan(few.m);
    expect(many.m).toBeCloseTo((900 + 75.9 * 0.4) / (500 + 75.9 * 0.4), 9);
    const station = omahaRiverOpeningFoldMultiplier({
      foldSmall: { folds: 0, opps: 300 },
      foldBig: { folds: 0, opps: 300 },
    });
    expect(station.m).toBeLessThan(0.2);
  });

  const nodes = RIVER_OPENING_FIXTURE.nodes;
  const node = nodes.find((n) => n.expect.bluff !== 'check')!;
  const decision: HorseDecision = { action: 'check', amount: 0 } as HorseDecision;
  const legal = (d: HorseDecision) => d;

  it('a bluff needs the blockers; a value bet needs position; off is the same object', () => {
    expect(node).toBeTruthy();
    const heavy = () => ({
      foldSmall: { folds: 950, opps: 1000 },
      foldBig: { folds: 990, opps: 1000 },
    });
    const on = omahaRiverOpeningBetRule(
      decision,
      node.player,
      node.gs,
      { value: false, bluff: true },
      0.04,
      legal,
      heavy
    );
    if (on.changed) {
      expect(on.kind).toBe('bluff');
      // the bluff placed is the best row that clears AND blocks (bluffBest; 2026-11-26 the blocker leg is read on
      // every size that clears, not only the best size overall)
      const placed = on.verdict!.bluffBest ?? on.verdict!.best!;
      expect(placed.fold).toBeGreaterThan(placed.fold0);
    }
    for (const n of nodes) {
      const r = omahaRiverOpeningBetRule(
        decision,
        n.player,
        n.gs,
        { value: true, bluff: true },
        0.04,
        legal,
        () => n.record
      );
      if (r.changed && r.kind === 'bluff') {
        const placed = r.verdict!.bluffBest ?? r.verdict!.best!;
        expect(placed.fold).toBeGreaterThan(placed.fold0);
      }
      if (r.changed && r.kind === 'value')
        expect(omahaRiverOpeningSpot(n.player, n.gs)!.position).toBe('ip');
      if (r.changed) expect(['bet', 'all_in']).toContain(r.decision.action);
    }
    const off = omahaRiverOpeningBetRule(
      decision,
      node.player,
      node.gs,
      { value: false, bluff: false },
      0.04,
      legal,
      heavy
    );
    expect(off.decision).toBe(decision);
    const bet = { action: 'bet', amount: 10 } as HorseDecision;
    expect(
      omahaRiverOpeningBetRule(
        bet,
        node.player,
        node.gs,
        { value: true, bluff: true },
        0.04,
        legal,
        heavy
      ).decision
    ).toBe(bet);
  });

  it('is out of scope multiway, outside PLO4/PLO5 cash and in tournaments', () => {
    const gs = structuredClone(node.gs);
    expect(omahaRiverOpeningSpot(node.player, gs)).not.toBeNull();
    const plo6 = { ...structuredClone(node.gs), gameVariant: 'plo6' };
    expect(omahaRiverOpeningSpot(node.player, plo6 as never)).toBeNull();
    const t = { ...structuredClone(node.gs), gameMode: 'tournament' };
    expect(omahaRiverOpeningSpot(node.player, t as never)).toBeNull();
    const mw = structuredClone(node.gs);
    mw.players = [
      ...mw.players,
      {
        ...structuredClone(mw.players.find((p) => p.seat !== node.player.seat)!),
        seat: 9,
        user_id: 'x9',
        is_folded: false,
      },
    ];
    expect(omahaRiverOpeningSpot(node.player, mw)).toBeNull();
  });

  it('never keys on identity: another user id, name or person flag with the same public record decides the same', () => {
    for (const n of nodes.slice(0, 20)) {
      const a = omahaRiverOpeningBetRule(
        decision,
        n.player,
        n.gs,
        { value: true, bluff: true },
        0.04,
        legal,
        () => n.record
      );
      const gs = structuredClone(n.gs);
      for (const p of gs.players)
        if (p.seat !== n.player.seat) {
          p.user_id = 'someone-else';
          (p as unknown as Record<string, unknown>).username = 'other';
          (p as unknown as Record<string, unknown>).is_horse = !(
            p as unknown as Record<string, unknown>
          ).is_horse;
          (p as unknown as Record<string, unknown>).isHuman = !(
            p as unknown as Record<string, unknown>
          ).isHuman;
        }
      const b = omahaRiverOpeningBetRule(
        decision,
        n.player,
        gs,
        { value: true, bluff: true },
        0.04,
        legal,
        () => n.record
      );
      expect([b.decision.action, b.decision.amount]).toEqual([
        a.decision.action,
        a.decision.amount,
      ]);
    }
  });
});
