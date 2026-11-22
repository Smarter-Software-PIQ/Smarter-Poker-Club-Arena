/**
 * horseRiverNoBlockerBet (lane RIVER-BLOCK 2026-11-19, default OFF; HorseRiverNoBlockerBet.ts). Owner order 2026-11-19 16:47
 * America/Chicago: "REMOVE BLOCKER BETS ON THE RIVER FOR HORSES, THEY ARE ALMOST ALWAYS WEAKNESS AND THEY ALMOST ALWAYS FOLD AFTER
 * BLOCK BETTING TO A BIG RAISE". Spots from the anonymised fixtures shared with HorseOmahaSmallBet.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import { fastRandom, seedFastRandom, variantInfo } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { omahaCardImpactResetCache } from './HorseOmahaCardImpact.js';
import {
  RIVER_NO_BLOCKER_BET_MIN_SHARE,
  riverNoBlockerBetSpot,
  riverNoBlockerBetVerdict,
} from './HorseRiverNoBlockerBet.js';
import { OPTION_SWITCH_NAMES } from './HorseOptionSwitch.js';
import { LIVE_OPTIONS } from './HorseOmahaPricedRules.test-support.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import ACES from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';
import STRAIGHT from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
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
const acesTurn = node(ACES, 16);
const acesRiver = node(ACES, 18);
const straightRiver = node(STRAIGHT, 18);
const missedRiver = node(ACES, 18, { hole: 'TsTdAcKd6c', board: 'Th9h4c2s3s' });
const completedRiver = node(ACES, 18, { hole: 'TsTdAcKd6c', board: 'Th9h4c2s8h' });
// A-K-T-7-5 (no flush possible, unpaired): Q-J makes the nut straight; 2-3-4-6-8 holds nothing.
const nutRiver = node(ACES, 18, { hole: 'QsJd2c3c4d', board: 'AhKdTc7s5h' });
const airRiver = node(ACES, 18, { hole: '2c3c4d6s8d', board: 'AhKdTc7s5h' });
const RIVERS = [acesRiver, straightRiver, missedRiver, completedRiver, nutRiver, airRiver];
const SEEDS = [1, 7, 42, 99, 2026, 3, 11, 17];

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  omahaCardImpactResetCache();
});
const bet = (amount: number): HorseDecision => ({ action: 'bet', amount, thinkTime: 0 });
const bytes = (d: unknown): string => JSON.stringify(d, (k, v) => (/Ms$/.test(k) ? undefined : v));
function decide(build: () => Node, opts: HorseDecideOpts, seed: number) {
  HorseMind.reset();
  vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => null) as never);
  enableBrainTelemetry();
  drainFires();
  seedFastRandom(seed);
  const st = build();
  const d = withFrozenDecisionClock(() =>
    HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...opts,
    } as never)
  );
  const out = {
    st,
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
/** Hold'em: the same river node played as NLH with two hole cards. */
const holdem = (build: () => Node, hole: string, board: string): Node => {
  const st = build();
  st.hero.cards = cards(hole);
  st.gs.communityCards = cards(board);
  st.gs.gameVariant = 'nlh' as never;
  st.gs.bettingStructure = 'no_limit';
  return st;
};

describe('horseRiverNoBlockerBet: the option', () => {
  it('is a registered switch name, read as === true', () => {
    expect(OPTION_SWITCH_NAMES).toContain('horseRiverNoBlockerBet');
  });
  it('states the measured threshold: PLO 40% of the pot, hold-em 25%', () => {
    expect(RIVER_NO_BLOCKER_BET_MIN_SHARE).toEqual({ omaha: 0.4, holdem: 0.25 });
  });
});

describe('horseRiverNoBlockerBet: the spot', () => {
  it('a PLO river first bet under 40% of the pot is in scope; at or over it, or an all-in, is not', () => {
    const st = acesRiver();
    const pot = st.gs.pot;
    for (const share of [0.1, 0.2, 0.25, 0.33, 0.39])
      expect(
        riverNoBlockerBetSpot(bet(Math.max(1, Math.floor(share * pot))), st.hero, st.gs)
      ).not.toBeNull();
    expect(riverNoBlockerBetSpot(bet(Math.ceil(0.4 * pot)), st.hero, st.gs)).toBeNull();
    expect(riverNoBlockerBetSpot(bet(pot), st.hero, st.gs)).toBeNull();
    expect(riverNoBlockerBetSpot({ action: 'all_in', thinkTime: 0 }, st.hero, st.gs)).toBeNull();
    expect(riverNoBlockerBetSpot({ action: 'check', thinkTime: 0 }, st.hero, st.gs)).toBeNull();
    expect(riverNoBlockerBetSpot(bet(st.hero.stack), st.hero, st.gs)).toBeNull();
  });
  it('the turn is never in scope', () => {
    const st = acesTurn();
    expect(
      riverNoBlockerBetSpot(bet(Math.max(1, Math.floor(0.1 * st.gs.pot))), st.hero, st.gs)
    ).toBeNull();
  });
  it('hold-em: under 25% of the pot is in scope, 25% and over is not', () => {
    const st = holdem(airRiver, '2c3d', 'AhKdTc7s5h');
    const pot = st.gs.pot;
    expect(
      riverNoBlockerBetSpot(bet(Math.max(1, Math.floor(0.2 * pot))), st.hero, st.gs)
    ).not.toBeNull();
    expect(riverNoBlockerBetSpot(bet(Math.ceil(0.25 * pot)), st.hero, st.gs)).toBeNull();
  });
  it('the threshold bet is at least the threshold share of the pot', () => {
    for (const build of RIVERS) {
      const st = build();
      const spot = riverNoBlockerBetSpot(
        bet(Math.max(1, Math.floor(0.1 * st.gs.pot))),
        st.hero,
        st.gs
      );
      if (!spot || spot.thresholdAllIn) continue;
      expect(spot.thresholdAmount / st.gs.pot).toBeGreaterThanOrEqual(spot.threshold - 1e-9);
    }
  });
});

describe('horseRiverNoBlockerBet: the verdict', () => {
  it('a small PLO river bet becomes the check or the threshold bet, never a bet under the threshold', () => {
    for (const build of RIVERS) {
      const st = build();
      for (const share of [0.1, 0.2, 0.25, 0.35]) {
        const v = riverNoBlockerBetVerdict(
          bet(Math.max(1, Math.floor(share * st.gs.pot))),
          st.hero,
          st.gs,
          null
        );
        if (v.changed === null) continue;
        expect(['check', 'bet', 'all_in']).toContain(v.decision.action);
        if (v.decision.action === 'bet')
          expect(v.decision.amount! / st.gs.pot).toBeGreaterThanOrEqual(0.4 - 1e-9);
        if (v.priced) expect(v.changed === 'resized_priced').toBe(v.evBet! > v.evCheck!);
      }
    }
  });
  it('hold-em (not priceable): air checks, the river nuts bets the threshold size', () => {
    const air = holdem(airRiver, '2c3d', 'AhKdTc7s5h');
    const va = riverNoBlockerBetVerdict(
      bet(Math.max(1, Math.floor(0.1 * air.gs.pot))),
      air.hero,
      air.gs,
      null
    );
    expect(va.changed).toBe('checked');
    expect(va.decision.action).toBe('check');
    expect(va.decision.amount).toBeUndefined();
    const nuts = holdem(airRiver, 'QsJd', 'AhKdTc7s5h');
    const vn = riverNoBlockerBetVerdict(
      bet(Math.max(1, Math.floor(0.1 * nuts.gs.pot))),
      nuts.hero,
      nuts.gs,
      null
    );
    expect(vn.changed).toBe('resized_nuts');
    expect(vn.decision.action).toBe('bet');
    expect(vn.decision.amount! / nuts.gs.pot).toBeGreaterThanOrEqual(0.25 - 1e-9);
  });
});

describe('horseRiverNoBlockerBet: the rule keeps the decision it replaces', () => {
  // AUDIT-48 river lane (2026-11-19): on the live switch set every PLO4/PLO5 heads-up blocker bet the option resized to the
  // threshold bet came back from legalize as {action, amount, thinkTime} only, so its Phase 10/11 policy receipt was gone,
  // horsePolicyOwnership threw and the safety net checked (phase15_brain_exception) instead of the verdict.
  it('a resized or checked blocker bet keeps every other field of the decision (the policy receipts)', () => {
    const rule = (HorseLogic as unknown as Record<string, (...a: unknown[]) => HorseDecision>)[
      'riverNoBlockerBetRule'
    ].bind(HorseLogic);
    let resized = 0;
    let checked = 0;
    for (const build of RIVERS) {
      const st = build();
      const receipt = { marker: 'phase11-receipt' };
      const input = {
        ...bet(Math.max(1, Math.floor(0.1 * st.gs.pot))),
        omahaVariantPolicy: receipt,
      } as unknown as HorseDecision;
      HorseMind.reset();
      const out = rule(
        input,
        st.hero,
        st.gs,
        variantInfo('plo5'),
        { horseRiverNoBlockerBet: true, mind: false },
        false
      );
      if (out === input) continue;
      expect((out as unknown as { omahaVariantPolicy?: unknown }).omahaVariantPolicy).toBe(receipt);
      if (out.action === 'check') {
        checked++;
        expect(out.amount).toBeUndefined();
      } else {
        resized++;
        expect(['bet', 'all_in']).toContain(out.action);
        if (out.action === 'bet')
          expect(out.amount! / st.gs.pot).toBeGreaterThanOrEqual(0.4 - 1e-9);
      }
    }
    expect(resized).toBeGreaterThan(0);
    expect(checked).toBeGreaterThan(0);
  });
});

describe('horseRiverNoBlockerBet off', () => {
  it('unset, false and a truthy non-boolean decide byte-identically and draw the same randoms', () => {
    const base: HorseDecideOpts = { omahaCardImpact: true, omahaSmallBetIsPriced: true };
    for (const build of [acesTurn, ...RIVERS])
      for (const seed of SEEDS.slice(0, 3)) {
        const unset = decide(build, base, seed);
        for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
          const off = decide(build, { ...base, horseRiverNoBlockerBet: v }, seed);
          expect(off.bytes).toEqual(unset.bytes);
          expect(off.next).toEqual(unset.next);
          expect(off.fires.filter((f) => f.startsWith('river_no_blocker_bet'))).toEqual([]);
        }
      }
  });
});

describe('horseRiverNoBlockerBet on (decide level)', () => {
  const base: HorseDecideOpts = { omahaCardImpact: true, omahaSmallBetIsPriced: true };
  const smallRiverBet = (r: ReturnType<typeof decide>) =>
    r.d.action === 'bet' &&
    String(r.st.gs.stage) === 'river' &&
    (r.d.amount ?? 0) / r.st.gs.pot < RIVER_NO_BLOCKER_BET_MIN_SHARE.omaha - 1e-9;
  it('a Horse makes no PLO river bet under 40% of the pot (the option off makes some on these spots)', () => {
    let offSmall = 0;
    let onSmall = 0;
    let changed = 0;
    for (const build of RIVERS)
      for (const seed of SEEDS) {
        const off = decide(build, base, seed);
        const on = decide(build, { ...base, horseRiverNoBlockerBet: true }, seed);
        if (smallRiverBet(off)) offSmall++;
        if (smallRiverBet(on)) onSmall++;
        expect(on.refused).toBeNull();
        if (on.bytes !== off.bytes) {
          changed++;
          expect(smallRiverBet(off)).toBe(true);
          expect(
            on.fires.some((f) =>
              [
                'river_no_blocker_bet_checked',
                'river_no_blocker_bet_resized_priced',
                'river_no_blocker_bet_resized_nuts',
              ].includes(f)
            )
          ).toBe(true);
        }
      }
    expect(offSmall).toBeGreaterThan(0);
    expect(onSmall).toBe(0);
    expect(changed).toBe(offSmall);
  });
  // AUDIT-48 river lane (2026-11-19): replaying the 48 hours of Horse river bets against persons on the live switch set,
  // every PLO4/PLO5 heads-up spot the option changed lost its Phase 10/11 policy receipt (legalize returns only
  // action, amount and think time), so horsePolicyOwnership threw and the safety net checked instead of the
  // rule's verdict (phase15_brain_exception). A changed decision keeps every field of the decision it replaces.
  it('a changed decision keeps its policy receipts: no brain exception, the verdict reaches the table', () => {
    let changed = 0;
    // the production option set of 2026-11-16 (LIVE_OPTIONS) with the priced small bet, the base the receipts come from
    const live: HorseDecideOpts = { ...LIVE_OPTIONS, omahaSmallBetIsPriced: true };
    for (const build of RIVERS)
      for (const seed of SEEDS) {
        const off = decide(build, live, seed);
        const on = decide(build, { ...live, horseRiverNoBlockerBet: true }, seed);
        expect(on.fires).not.toContain('phase15_brain_exception');
        if (on.bytes === off.bytes) continue;
        changed++;
        expect(on.d.policyOwnership).toBeDefined();
        expect(on.d.omahaVariantPolicy !== undefined).toBe(off.d.omahaVariantPolicy !== undefined);
        expect(on.d.plo4Policy !== undefined).toBe(off.d.plo4Policy !== undefined);
        if (
          on.fires.includes('river_no_blocker_bet_resized_priced') ||
          on.fires.includes('river_no_blocker_bet_resized_nuts')
        )
          expect(['bet', 'all_in']).toContain(on.d.action);
        if (on.fires.includes('river_no_blocker_bet_checked')) expect(on.d.action).toBe('check');
      }
    expect(changed).toBeGreaterThan(0);
  });
  it('the turn is unchanged with the option on', () => {
    for (const seed of SEEDS) {
      const off = decide(acesTurn, base, seed);
      const on = decide(acesTurn, { ...base, horseRiverNoBlockerBet: true }, seed);
      expect(on.bytes).toEqual(off.bytes);
      expect(on.next).toEqual(off.next);
    }
  });
  it('a tournament river is unchanged with the option on', () => {
    for (const build of RIVERS)
      for (const seed of SEEDS.slice(0, 3)) {
        const mk = () => {
          const st = build();
          st.gs.gameMode = 'tournament' as never;
          return st;
        };
        const off = decide(mk, base, seed);
        const on = decide(mk, { ...base, horseRiverNoBlockerBet: true }, seed);
        expect(on.bytes).toEqual(off.bytes);
      }
  });
});

// MATHCORE ask (INTEGRATE-6, 2026-11-19): responseValidation admits a wager_rules change only from an enumerated
// list; a change it does not admit is an invalid response and the lane plays its CHECK/FOLD fallback. The option's
// two changes (a small river bet -> the check; a small river bet -> the threshold bet) must both be admitted.
describe('horseRiverNoBlockerBet: both of its changes pass the worker receipt validator', () => {
  const base: HorseDecideOpts = { omahaCardImpact: true, omahaSmallBetIsPriced: true };
  it('PLO: every changed decision is admitted, and the check is among them', () => {
    const kinds = new Map<string, number>();
    for (const build of RIVERS)
      for (const seed of SEEDS) {
        const off = decide(build, base, seed);
        const on = decide(build, { ...base, horseRiverNoBlockerBet: true }, seed);
        if (on.bytes === off.bytes) continue;
        const k = `${off.d.action}->${on.d.action}`;
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
        expect(on.refused, `${k} seed ${seed}`).toBeNull();
      }
    expect(kinds.get('bet->check') ?? 0).toBeGreaterThan(0);
  });
});

describe('horseRiverNoBlockerBet: PLO6 is out of scope (owner 2026-11-19 8:26 PM Chicago)', () => {
  it('a PLO6 river first bet under 40% of the pot is not in scope; PLO5 and hold-em still are', () => {
    const st = acesRiver();
    const small = bet(Math.max(1, Math.floor(0.2 * st.gs.pot)));
    expect(riverNoBlockerBetSpot(small, st.hero, st.gs)).not.toBeNull();
    const six = acesRiver();
    six.gs.gameVariant = 'plo6' as never;
    six.hero.cards = [...(six.hero.cards ?? []), ...cards('2d')];
    expect(riverNoBlockerBetSpot(small, six.hero, six.gs)).toBeNull();
    const nlh = holdem(acesRiver, 'AsKd', 'Th9h4c2s3s');
    expect(
      riverNoBlockerBetSpot(bet(Math.max(1, Math.floor(0.1 * nlh.gs.pot))), nlh.hero, nlh.gs)
    ).not.toBeNull();
  });
});
