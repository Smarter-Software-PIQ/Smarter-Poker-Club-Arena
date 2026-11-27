/**
 * LAW (PLO-OWNER lead-7 2026-11-26; owner order "the stats need to be used against human players, not horses"):
 * omahaFacingBetPriorIsPeopleMeasured prices a heads-up PLO4/PLO5 cash turn or river bettor (a bet or a raise) on the
 * PEOPLE-ONLY measured non-value share for the street and size, the balanced share for the price weighting only a
 * thin people cell, and his own shown bets moving it as his sample grows.
 *
 *  1. The balanced share is the price: b = bet / (pot + 2 bet) on the river, 1 - (1 - b)^2 on a turn bet with a
 *     river bet to come; the deduction raises it.
 *  2. The population is people only: the generated data says so and its fit keeps the three filters (a person's
 *     bet, a person's answer, cards a person showed with mucked = false; no HUD population rows). No Horse play is
 *     read. The prior is (n x people + 30 x balanced) / (n + 30); an unmeasured cell is the balanced share.
 *  3. Only his own shown bets move it: value shown lowers it, weak shown raises it, weighted by sample. A raise has
 *     no per-opponent cell: the people raise cell alone prices it.
 *  4. On the committed PLO4/PLO5 state set, heads-up first wagers (turn 0.7 pot and over, river 0.4 and over):
 *     today folds more than a pure bluff needs; on the people prior the Horse range folds less than today; against
 *     a bettor shown value 59 times of 60 it folds at least as often (it does not pay off a proven value bettor).
 *  5. It does not turn into calling without a share against value on the river.
 *  6. Real audited hands decide as stated through the engine's own decide call; off, no receipt of the option.
 *  7. A multiway spot, PLO6 and tournaments are never priced by it; no identity input exists in the module.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { replayAt, replayProfiles, stateAt } from './HorseComplaintReplay.js';
import {
  OMAHA_EV_UNKNOWN_READ,
  omahaEvHandCounts,
  omahaFacingBetEvSpot,
  omahaFacingBetEvVerdict,
} from './HorseOmahaFacingBetEv.js';
import { omahaEquilibriumAnchor } from './HorseOmahaEquilibriumAnchor.js';
import {
  OMAHA_PEOPLE_PRIOR_ANCHOR_BETS,
  OMAHA_PEOPLE_PRIOR_RECORD_BETS,
  omahaPeoplePriorCell,
  omahaPeoplePriorShare,
} from './HorseOmahaFacingBetPeoplePrior.js';
import { OMAHA_FACING_BET_PEOPLE_PRIOR_DATA } from './HorseOmahaFacingBetPeoplePrior.data.js';
import { loadPricedStates, type PricedState } from './HorseOmahaFacingBetPriced.test-support.js';

type Arm = 'today' | 'anchor' | 'valueRecord';
interface Row {
  key: string;
  potFrac: number;
  call: Record<Arm, boolean>;
  vsValue: number;
  tie: number;
  street: string;
  /** river: the hand wins or ties nothing against the core and the middle regions; the bottom weight priced and the
   *  balanced share of the price */
  onlyBeatsBottom?: boolean;
  bottomWeight?: number;
  balanced?: number;
}

function rowOf(s: PricedState): Row | null {
  const { gs, player } = s;
  if (gs.stage !== 'turn' && gs.stage !== 'river') return null;
  const spot = omahaFacingBetEvSpot(player, gs);
  if (!spot || spot.isRaise || spot.callers + spot.allIns + spot.behind > 0) return null;
  const ctx = { rake: 0, realization: gs.stage === 'turn' ? 0.85 : 1 };
  const hole = player.cards ?? [];
  const board = gs.communityCards ?? [];
  const verdict = (
    share: number | null,
    regions: { core: number; middle: number; bottom: number } | null = null
  ) =>
    omahaFacingBetEvVerdict(
      spot,
      hole,
      board,
      [],
      share === null
        ? null
        : { ...OMAHA_EV_UNKNOWN_READ, pricedShare: share, pricedRegions: regions },
      ctx
    );
  const twoStreet = spot.street === 'turn' && !spot.final && spot.bettorCanBarrelRiver !== false;
  const input = {
    street: spot.street,
    potFrac: spot.potFrac,
    isRaise: false,
    multiway: false,
    paid: spot.paid,
    winnable: spot.winnable,
    rake: 0,
    twoStreet,
  };
  const anchor = omahaPeoplePriorShare({ ...input, record: null });
  const proven = omahaPeoplePriorShare({ ...input, record: { shown: 60, value: 59 } });
  const today = verdict(null);
  if (!today || !anchor || !proven) return null;
  const a = verdict(anchor.share, anchor.regions);
  const p = verdict(proven.share, proven.regions);
  if (!a || !p) return null;
  let onlyBeatsBottom: boolean | undefined;
  if (gs.stage === 'river') {
    const r = omahaEvHandCounts(hole, board, [], spot.valueShare)?.regions;
    if (r) onlyBeatsBottom = r.core.win + r.core.tie <= 1e-9 && r.middle.win + r.middle.tie <= 1e-9;
  }
  return {
    key: `${String(gs.gameVariant).toLowerCase()}|${gs.stage}`,
    potFrac: spot.potFrac,
    street: gs.stage,
    vsValue: a.vsValue,
    tie: a.pTie,
    call: { today: today.call, anchor: a.call, valueRecord: p.call },
    onlyBeatsBottom,
    bottomWeight: anchor.regions?.bottom ?? anchor.share,
    balanced: anchor.balanced,
  };
}

let rows: Row[] = [];
const foldOf = (
  key: string,
  arm: Arm,
  from: number
): { n: number; fold: number; breakEven: number } => {
  const set = rows.filter((r) => r.key === key && r.potFrac >= from);
  return {
    n: set.length,
    fold: set.filter((r) => !r.call[arm]).length / Math.max(1, set.length),
    breakEven: set.reduce((x, r) => x + r.potFrac / (1 + r.potFrac), 0) / Math.max(1, set.length),
  };
};

describe('LAW: a heads-up bettor is priced on the people-only measured share, and his own shown bets move it', () => {
  beforeAll(() => {
    rows = loadPricedStates()
      .map(rowOf)
      .filter((r): r is Row => r !== null);
  }, 1_200_000);

  it('the anchor is the price: bet / (pot + 2 bet) on the river, two streets of it on a turn bet with a river bet to come', () => {
    // a pot bet: pot 100 before, bet 100; the call pays 100 to win 200
    expect(omahaEquilibriumAnchor(100, 200, 0, false)).toBeCloseTo(1 / 3, 10);
    expect(omahaEquilibriumAnchor(100, 200, 0, true)).toBeCloseTo(1 - (2 / 3) ** 2, 10);
    // half the pot
    expect(omahaEquilibriumAnchor(50, 150, 0, false)).toBeCloseTo(0.25, 10);
    expect(omahaEquilibriumAnchor(50, 150, 0, true)).toBeCloseTo(1 - 0.75 ** 2, 10);
    // the deduction makes the pure bluff-catcher break even at a higher share
    expect(omahaEquilibriumAnchor(100, 200, 0.05, false)!).toBeGreaterThan(1 / 3);
    // bigger bets carry more non-value at balance
    let last = 0;
    for (const bet of [20, 40, 70, 100, 150]) {
      const q = omahaEquilibriumAnchor(bet, 100 + bet, 0, false)!;
      expect(q).toBeGreaterThan(last);
      last = q;
    }
    expect(omahaEquilibriumAnchor(0, 100, 0, false)).toBeNull();
    expect(omahaEquilibriumAnchor(100, 0, 0, false)).toBeNull();
  });

  it('the population is people only, and the prior is the people cell weighted toward the balanced share by its n', () => {
    const d = OMAHA_FACING_BET_PEOPLE_PRIOR_DATA;
    expect(d.source).toBe('people-only');
    expect(d.filters.bettor).toContain('is_horse = false');
    expect(d.filters.responder).toContain('is_horse = false');
    expect(d.filters.cards).toContain('mucked = false');
    expect(d.filters.hudPopulationRows).toBe('not read');
    const fit = readFileSync(
      join(__dirname, '../../scripts/omaha-facing-bet-people-prior-fit.ts'),
      'utf8'
    );
    expect(fit).toContain("p.isHorse === false && a.origin !== 'horse_policy'");
    const sql = readFileSync(
      join(__dirname, '../../scripts/omaha-facing-bet-people-prior-export.sql'),
      'utf8'
    );
    expect(sql).toContain("coalesce((s->>'mucked')::boolean, false) = false");
    expect(sql).toContain('coalesce(p.is_horse, true) = false');
    for (const street of ['turn', 'river'] as const)
      for (const pf of [0.3, 0.55, 0.9]) {
        const cell = omahaPeoplePriorCell(street, pf, false, false);
        expect(cell.n, `${street} ${pf}`).toBeGreaterThanOrEqual(100);
        const bal = omahaEquilibriumAnchor(pf * 100, 100 + pf * 100, 0, false)!;
        const q = omahaPeoplePriorShare({
          street,
          potFrac: pf,
          isRaise: false,
          multiway: false,
          paid: pf * 100,
          winnable: 100 + pf * 100,
          rake: 0,
          twoStreet: false,
          record: null,
        })!;
        expect(q.prior).toBeCloseTo(
          (cell.n * cell.share! + OMAHA_PEOPLE_PRIOR_ANCHOR_BETS * bal) /
            (cell.n + OMAHA_PEOPLE_PRIOR_ANCHOR_BETS),
          10
        );
        expect(q.share).toBe(q.prior);
      }
  });

  it('only his own shown bets move it: value shown lowers it, weak shown raises it, weighted by sample', () => {
    const at = (shown: number, value: number, isRaise = false) =>
      omahaPeoplePriorShare({
        street: 'river',
        potFrac: 0.9,
        isRaise,
        multiway: false,
        paid: 90,
        winnable: 190,
        rake: 0,
        twoStreet: false,
        record: shown > 0 ? { shown, value } : null,
      })!;
    const q0 = at(0, 0).share;
    let last = q0;
    for (const n of [1, 2, 4, 8, 16, 40]) {
      const q = at(n, n).share;
      expect(q).toBeLessThan(last);
      expect(q).toBeCloseTo(
        (OMAHA_PEOPLE_PRIOR_RECORD_BETS * q0) / (OMAHA_PEOPLE_PRIOR_RECORD_BETS + n),
        10
      );
      last = q;
    }
    expect(at(4, 0).share).toBeGreaterThan(q0);
    expect(at(40, 20).share).toBeGreaterThan(q0);
    expect(at(40, 20).share).toBeLessThanOrEqual(0.65);
    // a raise reads the people raise cell and no record
    const r = at(40, 0, true);
    expect(r.shown).toBe(0);
    expect(r.people).toBe(omahaPeoplePriorCell('river', 0.9, true, false).share);
  });

  it('big bets: today folds past the bluff break-even; on the anchor the range folds less, and a proven value bettor is not paid off', () => {
    // the committed set holds turn bets of 0.7 pot and over and river bets up to 0.7 pot (0.4 and over are read)
    for (const [key, from] of [
      ['plo4|turn', 0.7],
      ['plo5|turn', 0.7],
      ['plo4|river', 0.4],
      ['plo5|river', 0.4],
    ] as const) {
      const today = foldOf(key, 'today', from);
      const anchor = foldOf(key, 'anchor', from);
      const proven = foldOf(key, 'valueRecord', from);
      console.info(
        `[people prior] ${key} bets of ${from} pot and over, n ${today.n}: a pure bluff breaks even at ` +
          `${(100 * today.breakEven).toFixed(1)}% folds; today ${(100 * today.fold).toFixed(1)}%, people ` +
          `${(100 * anchor.fold).toFixed(1)}%, bettor shown value 59 of 60 ${(100 * proven.fold).toFixed(1)}%`
      );
      expect(today.n, key).toBeGreaterThanOrEqual(20);
      expect(today.fold, key).toBeGreaterThan(today.breakEven);
      if (key.endsWith('turn')) expect(anchor.fold, key).toBeLessThan(today.fold);
      else expect(anchor.fold, key).toBeLessThanOrEqual(today.fold);
      expect(proven.fold, key).toBeGreaterThanOrEqual(anchor.fold);
    }
  });

  it('a river hand that beats only the weakest region calls only when that region is priced above the balanced share', () => {
    const river = rows.filter((r) => r.street === 'river' && r.onlyBeatsBottom === true);
    expect(river.length).toBeGreaterThan(20);
    const bad = river.filter((r) => r.call.anchor && (r.bottomWeight ?? 0) < (r.balanced ?? 1));
    console.info(
      `[people prior] river hands beating only the weakest region: ${river.length}, calls ${river.filter((r) => r.call.anchor).length}, calls below the balanced share ${bad.length}`
    );
    expect(bad.length).toBe(0);
  });

  describe('real audited hands (public action and the deciding Horse own cards only)', () => {
    const fixture = JSON.parse(
      gunzipSync(
        readFileSync(join(__dirname, 'HorseOmahaEquilibriumAnchor.realHands.fixture.json.gz'))
      ).toString('utf8')
    ) as { spots: Array<{ k: string; hand: never; ord: number }> };
    const EXPECTED: Readonly<Record<string, 'call' | 'fold'>> = {
      cfbdc523: 'call',
      '0b9a6041': 'call',
      '30feaf0f': 'fold',
      '531f3bd8': 'fold',
      ca59a45b: 'fold',
      '86679d93': 'fold',
    };
    const decideOn = (k: string, on: boolean) => {
      const spot = fixture.spots.find((s) => s.k === k)!;
      const hand = spot.hand as { actions: Array<{ ord: number }> };
      const node = hand.actions.find((a) => a.ord === spot.ord)!;
      const st = stateAt(hand as never, node as never);
      const prof = replayProfiles((st as { pn: { mode: string } }).pn.mode as never).find(
        (p: { live?: boolean }) => p.live
      )!;
      return replayAt(st as never, prof as never, [1, 7, 42], {
        omahaFacingBetEv: true,
        ...(on ? { omahaFacingBetPriorIsPeopleMeasured: true } : {}),
      } as never) as { kinds: Record<string, number>; receipts: Record<string, number> };
    };
    const top = (kinds: Record<string, number>): string =>
      Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]![0];

    it('the fixture holds the ten audited decisions', () => {
      expect(fixture.spots.length).toBe(10);
    });

    for (const [k, want] of Object.entries(EXPECTED))
      it(`${k}: ${want} with the option on, fold with it off, and no receipt of the option when off`, () => {
        const off = decideOn(k, false);
        const on = decideOn(k, true);
        expect(top(off.kinds)).toBe('fold');
        expect(Object.keys(off.receipts).some((r) => r.startsWith('omaha_people_prior'))).toBe(
          false
        );
        expect(top(on.kinds)).toBe(want);
        expect(on.receipts.omaha_people_prior_priced ?? 0).toBeGreaterThan(0);
        if (want === 'call') expect(on.receipts.omaha_people_prior_changed ?? 0).toBeGreaterThan(0);
      }, 120_000);
  });

  it('a multiway spot, PLO6 and tournaments are never priced by it; no identity input (source: the one call site)', () => {
    const src = readFileSync(join(__dirname, 'HorseLogic.ts'), 'utf8');
    expect(
      src.includes('if (equilibriumAnchor && spot.callers + spot.allIns + spot.behind === 0) {')
    ).toBe(true);
    expect(
      /const equilibriumAnchor =\s+opts\.omahaFacingBetPriorIsPeopleMeasured === true &&\s+!isTournamentMode\(gs\) &&\s+\(\(player\.cards \?\? \[\]\)\.length === 4 \|\| \(player\.cards \?\? \[\]\)\.length === 5\);/.test(
        src
      )
    ).toBe(true);
    for (const f of ['HorseOmahaFacingBetPeoplePrior.ts', 'HorseOmahaEquilibriumAnchor.ts']) {
      const code = readFileSync(join(__dirname, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const banned of [
        'omahaOpponentKindOf',
        'is_horse',
        'isHorse',
        'humanUserIds',
        'username',
        'user_id',
      ])
        expect(code.includes(banned), `${f} ${banned}`).toBe(false);
    }
  });
});
