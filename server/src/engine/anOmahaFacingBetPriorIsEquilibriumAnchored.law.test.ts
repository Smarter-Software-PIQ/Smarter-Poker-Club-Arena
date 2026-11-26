/**
 * LAW (PLO-OWNER lead-7 2026-11-26; audit-rootcause/REPORT.md section B, woowoo/REPORT.md gap 1):
 * omahaFacingBetPriorIsEquilibriumAnchored prices a heads-up turn or river bettor with no record of his own at the
 * BALANCED non-value share for the price, and only his own shown bets move it.
 *
 *  1. The anchor is the price and nothing else: b = bet / (pot + 2 bet) on the river, 1 - (1 - b)^2 on a turn bet
 *     with a river bet to come; the deduction raises it; no constant is fitted.
 *  2. Only his own shown bets move it: every shown value bet lowers the share, every shown weak bet raises it, and
 *     a bettor shown value 40 times of 40 is priced at a sixth of the anchor.
 *  3. On the committed PLO4/PLO5 state set (HorseOmahaFacingBetPriced.states.ndjson.gz), heads-up first wagers (turn
 *     0.7 pot and over, river 0.4 pot and over: the set holds no bigger river bet): today's verdict folds more than a pure bluff needs to show a profit, and with the anchor
 *     the Horse's range folds less than today in every game and street; against a bettor shown value 59 times of
 *     60 it folds at least as often as against the anchor (it does not pay off a proven value bettor).
 *  4. It does not turn into calling without a share against value: on the river no hand with no win or tie
 *     against his value region calls on the anchor (a hand that ties part of it, a shared straight, may).
 *  5. Real audited hands (audit-rootcause/B: public action and the deciding Horse's OWN cards only): the folded
 *     ace-high flush draw with top pair facing a pot bet (cfbdc523) and the folded two pair with a flush draw
 *     (0b9a6041) are calls; bare aces on a three-flush board (30feaf0f), weak trips on a tripled board (531f3bd8)
 *     and one pair with no draw (ca59a45b) stay folds. Through the engine's own decide call, option off: no
 *     receipt of the option fires.
 *  6. A raise, a multiway spot, PLO6 and tournaments are never anchored.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { replayAt, replayProfiles, stateAt } from './HorseComplaintReplay.js';
import {
  OMAHA_EV_UNKNOWN_READ,
  omahaFacingBetEvSpot,
  omahaFacingBetEvVerdict,
} from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_EQUILIBRIUM_ANCHOR_PRIOR_BETS,
  omahaEquilibriumAnchor,
  omahaEquilibriumAnchoredShare,
} from './HorseOmahaEquilibriumAnchor.js';
import { loadPricedStates, type PricedState } from './HorseOmahaFacingBetPriced.test-support.js';

type Arm = 'today' | 'anchor' | 'valueRecord';
interface Row {
  key: string;
  potFrac: number;
  call: Record<Arm, boolean>;
  vsValue: number;
  tie: number;
  street: string;
}

function rowOf(s: PricedState): Row | null {
  const { gs, player } = s;
  if (gs.stage !== 'turn' && gs.stage !== 'river') return null;
  const spot = omahaFacingBetEvSpot(player, gs);
  if (!spot || spot.isRaise || spot.callers + spot.allIns + spot.behind > 0) return null;
  const ctx = { rake: 0, realization: gs.stage === 'turn' ? 0.85 : 1 };
  const hole = player.cards ?? [];
  const board = gs.communityCards ?? [];
  const verdict = (share: number | null) =>
    omahaFacingBetEvVerdict(
      spot,
      hole,
      board,
      [],
      share === null ? null : { ...OMAHA_EV_UNKNOWN_READ, pricedShare: share },
      ctx
    );
  const twoStreet = spot.street === 'turn' && !spot.final && spot.bettorCanBarrelRiver !== false;
  const input = { paid: spot.paid, winnable: spot.winnable, rake: 0, twoStreet };
  const anchor = omahaEquilibriumAnchoredShare({ ...input, record: null });
  const proven = omahaEquilibriumAnchoredShare({ ...input, record: { shown: 60, value: 59 } });
  const today = verdict(null);
  if (!today || !anchor || !proven) return null;
  const a = verdict(anchor.share);
  const p = verdict(proven.share);
  if (!a || !p) return null;
  return {
    key: `${String(gs.gameVariant).toLowerCase()}|${gs.stage}`,
    potFrac: spot.potFrac,
    street: gs.stage,
    vsValue: a.vsValue,
    tie: a.pTie,
    call: { today: today.call, anchor: a.call, valueRecord: p.call },
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

describe('LAW: a heads-up bettor with no record is priced at the balanced share, and only his own shown bets move it', () => {
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

  it('only his own shown bets move it: value shown lowers it, weak shown raises it, weighted by sample', () => {
    const at = (shown: number, value: number) =>
      omahaEquilibriumAnchoredShare({
        paid: 100,
        winnable: 200,
        rake: 0,
        twoStreet: false,
        record: shown > 0 ? { shown, value } : null,
      })!.share;
    const q0 = at(0, 0);
    expect(q0).toBeCloseTo(1 / 3, 10);
    let last = q0;
    for (const n of [1, 2, 4, 8, 16, 40]) {
      const q = at(n, n);
      expect(q).toBeLessThan(last);
      expect(q).toBeCloseTo(
        (OMAHA_EQUILIBRIUM_ANCHOR_PRIOR_BETS * q0) / (OMAHA_EQUILIBRIUM_ANCHOR_PRIOR_BETS + n),
        10
      );
      last = q;
    }
    expect(at(8, 8)).toBeCloseTo(q0 / 2, 10);
    expect(at(40, 40)).toBeCloseTo(q0 / 6, 10);
    // shown weak raises it; a bettor shown weak half the time is priced above the balanced share
    expect(at(4, 0)).toBeGreaterThan(q0);
    expect(at(40, 20)).toBeGreaterThan(q0);
    expect(at(40, 20)).toBeLessThanOrEqual(0.65);
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
        `[equilibrium anchor] ${key} bets of ${from} pot and over, n ${today.n}: a pure bluff breaks even at ` +
          `${(100 * today.breakEven).toFixed(1)}% folds; today ${(100 * today.fold).toFixed(1)}%, anchor ` +
          `${(100 * anchor.fold).toFixed(1)}%, bettor shown value 59 of 60 ${(100 * proven.fold).toFixed(1)}%`
      );
      expect(today.n, key).toBeGreaterThanOrEqual(20);
      expect(today.fold, key).toBeGreaterThan(today.breakEven);
      expect(anchor.fold, key).toBeLessThan(today.fold);
      expect(proven.fold, key).toBeGreaterThanOrEqual(anchor.fold);
    }
  });

  it('no river call on the anchor without a share against his value region', () => {
    const river = rows.filter((r) => r.street === 'river');
    expect(river.length).toBeGreaterThan(200);
    const without = river.filter((r) => r.vsValue <= 1e-9 && r.tie <= 1e-9);
    expect(without.length).toBeGreaterThan(20);
    expect(without.filter((r) => r.call.anchor).length).toBe(0);
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
        ...(on ? { omahaFacingBetPriorIsEquilibriumAnchored: true } : {}),
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
        expect(
          Object.keys(off.receipts).some((r) => r.startsWith('omaha_equilibrium_anchor'))
        ).toBe(false);
        expect(top(on.kinds)).toBe(want);
        expect(on.receipts.omaha_equilibrium_anchor_priced ?? 0).toBeGreaterThan(0);
        if (want === 'call')
          expect(on.receipts.omaha_equilibrium_anchor_changed ?? 0).toBeGreaterThan(0);
      }, 120_000);
  });

  it('a raise and a multiway spot are never anchored (source: the one call site)', () => {
    const src = readFileSync(join(__dirname, 'HorseLogic.ts'), 'utf8');
    expect(
      src.includes(
        'if (equilibriumAnchor && !spot.isRaise && spot.callers + spot.allIns + spot.behind === 0) {'
      )
    ).toBe(true);
    expect(
      /const equilibriumAnchor =\s+opts\.omahaFacingBetPriorIsEquilibriumAnchored === true &&\s+!isTournamentMode\(gs\) &&\s+\(\(player\.cards \?\? \[\]\)\.length === 4 \|\| \(player\.cards \?\? \[\]\)\.length === 5\);/.test(
        src
      )
    ).toBe(true);
    const anchor = readFileSync(join(__dirname, 'HorseOmahaEquilibriumAnchor.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const banned of ['omahaOpponentKindOf', 'is_horse', 'humanUserIds', 'username', 'user_id'])
      expect(anchor.includes(banned), banned).toBe(false);
  });
});
