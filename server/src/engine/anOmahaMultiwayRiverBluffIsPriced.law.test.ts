/**
 * LAW: THE MULTIWAY RIVER OPENING BLUFF IS MATH AND BLOCKERS, PRICED ON PEOPLE (PLO-OWNER lead-9 lane underbluff,
 * 2026-11-27; HorseOmahaMultiwayRiverBluff.ts, option omahaMultiwayRiverBluffIsPricedOnBlockers, default OFF).
 *  1. Off, heads-up, facing a wager or on any decision that is not a check, the rule returns the same object.
 *  2. It changes only a check into a bet (never a raise, never a fold), and every bet it makes clears the price by
 *     more than its margin AND has a positive blocker effect on the field; it is never a value bet.
 *  3. Each opponent's own record moves his fold: against opponents who never fold a multiway river bet it never
 *     bluffs; against opponents who always fold every size is worth at least what it is worth with no record.
 *  4. Identity never enters: another user id, name or person/Horse flag with the same public record decides the same.
 *  5. An opponent who is all in, PLO6, a tournament and a bomb pot are out of the spot.
 *  6. The people table is people-only and public: a Horse's answer never enters a cell, a hole-card column changes
 *     nothing, and every cell's multiplier is read against the multiway equilibrium (B / (P + B)) ^ (1 / N).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  OMAHA_MULTIWAY_RIVER_FOLD_VERSION,
  omahaMultiwayRiverBluffRule,
  omahaMultiwayRiverBluffSpot,
  omahaMultiwayRiverPeopleFold,
} from './HorseOmahaMultiwayRiverBluff.js';
import { RIVER_OPENING_FIXTURE } from './HorseOmahaRiverOpeningBet.test-support.js';
import tables from './HorseOmahaMultiwayRiverFoldTables.json' with { type: 'json' };

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECK = { action: 'check', amount: 0 } as HorseDecision;
const legal = (d: HorseDecision) => d;
type Rec = { foldSmall: { folds: number; opps: number }; foldBig: { folds: number; opps: number } };
const none = () => null;
const always = (): Rec => ({
  foldSmall: { folds: 1000, opps: 1000 },
  foldBig: { folds: 1000, opps: 1000 },
});
const never = (): Rec => ({
  foldSmall: { folds: 0, opps: 1000 },
  foldBig: { folds: 0, opps: 1000 },
});

/** A real heads-up river node of the fixture with one folded seat put back in: a three-way river, nothing to call. */
function multiway(i: number): { player: SeatPlayer; gs: HorseGameStateV2 } | null {
  const n = RIVER_OPENING_FIXTURE.nodes[i]!;
  const gs = structuredClone(n.gs) as HorseGameStateV2;
  const extra = (gs.players ?? []).find((p) => p.seat !== n.player.seat && p.is_folded);
  if (!extra) return null;
  extra.is_folded = false;
  extra.is_all_in = false;
  extra.stack = Math.max(extra.stack, gs.pot);
  // nobody has acted on the river
  gs.actionHistory = (gs.actionHistory ?? []).filter((a) => String(a.stage) !== 'river');
  return omahaMultiwayRiverBluffSpot(n.player, gs) ? { player: n.player, gs } : null;
}
const NODES = RIVER_OPENING_FIXTURE.nodes
  .map((_, i) => multiway(i))
  .filter((x): x is { player: SeatPlayer; gs: HorseGameStateV2 } => x !== null);
const run = (
  x: { player: SeatPlayer; gs: HorseGameStateV2 },
  rec: () => Rec | null,
  on = true,
  d: HorseDecision = CHECK
) => omahaMultiwayRiverBluffRule(d, x.player, x.gs, on, 0.04, legal, rec);

describe('LAW: the multiway river opening bluff is math and blockers, priced on people', () => {
  it('has real three-way river nodes to decide', () => {
    expect(NODES.length).toBeGreaterThanOrEqual(20);
  });

  it('off, heads-up, facing a wager or not a check: the same object', () => {
    for (const x of NODES.slice(0, 10)) {
      expect(run(x, always, false).decision).toBe(CHECK);
      const bet = { action: 'bet', amount: 10 } as HorseDecision;
      expect(run(x, always, true, bet).decision).toBe(bet);
      const facing = { ...structuredClone(x.gs), toCall: 5, currentBet: 5 } as HorseGameStateV2;
      expect(
        omahaMultiwayRiverBluffRule(CHECK, x.player, facing, true, 0.04, legal, always).decision
      ).toBe(CHECK);
    }
    for (const n of RIVER_OPENING_FIXTURE.nodes.slice(0, 20)) {
      expect(omahaMultiwayRiverBluffSpot(n.player, n.gs as HorseGameStateV2)).toBeNull();
      expect(
        omahaMultiwayRiverBluffRule(
          CHECK,
          n.player,
          n.gs as HorseGameStateV2,
          true,
          0.04,
          legal,
          always
        ).decision
      ).toBe(CHECK);
    }
  });

  it('only a check into a bet; every bet clears the price by its margin with a positive blocker effect', () => {
    let bets = 0;
    for (const x of NODES)
      for (const rec of [none, always]) {
        const r = run(x, rec);
        if (!r.changed) {
          expect(r.decision).toBe(CHECK);
          continue;
        }
        bets++;
        expect(['bet', 'all_in']).toContain(r.decision.action);
        expect(r.decision.amount as number).toBeLessThanOrEqual(x.player.stack + 0.005);
        const b = r.verdict!.best!;
        expect(b.ev - r.verdict!.evCheck).toBeGreaterThan(b.margin);
        expect(b.fold).toBeGreaterThan(b.fold0);
        expect(b.value).toBe(false);
        expect(r.verdict!.opponents).toBeGreaterThanOrEqual(2);
      }
    expect(bets).toBeGreaterThan(0);
  });

  it('his own record moves the price: never against opponents who never fold, every size worth more against those who always fold', () => {
    let folder = 0;
    for (const x of NODES) {
      expect(run(x, never).changed).toBe(false);
      const base = run(x, none);
      const fold = run(x, always);
      if (fold.changed) folder++;
      // the same size is worth more against opponents who fold more (the blocker leg may still refuse it)
      if (base.verdict && fold.verdict)
        for (const row of base.verdict.rows) {
          const other = fold.verdict.rows.find((r) => r.amount === row.amount);
          if (other) expect(other.ev).toBeGreaterThanOrEqual(row.ev - 1e-6);
        }
    }
    expect(folder).toBeGreaterThan(0);
  });

  it('identity never enters', () => {
    for (const x of NODES.slice(0, 20)) {
      const a = run(x, none);
      const gs = structuredClone(x.gs);
      for (const p of gs.players ?? [])
        if (p.seat !== x.player.seat) {
          p.user_id = `other-${p.seat}`;
          p.username = `name-${p.seat}`;
          (p as { is_horse?: boolean }).is_horse = !(p as { is_horse?: boolean }).is_horse;
        }
      const b = omahaMultiwayRiverBluffRule(CHECK, x.player, gs, true, 0.04, legal, none);
      expect(b.decision.action).toBe(a.decision.action);
      expect(b.decision.amount).toBe(a.decision.amount);
    }
  });

  it('an all-in opponent, PLO6, a tournament and a bomb pot are out of the spot', () => {
    const x = NODES[0]!;
    const allIn = structuredClone(x.gs);
    (allIn.players ?? []).find((p) => p.seat !== x.player.seat && !p.is_folded)!.is_all_in = true;
    expect(omahaMultiwayRiverBluffSpot(x.player, allIn)).toBeNull();
    expect(
      omahaMultiwayRiverBluffSpot(x.player, {
        ...structuredClone(x.gs),
        gameVariant: 'plo6',
      } as never)
    ).toBeNull();
    expect(
      omahaMultiwayRiverBluffSpot(x.player, {
        ...structuredClone(x.gs),
        gameMode: 'tournament',
      } as never)
    ).toBeNull();
    expect(
      omahaMultiwayRiverBluffSpot(x.player, { ...structuredClone(x.gs), bombPot: true } as never)
    ).toBeNull();
  });

  it('the people table is people-only, public, and read against the multiway equilibrium', async () => {
    const T = tables as unknown as {
      version: string;
      cells: Record<string, { n: number; fold: number; raise: number; eq: number }>;
    };
    expect(OMAHA_MULTIWAY_RIVER_FOLD_VERSION).toBe(T.version);
    for (const c of Object.values(T.cells)) {
      expect(c.fold).toBeLessThanOrEqual(c.n);
      expect(c.eq).toBeGreaterThan(0);
      expect(c.eq).toBeLessThan(c.n);
    }
    expect(omahaMultiwayRiverPeopleFold('plo6', 'chk', 0.8)).toEqual({ m: 1, n: 0 });
    const big = omahaMultiwayRiverPeopleFold('plo5', 'chk', 0.9);
    expect(big.n).toBe(T.cells['plo5|all|c70-110']!.n);
    expect(big.m).toBeGreaterThan(1);
    const mod = (await import(
      join(__dirname, '../../../scripts/ops/omaha-multiway-river-fold-fit.mjs')
    )) as {
      multiwayRiverAnswers: (
        row: unknown
      ) => Array<{ fold: boolean; eq: number; line: string; size: string }>;
    };
    const row = (horseAnswers: boolean, extra: Record<string, unknown> = {}) => ({
      id: 'h',
      created_at: '2026-11-27',
      gv: 'plo5',
      bb: 2,
      bomb: false,
      pl: [
        [1, 'a', true],
        [2, 'b', horseAnswers],
        [3, 'c', false],
      ],
      ac: [
        [1, 'preflop', 'call', 2, 'x', false, null, 'a'],
        [2, 'preflop', 'call', 2, 'x', false, null, 'b'],
        [3, 'preflop', 'call', 2, 'x', false, null, 'c'],
        [1, 'river', 'bet', 6, 'x', false, 6, 'a'],
        [2, 'river', 'fold', 0, 'x', false, null, 'b'],
        [3, 'river', 'call', 6, 'x', false, null, 'c'],
      ],
      ...extra,
    });
    const people = mod.multiwayRiverAnswers(row(false));
    expect(people.map((x) => x.fold)).toEqual([true, false]);
    expect(people[0]!.eq).toBeCloseTo(Math.sqrt(0.5), 6);
    expect(people[0]!.line).toBe('chk');
    expect(people[0]!.size).toBe('c70-110');
    // the Horse's answer never enters; a hole-card column changes nothing
    expect(mod.multiwayRiverAnswers(row(true)).map((x) => x.fold)).toEqual([false]);
    expect(
      mod.multiwayRiverAnswers(row(false, { hc: { b: ['As', 'Ks', 'Qs', 'Js', 'Ts'] } }))
    ).toEqual(people);
  });
});
