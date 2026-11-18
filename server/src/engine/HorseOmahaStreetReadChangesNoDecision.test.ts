/**
 * THE STREET READ CHANGES NO DECISION (2026-11-17). The postflop read by street and flop texture
 * (HorseOmahaStreetRead, horse_exact_profiles.street_counters) is carried into an Omaha decision's own state and
 * read by nothing. This file proves it on recorded decisions: the fifty recorded PLO4 / PLO5 turn and river
 * decisions behind HorseOmahaFacingBetEv.test.ts, each decided from the same random state with the column empty
 * (no record carried) and with the column full (a record for every opponent at the table, in every size and mode,
 * once shaped like a wide flop bettor who gives up and once like a value-only bettor), with the release options
 * and again with every Omaha option that reads an opponent switched on. The decision's bytes
 * (HorseDeclaredWork withoutMeasurements, the pattern of the option-off identity tests) are identical, and the
 * accessor that would answer the record is never called.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import {
  RECORDED_FACING_BETS,
  expand,
  type RecordedFacingBet,
} from './HorseOmahaFacingBetEv.test-support.js';
import {
  addStreetReadEvidence,
  emptyStreetRead,
  type StreetReadCounters,
} from './HorseOmahaStreetRead.js';
import { opponentMemoryKey } from './HorseOpponentMemory.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3];
/** Every Omaha option whose rule reads an opponent (the consumers a later change would point at this read). */
const READING: HorseDecideOpts = {
  omahaFacingBetEv: true,
  omahaTurnRiverRaiseNeedsNuts: true,
  omahaReraisedFoldVsTight: true,
  omahaMadeHandDefenseVsValueLeader: true,
  omahaBluffCatcherFoldVsValueLeader: true,
} as HorseDecideOpts;

/** 60 hands of one shape: `wide` bets nearly every flop and folds to raises; otherwise he bets rarely and never folds. */
function record(wide: boolean): StreetReadCounters {
  let r: StreetReadCounters | null = null;
  for (let i = 0; i < 60; i++) {
    const inc = emptyStreetRead();
    const texture = (['paired', 'rainbow', 'twoTone', 'monotone'] as const)[i % 4];
    const bets = wide ? i % 10 !== 0 : i % 10 === 0;
    for (const street of ['flop', 'turn', 'river'] as const) {
      inc.bet[street] = { hit: bets ? 1 : 0, opp: 1 };
      inc.foldToBet[street] = { hit: wide ? 1 : 0, opp: 1 };
      inc.foldToRaise[street] = { hit: wide ? 1 : 0, opp: 1 };
    }
    inc.flopBet[texture] = { hit: bets ? 1 : 0, opp: 1 };
    inc.cbet[texture] = { hit: bets ? 1 : 0, opp: 1 };
    r = addStreetReadEvidence(r, inc);
  }
  return r!;
}

type Column = 'empty' | 'wide' | 'value';
interface Outcome {
  bytes: string;
  action: string;
  /** whether the record was in the state the decision ran in (asked after the decision, in its own sandbox) */
  carried: boolean;
}
function decide(
  r: RecordedFacingBet,
  seed: number,
  column: Column,
  opts: HorseDecideOpts
): Outcome {
  HorseMind.reset();
  const { fx, node } = expand(JSON.parse(JSON.stringify(r)) as RecordedFacingBet);
  const st = stateAt(fx, node);
  const variant = r.variant ?? 'plo5';
  const sandbox = HorseMind.createSandbox();
  const opponents = st.gs.players.filter((p) => p.user_id !== st.hero.user_id);
  if (column !== 'empty') {
    sandbox.pooledStreetRead = new Map();
    for (const p of opponents)
      for (const mode of ['cash', 'tournament'] as const)
        for (const size of ['hu', 'short', 'full'] as const)
          sandbox.pooledStreetRead.set(
            opponentMemoryKey(p.user_id, variant, mode, size),
            record(column === 'wide')
          );
  }
  return HorseMind.runInSandbox(sandbox, () => {
    const asked = vi.spyOn(HorseMind, 'omahaStreetReadOf');
    seedFastRandom(seed);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    expect(asked).not.toHaveBeenCalled();
    asked.mockRestore();
    HorseMind.setDecisionScope('omaha:full' as never, variant, 'cash');
    const carried = opponents.some((p) => HorseMind.omahaStreetReadOf(p.user_id) !== null);
    HorseMind.setDecisionScope(null);
    return { bytes: JSON.stringify(withoutMeasurements(d)), action: d.action, carried };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the street read changes no decision', () => {
  for (const [name, opts] of [
    ['the release options', {} as HorseDecideOpts],
    ['every Omaha option that reads an opponent on', READING],
  ] as const)
    it(`${name}: the column empty or full, every recorded decision is byte-identical`, () => {
      expect(RECORDED_FACING_BETS.length).toBeGreaterThanOrEqual(20);
      const actions = new Set<string>();
      let compared = 0;
      for (const r of RECORDED_FACING_BETS)
        for (const seed of SEEDS) {
          const empty = decide(r, seed, 'empty', opts);
          const wide = decide(r, seed, 'wide', opts);
          const value = decide(r, seed, 'value', opts);
          expect(empty.carried).toBe(false);
          // not vacuous: the record was in the decision's own state, where a reader would have found it
          expect(wide.carried).toBe(true);
          expect(value.carried).toBe(true);
          expect(wide.bytes, `hand ${r.n} seed ${seed} (wide)`).toBe(empty.bytes);
          expect(value.bytes, `hand ${r.n} seed ${seed} (value)`).toBe(empty.bytes);
          actions.add(empty.action);
          compared += 2;
        }
      expect(compared).toBe(RECORDED_FACING_BETS.length * SEEDS.length * 2);
      // the recorded decisions are not one action repeated
      expect(actions.size).toBeGreaterThan(1);
    }, 600000);

  it('the same decisions do move when an opponent read they consult changes (the comparison can fail)', () => {
    // The pooled read a consumer does consult: with omahaFacingBetEv on, a bluff-heavy read against a value-heavy
    // one changes at least one of these decisions, so identical bytes above are not an insensitive comparison.
    let moved = 0;
    for (const r of RECORDED_FACING_BETS.slice(0, 20)) {
      const run = (best: number) => {
        HorseMind.reset();
        vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(() => ({
          measured: true,
          betCheckedToRatio: best > 12 ? 0.8 : 1.2,
          postflopManiac: false,
          valueLeader: false,
          sizeShown: { shown: 24, best },
        }));
        const { fx, node } = expand(JSON.parse(JSON.stringify(r)) as RecordedFacingBet);
        const st = stateAt(fx, node);
        seedFastRandom(1);
        const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
          telemetry: true,
          observeMind: false,
          omahaFacingBetEv: true,
        } as never);
        vi.restoreAllMocks();
        return JSON.stringify(withoutMeasurements(d));
      };
      if (run(4) !== run(22)) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  }, 600000);
});
