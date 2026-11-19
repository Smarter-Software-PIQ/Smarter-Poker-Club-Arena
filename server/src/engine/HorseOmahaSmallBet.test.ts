/**
 * omahaSmallBetIsPriced (PLO Strategy lane 2026-11-18, default OFF; HorseOmahaSmallBet.ts). Recorded hands 59517323 and
 * 59521326 (anonymised fixtures shared with HorseOmahaCardImpact.test.ts) and spots built from them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  omahaCardImpact,
  omahaCardImpactAmounts,
  omahaCardImpactLine,
  omahaCardImpactRead,
  omahaCardImpactResetCache,
  omahaCardImpactResponseOf,
  omahaCardImpactScope,
} from './HorseOmahaCardImpact.js';
import {
  omahaSmallBetAmounts,
  omahaSmallBetComparesSize,
  omahaSmallBetCurve,
  omahaSmallBetVerdict,
} from './HorseOmahaSmallBet.js';
import { OMAHA_SMALL_BET_READ_REFERENCE_SHARE } from './HorseOmahaSmallBetConstants.js';
import { OPTION_SWITCH_NAMES } from './HorseOptionSwitch.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  recordedPathMatches,
  replayProfiles,
  stateAt,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import ACES from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';
import STRAIGHT from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 7, 42, 99, 2026, 3, 11, 17, 23, 31];
const ON: HorseDecideOpts = { omahaCardImpact: true };
const HERO = 5;

type Node = ReturnType<typeof stateAt>;
const node =
  (fx: unknown, ord: number, edit: { hole?: string; board?: string } = {}) =>
  (): Node => {
    const f = JSON.parse(JSON.stringify(fx)) as ComplaintFixture;
    if (edit.hole) f.hole[String(HERO)] = cards(edit.hole);
    const n = f.actions.find((a) => a.ord === ord)!;
    if (edit.board) n.publicNode!.boards = [edit.board];
    return stateAt(f, n);
  };
const acesFlop = node(ACES, 14);
const acesTurn = node(ACES, 16);
const acesRiver = node(ACES, 18);
const straightTurn = node(STRAIGHT, 16);
const straightRiver = node(STRAIGHT, 18);
// The nut straight (3-6 on 2-4-5-9) with the nut heart draw, out of position.
const freerollTurn = node(STRAIGHT, 16, { hole: '6sAh3hKsQd', board: '2d4h5s9h' });
// Top set after the flop and turn bets were called; the river misses the
// heart draw and the straight draws around ten-nine.
const missedRiver = node(ACES, 18, { hole: 'TsTdAcKd6c', board: 'Th9h4c2s3s' });
// The same hand and line; the river completes the flush and three straights.
const completedRiver = node(ACES, 18, { hole: 'TsTdAcKd6c', board: 'Th9h4c2s8h' });
const ALL = [
  acesTurn,
  acesRiver,
  straightTurn,
  straightRiver,
  freerollTurn,
  missedRiver,
  completedRiver,
];

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  omahaCardImpactResetCache();
});
const check: HorseDecision = { action: 'check', thinkTime: 0 };
const bet = (amount: number): HorseDecision => ({ action: 'bet', amount, thinkTime: 0 });
const bytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
function decide(build: () => Node, opts: HorseDecideOpts, seed: number) {
  HorseMind.reset();
  vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => null) as never);
  enableBrainTelemetry();
  drainFires();
  seedFastRandom(seed);
  const st = build();
  const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
    telemetry: true,
    ...opts,
  } as never);
  const out = {
    d,
    bytes: bytes(d),
    next: fastRandom(),
    fires: drainFires().map((f) => f.feature),
    refused: horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
      player: st.hero,
      gameState: st.gs,
    }),
  };
  vi.restoreAllMocks();
  return out;
}

describe('omahaSmallBetIsPriced off', () => {
  it('unset, false and a truthy non-boolean decide byte-identically and draw the same randoms', () => {
    for (const build of [acesFlop, ...ALL])
      for (const seed of SEEDS.slice(0, 4)) {
        const unset = decide(build, {}, seed);
        for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
          const off = decide(build, { omahaSmallBetIsPriced: v }, seed);
          expect(off.bytes).toEqual(unset.bytes);
          expect(off.next).toEqual(unset.next);
          expect(off.fires.filter((f) => f.startsWith('omaha_small_bet'))).toEqual([]);
        }
      }
  });
  it('the card-impact model is unchanged when no response curve is given', () => {
    const st = acesRiver();
    const scope = omahaCardImpactScope(st.hero, st.gs)!;
    const input = {
      hole: st.hero.cards,
      board: st.gs.communityCards ?? [],
      dead: st.hero.knownDeadCards ?? [],
      pot: st.gs.pot,
      heroStack: st.hero.stack,
      oppStack: scope.opponent.stack,
      heroCloses: scope.heroCloses,
      line: omahaCardImpactLine(st.hero, scope.opponent, st.gs),
      read: omahaCardImpactRead(null),
      amounts: omahaCardImpactAmounts(st.hero, scope.opponent, st.gs),
      seedSalt: 7,
    };
    const plain = JSON.stringify(omahaCardImpact(input));
    omahaCardImpactResetCache();
    expect(JSON.stringify(omahaCardImpact({ ...input, responseAt: undefined }))).toBe(plain);
    omahaCardImpactResetCache();
    expect(JSON.stringify(omahaCardImpact({ ...input, responseAt: [] }))).toBe(plain);
  });
});

describe('the response curve', () => {
  const read = omahaCardImpactRead(null);
  it('is the model level at the reference bet and the measured shape elsewhere, for a person and a Horse apart', () => {
    for (const street of ['turn', 'river'] as const)
      for (const horse of [false, true]) {
        const c = omahaSmallBetCurve('plo5', street, horse, read)!;
        const ref = omahaCardImpactResponseOf(c, OMAHA_SMALL_BET_READ_REFERENCE_SHARE);
        expect(ref.cont).toBeCloseTo(1 / (1 + OMAHA_SMALL_BET_READ_REFERENCE_SHARE), 6);
        expect(c[0]).toMatchObject({ share: 0, cont: 1 });
        for (const p of c) {
          expect(p.raise).toBeGreaterThanOrEqual(0);
          expect(p.raise).toBeLessThanOrEqual(p.cont + 1e-12);
        }
      }
    const person = omahaSmallBetCurve('plo5', 'turn', false, read)!;
    const horse = omahaSmallBetCurve('plo5', 'turn', true, read)!;
    expect(JSON.stringify(person)).not.toBe(JSON.stringify(horse));
  });
  it('moves continuously with his measured continue rate', () => {
    const at = (rate: number) =>
      omahaCardImpactResponseOf(
        omahaSmallBetCurve('plo4', 'turn', false, { ...read, measured: true, continueRate: rate })!,
        0.25
      ).cont;
    const xs = [0.3, 0.31, 0.5, 0.7, 0.71];
    const ys = xs.map(at);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    expect(Math.abs(ys[1] - ys[0])).toBeLessThan(0.02);
  });
});

describe('the verdict', () => {
  it('never makes a nut-class bet smaller, never touches an all-in, never makes a bet bigger', () => {
    const st = freerollTurn();
    expect(omahaSmallBetVerdict(bet(442), st.hero, st.gs, null)).toMatchObject({
      changed: null,
      kept: 'nut_class',
    });
    const all: HorseDecision = { action: 'all_in', amount: st.hero.stack, thinkTime: 0 };
    expect(omahaSmallBetVerdict(all, st.hero, st.gs, null)).toMatchObject({
      changed: null,
      kept: 'all_in',
    });
    for (const build of ALL) {
      const s = build();
      const small = omahaSmallBetAmounts(s.hero, s.gs);
      for (const a of small) {
        const v = omahaSmallBetVerdict(bet(a), s.hero, s.gs, null);
        if (v.changed) expect(v.decision.amount!).toBeLessThan(a);
      }
    }
  });
  it('the flop is not priced: the owner decision stands', () => {
    const st = acesFlop();
    expect(omahaSmallBetVerdict(check, st.hero, st.gs, null)).toMatchObject({
      changed: null,
      kept: 'unpriced',
    });
  });
  it('a small bet replaces the owner only by the margin, at a legal small size', () => {
    for (const build of ALL) {
      const st = build();
      const v = omahaSmallBetVerdict(check, st.hero, st.gs, null);
      if (v.changed === null) continue;
      expect(v.best!.ev).toBeGreaterThanOrEqual(v.evOwner! + v.margin);
      expect(omahaSmallBetAmounts(st.hero, st.gs)).toContain(v.decision.amount);
    }
  });
});

describe('omahaSmallBetIsPriced on, through decide', () => {
  it('reaches the decision, fires its receipts and every changed decision passes the receipt validator', () => {
    let changed = 0;
    for (const build of ALL) {
      const off = decide(build, {}, 1);
      const on = decide(build, { omahaSmallBetIsPriced: true }, 1);
      expect(on.refused).toBeNull();
      if (on.bytes !== off.bytes) {
        changed++;
        expect(
          on.fires.some(
            (f) => f === 'omaha_small_bet_priced_bet' || f === 'omaha_small_bet_resized'
          )
        ).toBe(true);
      }
      expect(on.fires.some((f) => f.startsWith('omaha_small_bet'))).toBe(true);
    }
    expect(changed).toBeGreaterThan(0);
  });
});

describe('omahaSmallBetIsPriced receipts describe the final action (blockbet review N2)', () => {
  // Proposed after the limped-pot floor and settled when decide has its final decision: a small-bet receipt fires
  // only on the bet that was placed, and its _vetoed receipt fires when a later rule (the outermost owner rules)
  // replaced it. Every other Omaha option on, so later rules and the floor (omahaBigBetIsPotShare) all run.
  const EVERYTHING: HorseDecideOpts = Object.fromEntries(
    OPTION_SWITCH_NAMES.filter((n) => n.startsWith('omaha')).map((n) => [n, true])
  ) as HorseDecideOpts;
  it('a made receipt names a bet that stood; a replaced small bet fires _vetoed, never the made receipt', () => {
    let made = 0;
    let vetoed = 0;
    for (const opts of [
      { omahaSmallBetIsPriced: true },
      { ...EVERYTHING, omahaSmallBetIsPriced: true },
    ])
      for (const build of ALL)
        for (const seed of SEEDS.slice(0, 4)) {
          const on = decide(build, opts as HorseDecideOpts, seed);
          const small = on.fires.filter((f) =>
            /^omaha_small_bet_(priced_bet|resized)(_vetoed)?$/.test(f)
          );
          expect(small.length).toBeLessThanOrEqual(1);
          if (small.length === 0) continue;
          if (small[0].endsWith('_vetoed')) vetoed++;
          else {
            made++;
            expect(on.d.action).toBe('bet');
          }
        }
    expect(made).toBeGreaterThan(0);
    expect(vetoed).toBeGreaterThan(0);
  });
});

describe('one owner of the size (verifier D1/D2/D11, 2026-11-19)', () => {
  it('without a handed-over press the verdict is exactly the small-bet verdict', () => {
    for (const build of ALL) {
      const st = build();
      for (const d of [check, ...omahaSmallBetAmounts(st.hero, st.gs).map((a) => bet(a + 1))]) {
        const plain = JSON.stringify(omahaSmallBetVerdict(d, st.hero, st.gs, null));
        omahaCardImpactResetCache();
        expect(JSON.stringify(omahaSmallBetVerdict(d, st.hero, st.gs, null, null))).toBe(plain);
        omahaCardImpactResetCache();
      }
    }
  });
  it('a later size is priced on the same sample and curve as the placed bet, and taken only by the margin', () => {
    let compared = 0;
    for (const build of ALL) {
      const st = build();
      const v = omahaSmallBetVerdict(check, st.hero, st.gs, null);
      if (v.changed === null) continue;
      const placed = v.decision.amount!;
      for (const share of [0.4, 0.5, 1]) {
        const other = Math.round(st.gs.pot * share);
        if (!(other > placed) || other >= st.hero.stack) continue;
        const cmp = omahaSmallBetComparesSize(placed, other, st.hero, st.gs, null)!;
        expect(cmp).not.toBeNull();
        compared++;
        // the placed bet is priced exactly as the verdict priced it
        expect(cmp.evPlaced).toBeCloseTo(v.best!.ev, 6);
        expect(cmp.margin).toBe(v.margin);
        expect(cmp.takeOther).toBe(cmp.evOther >= cmp.evPlaced + cmp.margin);
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
  it('a handed-over press is one more priced candidate: chosen only when it is the best and beats the owner by the margin', () => {
    let changed = 0;
    for (const build of ALL) {
      const st = build();
      const pot = st.gs.pot;
      const press = Math.round(pot * 0.75);
      if (!(press < st.hero.stack)) continue;
      const v = omahaSmallBetVerdict(check, st.hero, st.gs, null, press);
      if (v.changed === null) continue;
      changed++;
      expect(v.best!.ev).toBeGreaterThanOrEqual(v.evOwner! + v.margin);
      if (v.changed === 'press_bet') {
        expect(v.decision.amount).toBe(press);
      } else expect(omahaSmallBetAmounts(st.hero, st.gs)).toContain(v.decision.amount);
    }
    expect(changed).toBeGreaterThan(0);
  });
  it('out of the card-impact scope (the flop) nothing is compared: the placed bet stands', () => {
    const st = acesFlop();
    expect(omahaSmallBetComparesSize(2, 10, st.hero, st.gs, null)).toBeNull();
  });
});
