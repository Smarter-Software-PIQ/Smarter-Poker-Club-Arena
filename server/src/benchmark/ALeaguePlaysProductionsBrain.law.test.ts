/**
 * A LEAGUE PLAYS PRODUCTION'S BRAIN (2026-11-15).
 *
 * These rules are always on in production (no option turns them off) and
 * each guards on the live decision contract - stateSchemaVersion 1, the
 * controller's legal menu, toCall, the wager bounds, the betting structure.
 * The league's decision state carried none of it, so in every arm of every
 * league card they returned unchanged (eval3 AUDIT-SCHEMA-GUARD.md,
 * 2026-11-15): this same census fired each of them 0 times before
 * LeagueDecisionState.ts. A league that cannot fire them measures a Horse
 * production never fields.
 *
 *  - riverNutsRaise (HorseRiverNuts.ts): the exact river nuts bet, raise or
 *    size up. Receipt river_nuts_wager.
 *  - fullPotNearPotWager (HorseRiverNuts.ts): a 90 to 100 percent pot wager
 *    goes full pot. Counted at its module boundary: its receipt
 *    near_pot_wager_full_pot counts only the wager_rules call site, and the
 *    legalize call site, which snaps the wager first, has none.
 *  - omahaCurrentNutsRaise (HorseOmahaCurrentNuts.ts): the Omaha current nuts
 *    facing a flop or turn bet raise. No receipt: counted at its module boundary.
 *  - the checked-to turn boat / river value bet (HorseLogic wager_rules:
 *    checkedToNonBottomBoat || checkedToOnePairAboveFlush). No receipt:
 *    counted when either predicate admits the spot - the last condition of
 *    the rule, so the bet follows.
 *  - headsUpCashCommitment (HorseHeadsUpCommitment.ts): receipts
 *    hu_cash_matched_commitment(_covered) when it prices the matched
 *    exposure, hu_cash_matched_commitment_wager when that changes the wager.
 *
 * The census is contiguous deal seeds from 1 (nothing selected), every seat a
 * Horse, through the league's own hand engine (playHand), and one duplicate
 * card through runMatchup. Every decision must carry the live contract and
 * choose from its menu inside its bounds, and the league must count 0 illegal
 * actions, 0 brain fallbacks and 0 truncated streets.
 */
import { describe, expect, it, vi } from 'vitest';

const fired = vi.hoisted(() => ({
  riverNutsRaise: 0,
  fullPotNearPotWager: 0,
  omahaCurrentNutsRaise: 0,
  checkedToValueBet: 0,
}));
vi.mock('../engine/HorseRiverNuts.js', async (actualModule) => {
  const actual = await actualModule<typeof import('../engine/HorseRiverNuts.js')>();
  return {
    ...actual,
    riverNutsRaise: (...args: Parameters<typeof actual.riverNutsRaise>) => {
      const out = actual.riverNutsRaise(...args);
      if (out !== args[0]) fired.riverNutsRaise++;
      return out;
    },
    fullPotNearPotWager: (...args: Parameters<typeof actual.fullPotNearPotWager>) => {
      const out = actual.fullPotNearPotWager(...args);
      if (out !== args[0]) fired.fullPotNearPotWager++;
      return out;
    },
  };
});
vi.mock('../engine/HorseOmahaCurrentNuts.js', async (actualModule) => {
  const actual = await actualModule<typeof import('../engine/HorseOmahaCurrentNuts.js')>();
  return {
    ...actual,
    omahaCurrentNutsRaise: (...args: Parameters<typeof actual.omahaCurrentNutsRaise>) => {
      const out = actual.omahaCurrentNutsRaise(...args);
      if (out !== args[0]) fired.omahaCurrentNutsRaise++;
      return out;
    },
  };
});
vi.mock('../engine/HorseNonBottomRiverValue.js', async (actualModule) => {
  const actual = await actualModule<typeof import('../engine/HorseNonBottomRiverValue.js')>();
  return {
    ...actual,
    checkedToNonBottomBoat: (...args: Parameters<typeof actual.checkedToNonBottomBoat>) => {
      const out = actual.checkedToNonBottomBoat(...args);
      if (out) fired.checkedToValueBet++;
      return out;
    },
    checkedToOnePairAboveFlush: (...args: Parameters<typeof actual.checkedToOnePairAboveFlush>) => {
      const out = actual.checkedToOnePairAboveFlush(...args);
      if (out) fired.checkedToValueBet++;
      return out;
    },
  };
});

import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import { HorseLogic, type HorseGameStateV2 } from '../engine/HorseLogic.js';
import type { HorseDecision, SeatPlayer } from '../types.js';
import { playHand, runMatchup } from './HorseLeague.js';

type Rule = keyof typeof fired;
const RULES = Object.keys(fired) as Rule[];
const RECEIPTS = [
  'river_nuts_wager',
  'hu_cash_matched_commitment',
  'hu_cash_matched_commitment_covered',
  'hu_cash_matched_commitment_wager',
] as const;

/** The census: contiguous deal seeds 1..hands, the rules each cell must fire. */
const CENSUS: ReadonlyArray<{
  variant: string;
  seats: number;
  hands: number;
  mustFire: readonly Rule[];
  mustReceipt: readonly (typeof RECEIPTS)[number][];
}> = [
  {
    variant: 'plo5',
    seats: 6,
    hands: 1000,
    mustFire: RULES,
    mustReceipt: ['river_nuts_wager', 'hu_cash_matched_commitment_wager'],
  },
  {
    variant: 'plo4',
    seats: 6,
    hands: 600,
    mustFire: ['riverNutsRaise', 'fullPotNearPotWager', 'omahaCurrentNutsRaise'],
    mustReceipt: ['river_nuts_wager', 'hu_cash_matched_commitment_wager'],
  },
  {
    variant: 'nlh',
    seats: 6,
    hands: 600,
    mustFire: ['riverNutsRaise', 'fullPotNearPotWager'],
    mustReceipt: ['river_nuts_wager', 'hu_cash_matched_commitment_wager'],
  },
  {
    variant: 'nlh',
    seats: 2,
    hands: 300,
    mustFire: ['fullPotNearPotWager'],
    mustReceipt: ['hu_cash_matched_commitment_wager'],
  },
];

/** Every HorseLogic.decide: the live contract, an action from its menu, inside its bounds. */
function watchDecisions() {
  const seen = { decisions: 0, offContract: 0, offMenu: [] as string[] };
  const decide = HorseLogic.decide.bind(HorseLogic);
  vi.spyOn(HorseLogic, 'decide').mockImplementation(((
    player: SeatPlayer,
    gs: HorseGameStateV2,
    ...rest: unknown[]
  ) => {
    const d = (decide as (...a: unknown[]) => HorseDecision)(player, gs, ...rest);
    seen.decisions++;
    if (gs.stateSchemaVersion !== 1 || !Array.isArray(gs.legalActions)) seen.offContract++;
    else {
      const sized = d.action === 'bet' || d.action === 'raise';
      const inMenu =
        gs.legalActions.includes(d.action) &&
        (!sized ||
          (Number.isFinite(d.amount) &&
            d.amount! >= gs.minRaiseTo! - 0.005 &&
            d.amount! <= gs.maxRaiseTo! + 0.005));
      if (!inMenu)
        seen.offMenu.push(
          `${gs.gameVariant} ${gs.stage} ${d.action} ${d.amount ?? ''} of ` +
            `${gs.legalActions.join('/')} [${gs.minRaiseTo}, ${gs.maxRaiseTo}]`
        );
    }
    return d;
  }) as typeof HorseLogic.decide);
  return seen;
}

describe("the league plays production's brain", () => {
  it('every always-on contract rule fires in a seeded league census, legally', async () => {
    enableBrainTelemetry();
    drainFires();
    const seen = watchDecisions();
    const total = Object.fromEntries(RULES.map((r) => [r, 0])) as Record<Rule, number>;
    const receipts: Record<string, number> = {};
    for (const cell of CENSUS) {
      for (const r of RULES) fired[r] = 0;
      const counters: { illegal: number; truncated: number; brainFallback?: number } = {
        illegal: 0,
        truncated: 0,
      };
      for (let seed = 1; seed <= cell.hands; seed++) {
        playHand(
          seed,
          1 + (seed % cell.seats),
          () => ({ telemetry: true }),
          counters,
          undefined,
          cell.variant,
          cell.seats,
          100,
          undefined,
          undefined,
          undefined,
          undefined,
          true,
          undefined,
          1_000_000 + seed * 1000
        );
      }
      const label = `${cell.variant} ${cell.seats}-handed, seeds 1..${cell.hands}`;
      expect(counters, label).toMatchObject({ illegal: 0, truncated: 0 });
      expect(counters.brainFallback ?? 0, label).toBe(0);
      const cellReceipts = Object.fromEntries(drainFires().map((f) => [f.feature, f.fires]));
      for (const rule of cell.mustFire)
        expect(fired[rule], `${label}: ${rule} fired`).toBeGreaterThan(0);
      for (const receipt of cell.mustReceipt)
        expect(cellReceipts[receipt] ?? 0, `${label}: receipt ${receipt}`).toBeGreaterThan(0);
      for (const r of RULES) total[r] += fired[r];
      for (const k of RECEIPTS) receipts[k] = (receipts[k] ?? 0) + (cellReceipts[k] ?? 0);
    }
    for (const rule of RULES) expect(total[rule], `${rule} fired`).toBeGreaterThan(0);
    expect(receipts.river_nuts_wager).toBeGreaterThan(0);
    expect(
      receipts.hu_cash_matched_commitment + receipts.hu_cash_matched_commitment_covered
    ).toBeGreaterThan(0);
    expect(receipts.hu_cash_matched_commitment_wager).toBeGreaterThan(0);

    // One duplicate card through the matchup path (per-pass sandboxes, mind on).
    const card = await runMatchup(
      {
        name: 'league_plays_productions_brain',
        variant: 'plo4',
        seats: 6,
        a: { telemetry: true },
        b: { telemetry: true },
      },
      30,
      20261115
    );
    expect(card.illegalActions).toBe(0);
    expect(card.truncatedStreets).toBe(0);
    expect(card.brainExceptionFallbacks ?? 0).toBe(0);

    expect(seen.decisions).toBeGreaterThan(10_000);
    expect(seen.offContract).toBe(0);
    expect(seen.offMenu).toEqual([]);
  }, 600_000);
});
