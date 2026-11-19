/**
 * THE FLOP-SHOWN RECORD AND THE FOLD-TO-RAISE PRICE CHANGE NO DECISION (2026-11-19). What an opponent showed after
 * betting a flop and what calls of his flop bets returned (HorseOmahaFlopShown, horse_exact_profiles.flop_shown),
 * and the price behind his fold-to-raise cells (HorseOmahaStreetReadPrice,
 * horse_exact_profiles.street_counters_price), are carried into an Omaha decision's own state and, with the options
 * here, read by nothing (the price's one gated reader, omahaSampledRaiseIsPricedAtEverySize with
 * omahaReadIsByStreetAndTexture, is off here; it is proved in HorseOmahaFoldToRaisePriceWired.test.ts).
 * This file proves it on recorded decisions: the recorded PLO4 / PLO5 turn and river decisions behind
 * HorseOmahaFacingBetEv.test.ts and the recorded flop decisions behind HorseOmahaFlopFacingBetEv.test.ts (the
 * decisions a later reader of these records would be pointed at), each decided from the same random state with
 * the columns empty (no record carried) and with the columns full (both records for every opponent at the table,
 * in every size and mode, once shaped like a bettor who shows the nuts and whose callers lose, once like a bettor
 * who shows air and whose callers win), with the release options and again with every Omaha option that reads an
 * opponent switched on, the flop verdict included. The decision's bytes (HorseDeclaredWork withoutMeasurements)
 * are identical, and the accessors that would answer the records are never called.
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
  RECORDED_FLOP_FACING_BETS,
  expandFlop,
  type RecordedFlopFacingBet,
} from './HorseOmahaFlopFacingBetEv.test-support.js';
import {
  FLOP_SHOWN_BET_CLASSES,
  FLOP_SHOWN_CALL_CELLS,
  FLOP_SHOWN_CALLER_KINDS,
  FLOP_SHOWN_LINES,
  addFlopShownEvidence,
  emptyFlopShown,
  flopShownBetIndex,
  flopShownCallIndex,
  validFlopShown,
  type FlopShownCounters,
} from './HorseOmahaFlopShown.js';
import { FLOP_TEXTURES } from './HorseOmahaStreetRead.js';
import {
  addStreetPriceEvidence,
  emptyStreetPrice,
  validStreetPrice,
  type StreetPriceCounters,
} from './HorseOmahaStreetReadPrice.js';
import { opponentMemoryKey } from './HorseOpponentMemory.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3];
/** Every Omaha option whose rule reads an opponent (the consumers a later change would point at these records). */
const READING: HorseDecideOpts = {
  omahaFacingBetEv: true,
  omahaFlopFacingBetEv: true,
  omahaReadIsByStreetAndTexture: true,
  omahaTurnRiverRaiseNeedsNuts: true,
  omahaReraisedFoldVsTight: true,
  omahaMadeHandDefenseVsValueLeader: true,
  omahaBluffCatcherFoldVsValueLeader: true,
} as HorseDecideOpts;

/** 80 hands of one shape, every line, texture, caller kind and cell filled: `value` shows the nuts and his callers
 *  lose their calls; otherwise he shows air and his callers win. */
function shown(value: boolean): FlopShownCounters {
  let r: FlopShownCounters | null = null;
  for (let i = 0; i < 80; i++) {
    const inc = emptyFlopShown();
    const klass = value ? (i % 8 ? 'nut' : 'strong') : i % 8 ? 'air' : 'weak';
    inc.bet[flopShownBetIndex(FLOP_SHOWN_LINES[i % 2], FLOP_TEXTURES[i % 4], klass)] = 1;
    const at = flopShownCallIndex(FLOP_SHOWN_CALLER_KINDS[i % 2], FLOP_SHOWN_CALL_CELLS[i % 5]);
    inc.call[at] = 1;
    inc.call[at + 1] = 600;
    inc.call[at + 2] = value ? -1500 : 2500;
    inc.call[at + 3] = 1;
    r = addFlopShownEvidence(r, inc);
  }
  expect(validFlopShown(r)).toBe(true);
  expect(FLOP_SHOWN_BET_CLASSES).toHaveLength(5);
  return r!;
}
/** 40 raises faced on every street: cheap ones (`value`) or expensive ones. */
function priced(value: boolean): StreetPriceCounters {
  let r: StreetPriceCounters | null = null;
  for (let i = 0; i < 40; i++) {
    const inc = emptyStreetPrice();
    for (const s of ['flop', 'turn', 'river'] as const)
      inc.foldToRaise[s] = { sum: value ? 0.2 : 0.45, opp: 1 };
    r = addStreetPriceEvidence(r, inc);
  }
  expect(validStreetPrice(r)).toBe(true);
  return r!;
}

type Column = 'empty' | 'value' | 'air';
type Recorded =
  | { street: 'later'; r: RecordedFacingBet }
  | { street: 'flop'; r: RecordedFlopFacingBet };
const RECORDED: Recorded[] = [
  ...RECORDED_FACING_BETS.map((r): Recorded => ({ street: 'later', r })),
  ...RECORDED_FLOP_FACING_BETS.map((r): Recorded => ({ street: 'flop', r })),
];
interface Outcome {
  bytes: string;
  action: string;
  /** whether the records were in the state the decision ran in (asked after the decision, in its own sandbox) */
  carried: boolean;
}
function decide(rec: Recorded, seed: number, column: Column, opts: HorseDecideOpts): Outcome {
  HorseMind.reset();
  const copy = JSON.parse(JSON.stringify(rec.r));
  const { fx, node } = rec.street === 'flop' ? expandFlop(copy) : expand(copy);
  const st = stateAt(fx, node);
  const variant = (rec.street === 'later' ? rec.r.variant : undefined) ?? 'plo5';
  const sandbox = HorseMind.createSandbox();
  const opponents = st.gs.players.filter((p) => p.user_id !== st.hero.user_id);
  if (column !== 'empty') {
    sandbox.pooledFlopShown = new Map();
    sandbox.pooledStreetPrice = new Map();
    for (const p of opponents)
      for (const mode of ['cash', 'tournament'] as const)
        for (const size of ['hu', 'short', 'full'] as const) {
          const key = opponentMemoryKey(p.user_id, variant, mode, size);
          sandbox.pooledFlopShown.set(key, shown(column === 'value'));
          sandbox.pooledStreetPrice.set(key, priced(column === 'value'));
        }
  }
  return HorseMind.runInSandbox(sandbox, () => {
    const askedShown = vi.spyOn(HorseMind, 'omahaFlopShownOf');
    const askedPrice = vi.spyOn(HorseMind, 'omahaFoldToRaisePriceOf');
    seedFastRandom(seed);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    expect(askedShown).not.toHaveBeenCalled();
    expect(askedPrice).not.toHaveBeenCalled();
    askedShown.mockRestore();
    askedPrice.mockRestore();
    HorseMind.setDecisionScope('omaha:full' as never, variant, 'cash');
    const carried =
      opponents.some((p) => HorseMind.omahaFlopShownOf(p.user_id) !== null) &&
      opponents.some((p) => HorseMind.omahaFoldToRaisePriceOf(p.user_id)?.flop != null);
    HorseMind.setDecisionScope(null);
    return { bytes: JSON.stringify(withoutMeasurements(d)), action: d.action, carried };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the flop-shown record and the fold-to-raise price change no decision', () => {
  for (const [name, opts] of [
    ['the release options', {} as HorseDecideOpts],
    ['every Omaha option that reads an opponent on, the flop verdict included', READING],
  ] as const)
    it(`${name}: the columns empty or full, every recorded decision is byte-identical`, () => {
      expect(RECORDED_FACING_BETS.length).toBeGreaterThanOrEqual(20);
      expect(RECORDED_FLOP_FACING_BETS.length).toBeGreaterThanOrEqual(15);
      const actions = new Set<string>();
      let compared = 0;
      for (const rec of RECORDED)
        for (const seed of SEEDS) {
          const empty = decide(rec, seed, 'empty', opts);
          const value = decide(rec, seed, 'value', opts);
          const air = decide(rec, seed, 'air', opts);
          expect(empty.carried).toBe(false);
          // not vacuous: the records were in the decision's own state, where a reader would have found them
          expect(value.carried).toBe(true);
          expect(air.carried).toBe(true);
          expect(value.bytes, `${rec.street} hand ${rec.r.n} seed ${seed} (value)`).toBe(
            empty.bytes
          );
          expect(air.bytes, `${rec.street} hand ${rec.r.n} seed ${seed} (air)`).toBe(empty.bytes);
          actions.add(empty.action);
          compared += 2;
        }
      expect(compared).toBe(RECORDED.length * SEEDS.length * 2);
      // the recorded decisions are not one action repeated
      expect(actions.size).toBeGreaterThan(1);
    }, 900000);

  it('the same flop decisions do move when the option that prices them is switched (the comparison can fail)', () => {
    let moved = 0;
    for (const r of RECORDED_FLOP_FACING_BETS) {
      const off = decide({ street: 'flop', r }, 1, 'empty', {} as HorseDecideOpts);
      const on = decide({ street: 'flop', r }, 1, 'empty', {
        omahaFlopFacingBetEv: true,
      } as HorseDecideOpts);
      if (off.bytes !== on.bytes) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  }, 900000);
});
