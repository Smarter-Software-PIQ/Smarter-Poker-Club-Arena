/**
 * LAW: THE PRICED MULTIWAY VALUE BET IS CHEAP WHERE IT APPLIES (omahaMultiwayValueBetIsPriced, M3; PLO-OWNER lead-7
 * 2026-11-26). The engine's own decide (HorseLogic.decide, the live PLO4 / PLO5 switch rows of the flop raise
 * fixture, mind off) on the committed real states (HorseOmahaFacingBetPriced.states.ndjson.gz: flop, turn and river)
 * made three-way and four-way (copies of the live opponent, no cards known, at free seats) with nothing to call and
 * every opponent's check of the street in the history: the spot M3 prices.
 *
 * Before the joint sample kept the hand's pool by card ids (anOmahaPricedJointRowsIsUnchanged), three-way states
 * measured 40.5 ms on against 1.1 ms off per decision (ratio 36.9), and offline on the compiled build (the option
 * cost harness, 600 applicable league states of two to four opponents, deep stacks among them) the option cost
 * p50 74.9 / p95 125.8 / max 214.6 ms. After it, the same harness on the same states: p50 4.3 / p95 5.8 / max 8.5 ms
 * (the harness keeps the best of three timings of a state, and the second and third find the hand's pool kept);
 * timed once per state, the pool built inside the timing: p50 5.9 / p95 7.8 / max 17.0 ms. A sample of a hand not
 * asked before costs 0.4 to 0.6 ms on a turn or river and 1.4 to 1.6 ms on a flop, against 5.7 to 14.5 ms before.
 * Here (vitest, source build, 2026-11-26; every decision a hand not asked before): 2.8 ms on against 1.2 off
 * three-way (ratio 2.3), 3.7 against 1.3 four-way (ratio 2.9).
 * Measured the way theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts): the decisions
 * with the option on cost at most RATIO times the same decisions with it off.
 */
import { describe, expect, it } from 'vitest';
import type { HorseDecision, SeatPlayer } from '../types.js';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { loadPricedStates, type PricedState } from './HorseOmahaFacingBetPriced.test-support.js';
import { FLOP_RAISE_FIXTURE } from './HorseOmahaFlopRaisePriced.test-support.js';
import { omahaMultiwayValueBetVerdict } from './HorseOmahaMultiwayValueBet.js';

const RATIO = 8;
const MODS = { tightness: 0.98, aggression: 1.18, bluffFreq: 0.91, sizingMultiplier: 0.94 };

function decide(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: Record<string, boolean>
): HorseDecision {
  HorseMind.reset();
  seedFastRandom(1);
  return HorseLogic.decide(
    structuredClone(player),
    structuredClone(gs),
    'grinder' as never,
    MODS as never,
    {
      ...FLOP_RAISE_FIXTURE.opts,
      ...on,
      mind: false,
      telemetry: false,
    } as never
  ) as HorseDecision;
}

/** The state checked to the Horse by `opponents` live players (copies of the live opponent at free seats). */
function checkedTo(
  s: PricedState,
  opponents: number
): { player: SeatPlayer; gs: HorseGameStateV2 } | null {
  const opp = (s.gs.players ?? []).find(
    (p) => p.seat !== s.player.seat && !p.is_folded && !p.is_all_in && !p.is_sitting_out
  );
  if (!opp) return null;
  const players = [...(s.gs.players ?? [])];
  const dealtSeatIds = [...((s.gs as { dealtSeatIds?: number[] }).dealtSeatIds ?? [])];
  while (
    players.filter(
      (p) => p.seat !== s.player.seat && !p.is_folded && !p.is_all_in && !p.is_sitting_out
    ).length < opponents
  ) {
    const used = new Set(players.map((p) => p.seat));
    let seat = 1;
    while (used.has(seat)) seat++;
    players.push({ ...opp, seat, user_id: `p${seat}`, username: `p${seat}`, cards: [] });
    dealtSeatIds.push(seat);
  }
  const street = s.gs.stage;
  const live = players.filter(
    (p) => p.seat !== s.player.seat && !p.is_folded && !p.is_all_in && !p.is_sitting_out
  );
  if (live.length !== opponents) return null;
  const actionHistory = [
    ...(s.gs.actionHistory ?? []).filter((a) => a.stage !== street),
    ...live.map((p) => ({ stage: street, seat: p.seat, action: 'check', amount: 0 })),
  ];
  const gs = {
    ...s.gs,
    players: players.map((p) => ({ ...p, bet: 0 })),
    dealtSeatIds,
    toCall: 0,
    currentBet: 0,
    legalActions: ['check', 'bet'],
    actionHistory,
  } as unknown as HorseGameStateV2;
  return { player: { ...s.player, bet: 0 }, gs };
}

describe('LAW: the priced multiway value bet is cheap where it applies', () => {
  const states = loadPricedStates();
  const ON = { omahaMultiwayValueBetIsPriced: true };

  for (const opponents of [2, 3]) {
    it(`checked to the Horse by ${opponents} players, flop, turn and river: on costs a bounded multiple of off`, () => {
      // the same number of flop, turn and river states of each game, where the spot is priced
      const nodes: Array<{ player: SeatPlayer; gs: HorseGameStateV2 }> = [];
      const per = new Map<string, number>();
      for (const s of states) {
        const cell = `${String(s.gs.gameVariant).toLowerCase()}|${s.gs.stage}`;
        if ((per.get(cell) ?? 0) >= 5) continue;
        const n = checkedTo(s, opponents);
        if (!n || omahaMultiwayValueBetVerdict(n.player, n.gs, 0.05) === null) continue;
        per.set(cell, (per.get(cell) ?? 0) + 1);
        nodes.push(n);
      }
      expect(per.size).toBe(6);
      expect(nodes.length).toBe(30);
      const cost = measureRelativeCost(
        () => {
          for (const n of nodes) decide(n.player, n.gs, ON);
        },
        () => {
          for (const n of nodes) decide(n.player, n.gs, {});
        },
        { warmupRounds: 1, rounds: 3 }
      );
      console.info(
        `[multiway value bet, ${opponents} opponents] on ${(cost.subjectMs / nodes.length).toFixed(2)} ms, off ${(cost.referenceMs / nodes.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
  }
});
