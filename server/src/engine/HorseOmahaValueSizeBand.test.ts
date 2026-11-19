/**
 * omahaValueSizeIsUnreadable (WooWoo audit NUT-SIZE, owner 2026-11-18 23:00 Chicago: nut bets "LIKE
 * 80-95% POT", not the full pot every time). The spots are the recorded complaint nodes the nut-size
 * suite already uses (HorseOmahaMadeHandDefense.test.ts: hands 59414191 and 59401453, public records;
 * the nut hands are that suite's own variations), so no recorded player's cards are added here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import {
  OMAHA_VALUE_SIZE_BAND_HIGH,
  OMAHA_VALUE_SIZE_BAND_LOW,
  OMAHA_VALUE_SIZE_FULL_POT_KEEP,
  omahaValueSizeBand,
  omahaValueSizeBandHolds,
  withoutValueSizeStamp,
} from './HorseOmahaValueSizeBand.js';
import {
  __resetValueSizeBandWagers,
  auditHorseRiverValue,
  noteValueSizeBandWager,
} from './HorseRiverValueAudit.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import SET_RAISES_TURN from './horseComplaints/plo5-set-raises-a-pot-turn-lead-on-the-straight-card.fixture.json';
import TOP_SET_RIVER from './horseComplaints/plo5-top-set-jams-over-a-pot-river-lead.fixture.json';

const FA = SET_RAISES_TURN as unknown as ComplaintFixture;
const F1 = TOP_SET_RIVER as unknown as ComplaintFixture;
const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  (text.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUITS[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = Array.from({ length: 120 }, (_, i) => i + 1);

function spot(
  base: ComplaintFixture,
  ord: number,
  hole?: string,
  variant?: 'plo4' | 'plo5' | 'plo6'
) {
  const fx = JSON.parse(JSON.stringify(base)) as ComplaintFixture;
  const node = fx.actions.find((a) => a.ord === ord)!;
  if (hole) fx.hole[String(node.seat)] = cards(hole);
  if (variant) {
    fx.variant = variant;
    node.publicNode!.variant = variant;
  }
  return stateAt(fx, node);
}
type Built = ReturnType<typeof spot>;
interface Run {
  action: string;
  amount: number | null;
  fires: string[];
}
function decideMany(s: Built, opts: Record<string, unknown>, seeds = SEEDS): Run[] {
  enableBrainTelemetry();
  return seeds.map((seed) => {
    seedFastRandom(seed);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: true,
      omahaNutClassValueSize: true,
      ...opts,
    } as never);
    return {
      action: d.action,
      amount: typeof d.amount === 'number' ? d.amount : null,
      fires: drainFires().map((f) => f.feature),
    };
  });
}
const ON = { omahaValueSizeIsUnreadable: true };
const NUT_SPOTS: Array<[string, () => Built, number, 'flop' | 'turn' | 'river']> = [
  ['flop: top set, no straight or flush possible', () => spot(FA, 15, 'KcKh7c7hAs'), 56, 'flop'],
  ['turn: the nut straight, no flush possible', () => spot(F1, 20, '9h7hKdKs2s'), 100, 'turn'],
  ['river: the nut straight', () => spot(FA, 22, 'AhQh7c7h3s'), 420, 'river'],
];

afterEach(() => __resetValueSizeBandWagers());

describe('omahaValueSizeIsUnreadable: a nut-class wager is not always the full pot', () => {
  for (const [name, build, pot, street] of NUT_SPOTS)
    it(`${name}: on, a nut bet is the full pot or 80-95% of it, both occur, never anything else`, () => {
      const s = build();
      expect(omahaNutClassNow(s.hero, s.gs)).toBe(true);
      const runs = decideMany(s, ON).filter((r) => r.action === 'bet');
      expect(runs.length).toBeGreaterThan(0);
      const band = runs.filter((r) => r.amount! < pot);
      for (const r of runs) {
        expect(r.amount).not.toBeNull();
        if (r.amount === pot) continue;
        expect(r.amount!).toBeGreaterThanOrEqual(
          Math.round(pot * OMAHA_VALUE_SIZE_BAND_LOW * 100) / 100
        );
        expect(r.amount!).toBeLessThanOrEqual(
          Math.round(pot * OMAHA_VALUE_SIZE_BAND_HIGH * 100) / 100
        );
      }
      // The band carries most nut bets on the flop (keep 0.094) and about half on the turn and river.
      expect(band.length).toBeGreaterThan(0);
      expect(band.length / runs.length).toBeGreaterThan(
        (1 - OMAHA_VALUE_SIZE_FULL_POT_KEEP[street]) * 0.6
      );
      // The sizes vary inside the band (a uniform draw), not one fixed size.
      expect(new Set(band.map((r) => r.amount)).size).toBeGreaterThan(5);
      expect(runs.filter((r) => r.fires.includes('omaha_value_size_band_applied')).length).toBe(
        band.length
      );
    });

  it('the full pot stays in the nut range at the measured street share (it is not abandoned)', () => {
    const s = spot(FA, 22, 'AhQh7c7h3s');
    const runs = decideMany(s, ON).filter((r) => r.action === 'bet');
    const full = runs.filter((r) => r.amount === 420);
    expect(full.length).toBeGreaterThan(0);
    expect(full.every((r) => r.fires.includes('omaha_value_size_full_pot_kept'))).toBe(true);
  });

  it('off (unset, false or a truthy non-boolean) is identical, draw for draw, and every nut bet is the full pot', () => {
    for (const [, build, pot] of NUT_SPOTS) {
      const s = build();
      const base = decideMany(s, {});
      const asPairs = (r: Run[]) => r.map((x) => [x.action, x.amount]);
      expect(asPairs(decideMany(s, { omahaValueSizeIsUnreadable: false }))).toEqual(asPairs(base));
      expect(asPairs(decideMany(s, { omahaValueSizeIsUnreadable: 1 }))).toEqual(asPairs(base));
      for (const r of base.filter((x) => x.action === 'bet')) expect(r.amount).toBe(pot);
      expect(base.some((r) => r.fires.some((f) => f.startsWith('omaha_value_size_')))).toBe(false);
    }
  });

  it('a hand that is not nut class keeps its size, the full pot included (the full pot is not nut-only)', () => {
    const s = spot(F1, 20);
    expect(omahaNutClassNow(s.hero, s.gs)).toBe(false);
    const asPairs = (r: Run[]) => r.map((x) => [x.action, x.amount]);
    expect(asPairs(decideMany(s, ON))).toEqual(asPairs(decideMany(s, {})));
    const full: HorseDecision = { action: 'bet', amount: 100, thinkTime: 0 };
    expect(
      omahaValueSizeBand(full, s.hero, s.gs, { keepUnit: 0.99, bandUnit: 0.5 }, () => false)
    ).toEqual({ decision: full, changed: null });
  });

  it('PLO6 and a tournament are unchanged', () => {
    const six = spot(F1, 20, '9h7hKdKs2s3d', 'plo6');
    const asPairs = (r: Run[]) => r.map((x) => [x.action, x.amount]);
    expect(asPairs(decideMany(six, ON))).toEqual(asPairs(decideMany(six, {})));
    const t = spot(F1, 20, '9h7hKdKs2s');
    (t.gs as unknown as Record<string, unknown>).gameMode = 'tournament';
    expect(asPairs(decideMany(t, ON, SEEDS.slice(0, 30)))).toEqual(
      asPairs(decideMany(t, {}, SEEDS.slice(0, 30)))
    );
  });
});

describe('omahaValueSizeBand: legal bounds', () => {
  const s = spot(F1, 20, '9h7hKdKs2s');
  const full: HorseDecision = { action: 'bet', amount: 100, thinkTime: 0 };
  const cell = (d: HorseDecision, gs = s.gs, hero = s.hero, bandUnit = 0.5, keepUnit = 0.99) =>
    omahaValueSizeBand(d, hero, gs, { keepUnit, bandUnit }, () => true);

  it('every draw lands in 80-95% of the pot increment, never above the maximum or under the minimum', () => {
    for (let i = 0; i <= 100; i++) {
      const r = cell(full, s.gs, s.hero, i / 100);
      expect(r.changed).toBe('band');
      expect(r.decision.amount!).toBeGreaterThanOrEqual(80);
      expect(r.decision.amount!).toBeLessThanOrEqual(95);
      expect(r.decision.amount!).toBeGreaterThanOrEqual(s.gs.minRaiseTo!);
      expect(r.decision.amount!).toBeLessThanOrEqual(s.gs.maxRaiseTo!);
      expect(r.decision.valueSize).toEqual({
        kind: 'unreadable_band',
        action: 'bet',
        amount: r.decision.amount,
      });
      expect(omahaValueSizeBandHolds(r.decision, s.hero, s.gs)).toBe(true);
    }
  });

  it('below the keep share the full pot stands', () => {
    expect(cell(full, s.gs, s.hero, 0.5, OMAHA_VALUE_SIZE_FULL_POT_KEEP.turn - 0.001)).toEqual({
      decision: full,
      changed: 'full_pot_kept',
    });
  });

  it('a wager under 95% of the pot, a check, a call and an all-in are never touched', () => {
    expect(cell({ action: 'bet', amount: 90, thinkTime: 0 }).changed).toBeNull();
    for (const action of ['check', 'call', 'fold', 'all_in'] as const)
      expect(cell({ action, thinkTime: 0 }).changed).toBeNull();
  });

  it('a legal minimum above the band leaves the wager as it is', () => {
    expect(cell(full, { ...s.gs, minRaiseTo: 96 }).changed).toBeNull();
    const r = cell(full, { ...s.gs, minRaiseTo: 90 }, s.hero, 0);
    expect(r.decision.amount).toBe(90);
  });

  it('a stack the pot covers keeps the all-in or full wager the stack makes', () => {
    const shortHero = { ...s.hero, stack: 100, bet: 0 };
    expect(cell(full, { ...s.gs, maxRaiseTo: 100 }, shortHero).changed).toBeNull();
    const nearHero = { ...s.hero, stack: 101, bet: 0 };
    expect(cell(full, s.gs, nearHero).changed).toBe('band');
  });

  it('a raise is sized on the pot raise increment', () => {
    const gs = {
      ...s.gs,
      currentBet: 20,
      toCall: 20,
      minRaiseTo: 40,
      maxRaiseTo: 160,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
    } as typeof s.gs;
    // pot 100 includes the 20 bet; a pot raise is to 20 + (100 + 20) = 140
    const r = omahaValueSizeBand(
      { action: 'raise', amount: 140, thinkTime: 0 },
      s.hero,
      gs,
      { keepUnit: 0.99, bandUnit: 1 },
      () => true
    );
    expect(r.decision.amount).toBe(20 + 0.95 * 120);
    const lo = omahaValueSizeBand(
      { action: 'raise', amount: 140, thinkTime: 0 },
      s.hero,
      gs,
      { keepUnit: 0.99, bandUnit: 0 },
      () => true
    );
    expect(lo.decision.amount).toBe(20 + 0.8 * 120);
  });

  it('the commit guard drops the band size when the fresh menu no longer allows it', () => {
    const banded = cell(full).decision;
    expect(omahaValueSizeBandHolds(banded, s.hero, { ...s.gs, maxRaiseTo: 50 })).toBe(false);
    expect(omahaValueSizeBandHolds(banded, s.hero, { ...s.gs, pot: 200 })).toBe(false);
    expect(omahaValueSizeBandHolds({ ...banded, valueSize: undefined }, s.hero, s.gs)).toBe(false);
    // A rebuild that replaced the amount (a withdrawn selection's baseline) keeps no band wager.
    expect(omahaValueSizeBandHolds({ ...banded, amount: 88 }, s.hero, s.gs)).toBe(false);
    expect(withoutValueSizeStamp(banded).valueSize).toBeUndefined();
  });
});

describe('the river value alarm excuses exactly an accepted band wager', () => {
  it('a band nut bet is a finding unless the table registered it', () => {
    const node = {
      status: 'captured',
      street: 'river',
      actorSeat: 1,
      variant: 'plo5',
      boardCount: 1,
      boards: ['AsKdQc7h2s'],
      pot: 100,
      currentBet: 0,
      toCall: 0,
      minRaiseTo: 2,
      maxRaiseTo: 100,
      structure: 'pot_limit',
      wagersCapped: false,
      legalActions: ['check', 'bet'],
      seats: [
        [1, 500, 0, 50, 0, 0, 0],
        [2, 500, 0, 50, 0, 0, 0],
      ],
    };
    const input = {
      variant: 'plo5',
      holeCards: new Map([['h1', { seat: 1, cards: cards('JhTd3c4c5d') }]]),
      actions: [
        {
          seat: 1,
          userId: 'h1',
          action: 'bet',
          amount: 92,
          stage: 'river',
          origin: 'horse_policy',
          publicNode: node,
        },
      ],
    } as never;
    const kinds = (bandWager?: (a: never, street: string) => boolean) =>
      auditHorseRiverValue(input, bandWager as never).findings.map((f) => f.kind);
    expect(kinds()).toContain('near_pot_wager_not_full_pot');
    expect(kinds()).toContain('nut_wager_undersized');
    expect(kinds(() => true)).toEqual([]);
    noteValueSizeBandWager('h1', 'river', 92);
  });
});
