/**
 * THE PRICE BEHIND A FOLD-TO-RAISE CELL IS READ BY THE SAMPLED RAISE (horse decisions stack 2, 2026-11-19).
 *
 * The opponent's price record (HorseOmahaStreetReadPrice, carried into the decision and answered by
 * HorseMind.omahaFoldToRaisePriceOf) is set as the `price` of the street read's fold-to-raise cell
 * (OmahaPricedCell.price) by the street-cell source of omahaReadIsByStreetAndTexture, and only with
 * omahaSampledRaiseIsPricedAtEverySize on (=== true): that option's omahaPricedSampledFoldAtPrice is the one reader
 * of a cell's price. Proved here:
 *  - omahaStreetRatesOf sets the price on an existing fold-to-raise cell only, and only a finite price in (0, 1];
 *  - the source asks the record only with the option exactly true and only for an existing cell, and with no record
 *    answers exactly the cells it answered before;
 *  - on recorded PLO decisions: with the option off, a full price record changes no byte and is never asked; with
 *    the option on and no record, the decision is the same as with the option on and a record that prices only the
 *    river; on priced flop raises (HorseOmahaPricedRules.test-support pricedSpot) with the option on the record is
 *    asked and a cheap measured price moves decisions, while with it off the same record is never asked.
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
  FLOP_TEXTURES,
  addStreetReadEvidence,
  emptyStreetRead,
  type StreetReadCounters,
} from './HorseOmahaStreetRead.js';
import {
  addStreetPriceEvidence,
  emptyStreetPrice,
  validStreetPrice,
  type StreetPriceCounters,
} from './HorseOmahaStreetReadPrice.js';
import { omahaStreetRatesOf } from './HorseOmahaReadByStreet.js';
import { withOmahaReadByStreetDecision } from './HorseOmahaReadByStreetRule.js';
import { omahaPricedStreetRatesSourceNow } from './HorseOmahaPricedWiring.js';
import { opponentMemoryKey } from './HorseOpponentMemory.js';
import {
  LIVE as LIVE_PRICED,
  LIVE_OPTIONS,
  pricedSpot,
  type PricedSpot,
} from './HorseOmahaPricedRules.test-support.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2];

/** `n` hands in which he bets, is raised and folds `fold` of the time, on every street and flop texture. */
function streetRow(n: number, fold: number): StreetReadCounters {
  let r: StreetReadCounters | null = null;
  for (let i = 0; i < n; i++) {
    const inc = emptyStreetRead();
    const f = ((i * 7) % 10) / 10 < fold ? 1 : 0;
    for (const s of ['flop', 'turn', 'river'] as const) {
      inc.bet[s] = { hit: i % 3 ? 1 : 0, opp: 1 };
      inc.foldToBet[s] = { hit: f, opp: 1 };
      inc.foldToRaise[s] = { hit: f, opp: 1 };
    }
    inc.flopBet[FLOP_TEXTURES[i % FLOP_TEXTURES.length]] = { hit: i % 3 ? 1 : 0, opp: 1 };
    r = addStreetReadEvidence(r, inc);
  }
  return r!;
}
/** 40 raises faced on the given streets, each laying him `price`. */
function priceRecord(
  price: number,
  streets: readonly ('flop' | 'turn' | 'river')[] = ['flop', 'turn', 'river']
): StreetPriceCounters {
  let r: StreetPriceCounters | null = null;
  for (let i = 0; i < 40; i++) {
    const inc = emptyStreetPrice();
    for (const s of streets) inc.foldToRaise[s] = { sum: price, opp: 1 };
    r = addStreetPriceEvidence(r, inc);
  }
  expect(validStreetPrice(r)).toBe(true);
  return r!;
}
const ROW = streetRow(120, 0.6);

type Recorded =
  | { street: 'later'; r: RecordedFacingBet }
  | { street: 'flop'; r: RecordedFlopFacingBet };
const RECORDED: Recorded[] = [
  ...RECORDED_FACING_BETS.map((r): Recorded => ({ street: 'later', r })),
  ...RECORDED_FLOP_FACING_BETS.map((r): Recorded => ({ street: 'flop', r })),
];
function spot(rec: Recorded) {
  const copy = JSON.parse(JSON.stringify(rec.r));
  const { fx, node } = rec.street === 'flop' ? expandFlop(copy) : expand(copy);
  const st = stateAt(fx, node);
  const variant = (rec.street === 'later' ? rec.r.variant : undefined) ?? 'plo5';
  return { st, variant };
}
function sandboxFor(
  rec: Recorded,
  row: StreetReadCounters | null,
  price: StreetPriceCounters | null
) {
  const { st, variant } = spot(rec);
  const sandbox = HorseMind.createSandbox();
  const opponents = st.gs.players.filter((p) => p.user_id !== st.hero.user_id);
  if (row) sandbox.pooledStreetRead = new Map();
  if (price) sandbox.pooledStreetPrice = new Map();
  for (const p of opponents)
    for (const mode of ['cash', 'tournament'] as const)
      for (const size of ['hu', 'short', 'full'] as const) {
        const key = opponentMemoryKey(p.user_id, variant, mode, size);
        if (row) sandbox.pooledStreetRead!.set(key, row);
        if (price) sandbox.pooledStreetPrice!.set(key, price);
      }
  return { st, variant, sandbox, opponents };
}
/** Every Omaha option that reaches the sampled raise, and the street read that carries its cells. */
const FAMILY: HorseDecideOpts = {
  omahaReadIsByStreetAndTexture: true,
  omahaDrawRaiseIsPriced: true,
  omahaPressureIsPriced: true,
  omahaFacingBetEv: true,
  omahaFlopFacingBetEv: true,
} as HorseDecideOpts;
const ON: HorseDecideOpts = { ...FAMILY, omahaSampledRaiseIsPricedAtEverySize: true };

function decide(
  rec: Recorded,
  seed: number,
  row: StreetReadCounters | null,
  price: StreetPriceCounters | null,
  opts: HorseDecideOpts
) {
  HorseMind.reset();
  const { st, sandbox } = sandboxFor(rec, row, price);
  return HorseMind.runInSandbox(sandbox, () => {
    const asked = vi.spyOn(HorseMind, 'omahaFoldToRaisePriceOf');
    seedFastRandom(seed);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    const calls = asked.mock.calls.length;
    asked.mockRestore();
    return { bytes: JSON.stringify(withoutMeasurements(d)), calls };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('omahaStreetRatesOf: the price lands on the fold-to-raise cell only', () => {
  it('a finite price in (0, 1] is set on an existing cell; anything else leaves the cells exactly as before', () => {
    for (const street of ['flop', 'turn', 'river'] as const) {
      const plain = omahaStreetRatesOf(ROW, street, 'rainbow');
      expect(plain?.foldToRaise).toBeTruthy();
      expect(plain!.foldToRaise).not.toHaveProperty('price');
      const priced = omahaStreetRatesOf(ROW, street, 'rainbow', 0.31);
      expect(priced).toEqual({ ...plain, foldToRaise: { ...plain!.foldToRaise, price: 0.31 } });
      expect(omahaStreetRatesOf(ROW, street, 'rainbow', 1)!.foldToRaise!.price).toBe(1);
      for (const bad of [null, 0, -0.2, 1.01, Number.NaN, Number.POSITIVE_INFINITY, '0.3'])
        expect(omahaStreetRatesOf(ROW, street, 'rainbow', bad as never)).toEqual(plain);
    }
    // no fold-to-raise cell: the price invents none
    const noRaise = emptyStreetRead();
    noRaise.bet.turn = { hit: 1, opp: 2 };
    const bare = omahaStreetRatesOf(noRaise, 'turn', null);
    expect(bare?.foldToRaise).toBeNull();
    expect(omahaStreetRatesOf(noRaise, 'turn', null, 0.3)).toEqual(bare);
    expect(omahaStreetRatesOf(null, 'turn', null, 0.3)).toBeNull();
  });
});

describe('the street-cell source asks the price record only with omahaSampledRaiseIsPricedAtEverySize on', () => {
  const rec = RECORDED.find((r) => r.street === 'later')!;
  function cellsOf(opts: HorseDecideOpts, price: StreetPriceCounters | null) {
    HorseMind.reset();
    const { st, variant, sandbox, opponents } = sandboxFor(rec, ROW, price);
    return HorseMind.runInSandbox(sandbox, () => {
      HorseMind.setDecisionScope('omaha:full' as never, variant, 'cash');
      const asked = vi.spyOn(HorseMind, 'omahaFoldToRaisePriceOf');
      const out = withOmahaReadByStreetDecision(true, opts, st.gs, () =>
        opponents.map((p) => omahaPricedStreetRatesSourceNow()!(p.user_id, st.gs))
      );
      const calls = asked.mock.calls.length;
      asked.mockRestore();
      const means = opponents.map((p) => HorseMind.omahaFoldToRaisePriceOf(p.user_id));
      HorseMind.setDecisionScope(null);
      return { out, calls, means, street: st.gs.stage as 'flop' | 'turn' | 'river' };
    });
  }
  it('off, unset or not exactly true: the record is never asked and the cells carry no price', () => {
    const base = cellsOf(FAMILY, null);
    expect(base.out.some((c) => c?.foldToRaise)).toBe(true);
    for (const opts of [
      FAMILY,
      { ...FAMILY, omahaSampledRaiseIsPricedAtEverySize: false },
      { ...FAMILY, omahaSampledRaiseIsPricedAtEverySize: 1 },
      { ...FAMILY, omahaSampledRaiseIsPricedAtEverySize: 'true' },
    ] as HorseDecideOpts[]) {
      const withRecord = cellsOf(opts, priceRecord(0.2));
      expect(withRecord.calls).toBe(0);
      expect(withRecord.out).toEqual(base.out);
    }
  });
  it('on: each existing cell carries the mean of his record; with no record the cells are exactly as off', () => {
    const off = cellsOf(FAMILY, null);
    const onNoRecord = cellsOf(ON, null);
    expect(onNoRecord.out).toEqual(off.out);
    const on = cellsOf(ON, priceRecord(0.2));
    expect(on.calls).toBeGreaterThan(0);
    on.out.forEach((cells, i) => {
      if (!cells?.foldToRaise) return expect(cells).toEqual(off.out[i]);
      const mean = on.means[i]![on.street]!;
      expect(mean.price).toBeCloseTo(0.2, 12);
      expect(cells).toEqual({
        ...off.out[i],
        foldToRaise: { ...off.out[i]!.foldToRaise, price: mean.price },
      });
    });
    // a record with no priced raise on this street: the cells are exactly as off
    const other = (['flop', 'turn', 'river'] as const).filter((s) => s !== on.street);
    expect(cellsOf(ON, priceRecord(0.2, other)).out).toEqual(off.out);
    // nothing is left registered after the decision
    expect(omahaPricedStreetRatesSourceNow()).toBeNull();
  });
});

describe('through HorseLogic.decide on recorded PLO decisions', () => {
  it('option off: a price record changes no byte and is never asked; option on with no record: the record is not what moves it', () => {
    expect(RECORDED.length).toBeGreaterThanOrEqual(35);
    let compared = 0;
    for (const rec of RECORDED)
      for (const seed of SEEDS) {
        const off = decide(rec, seed, ROW, null, FAMILY);
        const offCheap = decide(rec, seed, ROW, priceRecord(0.08), FAMILY);
        const offDear = decide(rec, seed, ROW, priceRecord(0.6), FAMILY);
        expect(offCheap.bytes, `${rec.street} hand ${rec.r.n} seed ${seed} (off, cheap)`).toBe(
          off.bytes
        );
        expect(offDear.bytes, `${rec.street} hand ${rec.r.n} seed ${seed} (off, dear)`).toBe(
          off.bytes
        );
        expect(offCheap.calls + offDear.calls).toBe(0);
        // on: no record, and a record priced on the river only (the sampled raise prices no river), decide alike
        const onNone = decide(rec, seed, ROW, null, ON);
        const onEmpty = decide(rec, seed, ROW, priceRecord(0.3, ['river']), ON);
        expect(onEmpty.bytes, `${rec.street} hand ${rec.r.n} seed ${seed} (on, empty record)`).toBe(
          onNone.bytes
        );
        compared += 3;
      }
    expect(compared).toBe(RECORDED.length * SEEDS.length * 3);
  }, 900000);

  it('option on with a record: on priced flop raises the record is asked, and the price it carries moves the decision', () => {
    const WHOLE = {
      ...LIVE_OPTIONS,
      omahaReadIsByStreetAndTexture: true,
      omahaDrawRaiseIsPriced: true,
      omahaPressureIsPriced: true,
      omahaSampledRaiseIsPricedAtEverySize: true,
    } as HorseDecideOpts;
    const at = (
      s: PricedSpot,
      seed: number,
      price: StreetPriceCounters | null,
      opts: HorseDecideOpts
    ) => {
      HorseMind.reset();
      const now = pricedSpot(s);
      // pricedSpot deals heads-up PLO5 cash
      const variant = 'plo5' as const;
      expect(now.gs.gameVariant).toBe(variant);
      const sandbox = HorseMind.createSandbox();
      sandbox.pooledStreetRead = new Map();
      if (price) sandbox.pooledStreetPrice = new Map();
      for (const p of now.gs.players.filter((q) => q.user_id !== now.hero.user_id))
        for (const size of ['hu', 'short', 'full'] as const) {
          const key = opponentMemoryKey(p.user_id, variant, 'cash', size);
          sandbox.pooledStreetRead.set(key, ROW);
          if (price) sandbox.pooledStreetPrice!.set(key, price);
        }
      return HorseMind.runInSandbox(sandbox, () => {
        const asked = vi.spyOn(HorseMind, 'omahaFoldToRaisePriceOf');
        seedFastRandom(seed);
        const d = HorseLogic.decide(now.hero, now.gs, LIVE_PRICED.style, LIVE_PRICED.mods, {
          observeMind: false,
          decisionTimeMs: 1794938400000,
          ...opts,
        } as never);
        const calls = asked.mock.calls.length;
        asked.mockRestore();
        return { bytes: JSON.stringify(withoutMeasurements({ ...d, thinkTime: 0 })), calls };
      });
    };
    let asked = 0;
    let moved = 0;
    let compared = 0;
    for (const hole of ['QsQd7c4c2s', 'Qs9s3c7c2d', 'AhKh7c4c2s', '2c3c7s8sKc'])
      for (const [potBefore, bet] of [
        [50, 50],
        [100, 30],
      ])
        for (const seed of [1, 2, 3]) {
          const s: PricedSpot = { hole, board: 'Qh9h3d', potBefore, bet };
          const none = at(s, seed, null, WHOLE);
          const cheap = at(s, seed, priceRecord(0.08), WHOLE);
          const off = at(s, seed, priceRecord(0.08), {
            ...WHOLE,
            omahaSampledRaiseIsPricedAtEverySize: false,
          });
          const offNone = at(s, seed, null, {
            ...WHOLE,
            omahaSampledRaiseIsPricedAtEverySize: false,
          });
          // off: the record is never asked and changes no byte
          expect(off.calls).toBe(0);
          expect(off.bytes, `${hole} ${potBefore}/${bet} seed ${seed} (off)`).toBe(offNone.bytes);
          asked += cheap.calls;
          if (cheap.bytes !== none.bytes) moved++;
          compared++;
        }
    expect(compared).toBe(24);
    expect(asked).toBeGreaterThan(0);
    // not vacuous: a fold-to-raise cell measured at a cheap price is carried to the price each raise lays
    expect(moved).toBeGreaterThan(0);
  }, 900000);
});
